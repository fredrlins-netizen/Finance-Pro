import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBRL, formatDateBR, formatDateTimeBR } from './api.ts';
import type {
  CollectionReport,
  CollectionReportColumn,
  FinancialTitle,
  IviStateMonthAnalysis,
  StateDebtRecoveryMetric,
} from '../types.ts';

function sanitizeFileSlug(raw: string): string {
  return (raw || 'relatorio_cobranca')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function formatReportCellValue(
  raw: string | number | undefined | null,
  format?: CollectionReportColumn['format']
): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  if (format === 'currency') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return formatBRL(Math.round(num));
  }
  if (format === 'percent') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return `${num.toFixed(1)}%`;
  }
  if (format === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return num.toLocaleString('pt-BR');
  }
  if (format === 'date') {
    return formatDateBR(String(raw));
  }
  return String(raw);
}

function rawExcelValue(
  raw: string | number | undefined | null,
  format?: CollectionReportColumn['format']
): string | number {
  if (raw === undefined || raw === null) return '';
  if (format === 'currency') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? Number((num / 100).toFixed(2)) : String(raw);
  }
  if (format === 'percent' || format === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : String(raw);
  }
  if (format === 'date') {
    return formatDateBR(String(raw));
  }
  return raw;
}

export function exportReportToExcel(report: CollectionReport): void {
  const wb = XLSX.utils.book_new();
  const cols = report.columnsJson || [];
  const rows = report.rowsJson || [];

  const mainSheetRows = rows.map((row) => {
    const record: Record<string, string | number> = {};
    for (const col of cols) {
      const header = col.format === 'currency' ? `${col.label} (R$)` : col.label;
      record[header] = rawExcelValue(row[col.key], col.format);
    }
    return record;
  });

  const dataWs = XLSX.utils.json_to_sheet(
    mainSheetRows.length > 0 ? mainSheetRows : [{ Aviso: 'Sem registros para os critérios do relatório.' }]
  );
  dataWs['!cols'] = cols.map((c) => ({
    wch: Math.max(14, Math.min(36, c.label.length + 6)),
  }));
  XLSX.utils.book_append_sheet(wb, dataWs, 'Dados');

  const metaRows: Array<Record<string, string>> = [
    { Campo: 'Relatório', Valor: report.title },
    { Campo: 'Tipo', Valor: report.reportType },
    { Campo: 'Criado em', Valor: formatDateTimeBR(report.createdAt) },
    { Campo: 'Responsável', Valor: report.createdByName || 'Coordenação' },
    { Campo: 'Motor Ivi', Valor: report.provider || 'ivi' },
    { Campo: 'Resumo Executivo', Valor: report.executiveSummary || '—' },
    ...(report.insightsJson || []).map((ins, i) => ({
      Campo: `Insight Ivi #${i + 1}`,
      Valor: ins,
    })),
  ];
  const metaWs = XLSX.utils.json_to_sheet(metaRows);
  metaWs['!cols'] = [{ wch: 24 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, metaWs, 'Resumo e Insights');

  if ((report.chartSeriesJson || []).length > 0) {
    const chartWs = XLSX.utils.json_to_sheet(
      report.chartSeriesJson.map((pt) => ({
        Categoria: pt.label,
        'Valor Principal': pt.value,
        'Valor Secundário': pt.secondaryValue ?? 0,
      }))
    );
    chartWs['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, chartWs, 'Serie Grafica');
  }

  const fileName = `${sanitizeFileSlug(report.title)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

export function exportReportToPdf(report: CollectionReport): void {
  const cols = report.columnsJson || [];
  const landscape = cols.length >= 6;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 14;

  // Cabeçalho Corporativo
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('FinancePro Assessoria · Cobrança & Ranking', 14, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Coordenação · Gerado por ${report.createdByName || 'Coordenação'} em ${formatDateTimeBR(report.createdAt)}`,
    14,
    16.5
  );

  cursorY = 32;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(report.title, 14, cursorY);
  cursorY += 6;

  if (report.executiveSummary) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const wrapped = doc.splitTextToSize(report.executiveSummary, pageWidth - 28);
    doc.text(wrapped, 14, cursorY);
    cursorY += wrapped.length * 4.5 + 3;
  }

  if ((report.insightsJson || []).length > 0) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Insights Ivi:', 14, cursorY);
    cursorY += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    for (const ins of report.insightsJson.slice(0, 5)) {
      const lines = doc.splitTextToSize(`• ${ins}`, pageWidth - 32);
      doc.text(lines, 16, cursorY);
      cursorY += lines.length * 4.2 + 1;
    }
    cursorY += 3;
  }

  if ((report.chartSeriesJson || []).length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Categoria / Dimensão', 'Valor / Saldo (R$ ou Unid.)', 'Qtd / Sec.']],
      body: report.chartSeriesJson.map((pt) => [
        pt.label,
        pt.value >= 1000
          ? pt.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : pt.value.toLocaleString('pt-BR'),
        String(pt.secondaryValue ?? 0),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    cursorY = (lastY || cursorY + 20) + 6;
  }

  if (cols.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [cols.map((c) => c.label)],
      body: (report.rowsJson || []).map((row) =>
        cols.map((c) => formatReportCellValue(row[c.key], c.format))
      ),
      styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });
  }

  const fileName = `${sanitizeFileSlug(report.title)}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

export interface DashboardSnapshotExportInput {
  totalCount: number;
  overdueCount: number;
  defaultRate: number;
  totalBalanceCents: number;
  overdueBalanceCents: number;
  recoveredCents: number;
  recoveryRate: number;
  dsoDays: number;
  agingBuckets: Array<{ label: string; count: number; balanceCents: number }>;
  collabPerformance: Array<{ name: string; count: number; balanceCents: number; overdueBalanceCents: number }>;
  titles: FinancialTitle[];
  getClientName: (clientId: number, fallback?: string) => string;
  getCollaboratorName: (collabId?: number | null) => string;
  filterLabel: string;
  monthlyAccumulated?: {
    month: string;
    monthLabel: string;
    monthDebtCents: number;
    monthOverdueDebtCents: number;
    monthRecoveredCents: number;
    monthRecoveryRatePct: number;
    monthOpenCount: number;
    monthSettledCount: number;
  };
  stateMetrics?: StateDebtRecoveryMetric[];
  iviStateAnalysis?: IviStateMonthAnalysis | null;
}

export function exportDashboardSnapshotToExcel(input: DashboardSnapshotExportInput): void {
  const wb = XLSX.utils.book_new();

  const kpiSheet = XLSX.utils.json_to_sheet([
    { Indicador: 'Filtro Aplicado', Valor: input.filterLabel },
    { Indicador: 'Títulos Ativos', Valor: input.totalCount },
    { Indicador: 'Títulos Vencidos', Valor: input.overdueCount },
    { Indicador: 'Taxa de Inadimplência (%)', Valor: Number(input.defaultRate.toFixed(1)) },
    { Indicador: 'Saldo Total em Aberto (R$)', Valor: Number((input.totalBalanceCents / 100).toFixed(2)) },
    { Indicador: 'Saldo Vencido (R$)', Valor: Number((input.overdueBalanceCents / 100).toFixed(2)) },
    { Indicador: 'Total Recuperado (R$)', Valor: Number((input.recoveredCents / 100).toFixed(2)) },
    { Indicador: 'Taxa de Recuperação (%)', Valor: Number(input.recoveryRate.toFixed(1)) },
    { Indicador: 'DSO Médio (Dias)', Valor: input.dsoDays },
  ]);
  kpiSheet['!cols'] = [{ wch: 30 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, kpiSheet, 'Indicadores KPI');

  const agingSheet = XLSX.utils.json_to_sheet(
    input.agingBuckets.map((b) => ({
      'Faixa de Atraso': b.label,
      'Qtd. Títulos': b.count,
      'Saldo (R$)': Number((b.balanceCents / 100).toFixed(2)),
    }))
  );
  agingSheet['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, agingSheet, 'Aging');

  const perfSheet = XLSX.utils.json_to_sheet(
    input.collabPerformance.map((c) => ({
      Operador: c.name,
      'Qtd. Títulos': c.count,
      'Saldo Carteira (R$)': Number((c.balanceCents / 100).toFixed(2)),
      'Saldo Vencido (R$)': Number((c.overdueBalanceCents / 100).toFixed(2)),
    }))
  );
  perfSheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, perfSheet, 'Performance Operadores');

  const titlesSheet = XLSX.utils.json_to_sheet(
    input.titles.map((t) => ({
      Cliente: input.getClientName(t.clientId, t.clientName),
      Documento: t.documentNumber || t.titleCode,
      Vencimento: formatDateBR(t.dueDate),
      'Valor Original (R$)': Number((Number(t.originalValueCents || t.amountCents || 0) / 100).toFixed(2)),
      'Saldo Atual (R$)': Number((Number(t.currentBalanceCents ?? t.amountCents ?? 0) / 100).toFixed(2)),
      Status: t.status === 'PAGO' ? 'Recebimento Total' : t.status === 'PARCIAL' ? 'Recebimento Parcial' : t.status,
      'Situação Cobrança': t.collectionStatus || 'EM_DIA',
      Operador: input.getCollaboratorName(t.assignedCollaboratorId),
    }))
  );
  titlesSheet['!cols'] = [
    { wch: 30 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, titlesSheet, 'Carteira Detalhada');

  if (input.monthlyAccumulated) {
    const m = input.monthlyAccumulated;
    const mSheet = XLSX.utils.json_to_sheet([
      { Indicador: 'Mês de Referência', Valor: m.monthLabel },
      { Indicador: 'Títulos com Vencimento no Mês', Valor: m.monthOpenCount },
      { Indicador: 'Endividamento Acumulado no Mês (R$)', Valor: Number((m.monthDebtCents / 100).toFixed(2)) },
      { Indicador: 'Saldo Já Vencido no Mês (R$)', Valor: Number((m.monthOverdueDebtCents / 100).toFixed(2)) },
      { Indicador: 'Liquidações / Baixas no Mês', Valor: m.monthSettledCount },
      { Indicador: 'Recuperação Acumulada no Mês (R$)', Valor: Number((m.monthRecoveredCents / 100).toFixed(2)) },
      { Indicador: 'Taxa de Recuperação do Mês (%)', Valor: Number(m.monthRecoveryRatePct.toFixed(1)) },
    ]);
    mSheet['!cols'] = [{ wch: 36 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, mSheet, 'Acumulado do Mes');
  }

  if (input.stateMetrics && input.stateMetrics.length > 0) {
    const ufSheet = XLSX.utils.json_to_sheet(
      input.stateMetrics.map((s) => ({
        'Estado (UF)': s.uf,
        Clientes: s.clientsCount,
        'Títulos Abertos': s.openTitlesCount,
        'Endividamento Total (R$)': Number((s.debtBalanceCents / 100).toFixed(2)),
        'Saldo Vencido (R$)': Number((s.overdueDebtCents / 100).toFixed(2)),
        'Recuperado Total (R$)': Number((s.recoveredTotalCents / 100).toFixed(2)),
        'Taxa Recup. Geral (%)': Number(s.recoveryRatePct.toFixed(1)),
        'Endividamento Mês (R$)': Number((s.monthDebtCents / 100).toFixed(2)),
        'Recuperado Mês (R$)': Number((s.monthRecoveredCents / 100).toFixed(2)),
        'Taxa Recup. Mês (%)': Number(s.monthRecoveryRatePct.toFixed(1)),
      }))
    );
    ufSheet['!cols'] = Array.from({ length: 10 }, () => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ufSheet, 'Por Estado (UF)');
  }

  if (input.iviStateAnalysis) {
    const iviRows = [
      { Campo: 'Mês Analisado', Conteudo: input.iviStateAnalysis.month },
      { Campo: 'Motor Ivi', Conteudo: input.iviStateAnalysis.provider },
      { Campo: 'Resumo Executivo', Conteudo: input.iviStateAnalysis.executiveSummary },
      { Campo: 'UFs Prioritárias', Conteudo: input.iviStateAnalysis.focusUfs.join(', ') || '—' },
      ...input.iviStateAnalysis.highlights.map((h, i) => ({
        Campo: `Destaque Ivi #${i + 1}`,
        Conteudo: h,
      })),
    ];
    const iviWs = XLSX.utils.json_to_sheet(iviRows);
    iviWs['!cols'] = [{ wch: 24 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(wb, iviWs, 'Analise Ivi UF e Mes');
  }

  XLSX.writeFile(wb, `dashboard_cobranca_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportDashboardSnapshotToPdf(input: DashboardSnapshotExportInput): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('FinancePro Assessoria · Dashboard Cobrança & Ranking (Coordenação)', 14, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Filtro: ${input.filterLabel} · Emitido em ${formatDateTimeBR(new Date())}`, 14, 16.5);

  autoTable(doc, {
    startY: 30,
    head: [['Indicador', 'Valor', 'Detalhe']],
    body: [
      ['Taxa de Inadimplência', `${input.defaultRate.toFixed(1)}%`, `${input.overdueCount} de ${input.totalCount} títulos vencidos`],
      ['Taxa de Recuperação', `${input.recoveryRate.toFixed(1)}%`, `Recuperado: ${formatBRL(input.recoveredCents)}`],
      ['Saldo Total / Vencido', formatBRL(input.totalBalanceCents), `Vencido: ${formatBRL(input.overdueBalanceCents)}`],
      ['DSO (Prazo Médio)', `${input.dsoDays} dias`, 'Prazo médio estimado de recebimento'],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    margin: { left: 14, right: 14 },
  });

  const y1 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 75;
  autoTable(doc, {
    startY: y1 + 5,
    head: [['Faixa de Atraso', 'Qtd. Títulos', 'Saldo (R$)']],
    body: input.agingBuckets.map((b) => [b.label, String(b.count), formatBRL(b.balanceCents)]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: 14, right: 155 },
  });

  autoTable(doc, {
    startY: y1 + 5,
    head: [['Operador', 'Qtd.', 'Saldo Carteira', 'Vencido']],
    body: input.collabPerformance.slice(0, 8).map((c) => [
      c.name,
      String(c.count),
      formatBRL(c.balanceCents),
      formatBRL(c.overdueBalanceCents),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: 152, right: 14 },
  });

  const y2 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 130;
  autoTable(doc, {
    startY: Math.max(y1 + 48, y2 + 6),
    head: [['Cliente', 'Documento', 'Vencimento', 'Valor Orig.', 'Saldo', 'Status', 'Operador']],
    body: input.titles.slice(0, 120).map((t) => [
      input.getClientName(t.clientId, t.clientName),
      t.documentNumber || t.titleCode,
      formatDateBR(t.dueDate),
      formatBRL(t.originalValueCents || t.amountCents || 0),
      formatBRL(t.currentBalanceCents ?? t.amountCents ?? 0),
      t.status === 'PAGO' ? 'Recebimento Total' : t.status === 'PARCIAL' ? 'Recebimento Parcial' : t.status,
      input.getCollaboratorName(t.assignedCollaboratorId),
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  if (input.stateMetrics && input.stateMetrics.length > 0) {
    doc.addPage();
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Endividamento & Recuperação por Estado (UF) e Acumulado (${input.monthlyAccumulated?.monthLabel || 'Mês'})`,
      14,
      12.5
    );

    let nextY = 26;
    if (input.monthlyAccumulated) {
      const m = input.monthlyAccumulated;
      autoTable(doc, {
        startY: nextY,
        head: [['Endividamento no Mês', 'Vencido no Mês', 'Recuperado Acum. Mês', 'Taxa Recup. Mês']],
        body: [[
          `${formatBRL(m.monthDebtCents)} (${m.monthOpenCount} tít.)`,
          formatBRL(m.monthOverdueDebtCents),
          `${formatBRL(m.monthRecoveredCents)} (${m.monthSettledCount} baixas)`,
          `${m.monthRecoveryRatePct.toFixed(1)}%`,
        ]],
        styles: { fontSize: 8.5, cellPadding: 2.2 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        margin: { left: 14, right: 14 },
      });
      nextY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 50) + 5;
    }

    autoTable(doc, {
      startY: nextY,
      head: [[
        'UF',
        'Clientes',
        'Tít. Abertos',
        'Endividamento Total',
        'Saldo Vencido',
        'Recuperado Total',
        '% Recup.',
        'Endivid. Mês',
        'Recup. Mês',
        '% Mês',
      ]],
      body: input.stateMetrics.map((s) => [
        s.uf,
        String(s.clientsCount),
        String(s.openTitlesCount),
        formatBRL(s.debtBalanceCents),
        formatBRL(s.overdueDebtCents),
        formatBRL(s.recoveredTotalCents),
        `${s.recoveryRatePct.toFixed(1)}%`,
        formatBRL(s.monthDebtCents),
        formatBRL(s.monthRecoveredCents),
        `${s.monthRecoveryRatePct.toFixed(1)}%`,
      ]),
      styles: { fontSize: 7.8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });

    if (input.iviStateAnalysis) {
      const yAfterTable = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 140) + 6;
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Análise Executiva da Ivi IA:', 14, yAfterTable);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(input.iviStateAnalysis.executiveSummary, pageWidth - 28);
      doc.text(lines, 14, yAfterTable + 5);
    }
  }

  doc.save(`dashboard_cobranca_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export interface StateMonthlyExportInput {
  monthLabel: string;
  month: string;
  filterLabel: string;
  monthlyAccumulated: {
    monthDebtCents: number;
    monthOverdueDebtCents: number;
    monthRecoveredCents: number;
    monthRecoveryRatePct: number;
    monthOpenCount: number;
    monthSettledCount: number;
  };
  stateMetrics: StateDebtRecoveryMetric[];
  iviAnalysis: IviStateMonthAnalysis | null;
}

export function exportStateMonthlyIndicatorsToExcel(input: StateMonthlyExportInput): void {
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    { Indicador: 'Mês de Referência', Valor: input.monthLabel },
    { Indicador: 'Escopo / Filtro', Valor: input.filterLabel },
    { Indicador: 'Endividamento Acumulado no Mês (R$)', Valor: Number((input.monthlyAccumulated.monthDebtCents / 100).toFixed(2)) },
    { Indicador: 'Saldo Vencido no Mês (R$)', Valor: Number((input.monthlyAccumulated.monthOverdueDebtCents / 100).toFixed(2)) },
    { Indicador: 'Títulos Previstos no Mês', Valor: input.monthlyAccumulated.monthOpenCount },
    { Indicador: 'Recuperação Acumulada no Mês (R$)', Valor: Number((input.monthlyAccumulated.monthRecoveredCents / 100).toFixed(2)) },
    { Indicador: 'Liquidações / Baixas no Mês', Valor: input.monthlyAccumulated.monthSettledCount },
    { Indicador: 'Taxa de Recuperação do Mês (%)', Valor: Number(input.monthlyAccumulated.monthRecoveryRatePct.toFixed(1)) },
  ]);
  summarySheet['!cols'] = [{ wch: 38 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Acumulado do Mes');

  const statesSheet = XLSX.utils.json_to_sheet(
    input.stateMetrics.length > 0
      ? input.stateMetrics.map((s) => ({
          'Estado (UF)': s.uf,
          Clientes: s.clientsCount,
          'Títulos em Aberto': s.openTitlesCount,
          'Endividamento Total (R$)': Number((s.debtBalanceCents / 100).toFixed(2)),
          'Saldo Vencido (R$)': Number((s.overdueDebtCents / 100).toFixed(2)),
          'Recuperado Total (R$)': Number((s.recoveredTotalCents / 100).toFixed(2)),
          'Taxa Recup. Geral (%)': Number(s.recoveryRatePct.toFixed(1)),
          'Endividamento no Mês (R$)': Number((s.monthDebtCents / 100).toFixed(2)),
          'Vencido no Mês (R$)': Number((s.monthOverdueDebtCents / 100).toFixed(2)),
          'Recuperado no Mês (R$)': Number((s.monthRecoveredCents / 100).toFixed(2)),
          'Taxa Recup. Mês (%)': Number(s.monthRecoveryRatePct.toFixed(1)),
        }))
      : [{ Aviso: 'Sem movimentação por Estado para os filtros aplicados.' }]
  );
  statesSheet['!cols'] = Array.from({ length: 11 }, () => ({ wch: 21 }));
  XLSX.utils.book_append_sheet(wb, statesSheet, 'Indicadores por Estado');

  if (input.iviAnalysis) {
    const iviSheet = XLSX.utils.json_to_sheet([
      { Campo: 'Mês', Analise: input.monthLabel },
      { Campo: 'UFs Prioritárias', Analise: input.iviAnalysis.focusUfs.join(', ') || '—' },
      { Campo: 'Resumo Executivo Ivi', Analise: input.iviAnalysis.executiveSummary },
      ...input.iviAnalysis.highlights.map((h, i) => ({ Campo: `Insight #${i + 1}`, Analise: h })),
    ]);
    iviSheet['!cols'] = [{ wch: 24 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(wb, iviSheet, 'Analise Ivi');
  }

  XLSX.writeFile(wb, `endividamento_recuperacao_uf_${input.month}.xlsx`);
}

export function exportStateMonthlyIndicatorsToPdf(input: StateMonthlyExportInput): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('FinancePro · Endividamento & Recuperação por Estado (UF) e Acumulado Mensal', 14, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Mês de Referência: ${input.monthLabel} · Filtro: ${input.filterLabel} · Emitido em ${formatDateTimeBR(new Date())}`,
    14,
    16.5
  );

  autoTable(doc, {
    startY: 30,
    head: [['Endividamento Mês', 'Vencido no Mês', 'Recuperado Acumulado no Mês', 'Taxa Recup. do Mês']],
    body: [[
      `${formatBRL(input.monthlyAccumulated.monthDebtCents)} (${input.monthlyAccumulated.monthOpenCount} títulos)`,
      formatBRL(input.monthlyAccumulated.monthOverdueDebtCents),
      `${formatBRL(input.monthlyAccumulated.monthRecoveredCents)} (${input.monthlyAccumulated.monthSettledCount} liquidações)`,
      `${input.monthlyAccumulated.monthRecoveryRatePct.toFixed(1)}%`,
    ]],
    styles: { fontSize: 8.5, cellPadding: 2.3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: 14, right: 14 },
  });

  const y1 = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 56) + 5;
  autoTable(doc, {
    startY: y1,
    head: [[
      'UF',
      'Clientes',
      'Tít. Abertos',
      'Endividamento Total',
      'Saldo Vencido',
      'Recuperado Total',
      '% Recup. Geral',
      'Endivid. Mês',
      'Recup. Mês',
      '% Recup. Mês',
    ]],
    body: input.stateMetrics.map((s) => [
      s.uf,
      String(s.clientsCount),
      String(s.openTitlesCount),
      formatBRL(s.debtBalanceCents),
      formatBRL(s.overdueDebtCents),
      formatBRL(s.recoveredTotalCents),
      `${s.recoveryRatePct.toFixed(1)}%`,
      formatBRL(s.monthDebtCents),
      formatBRL(s.monthRecoveredCents),
      `${s.monthRecoveryRatePct.toFixed(1)}%`,
    ]),
    styles: { fontSize: 7.8, cellPadding: 2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  if (input.iviAnalysis) {
    let cursorY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 140) + 7;
    if (cursorY > 175) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Análise Estratégica Ivi IA (${input.iviAnalysis.provider}):`, 14, cursorY);
    cursorY += 5;
    doc.setFontSize(8.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const summaryLines = doc.splitTextToSize(input.iviAnalysis.executiveSummary, pageWidth - 28);
    doc.text(summaryLines, 14, cursorY);
    cursorY += summaryLines.length * 4.3 + 3;

    for (const h of input.iviAnalysis.highlights) {
      const hLines = doc.splitTextToSize(`• ${h}`, pageWidth - 32);
      doc.text(hLines, 16, cursorY);
      cursorY += hLines.length * 4.2 + 1.5;
    }
  }

  doc.save(`endividamento_recuperacao_uf_${input.month}.pdf`);
}

