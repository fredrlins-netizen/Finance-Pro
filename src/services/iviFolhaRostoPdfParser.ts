import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const execFileAsync = promisify(execFile);

export interface PdfParsedSheetData {
  sheetName: string;
  headers: string[];
  rows: Array<Record<string, unknown> & { __rowNumber: number }>;
}

export interface PdfExtractionMetadata {
  isPdf: true;
  pageCount: number;
  digitalPages: number;
  ocrPages: number;
  extractedRecords: number;
  extractionMode: 'texto_digital' | 'ocr_gemini' | 'hibrido';
}

export interface PdfFolhaRostoParseResult {
  sheets: PdfParsedSheetData[];
  pdfMetadata: PdfExtractionMetadata;
}

const CANONICAL_PDF_FIELD_ORDER: string[] = [
  '_pagina_pdf',
  'modalidade.descricao',
  'cliente.nome',
  'cliente.documento',
  'cliente.rg',
  'cliente.telefone',
  'cliente.telefone2',
  'cliente.email',
  'cliente.profissao',
  'cliente.estado_civil',
  'cliente.data_nascimento',
  'cliente.cep',
  'cliente.endereco',
  'cliente.numero',
  'cliente.complemento',
  'cliente.bairro',
  'cliente.cidade',
  'cliente.uf',
  'titular.nome',
  'titular.documento',
  'titular.rg',
  'titular.telefone',
  'titular.email',
  'banco.nome',
  'banco.febraban',
  'colaborador.nome',
  'colaborador.email',
  'colaborador.telefone',
  'admissao.contrato',
  'admissao.data',
  'admissao.tipo_origem',
  'admissao.tipo_indicacao',
  'admissao.total_parcelas',
  'admissao.parcelas_pagas',
  'admissao.parcelas_atraso',
  'admissao.parcelas_a_pagar',
  'admissao.valor_financiado',
  'admissao.valor_parcela',
  'admissao.dia_vencimento',
  'admissao.forma_pagamento',
  'admissao.taxa_administrativa',
  'admissao.parcela1',
  'admissao.marca_veiculo',
  'admissao.modelo_veiculo',
  'admissao.cor_veiculo',
  'admissao.ano_veiculo',
  'admissao.placa',
  'admissao.chassi',
  'admissao.renavam',
  'recalculo.divida_original',
  'recalculo.parcela',
  'recalculo.divida',
  'recalculo.economia',
  'empresa.codigo_unidade',
  'admissao.info1',
];

function normText(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function normKey(v: unknown): string {
  return normText(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Memory-safe random-access PDF reader (streams 64KB ranges directly from disk, supports up to 500 MB PDFs)
class DiskPdfRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  private fh: fs.promises.FileHandle;

  constructor(length: number, initialData: Uint8Array, fh: fs.promises.FileHandle) {
    super(length, initialData);
    this.fh = fh;
  }

  async requestDataRange(begin: number, end: number): Promise<void> {
    try {
      const len = Math.max(0, end - begin);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await this.fh.read(buf, 0, len, begin);
      this.onDataRange(begin, new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
    } catch {
      this.onDataRange(begin, new Uint8Array(0));
    }
  }
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
}

function reconstructPageLines(items: unknown[]): string[] {
  const rowsByY = new Map<number, Array<{ x: number; w: number; str: string }>>();

  for (const raw of items) {
    const it = raw as TextItemLike;
    const str = String(it?.str ?? '');
    if (!str) continue;
    const tr = Array.isArray(it.transform) ? it.transform : [1, 0, 0, 1, 0, 0];
    const x = Number(tr[4] ?? 0);
    const y = Number(tr[5] ?? 0);
    const yBucket = Math.round(y / 3) * 3;
    const arr = rowsByY.get(yBucket) || [];
    arr.push({ x, w: Number(it.width ?? 0), str });
    rowsByY.set(yBucket, arr);
  }

  const sortedY = [...rowsByY.keys()].sort((a, b) => b - a);
  const lines: string[] = [];

  for (const y of sortedY) {
    const segs = rowsByY.get(y)!.sort((a, b) => a.x - b.x);
    let line = '';
    let prevEnd = -1;
    for (const seg of segs) {
      const text = seg.str;
      if (!text.trim() && !line) continue;
      if (prevEnd >= 0) {
        const gap = seg.x - prevEnd;
        if (gap >= 16) {
          line += '   ';
        } else if (gap >= 3 && !line.endsWith(' ') && !text.startsWith(' ')) {
          line += ' ';
        }
      }
      line += text;
      prevEnd = seg.x + Math.max(seg.w, text.length * 4);
    }
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }

  return lines;
}

// =========================================================================
// DETERMINISTIC LABEL PARSER FOR FOLHA DE ROSTO (VEÍCULO & CARTÃO DE CRÉDITO)
// =========================================================================
const FIELD_LABEL_RULES: Array<{ varKey: string; labelPattern: string }> = [
  // Titular first so "TITULAR ..." doesn't fall into generic cliente/contrato
  { varKey: 'titular.nome', labelPattern: '(?:NOMEDOTITULAR|NOMETITULAR|TITULARDOCONTRATO|TITULAR)' },
  { varKey: 'titular.documento', labelPattern: '(?:CPFCNPJTITULAR|CPFTITULAR|CNPJTITULAR|DOCUMENTOTITULAR)' },
  { varKey: 'titular.rg', labelPattern: '(?:RGTITULAR)' },
  { varKey: 'titular.telefone', labelPattern: '(?:TELEFONETITULAR|WHATSAPPTITULAR|CELULARTITULAR)' },
  { varKey: 'titular.email', labelPattern: '(?:EMAILTITULAR)' },

  // Cliente
  { varKey: 'cliente.nome', labelPattern: '(?:CLIENTE|NOMECOMPLETO|NOMEDOCLIENTE|NOMECLIENTE|PROPONENTE|RAZAOSOCIAL)' },
  { varKey: 'cliente.documento', labelPattern: '(?:CPFMFNO|CPFMFNN|CPFMFN|CPFMF|CPFCNPJ|CNPJCPF|CPF|CNPJ|DOCUMENTO)' },
  { varKey: 'cliente.rg', labelPattern: '(?:RG|IDENTIDADE)' },
  { varKey: 'cliente.telefone', labelPattern: '(?:TELEFONE|FONE|CELULAR|CONTATO)' },
  { varKey: 'cliente.telefone2', labelPattern: '(?:WHATSAPP|TELEFONE2|FONE2)' },
  { varKey: 'cliente.profissao', labelPattern: '(?:PROFISSAO|OCUPACAO)' },
  { varKey: 'cliente.estado_civil', labelPattern: '(?:ESTADOCIVIL)' },
  { varKey: 'cliente.data_nascimento', labelPattern: '(?:DATANASCIMENTO|DATANASC|DTNASC|NASCIMENTO)' },
  { varKey: 'cliente.cep', labelPattern: '(?:CEP)' },
  { varKey: 'cliente.endereco', labelPattern: '(?:ENDERECO|LOGRADOURO)' },
  { varKey: 'cliente.bairro', labelPattern: '(?:BAIRRO)' },
  { varKey: 'cliente.cidade', labelPattern: '(?:CIDADE|MUNICIPIO)' },
  { varKey: 'cliente.uf', labelPattern: '(?:UF|ESTADO)' },
  { varKey: 'cliente.email', labelPattern: '(?:EMAIL|E-MAIL)' },

  // Banco & Colaborador
  { varKey: 'banco.nome', labelPattern: '(?:BANCO|INSTITUICAOFINANCEIRA|INSTITUICAO|FINANCEIRA|CREDOR)' },
  { varKey: 'banco.febraban', labelPattern: '(?:FEBRABAN|CODIGOFEBRABAN)' },
  { varKey: 'colaborador.nome', labelPattern: '(?:CONSULTOR|COLABORADOR|VENDEDOR|ATENDENTE|CORRETOR)' },

  // Contrato & Origem
  { varKey: 'admissao.contrato', labelPattern: '(?:CONTRATONUMERO|NUMEROCONTRATO|NOCONTRATO|NCONTRATO|NUMCONTRATO|CONTRATO)' },
  { varKey: 'admissao.data', labelPattern: '(?:DATAADMISSAO|DATACONTRATO|DATA)' },
  { varKey: 'modalidade.descricao', labelPattern: '(?:MODALIDADE|PRODUTO)' },
  { varKey: 'empresa.codigo_unidade', labelPattern: '(?:CODIGOUNIDADE|UNIDADE|FILIAL)' },

  // Parcelas & Financiamento
  { varKey: 'admissao.total_parcelas', labelPattern: '(?:PARCELASTOTAIS|TOTALDEPARCELAS|TOTALPARCELAS)' },
  { varKey: 'admissao.parcelas_pagas', labelPattern: '(?:PARCELASPAGAS)' },
  { varKey: 'admissao.parcelas_atraso', labelPattern: '(?:PARCELASEMATRASO|PARCELASATRASO)' },
  { varKey: 'admissao.parcelas_a_pagar', labelPattern: '(?:PARCELASAPAGAR|PARCELASRESTANTES)' },
  { varKey: 'admissao.valor_financiado', labelPattern: '(?:VALORFINANCIADO|VLFINANCIADO)' },
  { varKey: 'admissao.valor_parcela', labelPattern: '(?:VALORPARCELA|VALORDAPARCELA|VLPARCELA)' },
  { varKey: 'admissao.dia_vencimento', labelPattern: '(?:DIAVENCIMENTO|VENCIMENTO)' },
  { varKey: 'admissao.forma_pagamento', labelPattern: '(?:TIPOPAGAMENTO|FORMADEPAGAMENTO|FORMAPAGAMENTO)' },
  { varKey: 'admissao.taxa_administrativa', labelPattern: '(?:TAXAADMINISTRATIVA|HONORARIOS)' },
  { varKey: 'admissao.parcela1', labelPattern: '(?:1PARCELA|1APARCELA|PRIMEIRAPARCELA|PARCELA1|CUSTOSINICIAIS)' },

  // Veículo
  { varKey: 'admissao.marca_veiculo', labelPattern: '(?:MARCADOVEICULO|MARCA)' },
  { varKey: 'admissao.modelo_veiculo', labelPattern: '(?:MODELODOVEICULO|MODELO)' },
  { varKey: 'admissao.cor_veiculo', labelPattern: '(?:CORDOVEICULO|COR)' },
  { varKey: 'admissao.ano_veiculo', labelPattern: '(?:ANODOVEICULO|ANOMODELO|ANO)' },
  { varKey: 'admissao.placa', labelPattern: '(?:PLACADOVEICULO|PLACA)' },
  { varKey: 'admissao.chassi', labelPattern: '(?:CHASSI)' },
  { varKey: 'admissao.renavam', labelPattern: '(?:RENAVAM)' },

  // Recálculo
  { varKey: 'recalculo.divida_original', labelPattern: '(?:DIVIDAORIGINAL|VALORDIVIDA)' },
  { varKey: 'recalculo.parcela', labelPattern: '(?:PARCELARECALCULO|PARCELARECALCULADA)' },
  { varKey: 'recalculo.divida', labelPattern: '(?:DIVIDARECALCULO|DIVIDARECALCULADA|VALORRECALCULO)' },
  { varKey: 'recalculo.economia', labelPattern: '(?:ECONOMIAESTIMADA|ECONOMIA)' },
];

// Normalize header key prefix matching without spaces/accents/punctuation to split multi-column lines cleanly
function normalizeHeaderCandidate(rawLabel: string): string {
  return rawLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[º°]/g, 'O')
    .replace(/[^A-Z0-9-]/g, '');
}

function matchLabelToVarKey(rawLabel: string): string {
  const norm = normalizeHeaderCandidate(rawLabel);
  if (!norm) return '';
  for (const rule of FIELD_LABEL_RULES) {
    const re = new RegExp(`^${rule.labelPattern}$`);
    if (re.test(norm)) return rule.varKey;
  }
  return '';
}

function parseCompositeAddressIntoRecord(rawAddress: string, rec: Record<string, string>) {
  const clean = normText(rawAddress);
  if (!clean) return;
  rec['cliente.endereco'] = rec['cliente.endereco'] || clean;

  const cepMatch = clean.match(/\b(\d{5}-?\d{3})\b/);
  if (cepMatch && !rec['cliente.cep']) {
    rec['cliente.cep'] = cepMatch[1];
  }

  const ufMatch = clean.match(/(?:-|\/|\s)\s*([A-Z]{2})\b(?:\s*,|\s*\d{5}|$)/);
  if (ufMatch && !rec['cliente.uf']) {
    rec['cliente.uf'] = ufMatch[1];
  }

  // Pattern from embedded template: "{{cliente.endereco}}, {{cliente.numero}} - {{cliente.bairro}}, {{cliente.cidade}} - {{cliente.uf}}, {{cliente.cep}}"
  const fullMatch = clean.match(
    /^([^,]+),\s*([^-,\s]+)?\s*-\s*([^,]+),\s*([^-]+?)\s*-\s*([A-Z]{2})(?:,\s*([\d-]+))?/i
  );
  if (fullMatch) {
    rec['cliente.endereco'] = fullMatch[1].trim();
    if (fullMatch[2] && !rec['cliente.numero']) rec['cliente.numero'] = fullMatch[2].trim();
    if (fullMatch[3] && !rec['cliente.bairro']) rec['cliente.bairro'] = fullMatch[3].trim();
    if (fullMatch[4] && !rec['cliente.cidade']) rec['cliente.cidade'] = fullMatch[4].trim();
    if (fullMatch[5] && !rec['cliente.uf']) rec['cliente.uf'] = fullMatch[5].trim().toUpperCase();
    if (fullMatch[6] && !rec['cliente.cep']) rec['cliente.cep'] = fullMatch[6].trim();
  }
}

function parseDigitalFolhaRostoBlock(pageText: string): Record<string, string> {
  const rec: Record<string, string> = {};
  const lines = pageText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Detect every "LABEL:" occurrence on the line (regardless of single/multi-space gap between columns)
    const matches: Array<{ rawLabel: string; varKey: string; labelStart: number; valStart: number }> = [];
    let searchFrom = 0;
    while (searchFrom < line.length) {
      const colonIdx = line.indexOf(':', searchFrom);
      if (colonIdx === -1) break;
      searchFrom = colonIdx + 1;

      // Ignore time strings like 14:30 or URLs like http://
      if (colonIdx > 0 && colonIdx + 1 < line.length && /^\d$/.test(line[colonIdx - 1]) && /^\d$/.test(line[colonIdx + 1])) {
        continue;
      }

      const minStart = matches.length > 0 ? matches[matches.length - 1].valStart : 0;
      const prefixSlice = line.slice(minStart, colonIdx);
      const tokenMatches = [...prefixSlice.matchAll(/\S+/g)];
      if (tokenMatches.length === 0) continue;

      let matchedKey = '';
      let matchedStart = colonIdx;
      let matchedRaw = '';
      const maxWords = Math.min(4, tokenMatches.length);
      // Try longest suffix of words before ":" (e.g. "CPF TITULAR" before "TITULAR", "CONTRATO NUMERO" before "NUMERO")
      for (let count = maxWords; count >= 1; count--) {
        const firstTok = tokenMatches[tokenMatches.length - count];
        const wordStart = minStart + (firstTok.index ?? 0);
        const candidateRaw = line.slice(wordStart, colonIdx).trim();
        const vk = matchLabelToVarKey(candidateRaw);
        if (vk) {
          matchedKey = vk;
          matchedStart = wordStart;
          matchedRaw = candidateRaw;
          break;
        }
      }

      if (matchedKey) {
        let valStart = colonIdx + 1;
        while (valStart < line.length && /\s/.test(line[valStart])) valStart++;
        matches.push({
          rawLabel: matchedRaw,
          varKey: matchedKey,
          labelStart: matchedStart,
          valStart,
        });
      }
    }

    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const nextStart = i + 1 < matches.length ? matches[i + 1].labelStart : line.length;
        const val = line.slice(cur.valStart, nextStart).trim().replace(/^[:|\s]+|[\s|]+$/g, '');
        if (!val || /^[\s:._-]+$/.test(val)) continue;
        // Skip empty template placeholders if literal
        if (val.startsWith('{{') && val.endsWith('}}')) continue;
        if (cur.varKey === 'cliente.endereco') {
          parseCompositeAddressIntoRecord(val, rec);
        } else if (!rec[cur.varKey]) {
          rec[cur.varKey] = val;
        }
      }
      continue;
    }

    // Check product banner line: "PRODUTO: FINANCIAMENTO DE VEÍCULO" or "PRODUTO: CARTÃO DE CRÉDITO"
    const normL = normKey(line);
    if (!rec['modalidade.descricao']) {
      if (/financiamento de ve[ií]culo|folha de rosto.*ve[ií]culo/.test(normL)) {
        rec['modalidade.descricao'] = 'CDC Veículo';
      } else if (/cart[aã]o de cr[eé]dito|folha de rosto.*cart[aã]o/.test(normL)) {
        rec['modalidade.descricao'] = 'Cartão de Crédito';
      }
    }

    // Check date signature line e.g. "Recife, 20/05/2025" or "São Paulo, 15 de maio de 2025"
    if (!rec['admissao.data']) {
      const dateSig = line.match(/^([A-Za-zÀ-ÿ\s]{2,35}),\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/);
      if (dateSig) {
        rec['admissao.data'] = dateSig[2];
        if (!rec['cliente.cidade']) rec['cliente.cidade'] = dateSig[1].trim();
      }
    }

    // Check selected origin checkbox: "[X] INDICAÇÃO" / "(X) RÁDIO" / "☑ PROSPECÇÃO"
    if (!rec['admissao.tipo_origem']) {
      if (/(?:\[[xX]\]|\([xX]\)|☑|✔)\s*INDICAC/i.test(normL.toUpperCase())) {
        rec['admissao.tipo_origem'] = 'indicacao';
        rec['admissao.tipo_indicacao'] = rec['admissao.tipo_indicacao'] || 'Indicação';
      } else if (/(?:\[[xX]\]|\([xX]\)|☑|✔)\s*RADIO/i.test(normL.toUpperCase())) {
        rec['admissao.tipo_origem'] = 'propaganda';
        rec['admissao.tipo_indicacao'] = rec['admissao.tipo_indicacao'] || 'Rádio';
      }
    }
  }

  return rec;
}

function pageStartsNewFolhaRosto(pageText: string): boolean {
  const n = normKey(pageText);
  return (
    n.includes('dados do cliente') ||
    /(?:^|\n)\s*cliente\s*:/.test(n) ||
    /(?:^|\n)\s*nome completo\s*:/.test(n) ||
    /(?:^|\n)\s*proponente\s*:/.test(n) ||
    /folha de rosto/.test(n)
  );
}

// =========================================================================
// GEMINI 4 HYDROGEN MULTIMODAL & TEXT BATCH PARSER
// =========================================================================
function buildGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

const GEMINI_RECORD_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      pagina_pdf: { type: Type.INTEGER },
      formulario_detectado: { type: Type.STRING, description: 'veiculo ou cartao' },
      modalidade_descricao: { type: Type.STRING },
      cliente_nome: { type: Type.STRING },
      cliente_documento: { type: Type.STRING },
      cliente_rg: { type: Type.STRING },
      cliente_telefone: { type: Type.STRING },
      cliente_telefone2: { type: Type.STRING },
      cliente_email: { type: Type.STRING },
      cliente_profissao: { type: Type.STRING },
      cliente_estado_civil: { type: Type.STRING },
      cliente_data_nascimento: { type: Type.STRING },
      cliente_cep: { type: Type.STRING },
      cliente_endereco: { type: Type.STRING },
      cliente_numero: { type: Type.STRING },
      cliente_complemento: { type: Type.STRING },
      cliente_bairro: { type: Type.STRING },
      cliente_cidade: { type: Type.STRING },
      cliente_uf: { type: Type.STRING },
      titular_nome: { type: Type.STRING },
      titular_documento: { type: Type.STRING },
      titular_rg: { type: Type.STRING },
      titular_telefone: { type: Type.STRING },
      titular_email: { type: Type.STRING },
      banco_nome: { type: Type.STRING },
      banco_febraban: { type: Type.STRING },
      colaborador_nome: { type: Type.STRING },
      colaborador_email: { type: Type.STRING },
      colaborador_telefone: { type: Type.STRING },
      admissao_contrato: { type: Type.STRING },
      admissao_data: { type: Type.STRING },
      admissao_tipo_origem: { type: Type.STRING },
      admissao_tipo_indicacao: { type: Type.STRING },
      admissao_total_parcelas: { type: Type.STRING },
      admissao_parcelas_pagas: { type: Type.STRING },
      admissao_parcelas_atraso: { type: Type.STRING },
      admissao_parcelas_a_pagar: { type: Type.STRING },
      admissao_valor_financiado: { type: Type.STRING },
      admissao_valor_parcela: { type: Type.STRING },
      admissao_dia_vencimento: { type: Type.STRING },
      admissao_forma_pagamento: { type: Type.STRING },
      admissao_taxa_administrativa: { type: Type.STRING },
      admissao_parcela1: { type: Type.STRING },
      admissao_marca_veiculo: { type: Type.STRING },
      admissao_modelo_veiculo: { type: Type.STRING },
      admissao_cor_veiculo: { type: Type.STRING },
      admissao_ano_veiculo: { type: Type.STRING },
      admissao_placa: { type: Type.STRING },
      admissao_chassi: { type: Type.STRING },
      admissao_renavam: { type: Type.STRING },
      recalculo_divida_original: { type: Type.STRING },
      recalculo_parcela: { type: Type.STRING },
      recalculo_divida: { type: Type.STRING },
      recalculo_economia: { type: Type.STRING },
      empresa_codigo_unidade: { type: Type.STRING },
      admissao_info1: { type: Type.STRING },
    },
  },
};

const GEMINI_KEY_TO_VAR: Record<string, string> = {
  modalidade_descricao: 'modalidade.descricao',
  cliente_nome: 'cliente.nome',
  cliente_documento: 'cliente.documento',
  cliente_rg: 'cliente.rg',
  cliente_telefone: 'cliente.telefone',
  cliente_telefone2: 'cliente.telefone2',
  cliente_email: 'cliente.email',
  cliente_profissao: 'cliente.profissao',
  cliente_estado_civil: 'cliente.estado_civil',
  cliente_data_nascimento: 'cliente.data_nascimento',
  cliente_cep: 'cliente.cep',
  cliente_endereco: 'cliente.endereco',
  cliente_numero: 'cliente.numero',
  cliente_complemento: 'cliente.complemento',
  cliente_bairro: 'cliente.bairro',
  cliente_cidade: 'cliente.cidade',
  cliente_uf: 'cliente.uf',
  titular_nome: 'titular.nome',
  titular_documento: 'titular.documento',
  titular_rg: 'titular.rg',
  titular_telefone: 'titular.telefone',
  titular_email: 'titular.email',
  banco_nome: 'banco.nome',
  banco_febraban: 'banco.febraban',
  colaborador_nome: 'colaborador.nome',
  colaborador_email: 'colaborador.email',
  colaborador_telefone: 'colaborador.telefone',
  admissao_contrato: 'admissao.contrato',
  admissao_data: 'admissao.data',
  admissao_tipo_origem: 'admissao.tipo_origem',
  admissao_tipo_indicacao: 'admissao.tipo_indicacao',
  admissao_total_parcelas: 'admissao.total_parcelas',
  admissao_parcelas_pagas: 'admissao.parcelas_pagas',
  admissao_parcelas_atraso: 'admissao.parcelas_atraso',
  admissao_parcelas_a_pagar: 'admissao.parcelas_a_pagar',
  admissao_valor_financiado: 'admissao.valor_financiado',
  admissao_valor_parcela: 'admissao.valor_parcela',
  admissao_dia_vencimento: 'admissao.dia_vencimento',
  admissao_forma_pagamento: 'admissao.forma_pagamento',
  admissao_taxa_administrativa: 'admissao.taxa_administrativa',
  admissao_parcela1: 'admissao.parcela1',
  admissao_marca_veiculo: 'admissao.marca_veiculo',
  admissao_modelo_veiculo: 'admissao.modelo_veiculo',
  admissao_cor_veiculo: 'admissao.cor_veiculo',
  admissao_ano_veiculo: 'admissao.ano_veiculo',
  admissao_placa: 'admissao.placa',
  admissao_chassi: 'admissao.chassi',
  admissao_renavam: 'admissao.renavam',
  recalculo_divida_original: 'recalculo.divida_original',
  recalculo_parcela: 'recalculo.parcela',
  recalculo_divida: 'recalculo.divida',
  recalculo_economia: 'recalculo.economia',
  empresa_codigo_unidade: 'empresa.codigo_unidade',
  admissao_info1: 'admissao.info1',
};

function mapGeminiRecordToCanonical(raw: Record<string, unknown>, fallbackPage: number): {
  pageNumber: number;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const [gKey, varKey] of Object.entries(GEMINI_KEY_TO_VAR)) {
    const val = normText(raw[gKey]);
    if (val) fields[varKey] = val;
  }
  const fDet = normKey(raw.formulario_detectado);
  if (!fields['modalidade.descricao'] && fDet) {
    fields['modalidade.descricao'] = fDet.includes('veic') ? 'CDC Veículo' : 'Cartão de Crédito';
  }
  const pg = Number(raw.pagina_pdf);
  return {
    pageNumber: Number.isFinite(pg) && pg > 0 ? Math.trunc(pg) : fallbackPage,
    fields,
  };
}

async function extractTextBatchWithGemini(
  ai: GoogleGenAI,
  pages: Array<{ pageNumber: number; text: string }>
): Promise<Array<{ pageNumber: number; fields: Record<string, string> }>> {
  const contentText = pages
    .map((p) => `--- PÁGINA PDF ${p.pageNumber} ---\n${p.text.slice(0, 6000)}`)
    .join('\n\n');

  const prompt = `Você é a Ivi da Invicta Assessoria Financeira.
Extraia TODOS os registros de clientes/contratos contidos nestas páginas de PDF comparando com os formulários "Folha de Rosto - Veículo" e "Folha de Rosto - Cartão de Crédito".
Cada página pode conter uma ficha completa ou várias linhas de uma tabela.
Regras:
- Se existir um Titular do Contrato distinto do Cliente/Responsável pelo bem, preencha titular_nome/titular_documento separadamente de cliente_nome/cliente_documento.
- Identifique banco_nome, colaborador_nome (consultor), admissao_contrato, parcelas, valores financeiros, dados do veículo (marca, modelo, cor, ano, placa, chassi, renavam) e recálculo.
- Defina formulario_detectado como "veiculo" ou "cartao".
- Não invente dados inexistentes; omita ou deixe vazio "" campos não presentes no documento.

Conteúdo extraído do PDF:
${contentText}`;

  const resp = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RECORD_SCHEMA,
    },
  });

  const arr = JSON.parse((resp.text || '[]').trim()) as Array<Record<string, unknown>>;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => mapGeminiRecordToCanonical(item, pages[0]?.pageNumber || 1))
    .filter((r) => Boolean(r.fields['cliente.nome'] || r.fields['titular.nome'] || r.fields['admissao.contrato']));
}

async function extractScannedPdfPagesWithGemini(params: {
  ai: GoogleGenAI;
  pdfPath: string;
  scannedPages: number[];
}): Promise<Array<{ pageNumber: number; fields: Record<string, string> }>> {
  const results: Array<{ pageNumber: number; fields: Record<string, string> }> = [];
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ivi-pdf-ocr-'));

  try {
    const OCR_SUB_BATCH = 5;
    for (let i = 0; i < params.scannedPages.length; i += OCR_SUB_BATCH) {
      const batch = params.scannedPages.slice(i, i + OCR_SUB_BATCH);
      const renderedFiles: Array<{ pageNumber: number; jpgPath: string }> = [];

      for (const pageNum of batch) {
        const outPath = path.join(tmpDir, `page-${String(pageNum).padStart(6, '0')}.jpg`);
        await execFileAsync(
          'gs',
          [
            '-q',
            '-dNOPAUSE',
            '-dBATCH',
            '-sDEVICE=jpeg',
            '-dJPEGQ=80',
            '-r140',
            `-dFirstPage=${pageNum}`,
            `-dLastPage=${pageNum}`,
            `-sOutputFile=${outPath}`,
            params.pdfPath,
          ],
          { maxBuffer: 8 * 1024 * 1024 }
        );
        if (fs.existsSync(outPath)) {
          renderedFiles.push({ pageNumber: pageNum, jpgPath: outPath });
        }
      }

      if (renderedFiles.length === 0) continue;

      const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
      for (const rf of renderedFiles) {
        const imgBuf = await fs.promises.readFile(rf.jpgPath);
        parts.push({ text: `Imagem da Página PDF ${rf.pageNumber}:` });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imgBuf.toString('base64'),
          },
        });
        // Libera imagem temporária imediatamente do disco após leitura
        await fs.promises.unlink(rf.jpgPath).catch(() => {});
      }

      parts.push({
        text: `Você é a Ivi da Invicta Assessoria Financeira. Leia atentamente as páginas digitalizadas de Folha de Rosto acima (Folha de Rosto - Veículo e Folha de Rosto - Cartão de Crédito).
Para cada folha de rosto ou contrato visível, extraia no JSON todos os dados disponíveis: Cliente (nome, CPF/CNPJ, RG, telefone, endereço completo, email), Titular (se diferente do cliente), Banco, Consultor/Colaborador, Contrato, Produto/Modalidade (veiculo ou cartao), Parcelas, Valores, Veículo (marca, modelo, cor, ano, placa, chassi, renavam) e Recálculo.`,
      });

      const resp = await params.ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RECORD_SCHEMA,
        },
      });

      // Libera referências dos buffers de imagem da RAM antes de prosseguir
      parts.length = 0;

      const arr = JSON.parse((resp.text || '[]').trim()) as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const mapped = mapGeminiRecordToCanonical(item, batch[0]);
          if (mapped.fields['cliente.nome'] || mapped.fields['titular.nome'] || mapped.fields['admissao.contrato']) {
            results.push(mapped);
          }
        }
      }
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return results;
}

// =========================================================================
// 5-PAGE BATCHED PDF PIPELINE (PREVENTS PROXY TIMEOUTS & CLEANS RAM/CACHE)
// =========================================================================
export const PDF_PAGE_BATCH_SIZE = 5;

export interface PdfBatchExtractedRecord {
  pageNumber: number;
  fields: Record<string, string>;
}

interface PdfBatchCheckpointPayload {
  startPage: number;
  endPage: number;
  digitalPages: number;
  ocrPages: number;
  extractedRecords: PdfBatchExtractedRecord[];
  continuationRecords: PdfBatchExtractedRecord[];
  scannedWithoutAi: number;
}

export interface PdfBatchProcessResult {
  startPage: number;
  endPage: number;
  digitalPages: number;
  ocrPages: number;
  extractedCount: number;
  memoryCleaned: boolean;
}

function getBatchDir(filePath: string): string {
  return `${filePath}.batches`;
}

function getBatchFilePath(filePath: string, startPage: number, endPage: number): string {
  return path.join(
    getBatchDir(filePath),
    `batch_${String(startPage).padStart(6, '0')}_${String(endPage).padStart(6, '0')}.json`
  );
}

function triggerBestEffortGc() {
  const g = globalThis as unknown as { gc?: () => void };
  if (typeof g.gc === 'function') {
    try {
      g.gc();
    } catch {
      // ignore if --expose-gc is not enabled
    }
  }
}

async function openDiskPdfDocument(filePath: string): Promise<{
  fh: fs.promises.FileHandle;
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  pdf: pdfjsLib.PDFDocumentProxy;
}> {
  const stat = await fs.promises.stat(filePath);
  const fh = await fs.promises.open(filePath, 'r');
  const standardFontDataUrl =
    path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

  let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  try {
    const initLen = Math.min(stat.size, 65536);
    const initBuf = Buffer.allocUnsafe(initLen);
    const { bytesRead } = await fh.read(initBuf, 0, initLen, 0);
    const transport = new DiskPdfRangeTransport(
      stat.size,
      new Uint8Array(initBuf.buffer, bufOffset(initBuf), bytesRead),
      fh
    );

    loadingTask = pdfjsLib.getDocument({
      range: transport,
      standardFontDataUrl,
      useWorkerFetch: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });

    const pdf = await loadingTask.promise;
    return { fh, loadingTask, pdf };
  } catch (err) {
    if (loadingTask) {
      await loadingTask.destroy().catch(() => {});
    }
    await fh.close().catch(() => {});
    throw err;
  }
}

function bufOffset(b: Buffer): number {
  return b.byteOffset;
}

async function closeDiskPdfDocument(res: {
  fh: fs.promises.FileHandle;
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  pdf: pdfjsLib.PDFDocumentProxy;
}): Promise<void> {
  try {
    await res.pdf.cleanup().catch(() => {});
  } finally {
    await res.loadingTask.destroy().catch(() => {});
    await res.fh.close().catch(() => {});
  }
}

export async function inspectFolhaRostoPdfInfo(filePath: string): Promise<{
  pageCount: number;
  batchSize: number;
  totalBatches: number;
}> {
  // Limpa qualquer cache ou lote residual anterior dessa sessão antes de iniciar
  await fs.promises.rm(getBatchDir(filePath), { recursive: true, force: true }).catch(() => {});
  await fs.promises.unlink(`${filePath}.parsed.json`).catch(() => {});

  const handle = await openDiskPdfDocument(filePath);
  let pageCount = 0;
  try {
    pageCount = handle.pdf.numPages;
  } finally {
    await closeDiskPdfDocument(handle);
    triggerBestEffortGc();
  }

  return {
    pageCount,
    batchSize: PDF_PAGE_BATCH_SIZE,
    totalBatches: Math.max(1, Math.ceil(pageCount / PDF_PAGE_BATCH_SIZE)),
  };
}

export async function processFolhaRostoPdfBatch(params: {
  filePath: string;
  startPage: number;
  endPage: number;
}): Promise<PdfBatchProcessResult> {
  const startPage = Math.max(1, Math.trunc(params.startPage));
  const requestedEnd = Math.max(startPage, Math.trunc(params.endPage));
  const endPage = Math.min(requestedEnd, startPage + PDF_PAGE_BATCH_SIZE - 1);

  let pageTexts: Array<{ pageNumber: number; text: string }> = [];
  let scannedPages: number[] = [];

  // 1. Abre o PDF apenas para extrair o texto das 5 páginas do lote e limpa o cache PDF.js logo em seguida
  const handle = await openDiskPdfDocument(params.filePath);
  let boundedEnd = endPage;
  try {
    boundedEnd = Math.min(endPage, handle.pdf.numPages);
    for (let p = startPage; p <= boundedEnd; p++) {
      const page = await handle.pdf.getPage(p);
      try {
        const tc = await page.getTextContent();
        const lines = reconstructPageLines(tc.items || []);
        const joined = lines.join('\n');
        const nonWs = joined.replace(/\s+/g, '').length;
        if (nonWs >= 50) {
          pageTexts.push({ pageNumber: p, text: joined });
        } else {
          scannedPages.push(p);
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await closeDiskPdfDocument(handle);
    triggerBestEffortGc();
  }

  const ai = buildGeminiClient();
  const extractedRecords: PdfBatchExtractedRecord[] = [];
  const continuationRecords: PdfBatchExtractedRecord[] = [];

  // 2. Segmenta e analisa páginas digitais dentro da janela de até 5 páginas
  const digitalBlocks: Array<{ startPage: number; pages: number[]; text: string; startsNew: boolean }> = [];
  for (const pt of pageTexts) {
    const explicitStart = pageStartsNewFolhaRosto(pt.text);
    const startsNew =
      digitalBlocks.length === 0 ||
      explicitStart ||
      digitalBlocks[digitalBlocks.length - 1].pages.length >= 2;
    if (startsNew) {
      digitalBlocks.push({
        startPage: pt.pageNumber,
        pages: [pt.pageNumber],
        text: pt.text,
        startsNew: explicitStart,
      });
    } else {
      const last = digitalBlocks[digitalBlocks.length - 1];
      last.pages.push(pt.pageNumber);
      last.text = `${last.text}\n${pt.text}`;
    }
  }

  const ambiguousTextPages: Array<{ pageNumber: number; text: string }> = [];

  for (let idx = 0; idx < digitalBlocks.length; idx++) {
    const blk = digitalBlocks[idx];
    const parsed = parseDigitalFolhaRostoBlock(blk.text);
    const hasCore =
      Boolean(parsed['cliente.nome'] || parsed['titular.nome']) &&
      Boolean(parsed['admissao.contrato'] || parsed['cliente.documento'] || parsed['banco.nome']);

    if (hasCore) {
      extractedRecords.push({ pageNumber: blk.startPage, fields: parsed });
    } else if (idx === 0 && !blk.startsNew && blk.startPage === startPage && Object.keys(parsed).length > 0) {
      // Primeira página do lote pode ser a continuação (pág. 2) da última ficha do lote anterior
      continuationRecords.push({ pageNumber: blk.startPage, fields: parsed });
    } else {
      ambiguousTextPages.push({ pageNumber: blk.startPage, text: blk.text });
    }
  }

  // Libera os textos brutos já tokenizados antes das chamadas externas
  pageTexts = [];
  digitalBlocks.length = 0;

  if (ambiguousTextPages.length > 0 && ai) {
    try {
      const aiRows = await extractTextBatchWithGemini(ai, ambiguousTextPages);
      extractedRecords.push(...aiRows);
    } catch {
      // Mantém resultados determinísticos se a página ambígua não retornar tabela
    }
  }
  ambiguousTextPages.length = 0;

  // 3. OCR Multimodal nas páginas escaneadas deste lote (apaga .jpg e diretório temp imediatamente)
  let scannedWithoutAi = 0;
  if (scannedPages.length > 0) {
    if (!ai) {
      scannedWithoutAi = scannedPages.length;
    } else {
      const ocrRows = await extractScannedPdfPagesWithGemini({
        ai,
        pdfPath: params.filePath,
        scannedPages,
      });
      extractedRecords.push(...ocrRows);
    }
  }

  const digitalCount = Math.max(0, boundedEnd - startPage + 1 - scannedPages.length);
  const ocrCount = ai ? scannedPages.length : 0;
  scannedPages = [];

  // 4. Salva checkpoint enxuto do lote em disco e limpa memória
  await fs.promises.mkdir(getBatchDir(params.filePath), { recursive: true });
  const batchPayload: PdfBatchCheckpointPayload = {
    startPage,
    endPage: boundedEnd,
    digitalPages: digitalCount,
    ocrPages: ocrCount,
    extractedRecords,
    continuationRecords,
    scannedWithoutAi,
  };
  await fs.promises.writeFile(
    getBatchFilePath(params.filePath, startPage, boundedEnd),
    JSON.stringify(batchPayload),
    'utf8'
  );

  triggerBestEffortGc();

  return {
    startPage,
    endPage: boundedEnd,
    digitalPages: digitalCount,
    ocrPages: ocrCount,
    extractedCount: extractedRecords.length,
    memoryCleaned: true,
  };
}

export async function finalizeFolhaRostoPdfBatches(
  filePath: string,
  pageCountHint?: number
): Promise<PdfFolhaRostoParseResult> {
  const batchDir = getBatchDir(filePath);
  const files = await fs.promises.readdir(batchDir).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.startsWith('batch_') && f.endsWith('.json')).sort();

  const allExtracted: PdfBatchExtractedRecord[] = [];
  const allContinuations: PdfBatchExtractedRecord[] = [];
  let totalDigital = 0;
  let totalOcr = 0;
  let maxPageSeen = pageCountHint || 0;
  let totalScannedWithoutAi = 0;

  for (const fname of jsonFiles) {
    const raw = await fs.promises.readFile(path.join(batchDir, fname), 'utf8');
    const payload = JSON.parse(raw) as PdfBatchCheckpointPayload;
    totalDigital += payload.digitalPages || 0;
    totalOcr += payload.ocrPages || 0;
    totalScannedWithoutAi += payload.scannedWithoutAi || 0;
    if ((payload.endPage || 0) > maxPageSeen) maxPageSeen = payload.endPage;
    if (Array.isArray(payload.extractedRecords)) {
      allExtracted.push(...payload.extractedRecords);
    }
    if (Array.isArray(payload.continuationRecords)) {
      allContinuations.push(...payload.continuationRecords);
    }
  }

  // Limpa imediatamente o cache temporário de lotes do disco
  await fs.promises.rm(batchDir, { recursive: true, force: true }).catch(() => {});

  allExtracted.sort((a, b) => a.pageNumber - b.pageNumber);

  // Mescla páginas de continuação entre fronteiras de lotes (ex.: pág. 5 -> pág. 6)
  for (const cont of allContinuations) {
    const prev = [...allExtracted]
      .reverse()
      .find((r) => r.pageNumber === cont.pageNumber - 1);
    if (prev) {
      for (const [k, v] of Object.entries(cont.fields)) {
        if (v && !prev.fields[k]) {
          prev.fields[k] = v;
        }
      }
    } else if (cont.fields['cliente.nome'] || cont.fields['admissao.contrato']) {
      allExtracted.push(cont);
    }
  }

  allExtracted.sort((a, b) => a.pageNumber - b.pageNumber);

  if (allExtracted.length === 0) {
    if (totalScannedWithoutAi > 0) {
      throw new Error(
        `Este PDF contém ${totalScannedWithoutAi} página(s) digitalizada(s) sem texto selecionável. Configure a chave Gemini nas Configurações/Secrets para a Ivi realizar a leitura visual (OCR) das Folhas de Rosto.`
      );
    }
    throw new Error(
      'Nenhuma ficha compatível com Folha de Rosto - Veículo ou Folha de Rosto - Cartão de Crédito foi identificada nas páginas do PDF enviado.'
    );
  }

  const veicRows: Array<Record<string, unknown> & { __rowNumber: number }> = [];
  const cartRows: Array<Record<string, unknown> & { __rowNumber: number }> = [];

  for (const rec of allExtracted) {
    const f = rec.fields;
    const modNorm = normKey(f['modalidade.descricao'] || '');
    const hasVeh = Boolean(
      f['admissao.placa'] ||
        f['admissao.chassi'] ||
        f['admissao.renavam'] ||
        f['admissao.marca_veiculo'] ||
        f['admissao.modelo_veiculo']
    );
    const isCart = /cart[aã]o|credito|fatura/.test(modNorm) && !hasVeh;
    const rowObj: Record<string, unknown> & { __rowNumber: number } = {
      __rowNumber: rec.pageNumber,
      _pagina_pdf: String(rec.pageNumber),
      ...f,
    };
    if (!isCart && (hasVeh || /ve[ií]culo|cdc|auto/.test(modNorm))) {
      veicRows.push(rowObj);
    } else {
      cartRows.push(rowObj);
    }
  }

  const buildSheet = (
    sheetName: string,
    rows: Array<Record<string, unknown> & { __rowNumber: number }>
  ): PdfParsedSheetData => {
    const presentSet = new Set<string>();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (k !== '__rowNumber' && normText(v) !== '') {
          presentSet.add(k);
        }
      }
    }
    const headers: string[] = [];
    for (const key of CANONICAL_PDF_FIELD_ORDER) {
      if (presentSet.has(key)) headers.push(key);
    }
    for (const key of presentSet) {
      if (!headers.includes(key)) headers.push(key);
    }
    return { sheetName, headers, rows };
  };

  const sheets: PdfParsedSheetData[] = [];
  if (veicRows.length > 0) sheets.push(buildSheet('PDF_FolhaRosto_Veiculo', veicRows));
  if (cartRows.length > 0) sheets.push(buildSheet('PDF_FolhaRosto_Cartao', cartRows));

  const extractionMode: PdfExtractionMetadata['extractionMode'] =
    totalOcr > 0 && totalDigital > 0
      ? 'hibrido'
      : totalOcr > 0
      ? 'ocr_gemini'
      : 'texto_digital';

  const result: PdfFolhaRostoParseResult = {
    sheets,
    pdfMetadata: {
      isPdf: true,
      pageCount: maxPageSeen,
      digitalPages: totalDigital,
      ocrPages: totalOcr,
      extractedRecords: allExtracted.length,
      extractionMode,
    },
  };

  await fs.promises.writeFile(`${filePath}.parsed.json`, JSON.stringify(result), 'utf8').catch(() => {});
  triggerBestEffortGc();
  return result;
}

// =========================================================================
// MAIN PDF ENTRY POINT (READS UP TO 500 MB IN 5-PAGE BATCHES)
// =========================================================================
export async function readFolhaRostoPdfAsSheets(
  filePath: string
): Promise<PdfFolhaRostoParseResult> {
  const cachePath = `${filePath}.parsed.json`;
  try {
    if (fs.existsSync(cachePath)) {
      const cachedRaw = await fs.promises.readFile(cachePath, 'utf8');
      const cached = JSON.parse(cachedRaw) as PdfFolhaRostoParseResult;
      if (cached && Array.isArray(cached.sheets) && cached.sheets.length > 0 && cached.pdfMetadata) {
        return cached;
      }
    }
  } catch {
    // Re-parse cleanly if cache file is incomplete
  }

  const info = await inspectFolhaRostoPdfInfo(filePath);
  for (let startPage = 1; startPage <= info.pageCount; startPage += PDF_PAGE_BATCH_SIZE) {
    const endPage = Math.min(info.pageCount, startPage + PDF_PAGE_BATCH_SIZE - 1);
    await processFolhaRostoPdfBatch({ filePath, startPage, endPage });
  }
  return finalizeFolhaRostoPdfBatches(filePath, info.pageCount);
}
