import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type {
  ReportChartDef,
  ReportColumnDef,
  ReportLayoutConfig,
  ReportSubreportDef,
  ReportTemplateItem,
  ReportTotalizerDef,
} from '../types.ts';
import {
  aggregateChartSeries,
  computeNumericAggregate,
  computeSummaryRows,
  formatReportValue,
  normalizeLayoutConfig,
  parseNumericValue,
} from './reportCatalogs.ts';
import {
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
} from './portalBrandingCache.ts';

export interface SubreportExportData {
  subreport: ReportSubreportDef;
  rows: Array<Record<string, any>>;
}

export interface ReportExportParams {
  template: ReportTemplateItem;
  rows: Array<Record<string, any>>;
  subreportsData?: SubreportExportData[];
  chartsContainer?: HTMLElement | null;
  companyLogoDataUrl?: string;
  companyName?: string;
  logoDarkBackdrop?: boolean;
}

function resolveExportLogo(layout: ReportLayoutConfig, params: ReportExportParams): {
  url: string;
  darkBackdrop: boolean;
  alt: string;
} {
  const cached = getCachedPortalBranding();
  const customLogo = String(layout.header.logo || '').trim();
  const institutionalLogo = String(params.companyLogoDataUrl ?? cached?.logoDataUrl ?? '').trim();
  const url = customLogo || institutionalLogo;
  const isInstitutional = !customLogo && Boolean(url);
  const darkBackdrop =
    params.logoDarkBackdrop ?? (isInstitutional ? getCachedLogoNeedsDarkBackdrop() : false);
  const alt = String(params.companyName || cached?.companyName || 'Logomarca da Empresa').trim();
  return { url, darkBackdrop, alt };
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(raw: string): string {
  return (
    String(raw || 'relatorio')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'relatorio'
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function getVisibleColumns(layout: ReportLayoutConfig, rows: Array<Record<string, any>>): ReportColumnDef[] {
  const configured = (layout.columns || []).filter((c) => c.visible !== false);
  if (configured.length > 0) return configured;
  if (rows.length > 0) {
    return Object.keys(rows[0]).map((field) => ({
      field,
      label: field,
      visible: true,
      width: 'auto',
      align: 'left' as const,
      format: 'text' as const,
    }));
  }
  return [];
}

export function buildGroupKey(row: Record<string, any>, fields: string[]): string {
  return fields
    .map((f) => {
      const v = row[f];
      return v === null || v === undefined || String(v).trim() === '' ? '(vazio)' : String(v);
    })
    .join(' · ');
}

export function formatGroupHeaderText(templateStr: string, groupKey: string, fields: string[], sampleRow: Record<string, any>): string {
  const raw = String(templateStr || '').trim();
  if (!raw) return groupKey;
  let out = raw.replace(/\{\{\s*(grupo|group)\s*\}\}/gi, groupKey);
  for (const f of fields) {
    const val = sampleRow?.[f] ?? '';
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, 'g'), String(val));
  }
  return out;
}

export function groupReportRows(
  rows: Array<Record<string, any>>,
  fields: string[]
): Array<{ groupKey: string; rows: Array<Record<string, any>> }> {
  if (!fields || fields.length === 0) return [{ groupKey: '', rows }];
  const map = new Map<string, Array<Record<string, any>>>();
  for (const r of rows) {
    const key = buildGroupKey(r, fields);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([groupKey, gRows]) => ({ groupKey, rows: gRows }));
}

function formatTotalizerCell(
  rows: Array<Record<string, any>>,
  col: ReportColumnDef,
  totalizer: ReportTotalizerDef | undefined
): string {
  if (!totalizer || totalizer.operation === 'nenhum') return '';
  const val = computeNumericAggregate(rows, col.field, totalizer.operation);
  if (totalizer.operation === 'contagem') return `${val.toLocaleString('pt-BR')} reg.`;
  return formatReportValue(val, col.format);
}

/**
 * Capture rendered Recharts SVGs inside a DOM container as PNG data URLs for PDF/Word/HTML exports.
 */
export async function captureChartImages(container?: HTMLElement | null): Promise<Array<{ title: string; dataUrl: string; width: number; height: number }>> {
  if (!container) return [];
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-report-chart-card]'));
  const results: Array<{ title: string; dataUrl: string; width: number; height: number }> = [];

  for (const card of cards) {
    const svg = card.querySelector<SVGSVGElement>('svg.recharts-surface') || card.querySelector<SVGSVGElement>('svg');
    if (!svg) continue;
    const title = card.getAttribute('data-chart-title') || 'Gráfico';
    const rect = svg.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || 640));
    const h = Math.max(200, Math.round(rect.height || 280));
    try {
      const cloned = svg.cloneNode(true) as SVGSVGElement;
      cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      cloned.setAttribute('width', String(w));
      cloned.setAttribute('height', String(h));
      const xml = new XMLSerializer().serializeToString(cloned);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const dataUrl = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = w * scale;
          canvas.height = h * scale;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
          } else {
            resolve('');
          }
          URL.revokeObjectURL(svgUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve('');
        };
        img.src = svgUrl;
      });
      if (dataUrl) {
        results.push({ title, dataUrl, width: w, height: h });
      }
    } catch {
      // Ignore single SVG serialization issue
    }
  }
  return results;
}

function resolveSubreportsRows(
  rows: Array<Record<string, any>>,
  subreports: ReportSubreportDef[],
  subreportsData?: SubreportExportData[]
): SubreportExportData[] {
  const byId = new Map((subreportsData || []).map((s) => [s.subreport.id, s.rows]));
  return subreports.map((sub) => {
    if (sub.type === 'summary') {
      const existing = byId.get(sub.id);
      return {
        subreport: sub,
        rows: existing && existing.length > 0 ? existing : computeSummaryRows(rows, sub),
      };
    }
    return {
      subreport: sub,
      rows: byId.get(sub.id) || [],
    };
  });
}

function getSubreportColumns(sub: ReportSubreportDef, rows: Array<Record<string, any>>) {
  if (sub.columns && sub.columns.length > 0) return sub.columns;
  if (rows.length > 0) {
    return Object.keys(rows[0]).map((field) => ({
      field,
      label: field,
      width: 120,
      format: '' as const,
      align: 'left' as const,
    }));
  }
  return [];
}

// ============================================================================
// 1. EXPORT PDF (jsPDF + jspdf-autotable)
// ============================================================================
export async function exportReportToPdf(params: ReportExportParams): Promise<void> {
  const { template, rows, chartsContainer } = params;
  const layout = normalizeLayoutConfig(template.layout);
  const cols = getVisibleColumns(layout, rows);
  const pageFormat =
    layout.general.pageSize === 'Letter' ? 'letter' : layout.general.pageSize === 'Legal' ? 'legal' : 'a4';

  const doc = new jsPDF({
    orientation: layout.general.orientation === 'landscape' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: pageFormat,
  });

  const mTop = Math.max(10, Number(layout.general.margins?.top ?? 18));
  const mBottom = Math.max(12, Number(layout.general.margins?.bottom ?? 18));
  const mLeft = Math.max(10, Number(layout.general.margins?.left ?? 14));
  const mRight = Math.max(10, Number(layout.general.margins?.right ?? 14));
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - mLeft - mRight;
  let cursorY = mTop;

  const resolvedLogo = resolveExportLogo(layout, params);
  const hasPdfLogo =
    layout.header.show &&
    layout.header.showLogo !== false &&
    Boolean(resolvedLogo.url && resolvedLogo.url.startsWith('data:image/'));
  const subsequentTopMargin = hasPdfLogo ? Math.max(mTop, 25) : mTop;

  const drawCenteredPdfLogo = (topY: number): number => {
    if (!hasPdfLogo) return 0;
    try {
      const fmt = resolvedLogo.url.includes('image/png')
        ? 'PNG'
        : resolvedLogo.url.includes('image/webp')
        ? 'WEBP'
        : 'JPEG';
      let logoW = 14;
      let logoH = 14;
      try {
        const props = doc.getImageProperties(resolvedLogo.url);
        if (props?.width && props?.height) {
          const maxW = 46;
          const maxH = 14;
          const scale = Math.min(maxW / props.width, maxH / props.height);
          logoW = Math.max(8, props.width * scale);
          logoH = Math.max(8, props.height * scale);
        }
      } catch {
        // fallback dimensions
      }
      const logoX = (pageWidth - logoW) / 2;
      if (resolvedLogo.darkBackdrop) {
        doc.setFillColor(15, 23, 42);
        doc.roundedRect(logoX - 3, topY - 1.5, logoW + 6, logoH + 3, 2, 2, 'F');
      }
      doc.addImage(resolvedLogo.url, fmt, logoX, topY, logoW, logoH);
      return logoH + 4;
    } catch {
      return 0;
    }
  };

  // Header
  if (layout.header.show) {
    const title = layout.header.title || template.name || 'Relatório Geral';
    const align = layout.header.alignment || 'left';
    const xPos = align === 'center' ? pageWidth / 2 : align === 'right' ? pageWidth - mRight : mLeft;
    const textAlignOpt = { align } as const;

    if (hasPdfLogo) {
      cursorY += drawCenteredPdfLogo(Math.max(6, cursorY - 3));
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(title, xPos, cursorY + 4, textAlignOpt);
    cursorY += 7;

    if (layout.header.subtitle) {
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(layout.header.subtitle, xPos, cursorY + 3, textAlignOpt);
      cursorY += 5.5;
    }

    if (layout.header.showDate) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, xPos, cursorY + 2.5, textAlignOpt);
      cursorY += 5;
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(mLeft, cursorY, pageWidth - mRight, cursorY);
    cursorY += 5;
  }

  // Charts if content_mode includes charts
  if (template.content_mode !== 'data' && (template.charts || []).length > 0) {
    const chartImgs = await captureChartImages(chartsContainer);
    for (const img of chartImgs) {
      const ratio = img.height / img.width;
      const drawW = Math.min(usableWidth, 165);
      const drawH = Math.min(72, drawW * ratio);
      if (cursorY + drawH + 14 > pageHeight - mBottom) {
        doc.addPage();
        cursorY = subsequentTopMargin;
      }
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(img.title, mLeft, cursorY + 3);
      cursorY += 5;
      doc.addImage(img.dataUrl, 'PNG', mLeft, cursorY, drawW, drawH);
      cursorY += drawH + 6;
    }
  }

  // Main table (supports grouping + subtotals)
  if (template.content_mode !== 'charts' && cols.length > 0) {
    const groupingFields = layout.grouping?.fields || [];
    const grouped = groupReportRows(rows, groupingFields);
    const bodyRows: any[] = [];

    for (const grp of grouped) {
      if (groupingFields.length > 0) {
        const hdr = formatGroupHeaderText(
          layout.grouping?.headerTemplate || '',
          grp.groupKey,
          groupingFields,
          grp.rows[0] || {}
        );
        bodyRows.push([
          {
            content: `${hdr} (${grp.rows.length} registros)`,
            colSpan: cols.length,
            styles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
          },
        ]);
      }

      for (const r of grp.rows) {
        bodyRows.push(cols.map((c) => formatReportValue(r[c.field], c.format)));
      }

      if (groupingFields.length > 0 && layout.grouping?.showSubtotals) {
        const subTots = layout.grouping.totalizers || [];
        bodyRows.push(
          cols.map((c, idx) => {
            const tot = subTots.find((t) => t.field === c.field && t.operation !== 'nenhum');
            const content = idx === 0 && !tot ? 'Subtotal' : formatTotalizerCell(grp.rows, c, tot);
            return {
              content,
              styles: { fillColor: [248, 250, 252], fontStyle: 'bold', textColor: [30, 41, 59] },
            };
          })
        );
      }
    }

    const footerTots = layout.footer.totalizers || [];
    const hasFooterTotals = layout.footer.showTotals && footerTots.some((t) => t.operation !== 'nenhum');
    const footRows = hasFooterTotals
      ? [
          cols.map((c, idx) => {
            const tot = footerTots.find((t) => t.field === c.field && t.operation !== 'nenhum');
            if (tot) return formatTotalizerCell(rows, c, tot);
            return idx === 0 ? `Total (${rows.length})` : '';
          }),
        ]
      : undefined;

    const columnStyles: Record<number, { halign: 'left' | 'center' | 'right' }> = {};
    cols.forEach((c, idx) => {
      columnStyles[idx] = { halign: c.align || 'left' };
    });

    autoTable(doc, {
      startY: cursorY,
      margin: { top: subsequentTopMargin, bottom: mBottom, left: mLeft, right: mRight },
      head: [cols.map((c) => c.label || c.field)],
      body: bodyRows,
      foot: footRows,
      theme: layout.general.zebra ? 'striped' : 'grid',
      styles: {
        fontSize: Math.max(7, Math.min(10, Number(layout.general.fontSize || 11) - 3)),
        cellPadding: 2,
        textColor: [30, 41, 59],
      },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      columnStyles,
    });

    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY) + 8;
  }

  // Subreports
  const resolvedSubs = resolveSubreportsRows(rows, template.subreports || [], params.subreportsData);
  for (const { subreport, rows: subRows } of resolvedSubs) {
    const subCols = getSubreportColumns(subreport, subRows);
    if (subCols.length === 0) continue;
    if (cursorY + 25 > pageHeight - mBottom) {
      doc.addPage();
      cursorY = subsequentTopMargin;
    }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(subreport.title || 'Sub-relatório', mLeft, cursorY);
    cursorY += 3;

    const subFoot =
      (subreport.totalizers || []).some((t) => t.operation !== 'none')
        ? [
            subCols.map((sc, idx) => {
              const tot = subreport.totalizers.find((t) => t.field === sc.field && t.operation !== 'none');
              if (!tot) return idx === 0 ? 'Total' : '';
              const num = computeNumericAggregate(subRows, sc.field, tot.operation);
              return tot.operation === 'count' ? String(num) : formatReportValue(num, sc.format || 'number');
            }),
          ]
        : undefined;

    autoTable(doc, {
      startY: cursorY,
      margin: { top: subsequentTopMargin, bottom: mBottom, left: mLeft, right: mRight },
      head: [subCols.map((sc) => sc.label || sc.field)],
      body: subRows.map((sr) => subCols.map((sc) => formatReportValue(sr[sc.field], sc.format || 'text'))),
      foot: subFoot,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY) + 8;
  }

  // Subsequent page top-center logos + Page numbers & footer text
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    if (p > 1 && hasPdfLogo) {
      drawCenteredPdfLogo(6);
    }
    if (layout.footer.show) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const footerY = pageHeight - Math.max(6, mBottom / 2);
      const leftTxt = [
        layout.footer.customText,
        layout.footer.showDateTime ? `Emitido em ${new Date().toLocaleString('pt-BR')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (leftTxt) {
        doc.text(leftTxt, mLeft, footerY);
      }
      if (layout.footer.showPageNumbers) {
        doc.text(`Página ${p} de ${totalPages}`, pageWidth - mRight, footerY, { align: 'right' });
      }
    }
  }

  doc.save(`${sanitizeFilename(template.name)}.pdf`);
}

// ============================================================================
// 2. EXPORT EXCEL (xlsx multi-sheet)
// ============================================================================
export function exportReportToExcel(params: ReportExportParams): void {
  const { template, rows } = params;
  const layout = normalizeLayoutConfig(template.layout);
  const cols = getVisibleColumns(layout, rows);

  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  const makeUniqueSheetName = (raw: string): string => {
    const clean =
      String(raw || 'Planilha')
        .replace(/[\\/?*[\]:]/g, ' ')
        .trim()
        .slice(0, 28) || 'Planilha';
    let candidate = clean;
    let suffix = 2;
    while (usedSheetNames.has(candidate.toLowerCase())) {
      candidate = `${clean.slice(0, 26)}_${suffix++}`;
    }
    usedSheetNames.add(candidate.toLowerCase());
    return candidate;
  };

  // Main sheet
  const aoa: any[][] = [];
  if (layout.header.title || template.name) {
    aoa.push([layout.header.title || template.name]);
    if (layout.header.subtitle) aoa.push([layout.header.subtitle]);
    aoa.push([`Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} registro(s)`]);
    aoa.push([]);
  }
  aoa.push(cols.map((c) => c.label || c.field));

  for (const r of rows) {
    aoa.push(
      cols.map((c) => {
        const raw = r[c.field];
        if (c.format === 'number' || c.format === 'currency_brl' || c.format === 'percent') {
          const n = parseNumericValue(raw);
          return n !== null ? n : raw ?? '';
        }
        return formatReportValue(raw, c.format);
      })
    );
  }

  const footerTots = layout.footer.totalizers || [];
  if (layout.footer.showTotals && footerTots.some((t) => t.operation !== 'nenhum')) {
    aoa.push(
      cols.map((c, idx) => {
        const tot = footerTots.find((t) => t.field === c.field && t.operation !== 'nenhum');
        if (!tot) return idx === 0 ? 'TOTAL' : '';
        return computeNumericAggregate(rows, c.field, tot.operation);
      })
    );
  }

  const wsMain = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, wsMain, makeUniqueSheetName('Relatório'));

  // Charts sheets
  (template.charts || []).forEach((chart: ReportChartDef, idx: number) => {
    const agg = aggregateChartSeries(rows, chart);
    if (agg.data.length === 0) return;
    const chartAoa: any[][] = [
      [chart.title || `Gráfico ${idx + 1}`],
      [chart.xField, ...agg.seriesKeys.map((s) => s.label)],
      ...agg.data.map((pt) => [pt.__x, ...agg.seriesKeys.map((s) => pt[s.key] ?? 0)]),
    ];
    const wsChart = XLSX.utils.aoa_to_sheet(chartAoa);
    XLSX.utils.book_append_sheet(wb, wsChart, makeUniqueSheetName(chart.title || `Gráfico ${idx + 1}`));
  });

  // Subreports sheets
  const resolvedSubs = resolveSubreportsRows(rows, template.subreports || [], params.subreportsData);
  resolvedSubs.forEach(({ subreport, rows: subRows }, idx) => {
    const subCols = getSubreportColumns(subreport, subRows);
    const subAoa: any[][] = [
      [subreport.title || `Sub-relatório ${idx + 1}`],
      subCols.map((sc) => sc.label || sc.field),
      ...subRows.map((sr) =>
        subCols.map((sc) => {
          if (sc.format === 'number' || sc.format === 'currency' || sc.format === 'percent') {
            const n = parseNumericValue(sr[sc.field]);
            return n !== null ? n : sr[sc.field] ?? '';
          }
          return formatReportValue(sr[sc.field], sc.format || 'text');
        })
      ),
    ];
    const wsSub = XLSX.utils.aoa_to_sheet(subAoa);
    XLSX.utils.book_append_sheet(wb, wsSub, makeUniqueSheetName(subreport.title || `Sub_${idx + 1}`));
  });

  XLSX.writeFile(wb, `${sanitizeFilename(template.name)}.xlsx`);
}

// ============================================================================
// 3. EXPORT CSV (UTF-8 BOM + Formula Injection Protection)
// ============================================================================
function csvEscapeCell(raw: unknown): string {
  let str = String(raw ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function exportReportToCsv(params: ReportExportParams): void {
  const { template, rows } = params;
  const layout = normalizeLayoutConfig(template.layout);
  const cols = getVisibleColumns(layout, rows);

  const lines: string[] = [];
  lines.push(cols.map((c) => csvEscapeCell(c.label || c.field)).join(';'));
  for (const r of rows) {
    lines.push(cols.map((c) => csvEscapeCell(formatReportValue(r[c.field], c.format))).join(';'));
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${sanitizeFilename(template.name)}.csv`);
}

// ============================================================================
// 4. STANDALONE HTML & PRINT DOCUMENT BUILDER
// ============================================================================
export function buildReportHtmlDocument(
  params: ReportExportParams & { chartImages?: Array<{ title: string; dataUrl: string }> }
): string {
  const { template, rows, chartImages = [] } = params;
  const layout = normalizeLayoutConfig(template.layout);
  const cols = getVisibleColumns(layout, rows);
  const groupingFields = layout.grouping?.fields || [];
  const grouped = groupReportRows(rows, groupingFields);
  const title = layout.header.title || template.name || 'Relatório Geral';

  const pageCssSize = `${layout.general.pageSize} ${layout.general.orientation}`;
  const m = layout.general.margins || { top: 20, bottom: 20, left: 15, right: 15 };

  const chartsHtml =
    template.content_mode !== 'data' && chartImages.length > 0
      ? `<section class="charts-grid">${chartImages
          .map(
            (img) =>
              `<div class="chart-box"><h4>${escapeHtml(img.title)}</h4><img src="${img.dataUrl}" alt="${escapeHtml(
                img.title
              )}" /></div>`
          )
          .join('')}</section>`
      : template.content_mode !== 'data' && (template.charts || []).length > 0
      ? `<section class="charts-grid">${(template.charts || [])
          .map((c) => {
            const agg = aggregateChartSeries(rows, c);
            if (agg.data.length === 0) return '';
            return `<div class="chart-box"><h4>${escapeHtml(c.title || 'Resumo Gráfico')}</h4><table><thead><tr><th>${escapeHtml(
              c.xField
            )}</th>${agg.seriesKeys.map((s) => `<th>${escapeHtml(s.label)}</th>`).join('')}</tr></thead><tbody>${agg.data
              .slice(0, 20)
              .map(
                (pt) =>
                  `<tr><td>${escapeHtml(pt.__x)}</td>${agg.seriesKeys
                    .map((s) => `<td class="num">${escapeHtml(Number(pt[s.key] ?? 0).toLocaleString('pt-BR'))}</td>`)
                    .join('')}</tr>`
              )
              .join('')}</tbody></table></div>`;
          })
          .join('')}</section>`
      : '';

  const mainTableHtml =
    template.content_mode !== 'charts' && cols.length > 0
      ? `<table class="data-table">
          <thead><tr>${cols
            .map((c) => `<th style="text-align:${c.align || 'left'}">${escapeHtml(c.label || c.field)}</th>`)
            .join('')}</tr></thead>
          <tbody>
            ${grouped
              .map((grp) => {
                const hdrRow =
                  groupingFields.length > 0
                    ? `<tr class="grp-row"><td colspan="${cols.length}">${escapeHtml(
                        formatGroupHeaderText(
                          layout.grouping?.headerTemplate || '',
                          grp.groupKey,
                          groupingFields,
                          grp.rows[0] || {}
                        )
                      )} (${grp.rows.length} registros)</td></tr>`
                    : '';
                const dataRows = grp.rows
                  .map(
                    (r, rIdx) =>
                      `<tr class="${layout.general.zebra && rIdx % 2 === 1 ? 'zebra' : ''}">${cols
                        .map(
                          (c) =>
                            `<td style="text-align:${c.align || 'left'}">${escapeHtml(
                              formatReportValue(r[c.field], c.format)
                            )}</td>`
                        )
                        .join('')}</tr>`
                  )
                  .join('');
                const subTots = layout.grouping?.totalizers || [];
                const subtotalRow =
                  groupingFields.length > 0 && layout.grouping?.showSubtotals
                    ? `<tr class="subtot-row">${cols
                        .map((c, idx) => {
                          const tot = subTots.find((t) => t.field === c.field && t.operation !== 'nenhum');
                          const val = idx === 0 && !tot ? 'Subtotal' : formatTotalizerCell(grp.rows, c, tot);
                          return `<td style="text-align:${c.align || 'left'}">${escapeHtml(val)}</td>`;
                        })
                        .join('')}</tr>`
                    : '';
                return hdrRow + dataRows + subtotalRow;
              })
              .join('')}
          </tbody>
          ${
            layout.footer.showTotals && (layout.footer.totalizers || []).some((t) => t.operation !== 'nenhum')
              ? `<tfoot><tr class="tot-row">${cols
                  .map((c, idx) => {
                    const tot = (layout.footer.totalizers || []).find(
                      (t) => t.field === c.field && t.operation !== 'nenhum'
                    );
                    const val = tot
                      ? formatTotalizerCell(rows, c, tot)
                      : idx === 0
                      ? `Total (${rows.length})`
                      : '';
                    return `<td style="text-align:${c.align || 'left'}">${escapeHtml(val)}</td>`;
                  })
                  .join('')}</tr></tfoot>`
              : ''
          }
        </table>`
      : '';

  const resolvedSubs = resolveSubreportsRows(rows, template.subreports || [], params.subreportsData);
  const subsHtml = resolvedSubs
    .map(({ subreport, rows: subRows }) => {
      const subCols = getSubreportColumns(subreport, subRows);
      if (subCols.length === 0) return '';
      return `<section class="subreport-section">
        <h3>${escapeHtml(subreport.title || 'Sub-relatório')}</h3>
        <table class="data-table">
          <thead><tr>${subCols
            .map((sc) => `<th style="text-align:${sc.align || 'left'}">${escapeHtml(sc.label || sc.field)}</th>`)
            .join('')}</tr></thead>
          <tbody>${subRows
            .map(
              (sr) =>
                `<tr>${subCols
                  .map(
                    (sc) =>
                      `<td style="text-align:${sc.align || 'left'}">${escapeHtml(
                        formatReportValue(sr[sc.field], sc.format || 'text')
                      )}</td>`
                  )
                  .join('')}</tr>`
            )
            .join('')}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const resolvedHtmlLogo = resolveExportLogo(layout, params);
  const logoHtmlBlock =
    layout.header.showLogo !== false && resolvedHtmlLogo.url
      ? `<div class="hdr-logo"><span class="${
          resolvedHtmlLogo.darkBackdrop ? 'hdr-logo-badge dark' : 'hdr-logo-badge'
        }"><img src="${escapeHtml(resolvedHtmlLogo.url)}" alt="${escapeHtml(
          resolvedHtmlLogo.alt
        )}" /></span></div>`
      : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: ${pageCssSize}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
    * { box-sizing: border-box; }
    body { font-family: ${escapeHtml(layout.general.fontFamily || 'Arial')}, sans-serif; font-size: ${Math.max(
      10,
      Number(layout.general.fontSize || 12)
    )}px; color: #0f172a; margin: 0; padding: 24px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .hdr { border-bottom: 1.5px solid #cbd5e1; padding-bottom: 12px; margin-bottom: 16px; text-align: ${
      layout.header.alignment || 'left'
    }; }
    .hdr-logo { display: flex; justify-content: center; align-items: center; width: 100%; margin: 0 auto 10px auto; text-align: center; }
    .hdr-logo-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
    .hdr-logo-badge.dark { background: #0f172a; padding: 6px 14px; }
    .hdr-logo img { max-height: 52px; max-width: 190px; width: auto; height: auto; object-fit: contain; display: block; margin: 0 auto; }
    .hdr h1 { margin: 0; font-size: 18px; font-weight: 700; color: #0f172a; }
    .hdr p { margin: 4px 0 0; font-size: 12px; color: #475569; }
    .hdr .dt { margin-top: 4px; font-size: 11px; color: #64748b; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .chart-box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #fff; }
    .chart-box h4 { margin: 0 0 8px; font-size: 13px; color: #1e293b; }
    .chart-box img { max-width: 100%; height: auto; display: block; }
    table.data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-variant-numeric: tabular-nums; }
    table.data-table th { background: #1e293b; color: #fff; font-weight: 600; padding: 7px 8px; border: 1px solid #334155; font-size: 11px; }
    table.data-table td { padding: 6px 8px; border: 1px solid #e2e8f0; font-size: 11px; }
    tr.zebra td { background: #f8fafc; }
    tr.grp-row td { background: #e2e8f0; font-weight: 700; color: #0f172a; }
    tr.subtot-row td, tr.tot-row td { background: #f1f5f9; font-weight: 700; border-top: 1.5px solid #94a3b8; }
    .subreport-section { margin-top: 18px; }
    .subreport-section h3 { margin: 0 0 8px; font-size: 14px; color: #1e293b; }
    .ftr { border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 18px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  ${
    layout.header.show
      ? `<header class="hdr">
          ${logoHtmlBlock}
          <h1>${escapeHtml(title)}</h1>
          ${layout.header.subtitle ? `<p>${escapeHtml(layout.header.subtitle)}</p>` : ''}
          ${layout.header.showDate ? `<div class="dt">Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} registro(s)</div>` : ''}
        </header>`
      : ''
  }
  ${chartsHtml}
  ${mainTableHtml}
  ${subsHtml}
  ${
    layout.footer.show
      ? `<footer class="ftr"><span>${escapeHtml(layout.footer.customText || '')}${
          layout.footer.showDateTime ? ` · Emitido em ${new Date().toLocaleString('pt-BR')}` : ''
        }</span><span>${escapeHtml(resolvedHtmlLogo.alt || 'FinancePro Assessoria')}</span></footer>`
      : ''
  }
</body>
</html>`;
}

export async function exportReportToHtml(params: ReportExportParams): Promise<void> {
  const chartImages = await captureChartImages(params.chartsContainer);
  const html = buildReportHtmlDocument({ ...params, chartImages });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  downloadBlob(blob, `${sanitizeFilename(params.template.name)}.html`);
}

export async function exportReportToWord(params: ReportExportParams): Promise<void> {
  const chartImages = await captureChartImages(params.chartsContainer);
  const baseHtml = buildReportHtmlDocument({ ...params, chartImages });
  const wordDoc = baseHtml.replace(
    '<html lang="pt-BR">',
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="pt-BR">'
  );
  const blob = new Blob(['\uFEFF', wordDoc], { type: 'application/msword;charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(params.template.name)}.doc`);
}

export async function preparePrintHtmlDocument(
  params: ReportExportParams
): Promise<string> {
  const chartImages = await captureChartImages(params.chartsContainer);
  return buildReportHtmlDocument({ ...params, chartImages });
}
