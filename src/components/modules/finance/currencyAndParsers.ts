import * as XLSX from 'xlsx';

export interface ImportedStatementRow {
  localId: string;
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // sempre positivo
  type: 'CREDITO' | 'DEBITO';
  documentNumber: string;
  fitId?: string;
  matched: boolean;
  matchedMovementId?: number | null;
}

export function formatSignedBRL(cents: number): string {
  const num = Number(cents) || 0;
  const absFormatted = (Math.abs(num) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  return num < 0 ? `-${absFormatted}` : absFormatted;
}

export function centsToMaskInput(cents: number): string {
  return (Math.abs(Number(cents) || 0) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseMaskInputToCents(raw: string): number {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) || 0;
}

export function formatCurrencyTyping(raw: string): string {
  const cents = parseMaskInputToCents(raw);
  return centsToMaskInput(cents);
}

export function toIsoDateOnly(input: string | Date | null | undefined): string {
  if (!input) return '';
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '';
    return input.toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function formatIsoDateToBR(iso: string): string {
  const clean = toIsoDateOnly(iso);
  if (!clean) return '-';
  const [y, m, d] = clean.split('-');
  return `${d}/${m}/${y}`;
}

export function getCurrentMonthBounds(): { firstDay: string; lastDay: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { firstDay: fmt(first), lastDay: fmt(last) };
}

function extractOfxTag(block: string, tag: string): string {
  const xmlRegex = new RegExp(`<${tag}>([^<\\r\\n]+)</${tag}>`, 'i');
  const mXml = block.match(xmlRegex);
  if (mXml?.[1]) return mXml[1].trim();
  const sgmlRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
  const mSgml = block.match(sgmlRegex);
  return mSgml?.[1] ? mSgml[1].trim() : '';
}

export function parseOfxText(text: string): ImportedStatementRow[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const rows: ImportedStatementRow[] = [];

  blocks.forEach((rawBlock, idx) => {
    const endIdx = rawBlock.search(/<\/STMTTRN>/i);
    const block = endIdx >= 0 ? rawBlock.slice(0, endIdx) : rawBlock;

    const dtRaw = extractOfxTag(block, 'DTPOSTED');
    const trnAmtRaw = extractOfxTag(block, 'TRNAMT');
    const memo = extractOfxTag(block, 'MEMO');
    const name = extractOfxTag(block, 'NAME');
    const trnType = extractOfxTag(block, 'TRNTYPE');
    const checkNum = extractOfxTag(block, 'CHECKNUM');
    const fitId = extractOfxTag(block, 'FITID');

    const normalizedAmt = Number(trnAmtRaw.replace(',', '.'));
    if (Number.isNaN(normalizedAmt)) return;

    let isoDate = '';
    const digits = dtRaw.replace(/\D/g, '');
    if (digits.length >= 8) {
      isoDate = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }

    const description = memo || name || trnType || 'Sem descrição';
    const type: 'CREDITO' | 'DEBITO' = normalizedAmt >= 0 ? 'CREDITO' : 'DEBITO';
    const amountCents = Math.round(Math.abs(normalizedAmt) * 100);

    rows.push({
      localId: `ofx-${idx}-${fitId || Date.now()}`,
      date: isoDate,
      description,
      amountCents,
      type,
      documentNumber: checkNum,
      fitId: fitId || undefined,
      matched: false,
      matchedMovementId: null,
    });
  });

  if (rows.length === 0) {
    throw new Error('Nenhuma transação válida (<STMTTRN>) encontrada no arquivo OFX.');
  }
  return rows;
}

function parseCellNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined) return 0;
  let str = String(val).trim().replace(/[R$\s]/g, '');
  if (!str) return 0;
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

function parseExcelDateCell(val: unknown): string {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number' && val > 20000 && val < 90000) {
    const utcDays = Math.floor(val - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(val ?? '').trim();
  if (!s) return '';
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function parseXlsxBuffer(buffer: ArrayBuffer): ImportedStatementRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Arquivo XLSX vazio ou sem planilhas.');
  }
  const ws = wb.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (matrix.length < 2) {
    throw new Error('Arquivo vazio ou com dados insuficientes (mínimo de cabeçalho + 1 linha).');
  }

  const headers = (matrix[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const findCol = (keywords: string[]) =>
    headers.findIndex((h) => keywords.some((kw) => h.includes(kw)));

  const dateCol = findCol(['data', 'date']);
  const descCol = findCol(['descri', 'hist', 'memo', 'description']);
  const valCol = findCol(['valor', 'value', 'amount', 'quantia']);
  const creditCol = findCol(['crédit', 'credit', 'entrada']);
  const debitCol = findCol(['débit', 'debit', 'saída', 'saida']);
  const docCol = findCol(['doc', 'número', 'numero']);

  const rows: ImportedStatementRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const isoDate = dateCol >= 0 ? parseExcelDateCell(row[dateCol]) : '';
    const desc = descCol >= 0 ? String(row[descCol] ?? '').trim() : '';
    const docNum = docCol >= 0 ? String(row[docCol] ?? '').trim() : '';

    let type: 'CREDITO' | 'DEBITO' = 'CREDITO';
    let absAmount = 0;

    if (creditCol >= 0 && debitCol >= 0) {
      const credVal = parseCellNumber(row[creditCol]);
      const debVal = parseCellNumber(row[debitCol]);
      if (credVal > 0) {
        type = 'CREDITO';
        absAmount = credVal;
      } else {
        type = 'DEBITO';
        absAmount = Math.abs(debVal);
      }
    } else if (valCol >= 0) {
      const rawVal = parseCellNumber(row[valCol]);
      type = rawVal >= 0 ? 'CREDITO' : 'DEBITO';
      absAmount = Math.abs(rawVal);
    }

    if (absAmount === 0 && !isoDate) continue;

    rows.push({
      localId: `xlsx-${i}-${Date.now()}`,
      date: isoDate,
      description: desc || 'Sem descrição',
      amountCents: Math.round(absAmount * 100),
      type,
      documentNumber: docNum,
      matched: false,
      matchedMovementId: null,
    });
  }

  if (rows.length === 0) {
    throw new Error('Nenhuma movimentação válida encontrada na primeira planilha do XLSX.');
  }
  return rows;
}
