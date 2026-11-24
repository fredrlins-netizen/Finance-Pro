import { jsPDF } from 'jspdf';
import { formatBRL, formatDateBR } from './api.ts';
import { BankAccount, Client, FinancialTitle, Unit } from '../types.ts';

const ITF_PATTERNS: Record<string, string> = {
  '0': '00110',
  '1': '10001',
  '2': '01001',
  '3': '11000',
  '4': '00101',
  '5': '10100',
  '6': '01100',
  '7': '00011',
  '8': '10010',
  '9': '01010',
};

function drawItfBarcodePdf(
  doc: jsPDF,
  digitsRaw: string,
  xStart: number,
  yStart: number,
  heightMm = 12
) {
  const digits = digitsRaw.replace(/\D/g, '');
  if (digits.length < 4) return;
  const padded = digits.length % 2 === 0 ? digits : `0${digits}`;
  const narrow = 0.28;
  const wide = 0.78;
  let x = xStart;

  const drawBar = (isBlack: boolean, width: number) => {
    if (isBlack) {
      doc.setFillColor(15, 23, 42);
      doc.rect(x, yStart, width, heightMm, 'F');
    }
    x += width;
  };

  drawBar(true, narrow);
  drawBar(false, narrow);
  drawBar(true, narrow);
  drawBar(false, narrow);

  for (let i = 0; i < padded.length; i += 2) {
    const p1 = ITF_PATTERNS[padded[i]] || '00110';
    const p2 = ITF_PATTERNS[padded[i + 1]] || '00110';
    for (let j = 0; j < 5; j++) {
      drawBar(true, p1[j] === '1' ? wide : narrow);
      drawBar(false, p2[j] === '1' ? wide : narrow);
    }
  }

  drawBar(true, wide);
  drawBar(false, narrow);
  drawBar(true, narrow);
}

export interface BuildSantanderBoletoPdfInput {
  title: FinancialTitle;
  client?: Client | null;
  unit?: Unit | null;
  account?: BankAccount | null;
  qrCodeDataUrl?: string;
}

export function buildSantanderBoletoPdfDoc({
  title,
  client,
  unit,
  account,
  qrCodeDataUrl,
}: BuildSantanderBoletoPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const balanceCents = title.currentBalanceCents ?? 0;
  const amount = balanceCents > 0 ? balanceCents : title.amountCents;
  const beneficiaryName =
    account?.beneficiaryName || unit?.legalName || unit?.name || 'FinancePro Assessoria';
  const beneficiaryDoc = account?.beneficiaryDocument || unit?.cnpj || '—';
  const digLine = title.digitableLine || title.barcode || '—';

  // Top Header
  doc.setFillColor(204, 0, 0);
  doc.rect(14, 14, 182, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('BANCO SANTANDER (BRASIL) S.A.  |  033-7', 18, 20.5);
  doc.setFontSize(9);
  doc.text('FICHA DE COMPENSAÇÃO / COBRANÇA PIX', 192, 20.5, { align: 'right' });

  // Linha Digitável Box
  doc.setTextColor(15, 23, 42);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, 27, 182, 12);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text('LINHA DIGITÁVEL', 17, 31.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(digLine, 17, 36.5);

  // Beneficiary & Title Grid
  doc.rect(14, 41, 130, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('BENEFICIÁRIO', 17, 45);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`${beneficiaryName} (${beneficiaryDoc})`, 17, 50.5);

  doc.rect(144, 41, 52, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('VENCIMENTO', 147, 45);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(formatDateBR(title.dueDate), 147, 51);

  doc.rect(14, 55, 65, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('AGÊNCIA / CÓD. BENEFICIÁRIO', 17, 59);
  doc.setFont('courier', 'bold');
  doc.setFontSize(9);
  doc.text(
    `${account?.agency || '—'} / ${
      account?.santanderSummary?.covenantCode ||
      title.santanderCovenantCode ||
      account?.accountNumber ||
      '—'
    }`,
    17,
    64.5
  );

  doc.rect(79, 55, 65, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('NOSSO NÚMERO / DOCUMENTO', 82, 59);
  doc.setFont('courier', 'bold');
  doc.setFontSize(9);
  doc.text(`${title.ourNumber || '—'} · ${title.documentNumber || title.titleCode}`, 82, 64.5);

  doc.rect(144, 55, 52, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('(=) VALOR DO DOCUMENTO', 147, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(formatBRL(amount), 147, 64.5);

  // Payer Info
  doc.rect(14, 70, 182, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('PAGADOR (SACADO)', 17, 74.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `${client?.fullName || title.clientName || 'Cliente'}  ·  CPF/CNPJ: ${client?.cpfCnpj || '—'}`,
    17,
    79.5
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const addr = [
    client?.address,
    client?.addressNumber,
    client?.neighborhood,
    client?.city,
    client?.state,
    client?.zipCode,
  ]
    .filter(Boolean)
    .join(' · ');
  doc.text(addr || 'Endereço cadastrado no sistema', 17, 85);
  doc.text(`Demonstrativo: ${title.description || title.titleCode}`, 17, 89.5);

  // Barcode ITF 2-of-5
  if (title.barcode && title.barcode.replace(/\D/g, '').length >= 40) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text('CÓDIGO DE BARRAS (FEBRABAN)', 14, 98);
    drawItfBarcodePdf(doc, title.barcode, 14, 100, 14);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(title.barcode, 14, 118);
  }

  // PIX QR Code Section
  if (qrCodeDataUrl || title.pixCopiaECola) {
    doc.rect(14, 124, 182, 56);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('PAGAMENTO INSTANTÂNEO VIA PIX (BOLETO SX / QR CODE SANTANDER)', 18, 131);

    if (qrCodeDataUrl) {
      doc.addImage(qrCodeDataUrl, 'PNG', 18, 134, 40, 40);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`TXID: ${title.pixTxid || 'Boleto SX Integrado'}`, 63, 139);
    doc.text(`Status PIX: ${title.pixStatus || 'ATIVA'}`, 63, 144);
    doc.setFont('helvetica', 'bold');
    doc.text('PIX Copia e Cola:', 63, 151);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    const wrappedPix = doc.splitTextToSize(title.pixCopiaECola || '', 127);
    doc.text(wrappedPix, 63, 156);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Documento emitido pelo ERP FinancePro · Título #${title.id} (${title.titleCode})`,
    14,
    284
  );

  return doc;
}

export function downloadSantanderBoletoPdf(input: BuildSantanderBoletoPdfInput) {
  const doc = buildSantanderBoletoPdfDoc(input);
  const safeDoc = (input.title.documentNumber || input.title.titleCode || String(input.title.id))
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  doc.save(`Boleto_Santander_${safeDoc}.pdf`);
}

export function buildSantanderBoletoPdfFile(input: BuildSantanderBoletoPdfInput): File {
  const doc = buildSantanderBoletoPdfDoc(input);
  const blob = doc.output('blob');
  const safeDoc = (input.title.documentNumber || input.title.titleCode || String(input.title.id))
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  return new File([blob], `Boleto_Santander_${safeDoc}.pdf`, { type: 'application/pdf' });
}
