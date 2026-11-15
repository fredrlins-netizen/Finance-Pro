import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatBRL, formatDateTimeBR } from './api.ts';
import type { ManagerialDashboardPayload } from '../types.ts';

function buildStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportManagerialDashboardToExcel(payload: ManagerialDashboardPayload): void {
  const wb = XLSX.utils.book_new();
  const { meta, kpis, collection, legal, ivi } = payload;

  // Sheet 1: Resumo Executivo
  const kpiRows = [
    { Indicador: 'Escopo de Unidade', Valor: meta.unitLabel, Detalhe: `Período: últimos ${meta.periodDays} dias` },
    { Indicador: 'Gerado em', Valor: formatDateTimeBR(meta.generatedAt), Detalhe: `${meta.totalUnitsIncluded} unidade(s)` },
    { Indicador: 'Saldo Total a Receber (R$)', Valor: Number((kpis.totalReceivableBalanceCents / 100).toFixed(2)), Detalhe: `${kpis.totalActiveTitles} títulos ativos` },
    { Indicador: 'Saldo Vencido (R$)', Valor: Number((kpis.overdueBalanceCents / 100).toFixed(2)), Detalhe: `${kpis.overdueTitlesCount} títulos vencidos` },
    { Indicador: 'Recuperado no Período (R$)', Valor: Number((kpis.recoveredPeriodCents / 100).toFixed(2)), Detalhe: `Taxa de recuperação: ${kpis.recoveryRatePct.toFixed(1)}%` },
    { Indicador: 'Taxa de Inadimplência (%)', Valor: Number(kpis.defaultRatePct.toFixed(1)), Detalhe: 'Sobre carteira ativa' },
    { Indicador: 'Processos Jurídicos Ativos', Valor: kpis.activeLegalProcesses, Detalhe: `Total geral: ${legal.summary.totalProcesses}` },
    { Indicador: 'Movimentações Não Lidas', Valor: kpis.unreadLegalMovements, Detalhe: `Busca & Apreensão: ${legal.summary.searchSeizureCount}` },
    { Indicador: 'Interações Automatizadas Ivi', Valor: kpis.iviTotalInteractions, Detalhe: 'Auditoria + Jurídico + Prospecção + Áudios + Relatórios' },
    { Indicador: 'Chamadas IA Economizadas (Cache BD)', Valor: kpis.iviAiCallsSaved, Detalhe: `Taxa de reuso cache: ${ivi.summary.cacheHitRatioPct.toFixed(1)}%` },
  ];
  const wsKpi = XLSX.utils.json_to_sheet(kpiRows);
  wsKpi['!cols'] = [{ wch: 36 }, { wch: 24 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, wsKpi, 'Resumo Executivo');

  // Sheet 2: Desempenho de Cobrança
  const monthlyRows = collection.monthlyTrend.map((m) => ({
    Mês: m.monthLabel,
    'Recebido (R$)': Number((m.receivedCents / 100).toFixed(2)),
    'Vencido (R$)': Number((m.overdueCents / 100).toFixed(2)),
    'Em Aberto a Vencer (R$)': Number((m.openedCents / 100).toFixed(2)),
    'Qtd. Baixas': m.recoveredCount,
  }));
  const wsMonthly = XLSX.utils.json_to_sheet(
    monthlyRows.length > 0 ? monthlyRows : [{ Aviso: 'Sem movimentação no período' }]
  );
  wsMonthly['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Cobranca Mensal');

  const agingAndOpsRows = [
    ...collection.agingBuckets.map((b) => ({
      Categoria: 'Aging Carteira',
      Segmento: b.label,
      Quantidade: b.count,
      'Saldo (R$)': Number((b.balanceCents / 100).toFixed(2)),
      'Recuperado (R$)': 0,
      'Notas / Pontos': '',
    })),
    ...collection.operatorRanking.map((op) => ({
      Categoria: 'Ranking Operador',
      Segmento: op.name,
      Quantidade: op.titlesCount,
      'Saldo (R$)': Number((op.openBalanceCents / 100).toFixed(2)),
      'Recuperado (R$)': Number((op.recoveredCents / 100).toFixed(2)),
      'Notas / Pontos': `${op.notesCount} notas · ${op.points} pts`,
    })),
  ];
  const wsAgingOps = XLSX.utils.json_to_sheet(agingAndOpsRows);
  wsAgingOps['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsAgingOps, 'Aging e Operadores');

  // Sheet 3: Processos Jurídicos
  const legalRows = [
    ...legal.byStatus.map((s) => ({
      Dimensão: 'Status do Processo',
      Descrição: s.label,
      Volume: s.count,
      Complemento: '',
    })),
    ...legal.byActionType.map((a) => ({
      Dimensão: 'Tipo de Ação',
      Descrição: a.label,
      Volume: a.count,
      Complemento: '',
    })),
    ...legal.byCourt.map((c) => ({
      Dimensão: 'Tribunal / Comarca',
      Descrição: c.courtName,
      Volume: c.count,
      Complemento: `${c.searchSeizureCount} busca/apreensão`,
    })),
  ];
  const wsLegal = XLSX.utils.json_to_sheet(
    legalRows.length > 0 ? legalRows : [{ Aviso: 'Sem processos cadastrados no escopo' }]
  );
  wsLegal['!cols'] = [{ wch: 22 }, { wch: 36 }, { wch: 12 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, wsLegal, 'Processos Juridicos');

  const legalTimelineRows = legal.movementsTimeline.map((pt) => ({
    Data: pt.dateLabel,
    'Escavador Webhook': pt.escavadorWebhook,
    'Escavador Fallback': pt.escavadorFallback,
    'Varredura Detran': pt.detranScan,
    Total: pt.total,
  }));
  const wsLegalTimeline = XLSX.utils.json_to_sheet(legalTimelineRows);
  wsLegalTimeline['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsLegalTimeline, 'Movimentacoes Diarias');

  // Sheet 4: Eficiência da Ivi
  const iviCapRows = ivi.byCapability.map((cap) => ({
    Frente: cap.label,
    'Ações Automatizadas': cap.automationsCount,
    'Resolvido Autônomo / Cache': cap.cacheOrSelfResolved,
    'Escalado / Manual': cap.escalatedOrManual,
    'Eficiência (%)': cap.efficiencyPct,
  }));
  const wsIvi = XLSX.utils.json_to_sheet(iviCapRows);
  wsIvi['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 26 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsIvi, 'Eficiencia Ivi');

  XLSX.writeFile(wb, `dashboard_gerencial_${buildStamp()}.xlsx`);
}

export function exportManagerialDashboardToPdf(payload: ManagerialDashboardPayload): void {
  const { meta, kpis, collection, legal, ivi } = payload;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('FinancePro Assessoria · Dashboard Gerencial Executivo', 14, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Escopo: ${meta.unitLabel} · Período: últimos ${meta.periodDays} dias · Emitido em ${formatDateTimeBR(meta.generatedAt)}`,
    14,
    17
  );

  // Bloco 1: KPIs Consolidados
  autoTable(doc, {
    startY: 29,
    head: [['Indicador Gerencial', 'Valor Atual', 'Contexto / Métrica']],
    body: [
      ['Saldo Total a Receber', formatBRL(kpis.totalReceivableBalanceCents), `${kpis.totalActiveTitles} títulos ativos`],
      ['Saldo Vencido / Inadimplência', `${formatBRL(kpis.overdueBalanceCents)} (${kpis.defaultRatePct.toFixed(1)}%)`, `${kpis.overdueTitlesCount} títulos vencidos`],
      ['Recuperado no Período', formatBRL(kpis.recoveredPeriodCents), `Taxa de recuperação: ${kpis.recoveryRatePct.toFixed(1)}%`],
      ['Processos Jurídicos Ativos', String(kpis.activeLegalProcesses), `${kpis.unreadLegalMovements} não lidos · ${kpis.seizureRiskProcesses} risco apreensão`],
      ['Atuações Automatizadas Ivi', String(kpis.iviTotalInteractions), `${kpis.iviAiCallsSaved} chamadas IA economizadas em cache (${ivi.summary.cacheHitRatioPct.toFixed(1)}%)`],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  const y1 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 82;

  // Bloco 2: Cobrança Mensal & Ranking Operadores (lado a lado)
  autoTable(doc, {
    startY: y1 + 5,
    head: [['Mês', 'Recebido', 'Vencido', 'Em Aberto', 'Baixas']],
    body: collection.monthlyTrend.map((m) => [
      m.monthLabel,
      formatBRL(m.receivedCents),
      formatBRL(m.overdueCents),
      formatBRL(m.openedCents),
      String(m.recoveredCount),
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: 14, right: 152 },
  });

  autoTable(doc, {
    startY: y1 + 5,
    head: [['Operador Cobrança', 'Recuperado', 'Em Aberto', 'Títulos', 'Pts']],
    body: collection.operatorRanking.slice(0, 7).map((op) => [
      op.name,
      formatBRL(op.recoveredCents),
      formatBRL(op.openBalanceCents),
      String(op.titlesCount),
      String(op.points),
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: 150, right: 14 },
  });

  const y2 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 145;

  // Bloco 3: Processos Jurídicos & Eficiência da Ivi
  autoTable(doc, {
    startY: Math.max(y1 + 48, y2 + 6),
    head: [['Status Jurídico', 'Volume', 'Tribunal / Comarca', 'Qtd. / B&A']],
    body: Array.from({ length: Math.max(legal.byStatus.length, Math.min(legal.byCourt.length, 6)) }).map((_, i) => {
      const st = legal.byStatus[i];
      const ct = legal.byCourt[i];
      return [
        st ? st.label : '',
        st ? String(st.count) : '',
        ct ? ct.courtName : '',
        ct ? `${ct.count} (${ct.searchSeizureCount} B&A)` : '',
      ];
    }),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    margin: { left: 14, right: 152 },
  });

  autoTable(doc, {
    startY: Math.max(y1 + 48, y2 + 6),
    head: [['Frente Ivi', 'Automatizadas', 'Cache / Autônomo', 'Eficiência']],
    body: ivi.byCapability.map((c) => [
      c.label,
      String(c.automationsCount),
      String(c.cacheOrSelfResolved),
      `${c.efficiencyPct.toFixed(1)}%`,
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    margin: { left: 150, right: 14 },
  });

  doc.save(`dashboard_gerencial_${buildStamp()}.pdf`);
}
