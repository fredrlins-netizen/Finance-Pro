import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

export const SPREADSHEET_CHUNK_ROWS = 250;

export interface StreamedSheetInfo {
  sheetName: string;
  headers: string[];
  rowCount: number;
  sampleRows: Array<Record<string, unknown>>;
  chunkIndices: number[];
}

export interface SpreadsheetChunkMeta {
  chunkIndex: number;
  sheetName: string;
  fileName: string;
  startRowNumber: number;
  endRowNumber: number;
  rowCount: number;
  dryRunStatus: 'pending' | 'done';
  commitStatus: 'pending' | 'done';
  analyzeStatus: 'pending' | 'done';
}

export interface SpreadsheetStreamManifest {
  filePath: string;
  originalFileName: string;
  fileSizeBytes: number;
  createdAt: string;
  chunkRows: number;
  totalSheets: number;
  totalChunks: number;
  totalRows: number;
  sheets: StreamedSheetInfo[];
  chunks: SpreadsheetChunkMeta[];
}

export interface StreamedRowRecord extends Record<string, unknown> {
  __rowNumber: number;
}

export function triggerBestEffortGc(): void {
  try {
    const gcFn = (globalThis as { gc?: () => void }).gc;
    if (typeof gcFn === 'function') gcFn();
  } catch {
    // ignore if --expose-gc is not enabled
  }
}

function normCellText(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v ?? '').trim();
}

function normSheetKey(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const SKIP_META_SHEETS = new Set([
  '_ordem_precedencia',
  'dicionario_campos',
  'listas_dominio',
  '_retorno_importacao',
]);

function extractExcelJsCellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw;
  if (typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if ('result' in obj && obj.result !== undefined) {
    return extractExcelJsCellValue(obj.result);
  }
  if (Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>)
      .map((seg) => String(seg?.text ?? ''))
      .join('');
  }
  if ('text' in obj && obj.text !== undefined) {
    return String(obj.text);
  }
  if ('hyperlink' in obj && obj.hyperlink !== undefined) {
    return String(obj.hyperlink);
  }
  if ('error' in obj) {
    return '';
  }
  return String(raw);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function pickBestHeaderIndex(candidateRows: unknown[][], mode: 'first_non_empty' | 'best_of_5'): number {
  if (mode === 'first_non_empty') {
    for (let i = 0; i < candidateRows.length; i++) {
      if ((candidateRows[i] || []).some((c) => normCellText(c) !== '')) return i;
    }
    return 0;
  }
  let headerIdx = 0;
  let bestScore = -1;
  const limit = Math.min(5, candidateRows.length);
  for (let i = 0; i < limit; i++) {
    const row = candidateRows[i] || [];
    const nonEmptyText = row.filter((c) => {
      const s = normCellText(c);
      return s.length > 0 && Number.isNaN(Number(s));
    }).length;
    if (nonEmptyText > bestScore) {
      bestScore = nonEmptyText;
      headerIdx = i;
    }
  }
  return headerIdx;
}

function makeSheetNameLookup(wbReader: unknown): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const r = wbReader as {
      workbookRels?: Array<{ Id?: string; Target?: string }>;
      model?: { sheets?: Array<{ id?: number; rId?: string; name?: string }> };
    };
    const rels = r.workbookRels || [];
    const sheets = r.model?.sheets || [];
    for (const rel of rels) {
      const target = String(rel.Target || '');
      const m = target.match(/worksheets\/sheet(\d+)\.xml$/i);
      if (!m) continue;
      const sheetNo = m[1];
      const matchSheet = sheets.find((s) => s.rId === rel.Id);
      if (matchSheet?.name) {
        map.set(sheetNo, matchSheet.name);
      }
    }
  } catch {
    // non-fatal
  }
  return map;
}

export async function streamSpreadsheetToChunks(params: {
  filePath: string;
  originalFileName: string;
  workDir: string;
  chunkRows?: number;
  headerMode?: 'first_non_empty' | 'best_of_5';
  skipMetaSheets?: boolean;
}): Promise<SpreadsheetStreamManifest> {
  const chunkRows = Math.max(50, Math.min(1000, params.chunkRows ?? SPREADSHEET_CHUNK_ROWS));
  const headerMode = params.headerMode ?? 'first_non_empty';
  const skipMetaSheets = params.skipMetaSheets ?? true;

  await fs.promises.rm(params.workDir, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(params.workDir, { recursive: true });

  const stat = await fs.promises.stat(params.filePath);
  const lower = String(params.originalFileName || params.filePath).toLowerCase();

  const sheets: StreamedSheetInfo[] = [];
  const chunks: SpreadsheetChunkMeta[] = [];
  let globalChunkIndex = 0;
  let totalRows = 0;

  const writeChunkBuffer = async (
    sheetInfo: StreamedSheetInfo,
    buffer: StreamedRowRecord[]
  ): Promise<void> => {
    if (buffer.length === 0) return;
    const chunkIndex = globalChunkIndex++;
    const fileName = `chunk-${String(chunkIndex).padStart(5, '0')}.json`;
    const chunkPath = path.join(params.workDir, fileName);
    await fs.promises.writeFile(chunkPath, JSON.stringify(buffer), 'utf8');

    const startRowNumber = Number(buffer[0].__rowNumber || 0);
    const endRowNumber = Number(buffer[buffer.length - 1].__rowNumber || startRowNumber);
    chunks.push({
      chunkIndex,
      sheetName: sheetInfo.sheetName,
      fileName,
      startRowNumber,
      endRowNumber,
      rowCount: buffer.length,
      dryRunStatus: 'pending',
      commitStatus: 'pending',
      analyzeStatus: 'pending',
    });
    sheetInfo.chunkIndices.push(chunkIndex);
    sheetInfo.rowCount += buffer.length;
    totalRows += buffer.length;
    buffer.length = 0;
  };

  const buildRowObj = (
    headers: string[],
    cells: unknown[],
    rowNumber: number
  ): StreamedRowRecord | null => {
    let hasValue = false;
    const obj: StreamedRowRecord = { __rowNumber: rowNumber };
    for (let c = 0; c < headers.length; c++) {
      const rawVal = cells[c] ?? '';
      if (!hasValue && normCellText(rawVal) !== '') {
        hasValue = true;
      }
      if (rawVal instanceof Date && !Number.isNaN(rawVal.getTime())) {
        obj[headers[c]] = rawVal.toISOString();
      } else {
        obj[headers[c]] = rawVal === undefined || rawVal === null ? '' : rawVal;
      }
    }
    return hasValue ? obj : null;
  };

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const stream = fs.createReadStream(params.filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let headers: string[] = [];
    let delimiter = ';';
    let lineNo = 0;
    let sheetInfo: StreamedSheetInfo | null = null;
    const buffer: StreamedRowRecord[] = [];
    const candidateLines: Array<{ lineNo: number; cells: string[] }> = [];

    for await (const rawLine of rl) {
      lineNo++;
      const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      if (!line.trim()) continue;

      if (headers.length === 0) {
        if (candidateLines.length === 0) {
          const semi = (line.match(/;/g) || []).length;
          const comma = (line.match(/,/g) || []).length;
          const tab = (line.match(/\t/g) || []).length;
          delimiter = semi >= comma && semi >= tab ? ';' : tab > comma ? '\t' : ',';
        }
        const cells = splitCsvLine(line, delimiter);
        if (headerMode === 'first_non_empty') {
          headers = cells.map((h, i) => h || `Coluna_${i + 1}`);
          sheetInfo = {
            sheetName: 'CSV_Importado',
            headers,
            rowCount: 0,
            sampleRows: [],
            chunkIndices: [],
          };
          sheets.push(sheetInfo);
        } else {
          candidateLines.push({ lineNo, cells });
          if (candidateLines.length >= 5) {
            const hdrIdx = pickBestHeaderIndex(
              candidateLines.map((c) => c.cells),
              'best_of_5'
            );
            headers = candidateLines[hdrIdx].cells.map((h, i) => h || `Coluna_${i + 1}`);
            sheetInfo = {
              sheetName: 'CSV_Importado',
              headers,
              rowCount: 0,
              sampleRows: [],
              chunkIndices: [],
            };
            sheets.push(sheetInfo);
            for (let j = hdrIdx + 1; j < candidateLines.length; j++) {
              const obj = buildRowObj(headers, candidateLines[j].cells, candidateLines[j].lineNo);
              if (obj) {
                if (sheetInfo.sampleRows.length < 8) sheetInfo.sampleRows.push(obj);
                buffer.push(obj);
              }
            }
            candidateLines.length = 0;
          }
        }
        continue;
      }

      if (!sheetInfo) continue;
      const cells = splitCsvLine(line, delimiter);
      const obj = buildRowObj(headers, cells, lineNo);
      if (!obj) continue;

      if (sheetInfo.sampleRows.length < 8) {
        sheetInfo.sampleRows.push(obj);
      }
      buffer.push(obj);

      if (buffer.length >= chunkRows) {
        await writeChunkBuffer(sheetInfo, buffer);
        if (globalChunkIndex % 10 === 0) triggerBestEffortGc();
      }
    }

    // Handle small CSV (< 5 lines) when headerMode === 'best_of_5'
    if (headers.length === 0 && candidateLines.length > 0) {
      const hdrIdx = pickBestHeaderIndex(
        candidateLines.map((c) => c.cells),
        'best_of_5'
      );
      headers = candidateLines[hdrIdx].cells.map((h, i) => h || `Coluna_${i + 1}`);
      sheetInfo = {
        sheetName: 'CSV_Importado',
        headers,
        rowCount: 0,
        sampleRows: [],
        chunkIndices: [],
      };
      sheets.push(sheetInfo);
      for (let j = hdrIdx + 1; j < candidateLines.length; j++) {
        const obj = buildRowObj(headers, candidateLines[j].cells, candidateLines[j].lineNo);
        if (obj) {
          if (sheetInfo.sampleRows.length < 8) sheetInfo.sampleRows.push(obj);
          buffer.push(obj);
        }
      }
    }

    if (sheetInfo && buffer.length > 0) {
      await writeChunkBuffer(sheetInfo, buffer);
    }
    triggerBestEffortGc();
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    let streamedOk = false;
    try {
      const wbReader = new ExcelJS.stream.xlsx.WorkbookReader(params.filePath, {
        worksheets: 'emit',
        sharedStrings: 'cache',
        styles: 'cache',
        hyperlinks: 'ignore',
      });

      let relSheetNameByNo: Map<string, string> | null = null;
      let sheetOrdinal = 0;

      for await (const wsReader of wbReader) {
        sheetOrdinal++;
        if (!relSheetNameByNo) {
          relSheetNameByNo = makeSheetNameLookup(wbReader);
        }
        const wsAny = wsReader as unknown as { id?: string | number; name?: string };
        const rawId = String(wsAny.id ?? sheetOrdinal);
        let sName = String(wsAny.name || '').trim();
        if (!sName || /^Sheet\d+$/i.test(sName)) {
          sName = relSheetNameByNo.get(rawId) || relSheetNameByNo.get(String(sheetOrdinal)) || sName || `Aba_${sheetOrdinal}`;
        }

        if (skipMetaSheets && SKIP_META_SHEETS.has(normSheetKey(sName))) {
          for await (const _skipRow of wsReader) {
            // drain entry cleanly without buffering
          }
          continue;
        }

        let headers: string[] = [];
        let sheetInfo: StreamedSheetInfo | null = null;
        const buffer: StreamedRowRecord[] = [];
        const preHeaderRows: Array<{ rowNumber: number; values: unknown[] }> = [];
        let rowSeq = 0;

        for await (const row of wsReader) {
          rowSeq++;
          const rowNum = Number((row as { number?: number }).number || rowSeq);
          const rawArr = Array.isArray(row.values) ? row.values.slice(1) : [];
          const normalized = rawArr.map((v) => extractExcelJsCellValue(v));

          if (headers.length === 0) {
            if (headerMode === 'first_non_empty') {
              if (!normalized.some((c) => normCellText(c) !== '')) continue;
              headers = normalized.map((h, idx) => normCellText(h) || `Coluna_${idx + 1}`);
              if (!headers.some((h) => !h.startsWith('Coluna_'))) {
                headers = [];
                continue;
              }
              sheetInfo = {
                sheetName: sName,
                headers,
                rowCount: 0,
                sampleRows: [],
                chunkIndices: [],
              };
              sheets.push(sheetInfo);
            } else {
              preHeaderRows.push({ rowNumber: rowNum, values: normalized });
              if (preHeaderRows.length >= 5) {
                const hdrIdx = pickBestHeaderIndex(
                  preHeaderRows.map((p) => p.values),
                  'best_of_5'
                );
                headers = preHeaderRows[hdrIdx].values.map(
                  (h, idx) => normCellText(h) || `Coluna_${idx + 1}`
                );
                if (headers.some((h) => !h.startsWith('Coluna_'))) {
                  sheetInfo = {
                    sheetName: sName,
                    headers,
                    rowCount: 0,
                    sampleRows: [],
                    chunkIndices: [],
                  };
                  sheets.push(sheetInfo);
                  for (let j = hdrIdx + 1; j < preHeaderRows.length; j++) {
                    const obj = buildRowObj(
                      headers,
                      preHeaderRows[j].values,
                      preHeaderRows[j].rowNumber
                    );
                    if (obj) {
                      if (sheetInfo.sampleRows.length < 8) sheetInfo.sampleRows.push(obj);
                      buffer.push(obj);
                    }
                  }
                }
                preHeaderRows.length = 0;
              }
            }
            continue;
          }

          if (!sheetInfo) continue;
          const obj = buildRowObj(headers, normalized, rowNum);
          if (!obj) continue;

          if (sheetInfo.sampleRows.length < 8) {
            sheetInfo.sampleRows.push(obj);
          }
          buffer.push(obj);

          if (buffer.length >= chunkRows) {
            await writeChunkBuffer(sheetInfo, buffer);
            if (globalChunkIndex % 10 === 0) triggerBestEffortGc();
          }
        }

        // Small sheet (< 5 rows) when headerMode === 'best_of_5'
        if (headers.length === 0 && preHeaderRows.length > 0) {
          const hdrIdx = pickBestHeaderIndex(
            preHeaderRows.map((p) => p.values),
            'best_of_5'
          );
          headers = preHeaderRows[hdrIdx].values.map(
            (h, idx) => normCellText(h) || `Coluna_${idx + 1}`
          );
          if (headers.some((h) => !h.startsWith('Coluna_'))) {
            sheetInfo = {
              sheetName: sName,
              headers,
              rowCount: 0,
              sampleRows: [],
              chunkIndices: [],
            };
            sheets.push(sheetInfo);
            for (let j = hdrIdx + 1; j < preHeaderRows.length; j++) {
              const obj = buildRowObj(
                headers,
                preHeaderRows[j].values,
                preHeaderRows[j].rowNumber
              );
              if (obj) {
                if (sheetInfo.sampleRows.length < 8) sheetInfo.sampleRows.push(obj);
                buffer.push(obj);
              }
            }
          }
        }

        if (sheetInfo && buffer.length > 0) {
          await writeChunkBuffer(sheetInfo, buffer);
        }
        triggerBestEffortGc();
      }

      streamedOk = true;
    } catch {
      // Fall back to single-sheet unload SheetJS reader below if a malformed xlsx fails SAX streaming
      streamedOk = false;
      sheets.length = 0;
      chunks.length = 0;
      globalChunkIndex = 0;
      totalRows = 0;
      await fs.promises.rm(params.workDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.mkdir(params.workDir, { recursive: true });
    }

    if (!streamedOk) {
      await streamWithSheetJsFallback({
        filePath: params.filePath,
        chunkRows,
        headerMode,
        skipMetaSheets,
        sheets,
        writeChunkBuffer,
        buildRowObj,
      });
    }
  } else {
    // Legacy .xls / .xlsb -> SheetJS sheet-by-sheet unload with explicit memory cleanup
    await streamWithSheetJsFallback({
      filePath: params.filePath,
      chunkRows,
      headerMode,
      skipMetaSheets,
      sheets,
      writeChunkBuffer,
      buildRowObj,
    });
  }

  // Filter out empty sheets that yielded 0 data chunks (e.g. header-only or blank tabs)
  const nonEmptySheets = sheets.filter((s) => s.rowCount > 0 || (headerMode === 'first_non_empty' && s.headers.length > 0));

  const manifest: SpreadsheetStreamManifest = {
    filePath: params.filePath,
    originalFileName: params.originalFileName,
    fileSizeBytes: stat.size,
    createdAt: new Date().toISOString(),
    chunkRows,
    totalSheets: nonEmptySheets.length,
    totalChunks: chunks.length,
    totalRows,
    sheets: nonEmptySheets,
    chunks,
  };

  await saveManifest(params.workDir, manifest);
  triggerBestEffortGc();
  return manifest;
}

async function streamWithSheetJsFallback(params: {
  filePath: string;
  chunkRows: number;
  headerMode: 'first_non_empty' | 'best_of_5';
  skipMetaSheets: boolean;
  sheets: StreamedSheetInfo[];
  writeChunkBuffer: (sheetInfo: StreamedSheetInfo, buffer: StreamedRowRecord[]) => Promise<void>;
  buildRowObj: (headers: string[], cells: unknown[], rowNumber: number) => StreamedRowRecord | null;
}) {
  const fileBuffer = await fs.promises.readFile(params.filePath);
  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, dense: true });

  for (const sName of wb.SheetNames) {
    if (params.skipMetaSheets && SKIP_META_SHEETS.has(normSheetKey(sName))) {
      delete wb.Sheets[sName];
      continue;
    }
    const ws = wb.Sheets[sName];
    if (!ws) continue;

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    // Release sheet reference from workbook immediately after aoa conversion
    delete wb.Sheets[sName];

    if (aoa.length === 0) continue;
    const hdrIdx = pickBestHeaderIndex(aoa, params.headerMode);
    const headers = (aoa[hdrIdx] || []).map((h, idx) => normCellText(h) || `Coluna_${idx + 1}`);
    if (!headers.some((h) => !h.startsWith('Coluna_'))) continue;

    const sheetInfo: StreamedSheetInfo = {
      sheetName: sName,
      headers,
      rowCount: 0,
      sampleRows: [],
      chunkIndices: [],
    };
    params.sheets.push(sheetInfo);

    const buffer: StreamedRowRecord[] = [];
    for (let r = hdrIdx + 1; r < aoa.length; r++) {
      const arr = aoa[r] || [];
      const obj = params.buildRowObj(headers, arr, r + 1);
      if (!obj) continue;
      if (sheetInfo.sampleRows.length < 8) sheetInfo.sampleRows.push(obj);
      buffer.push(obj);
      if (buffer.length >= params.chunkRows) {
        await params.writeChunkBuffer(sheetInfo, buffer);
      }
    }
    if (buffer.length > 0) {
      await params.writeChunkBuffer(sheetInfo, buffer);
    }
    aoa.length = 0;
    triggerBestEffortGc();
  }
}

export async function loadManifest(workDir: string): Promise<SpreadsheetStreamManifest> {
  const raw = await fs.promises.readFile(path.join(workDir, 'manifest.json'), 'utf8');
  return JSON.parse(raw) as SpreadsheetStreamManifest;
}

export async function saveManifest(workDir: string, manifest: SpreadsheetStreamManifest): Promise<void> {
  await fs.promises.writeFile(
    path.join(workDir, 'manifest.json'),
    JSON.stringify(manifest),
    'utf8'
  );
}

export async function readSpreadsheetChunk(
  workDir: string,
  fileName: string
): Promise<StreamedRowRecord[]> {
  const raw = await fs.promises.readFile(path.join(workDir, fileName), 'utf8');
  return JSON.parse(raw) as StreamedRowRecord[];
}
