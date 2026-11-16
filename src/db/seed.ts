import crypto from 'node:crypto';
import { db } from './index.ts';
import {
  units,
  userGroups,
  users,
  workSchedules,
  customFields,
  clients,
  clientAssetLinks,
  admissions,
  documentObjects,
  prospectionLeads,
  iviKnowledgeArticles,
  appointments,
  legalProcesses,
  legalMovements,
  negotiations,
  paymentCategories,
  financialTitles,
  titleSettlements,
  collectionCases,
  bearers,
  documentTypes,
  chartOfAccounts,
  bankAccounts,
  bankMovements,
  whatsappThreads,
  whatsappMessages,
  internalMessages,
  systemSettings,
  auditLogs,
  rolesCatalog,
  departments,
  collaborators,
  febrabanBanks,
  modalities,
  banks,
  bankServices,
  bankContacts,
  measurementUnits,
  products,
  seriesCatalog,
  seriesUnitNumbering,
  auditChecklistItems,
  helpCenterTopics,
  scheduleServices,
} from './schema.ts';
import { hashPassword } from '../middleware/auth.ts';
import { asc, count, eq } from 'drizzle-orm';

let seedPromise: Promise<void> | null = null;

export async function ensureInitialSeed(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = runSeedInternal().catch((err) => {
    seedPromise = null;
    console.error('Seed check error:', err);
  });
  return seedPromise;
}

async function runSeedInternal(): Promise<void> {
  const existingUnits = await db.select({ value: count() }).from(units);
  if (Number(existingUnits[0]?.value || 0) > 0) {
    await ensureCommonCadastrosSeed();
    return;
  }

  // 1. 7 Unidades
  const insertedUnits = await db
    .insert(units)
    .values([
      { code: 'MTZ', name: 'Matriz', city: 'Recife', state: 'PE', cnpj: '12.345.678/0001-01', phone: '(81) 3000-1000', address: 'Av. Agamenon Magalhães, 2400 - Recife/PE', minAdmissionCostCents: 180000 },
      { code: 'SSA', name: 'Salvador', city: 'Salvador', state: 'BA', cnpj: '12.345.678/0002-84', phone: '(71) 3000-2000', address: 'Av. Tancredo Neves, 1632 - Salvador/BA', minAdmissionCostCents: 165000 },
      { code: 'FOR', name: 'Fortaleza', city: 'Fortaleza', state: 'CE', cnpj: '12.345.678/0003-65', phone: '(85) 3000-3000', address: 'Av. Santos Dumont, 2828 - Fortaleza/CE', minAdmissionCostCents: 160000 },
      { code: 'MCZ', name: 'Maceió', city: 'Maceió', state: 'AL', cnpj: '12.345.678/0004-46', phone: '(82) 3000-4000', address: 'Av. Fernandes Lima, 1120 - Maceió/AL', minAdmissionCostCents: 150000 },
      { code: 'JPA', name: 'João Pessoa', city: 'João Pessoa', state: 'PB', cnpj: '12.345.678/0005-27', phone: '(83) 3000-5000', address: 'Av. Epitácio Pessoa, 1890 - João Pessoa/PB', minAdmissionCostCents: 150000 },
      { code: 'SAO', name: 'São Paulo', city: 'São Paulo', state: 'SP', cnpj: '12.345.678/0006-08', phone: '(11) 3000-6000', address: 'Av. Paulista, 1374 - São Paulo/SP', minAdmissionCostCents: 220000 },
      { code: 'NAT', name: 'Natal', city: 'Natal', state: 'RN', cnpj: '12.345.678/0007-99', phone: '(84) 3000-7000', address: 'Av. Hermes da Fonseca, 980 - Natal/RN', minAdmissionCostCents: 150000 },
    ])
    .returning();

  const mtz = insertedUnits[0];
  const ssa = insertedUnits[1];
  const fort = insertedUnits[2];
  const sao = insertedUnits[5];

  // 2. Grupos de Usuários & Permissões por Campo
  const insertedGroups = await db
    .insert(userGroups)
    .values([
      {
        name: 'Administradores',
        description: 'Acesso irrestrito, Console SQL, configurações de unidades e auditoria.',
        modulePermissions: { overview: true, prospection: true, admission: true, audit: true, legal: true, negotiations: true, finance: true, collection: true, managerial: true, forms: true, reports: true, config: true, sql_console: true },
        fieldPermissions: { admissions: { debtAmountCents: 'edit', serviceFeeCents: 'edit', cpfCnpj: 'edit' }, financial_titles: { amountCents: 'edit', status: 'edit' } },
      },
      {
        name: 'Consultores Comerciais',
        description: 'Atendimento agendado, prospecção e preenchimento da ficha de admissão.',
        modulePermissions: { overview: true, prospection: true, admission: true, audit: false, legal: false, negotiations: false, finance: false, collection: false, managerial: false, forms: false, reports: false, config: false, sql_console: false },
        fieldPermissions: { admissions: { debtAmountCents: 'edit', serviceFeeCents: 'edit', cpfCnpj: 'edit' }, financial_titles: { amountCents: 'read', status: 'read' } },
      },
      {
        name: 'Auditoria & Compliance',
        description: 'Conferência documental, geração de 2 boletos iniciais e consulta Escavador.',
        modulePermissions: { overview: true, prospection: false, admission: true, audit: true, legal: true, negotiations: false, finance: true, collection: false, managerial: true, forms: true, reports: true, config: false, sql_console: false },
        fieldPermissions: { admissions: { debtAmountCents: 'read', serviceFeeCents: 'read', cpfCnpj: 'read' }, financial_titles: { amountCents: 'edit', status: 'edit' } },
      },
      {
        name: 'Jurídico & Negociações',
        description: 'Acompanhamento processual Escavador, tradução Ivi e redução bancária.',
        modulePermissions: { overview: true, prospection: false, admission: true, audit: false, legal: true, negotiations: true, finance: false, collection: false, managerial: false, forms: true, reports: true, config: false, sql_console: false },
        fieldPermissions: { admissions: { debtAmountCents: 'read', serviceFeeCents: 'hidden', cpfCnpj: 'read' }, financial_titles: { amountCents: 'read', status: 'read' } },
      },
      {
        name: 'Financeiro & Cobrança',
        description: 'Conciliação 07h, régua de cobrança Ivi, baixas e WhatsApp fixo.',
        modulePermissions: { overview: true, prospection: false, admission: false, audit: false, legal: false, negotiations: true, finance: true, collection: true, managerial: true, forms: true, reports: true, config: false, sql_console: false },
        fieldPermissions: { admissions: { debtAmountCents: 'read', serviceFeeCents: 'edit', cpfCnpj: 'read' }, financial_titles: { amountCents: 'edit', status: 'edit' } },
      },
    ])
    .returning();

  const demoPasswordHash = hashPassword('Invicta@2026');

  // 3. Usuários
  const insertedUsers = await db
    .insert(users)
    .values([
      { uid: 'corp-admin-fred', email: 'fredlins@singularpe.com.br', name: 'Fred Lins (Admin)', role: 'admin', groupId: insertedGroups[0].id, defaultUnitId: mtz.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5581999990001', points: 140 },
      { uid: 'corp-admin-demo', email: 'admin@financepro.com.br', name: 'Diretoria FinancePro', role: 'admin', groupId: insertedGroups[0].id, defaultUnitId: mtz.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5581999990000', points: 210 },
      { uid: 'corp-cons-marina', email: 'marina.alves@financepro.com.br', name: 'Marina Alves', role: 'consultant', groupId: insertedGroups[1].id, defaultUnitId: mtz.id, allowedUnitIds: [mtz.id, ssa.id], passwordHash: demoPasswordHash, whatsappPhone: '5581988112233', points: 320 },
      { uid: 'corp-cons-rafael', email: 'rafael.moura@financepro.com.br', name: 'Rafael Moura', role: 'consultant', groupId: insertedGroups[1].id, defaultUnitId: sao.id, allowedUnitIds: [sao.id, mtz.id], passwordHash: demoPasswordHash, whatsappPhone: '5511977445566', points: 280 },
      { uid: 'corp-aud-beatriz', email: 'beatriz.audit@financepro.com.br', name: 'Beatriz Nogueira', role: 'auditor', groupId: insertedGroups[2].id, defaultUnitId: mtz.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5581988223344', points: 195 },
      { uid: 'corp-jur-thiago', email: 'thiago.juridico@financepro.com.br', name: 'Dr. Thiago Vasconcelos', role: 'legal', groupId: insertedGroups[3].id, defaultUnitId: mtz.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5581988334455', points: 245 },
      { uid: 'corp-neg-camila', email: 'camila.neg@financepro.com.br', name: 'Camila Freitas', role: 'negotiator', groupId: insertedGroups[3].id, defaultUnitId: fort.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5585988445566', points: 410 },
      { uid: 'corp-cob-lucas', email: 'lucas.cobranca@financepro.com.br', name: 'Lucas Andrade', role: 'collection', groupId: insertedGroups[4].id, defaultUnitId: mtz.id, allowedUnitIds: insertedUnits.map((u) => u.id), passwordHash: demoPasswordHash, whatsappPhone: '5581988556677', points: 540 },
    ])
    .returning();

  const [, adminUser, marina, rafael, beatriz, thiago, camila, lucas] = insertedUsers;

  // 4. Quadro de Horários & Campos Customizados
  await db.insert(workSchedules).values([
    { targetType: 'unit', targetId: mtz.id, targetLabel: 'Unidade Matriz (Recife)', startTime: '06:00', endTime: '23:30', allowedDays: [0, 1, 2, 3, 4, 5, 6] },
    { targetType: 'group', targetId: insertedGroups[1].id, targetLabel: 'Grupo Consultores Comerciais', startTime: '07:30', endTime: '21:00', allowedDays: [1, 2, 3, 4, 5, 6] },
  ]);

  await db.insert(customFields).values([
    { module: 'admissions', fieldKey: 'fipe_referencia', label: 'Valor FIPE do Veículo', fieldType: 'number', options: [], required: false },
    { module: 'admissions', fieldKey: 'origem_campanha', label: 'Campanha de Origem', fieldType: 'select', options: ['Meta Ads Veicular', 'Google Busca', 'Indicação', 'Orgânico Instagram'], required: false },
  ]);

  // 5. Clientes + Vínculo Bidirecional Titular <-> Responsável pelo Bem
  const insertedClients = await db
    .insert(clients)
    .values([
      { fullName: 'Carlos Eduardo da Silva', cpfCnpj: '384.920.114-09', rg: '7.482.910 SDS/PE', birthDate: '1986-04-12', phone: '(81) 99123-4400', whatsapp: '5581991234400', email: 'carlos.silva@email.com', address: 'Rua das Graças, 412, Ap 501', city: 'Recife', state: 'PE', zipCode: '52011-200', clientType: 'titular', status: 'ativo', unitId: mtz.id },
      { fullName: 'Fernanda Costa Silva', cpfCnpj: '519.840.224-55', rg: '8.120.334 SDS/PE', birthDate: '1989-09-23', phone: '(81) 99441-2201', whatsapp: '5581994412201', email: 'fernanda.costa@email.com', address: 'Rua das Graças, 412, Ap 501', city: 'Recife', state: 'PE', zipCode: '52011-200', clientType: 'responsavel_bem', status: 'ativo', unitId: mtz.id },
      { fullName: 'Roberto Mendes Alencar', cpfCnpj: '214.778.905-12', rg: '5.998.120 SSP/BA', birthDate: '1979-11-05', phone: '(71) 98841-9900', whatsapp: '5571988419900', email: 'roberto.alencar@email.com', address: 'Av. ACM, 1450, Bloco B', city: 'Salvador', state: 'BA', zipCode: '40280-000', clientType: 'ambos', status: 'ativo', unitId: ssa.id },
      { fullName: 'Juliana Moreira Gomes', cpfCnpj: '442.103.888-30', rg: '42.190.442-1 SSP/SP', birthDate: '1992-02-18', phone: '(11) 98233-1102', whatsapp: '5511982331102', email: 'juliana.gomes@email.com', address: 'Rua Vergueiro, 2240', city: 'São Paulo', state: 'SP', zipCode: '04102-000', clientType: 'ambos', status: 'ativo', unitId: sao.id },
      { fullName: 'Marcos Vinícius Lima', cpfCnpj: '601.339.413-77', rg: '20040102938 SSP/CE', birthDate: '1984-07-30', phone: '(85) 99701-3312', whatsapp: '5585997013312', email: 'marcos.lima@email.com', address: 'Av. Beira Mar, 3100', city: 'Fortaleza', state: 'CE', zipCode: '60165-121', clientType: 'ambos', status: 'suspenso', suspensionReason: 'Solicitou suspensão temporária por viagem internacional de 45 dias.', unitId: fort.id },
    ])
    .returning();

  const [carlos, fernanda, roberto, juliana, marcos] = insertedClients;

  await db.insert(clientAssetLinks).values([
    { titularClientId: carlos.id, assetOwnerClientId: fernanda.id, relationshipLabel: 'Cônjuge / Condutora Principal do Bem', vehiclePlate: 'PDK-8H42', vehicleModel: 'Jeep Compass Longitude 2023', renavam: '01348291044' },
  ]);

  // 6. Admissões (Múltiplos contratos para o mesmo titular!)
  const insertedAdmissions = await db
    .insert(admissions)
    .values([
      { protocolCode: 'ADM-2026-00101', clientId: carlos.id, assetOwnerId: fernanda.id, unitId: mtz.id, consultantId: marina.id, debtType: 'veicular', bankName: 'Banco BV Financeira', contractNumber: 'BV-9948120', vehicleInfo: 'Jeep Compass 2023 · Placa PDK-8H42', debtAmountCents: 11840000, serviceFeeCents: 360000, installmentsCount: 6, initialInstallmentCents: 60000, status: 'em_andamento', auditorId: beatriz.id, slaMinutes: 42, escavadorAlert: true },
      { protocolCode: 'ADM-2026-00102', clientId: carlos.id, assetOwnerId: null, unitId: mtz.id, consultantId: marina.id, debtType: 'cartao', bankName: 'Itaú Unibanco', contractNumber: 'ITAU-CC-44109', vehicleInfo: 'Cartão Platinum · Fatura rotativo', debtAmountCents: 3420000, serviceFeeCents: 195000, installmentsCount: 5, initialInstallmentCents: 39000, status: 'aguardando_auditoria' },
      { protocolCode: 'ADM-2026-00103', clientId: roberto.id, assetOwnerId: null, unitId: ssa.id, consultantId: marina.id, debtType: 'veicular', bankName: 'Banco Santander', contractNumber: 'SAN-7721094', vehicleInfo: 'Toyota Hilux SRX 2022 · Placa QRT-4E11', debtAmountCents: 18450000, serviceFeeCents: 480000, installmentsCount: 8, initialInstallmentCents: 60000, status: 'aprovada', auditorId: beatriz.id, slaMinutes: 28, escavadorAlert: true },
      { protocolCode: 'ADM-2026-00104', clientId: juliana.id, assetOwnerId: null, unitId: sao.id, consultantId: rafael.id, debtType: 'emprestimo', bankName: 'Banco Bradesco', contractNumber: 'BRAD-EMP-8821', vehicleInfo: 'Empréstimo Pessoal Consignado Privado', debtAmountCents: 6200000, serviceFeeCents: 240000, installmentsCount: 6, initialInstallmentCents: 40000, status: 'devolvida_admissao', auditRejectionReason: 'Comprovante de residência ilegível e faltando assinatura na 2ª via da procuração.', returnedCount: 1, auditorId: beatriz.id, slaMinutes: 35 },
      { protocolCode: 'ADM-2026-00105', clientId: marcos.id, assetOwnerId: null, unitId: fort.id, consultantId: marina.id, debtType: 'cheque_especial', bankName: 'Banco Pan', contractNumber: 'PAN-CE-11290', vehicleInfo: 'Cheque Especial + Parcelado', debtAmountCents: 2150000, serviceFeeCents: 180000, installmentsCount: 6, initialInstallmentCents: 30000, status: 'suspensa', auditorId: beatriz.id, slaMinutes: 50 },
    ])
    .returning();

  const [adm1, adm2, adm3, adm4, adm5] = insertedAdmissions;

  // 7. Documentos no Vault (bucketdainvicta)
  const docHash = (seed: string) => crypto.createHash('sha256').update(seed).digest('hex');
  const insertedDocs = await db
    .insert(documentObjects)
    .values([
      { clientId: carlos.id, admissionId: adm1.id, folderPath: `bucketdainvicta/MTZ/${carlos.id}/${adm1.protocolCode}`, fileName: 'ficha_admissao_assinada.pdf', docCategory: 'ficha_admissao', mimeType: 'application/pdf', sizeBytes: 1842900, sha256Hash: docHash('doc1'), storageUri: 'vault://seed/ficha_admissao_assinada.pdf', uploadedBy: 'Marina Alves' },
      { clientId: carlos.id, admissionId: adm1.id, folderPath: `bucketdainvicta/MTZ/${carlos.id}/${adm1.protocolCode}`, fileName: 'contrato_honorarios_2vias.pdf', docCategory: 'contrato', mimeType: 'application/pdf', sizeBytes: 3120400, sha256Hash: docHash('doc2'), storageUri: 'vault://seed/contrato_honorarios_2vias.pdf', uploadedBy: 'Beatriz Nogueira' },
      { clientId: fernanda.id, admissionId: adm1.id, folderPath: `bucketdainvicta/MTZ/${fernanda.id}/responsavel_bem`, fileName: 'CRLV_Jeep_Compass_PDK8H42.pdf', docCategory: 'crlv', mimeType: 'application/pdf', sizeBytes: 942100, sha256Hash: docHash('doc3'), storageUri: 'vault://seed/CRLV_Jeep_Compass.pdf', uploadedBy: 'Marina Alves' },
      { clientId: fernanda.id, admissionId: adm1.id, folderPath: `bucketdainvicta/MTZ/${fernanda.id}/responsavel_bem`, fileName: 'CNH_Fernanda_Costa.pdf', docCategory: 'pessoal', mimeType: 'application/pdf', sizeBytes: 620400, sha256Hash: docHash('doc4'), storageUri: 'vault://seed/CNH_Fernanda.pdf', uploadedBy: 'Marina Alves' },
      { clientId: roberto.id, admissionId: adm3.id, folderPath: `bucketdainvicta/SSA/${roberto.id}/${adm3.protocolCode}`, fileName: 'procuracao_ad_judicia.pdf', docCategory: 'procuracao', mimeType: 'application/pdf', sizeBytes: 1120000, sha256Hash: docHash('doc5'), storageUri: 'vault://seed/procuracao_roberto.pdf', uploadedBy: 'Beatriz Nogueira' },
      { clientId: roberto.id, admissionId: adm3.id, folderPath: `bucketdainvicta/SSA/${roberto.id}/${adm3.protocolCode}`, fileName: 'comprovante_parcela1_santander.pdf', docCategory: 'comprovante', mimeType: 'application/pdf', sizeBytes: 410200, sha256Hash: docHash('doc6'), storageUri: 'vault://seed/comprovante_1.pdf', uploadedBy: 'Ivi Conciliadora' },
    ])
    .returning();

  // 8. Categorias de Pagamento & Títulos Financeiros (12 meses + 2 parcelas iniciais pagas!)
  const insertedCats = await db
    .insert(paymentCategories)
    .values([
      { name: 'Boleto Santander', providerCode: 'santander' },
      { name: 'Pix', providerCode: 'pix' },
      { name: 'Cora', providerCode: 'cora' },
      { name: 'Aleatório', providerCode: 'aleatorio' },
      { name: 'Boleto Terceiros', providerCode: 'terceiros' },
    ])
    .returning();

  const [catSantander, catPix, catCora] = insertedCats;
  const now = new Date();
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);

  const insertedTitles = await db
    .insert(financialTitles)
    .values([
      // Carlos Eduardo: 2 parcelas iniciais pagas -> pronto para Folha de Rosto gerar parcelas 3..6!
      { titleCode: 'TIT-2026-1001', clientId: carlos.id, admissionId: adm1.id, unitId: mtz.id, categoryId: catSantander.id, installmentNumber: 1, totalInstallments: 6, isInitialFee: true, amountCents: 60000, dueDate: daysFromNow(-20), paidAt: daysFromNow(-18), status: 'pago', boletoProvider: 'santander', barcode: '03399.63290 64000.000006 00100.101014 8 98880000060000', ourNumber: '000001001', receiptDocId: insertedDocs[5].id, collectorId: lucas.id },
      { titleCode: 'TIT-2026-1002', clientId: carlos.id, admissionId: adm1.id, unitId: mtz.id, categoryId: catSantander.id, installmentNumber: 2, totalInstallments: 6, isInitialFee: true, amountCents: 60000, dueDate: daysFromNow(-5), paidAt: daysFromNow(-3), status: 'pago', boletoProvider: 'santander', barcode: '03399.63290 64000.000006 00100.201014 1 99030000060000', ourNumber: '000001002', collectorId: lucas.id },
      // Roberto: Parcela 1 paga, Parcela 2 vencida há 9 dias (vai pra Cobrança + Régua +7d)
      { titleCode: 'TIT-2026-1003', clientId: roberto.id, admissionId: adm3.id, unitId: ssa.id, categoryId: catSantander.id, installmentNumber: 1, totalInstallments: 8, isInitialFee: true, amountCents: 60000, dueDate: daysFromNow(-25), paidAt: daysFromNow(-25), status: 'pago', boletoProvider: 'santander', barcode: '03399.63290 64000.000006 00100.301014 3 98830000060000', ourNumber: '000001003' },
      { titleCode: 'TIT-2026-1004', clientId: roberto.id, admissionId: adm3.id, unitId: ssa.id, categoryId: catSantander.id, installmentNumber: 2, totalInstallments: 8, isInitialFee: true, amountCents: 60000, dueDate: daysFromNow(-9), status: 'vencido', boletoProvider: 'santander', barcode: '03399.63290 64000.000006 00100.401014 5 98990000060000', ourNumber: '000001004', collectorId: lucas.id, reguaStageSent: ['-15d', '-5d'] },
      // Juliana: vencido há 14 dias e título a vencer em 5 dias (Régua)
      { titleCode: 'TIT-2026-1005', clientId: juliana.id, admissionId: adm4.id, unitId: sao.id, categoryId: catPix.id, installmentNumber: 1, totalInstallments: 6, isInitialFee: true, amountCents: 40000, dueDate: daysFromNow(-14), status: 'vencido', boletoProvider: 'pix', barcode: 'PIX-CHAVE-FINANCEPRO-1005', ourNumber: '000001005', collectorId: lucas.id },
      { titleCode: 'TIT-2026-1006', clientId: juliana.id, admissionId: adm4.id, unitId: sao.id, categoryId: catCora.id, installmentNumber: 2, totalInstallments: 6, isInitialFee: true, amountCents: 40000, dueDate: daysFromNow(5), status: 'aberto', boletoProvider: 'cora', barcode: '40300.00019 00000.010064 00000.000002 9 99150000040000', ourNumber: '000001006' },
      // Títulos históricos pagos nos últimos meses para o gráfico acumulativo 12 meses
      { titleCode: 'TIT-2025-0801', clientId: carlos.id, admissionId: adm1.id, unitId: mtz.id, categoryId: catSantander.id, installmentNumber: 1, totalInstallments: 1, isInitialFee: false, amountCents: 380000, dueDate: daysFromNow(-180), paidAt: daysFromNow(-179), status: 'pago', boletoProvider: 'santander', ourNumber: '000000801' },
      { titleCode: 'TIT-2026-0101', clientId: roberto.id, admissionId: adm3.id, unitId: ssa.id, categoryId: catCora.id, installmentNumber: 1, totalInstallments: 1, isInitialFee: false, amountCents: 520000, dueDate: daysFromNow(-120), paidAt: daysFromNow(-118), status: 'pago', boletoProvider: 'cora', ourNumber: '000000901' },
      { titleCode: 'TIT-2026-0501', clientId: juliana.id, admissionId: adm4.id, unitId: sao.id, categoryId: catPix.id, installmentNumber: 1, totalInstallments: 1, isInitialFee: false, amountCents: 440000, dueDate: daysFromNow(-60), paidAt: daysFromNow(-58), status: 'pago', boletoProvider: 'pix', ourNumber: '000000951' },
    ])
    .returning();

  // 9. Prospecção & Base de Conhecimento Ivi & Agendamentos
  const insertedLeads = await db
    .insert(prospectionLeads)
    .values([
      { name: 'Ana Paula Ferreira', phone: '(81) 99655-8812', email: 'ana.ferreira@email.com', channel: 'instagram', unitId: mtz.id, stage: 'em_atendimento_ivi', iviProviderUsed: 'gemini', assignedUserId: marina.id, aiTranscript: [{ sender: 'cliente', text: 'Olá, vi no Instagram que vocês reduzem parcelas de carro em atraso. Estou com 3 parcelas do meu Ônix vencidas.', timestamp: new Date().toISOString() }, { sender: 'ivi', text: 'Olá Ana Paula! Sim, atuamos diretamente na revisão e negociação de financiamentos veiculares para proteger seu bem e buscar redução expressiva do saldo. Posso agendar um horário Presencial na Matriz Recife, por Telefone ou Vídeo Chamada com nossa consultora Marina?', provider: 'gemini', timestamp: new Date().toISOString() }] },
      { name: 'Bruno Henrique Costa', phone: '(71) 99104-5521', email: 'bruno.costa@email.com', channel: 'whatsapp_gotalk', unitId: ssa.id, stage: 'escalado_humano', iviProviderUsed: 'claude_code', assignedUserId: marina.id, aiTranscript: [{ sender: 'cliente', text: 'Recebi uma notificação extrajudicial do banco Santander sobre busca e apreensão. Preciso falar com um consultor agora.', timestamp: new Date().toISOString() }, { sender: 'ivi', text: 'Compreendo a urgência, Bruno. Já registrei seu caso prioritário e encaminhei para um especialista de Salvador entrar em contato imediatamente.', provider: 'claude_code', timestamp: new Date().toISOString() }] },
      { name: 'Patrícia Lopes', phone: '(85) 98890-1122', email: 'patricia@email.com', channel: 'facebook', unitId: fort.id, stage: 'agendado', iviProviderUsed: 'openai', assignedUserId: marina.id },
      { name: 'Eduardo Cavalcanti', phone: '(11) 99311-7744', email: 'eduardo.sp@email.com', channel: 'whatsapp_uazapi', unitId: sao.id, stage: 'recuperado', iviProviderUsed: 'deepseek', assignedUserId: rafael.id },
      { name: 'Sandra Regina Dias', phone: '(82) 99911-0022', email: 'sandra.mcz@email.com', channel: 'email_maton', unitId: insertedUnits[3].id, stage: 'analise', iviProviderUsed: 'gemini', assignedUserId: marina.id },
    ])
    .returning();

  await db.insert(iviKnowledgeArticles).values([
    { questionPattern: 'Como funciona a negociação de dívida veicular com parcelas em atraso?', answerTemplate: 'Realizamos auditoria contratual completa, acompanhamento preventivo contra busca e apreensão via Escavador e negociação direta junto ao banco buscando redução de até 60% do saldo devedor.', category: 'veicular', sourceChannel: 'instagram', hitCount: 38 },
    { questionPattern: 'Preciso ir presencialmente até a unidade?', answerTemplate: 'Não é obrigatório. O atendimento inicial pode ser Presencial em uma de nossas 7 unidades, por Telefone ou Vídeo Chamada com assinatura e envio digital de documentos.', category: 'agendamento', sourceChannel: 'whatsapp_gotalk', hitCount: 27 },
    { questionPattern: 'Vocês atendem cartão de crédito e empréstimo além de veículos?', answerTemplate: 'Sim! Embora financiamento veicular seja nosso carro-chefe, também negociamos cartão de crédito, empréstimos pessoais/consignados e cheque especial.', category: 'produtos', sourceChannel: 'facebook', hitCount: 19 },
  ]);

  await db.insert(appointments).values([
    { leadId: insertedLeads[2].id, clientName: 'Patrícia Lopes', clientPhone: '(85) 98890-1122', unitId: fort.id, attendantId: adminUser.id, consultantId: marina.id, modality: 'presencial', scheduledFor: daysFromNow(1), status: 'agendado', notes: 'Trazer CRLV e contrato do banco.' },
    { clientId: carlos.id, clientName: 'Carlos Eduardo da Silva', clientPhone: '(81) 99123-4400', unitId: mtz.id, attendantId: adminUser.id, consultantId: marina.id, modality: 'presencial', scheduledFor: daysFromNow(-10), status: 'cumprido', notes: 'Contrato fechado em atendimento presencial.' },
    { clientId: juliana.id, clientName: 'Juliana Moreira Gomes', clientPhone: '(11) 98233-1102', unitId: sao.id, attendantId: adminUser.id, consultantId: rafael.id, modality: 'video', scheduledFor: daysFromNow(-4), status: 'cumprido', notes: 'Enviado para auditoria.' },
    { clientName: 'Ricardo Nogueira', clientPhone: '(83) 98811-9090', unitId: insertedUnits[4].id, attendantId: adminUser.id, consultantId: rafael.id, modality: 'telefone', scheduledFor: daysFromNow(-2), status: 'faltoso', notes: 'Não atendeu às 3 tentativas.' },
  ]);

  // 10. Jurídico (Escavador + Tradução Ivi + SLA)
  const insertedProcesses = await db
    .insert(legalProcesses)
    .values([
      { processNumber: '0048291-44.2026.8.17.2001', clientId: carlos.id, admissionId: adm1.id, unitId: mtz.id, courtName: 'TJPE - 14ª Vara Cível do Recife', actionType: 'busca_apreensao', hasSearchSeizure: true, vehicleSeized: false, status: 'alerta_movimentacao', hasUnreadMovement: true, assignedLawyerId: thiago.id },
      { processNumber: '0812944-12.2026.8.05.0001', clientId: roberto.id, admissionId: adm3.id, unitId: ssa.id, courtName: 'TJBA - 6ª Vara Cível de Salvador', actionType: 'busca_apreensao', hasSearchSeizure: true, vehicleSeized: true, status: 'apreendido', hasUnreadMovement: true, assignedLawyerId: thiago.id },
      { processNumber: '1029384-88.2026.8.26.0100', clientId: juliana.id, admissionId: adm4.id, unitId: sao.id, courtName: 'TJSP - 22ª Vara Cível Central', actionType: 'revisional', hasSearchSeizure: false, vehicleSeized: false, status: 'em_acompanhamento', hasUnreadMovement: false, assignedLawyerId: thiago.id },
    ])
    .returning();

  await db.insert(legalMovements).values([
    {
      processId: insertedProcesses[0].id,
      source: 'escavador_webhook',
      originalDispatch: 'Vistos. Comprovada a mora mediante notificação extrajudicial entregue no endereço contratual, defiro liminarmente a busca e apreensão do bem descrito na inicial, expedindo-se mandado com urgência. Cite-se a parte ré para pagamento da integralidade da dívida em 5 dias.',
      iviTranslationPtBr: 'O juiz autorizou um mandado liminar de busca e apreensão do veículo Jeep Compass porque considerou válida a notificação de atraso. O prazo para quitação integral ou defesa urgente é de 5 dias. Ação recomendada: acionar o cliente imediatamente para protocolo de defesa revisional e proteção do bem.',
      lawyerId: thiago.id,
    },
    {
      processId: insertedProcesses[1].id,
      source: 'escavador_fallback',
      originalDispatch: 'Certifico que foi cumprido o mandado de busca e apreensão pelo Oficial de Justiça, encontrando-se o veículo recolhido em pátio credenciado. Intime-se a parte requerida para manifestação no prazo legal.',
      iviTranslationPtBr: 'O Oficial de Justiça cumpriu o mandado e o veículo Toyota Hilux foi recolhido ao pátio. Precisamos buscar o auto de apreensão oficial e apresentar contestação/proposta de purgação ou acordo de devolução em tempo hábil.',
      openedAt: daysFromNow(-1),
      lawyerId: thiago.id,
    },
  ]);

  // 11. Negociações
  await db.insert(negotiations).values([
    {
      admissionId: adm1.id,
      clientId: carlos.id,
      unitId: mtz.id,
      negotiatorId: camila.id,
      bankName: 'Banco BV Financeira',
      originalDebtCents: 11840000,
      targetReductionPct: 55,
      currentReductionPct: 48,
      estimatedSavingsCents: 5683200,
      targetDeadline: daysFromNow(14),
      status: 'proxima_meta',
      chatLogs: [{ channel: 'gotalk', note: 'Proposta de quitação à vista enviada ao jurídico do BV (desconto atual 48%).', author: 'Camila Freitas', timestamp: new Date().toISOString() }],
    },
    {
      admissionId: adm3.id,
      clientId: roberto.id,
      unitId: ssa.id,
      negotiatorId: camila.id,
      bankName: 'Banco Santander',
      originalDebtCents: 18450000,
      targetReductionPct: 50,
      currentReductionPct: 22,
      estimatedSavingsCents: 4059000,
      targetDeadline: daysFromNow(6),
      status: 'prazo_critico',
      chatLogs: [{ channel: 'uazapi', note: 'Aguardando retorno da mesa de recuperação Santander após apreensão.', author: 'Camila Freitas', timestamp: new Date().toISOString() }],
    },
    {
      admissionId: adm4.id,
      clientId: juliana.id,
      unitId: sao.id,
      negotiatorId: camila.id,
      bankName: 'Banco Bradesco',
      originalDebtCents: 6200000,
      targetReductionPct: 60,
      currentReductionPct: 64,
      estimatedSavingsCents: 3968000,
      targetDeadline: daysFromNow(25),
      status: 'meta_alcancada',
      chatLogs: [{ channel: 'gotalk', note: 'Acordo fechado com 64% de deságio antes do prazo contratual!', author: 'Camila Freitas', timestamp: new Date().toISOString() }],
    },
  ]);

  // 12. Casos de Cobrança
  await db.insert(collectionCases).values([
    { titleId: insertedTitles[3].id, clientId: roberto.id, unitId: ssa.id, assignedCollectorId: lucas.id, stateCode: 'BA', priorityValueCents: 60000, status: 'em_cobranca', conversationSummary: 'Cliente informou que recebe comissão dia 15 e pediu boleto atualizado.', pointsAwarded: 0 },
    { titleId: insertedTitles[4].id, clientId: juliana.id, unitId: sao.id, assignedCollectorId: lucas.id, stateCode: 'SP', priorityValueCents: 40000, status: 'em_cobranca', conversationSummary: 'Enviado link Pix pelo WhatsApp Fixo.', pointsAwarded: 0 },
  ]);

  // 13. WhatsApp Fixo (Threads & Messages)
  const insertedThreads = await db
    .insert(whatsappThreads)
    .values([
      { clientId: roberto.id, unitId: ssa.id, contactName: 'Roberto Mendes Alencar', contactPhone: '5571988419900', provider: 'gotalk', assignedOperatorId: lucas.id, unreadCount: 2, lastMessagePreview: 'Áudio (0:24) · Promessa de pagamento para sexta-feira' },
      { clientId: carlos.id, unitId: mtz.id, contactName: 'Carlos Eduardo da Silva', contactPhone: '5581991234400', provider: 'uazapi', assignedOperatorId: lucas.id, unreadCount: 0, lastMessagePreview: 'Enviei o comprovante da segunda parcela inicial!' },
      { clientId: juliana.id, unitId: sao.id, contactName: 'Juliana Moreira Gomes', contactPhone: '5511982331102', provider: 'gotalk', assignedOperatorId: lucas.id, unreadCount: 1, lastMessagePreview: 'Pode mandar o novo boleto por favor?' },
    ])
    .returning();

  await db.insert(whatsappMessages).values([
    { threadId: insertedThreads[0].id, direction: 'inbound', contentType: 'text', body: 'Bom dia Lucas, estou resolvendo a questão do caminhão e consigo pagar a parcela vencida na sexta.', senderName: 'Roberto Mendes Alencar' },
    { threadId: insertedThreads[0].id, direction: 'inbound', contentType: 'audio', body: '[Áudio WhatsApp 0:24] Oi Lucas, pode emitir o boleto com vencimento para sexta-feira dia 15 que eu faço o Pix na hora.', senderName: 'Roberto Mendes Alencar', iviAudioTranscript: 'Cliente Roberto confirmou pagamento via Pix/Boleto para sexta-feira dia 15.' },
    { threadId: insertedThreads[1].id, direction: 'inbound', contentType: 'text', body: 'Enviei o comprovante da segunda parcela inicial!', senderName: 'Carlos Eduardo da Silva' },
    { threadId: insertedThreads[2].id, direction: 'inbound', contentType: 'text', body: 'Pode mandar o novo boleto por favor?', senderName: 'Juliana Moreira Gomes' },
  ]);

  // 14. Mensagens Internas & Configurações Globais
  await db.insert(internalMessages).values([
    { senderId: beatriz.id, senderName: 'Beatriz Nogueira (Auditoria)', recipientId: thiago.id, targetSector: 'juridico', subject: 'Alerta Escavador: Mandado Liminar TJPE', body: 'Contrato ADM-2026-00101 (Carlos Eduardo / Jeep Compass) recebeu movimentação de Busca e Apreensão no TJPE.', readAt: null },
    { senderId: adminUser.id, senderName: 'Ivi Automação', recipientId: marina.id, targetSector: 'comercial', subject: 'Novo Agendamento Confirmado (Presencial - FOR)', body: 'Lead Patrícia Lopes agendada para atendimento presencial. Notificação enviada via WhatsApp.', readAt: null },
  ]);

  await db.insert(systemSettings).values([
    { key: 'regua_cobranca', value: { beforeDays1: 15, beforeDays2: 5, afterDays: 7, autoSend07h: true } },
    { key: 'financial_goals', value: { monthlyTargetCents: 25000000, annualTargetCents: 300000000 } },
    { key: 'ivi_chain', value: { order: ['claude_code', 'openai', 'gemini', 'deepseek'], fallbackEnabled: true } },
  ]);

  await db.insert(auditLogs).values([
    { userId: adminUser.id, userName: 'Sistema FinancePro', action: 'BOOTSTRAP_SEED', entityType: 'system', entityId: 'init', details: { units: 7, modules: 8 }, unitId: mtz.id },
  ]);

  await ensureCommonCadastrosSeed();
}

let cadastrosSeedPromise: Promise<void> | null = null;

export async function ensureCommonCadastrosSeed(): Promise<void> {
  if (cadastrosSeedPromise) return cadastrosSeedPromise;
  cadastrosSeedPromise = runCommonCadastrosSeedInternal().catch((err) => {
    cadastrosSeedPromise = null;
    console.error('Common cadastros seed error:', err);
  });
  return cadastrosSeedPromise;
}

async function runCommonCadastrosSeedInternal(): Promise<void> {
  // 1. Estados Civis
  const existingMarital = await db.select().from(systemSettings).where(eq(systemSettings.key, 'cad_marital_statuses')).limit(1);
  if (!existingMarital[0]) {
    await db.insert(systemSettings).values({
      key: 'cad_marital_statuses',
      value: { options: ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União Estável', 'Separado(a)'] },
    }).onConflictDoNothing();
  }

  // 2. Cargos
  const existingRoles = await db.select({ value: count() }).from(rolesCatalog);
  if (Number(existingRoles[0]?.value || 0) === 0) {
    await db.insert(rolesCatalog).values([
      { name: 'Consultor Comercial', participatesInScheduleQueue: true, sortOrder: 1, active: true },
      { name: 'Atendente SDR', participatesInScheduleQueue: true, sortOrder: 2, active: true },
      { name: 'Auditor', participatesInScheduleQueue: false, sortOrder: 3, active: true },
      { name: 'Advogado', participatesInScheduleQueue: false, sortOrder: 4, active: true },
      { name: 'Negociador Bancário', participatesInScheduleQueue: false, sortOrder: 5, active: true },
      { name: 'Cobrador', participatesInScheduleQueue: false, sortOrder: 6, active: true },
      { name: 'Gerente de Unidade', participatesInScheduleQueue: false, sortOrder: 7, active: true },
    ]).onConflictDoNothing();
  }

  // 3. Departamentos
  const existingDepts = await db.select({ value: count() }).from(departments);
  if (Number(existingDepts[0]?.value || 0) === 0) {
    await db.insert(departments).values([
      { code: '01', name: 'COMERCIAL', managerName: 'Marina Alves', status: 'ATIVO' },
      { code: '02', name: 'AUDITORIA', managerName: 'Beatriz Nogueira', status: 'ATIVO' },
      { code: '03', name: 'JURÍDICO', managerName: 'Dr. Thiago Vasconcelos', status: 'ATIVO' },
      { code: '04', name: 'NEGOCIAÇÃO BANCÁRIA', managerName: 'Camila Freitas', status: 'ATIVO' },
      { code: '05', name: 'FINANCEIRO', managerName: 'Diretoria FinancePro', status: 'ATIVO' },
      { code: '06', name: 'COBRANÇA', managerName: 'Lucas Andrade', status: 'ATIVO' },
    ]).onConflictDoNothing();
  }

  // 4. Colaboradores (sincronizados com a equipe inicial)
  const existingCollabs = await db.select({ value: count() }).from(collaborators);
  if (Number(existingCollabs[0]?.value || 0) === 0) {
    const [allUnits, allRoles, allDepts, allUsers] = await Promise.all([
      db.select().from(units),
      db.select().from(rolesCatalog),
      db.select().from(departments),
      db.select().from(users),
    ]);
    const defaultUnitId = allUnits[0]?.id;
    if (defaultUnitId) {
      const findRole = (part: string) => allRoles.find((r) => r.name.toLowerCase().includes(part.toLowerCase()));
      const findDept = (part: string) => allDepts.find((d) => d.name.toLowerCase().includes(part.toLowerCase()));
      const findUser = (emailPart: string) => allUsers.find((u) => u.email.toLowerCase().includes(emailPart.toLowerCase()));

      const seedCollabs = [
        { code: '2001', name: 'Marina Alves', unitId: findUser('marina')?.defaultUnitId || defaultUnitId, role: findRole('Consultor'), dept: findDept('COMERCIAL'), user: findUser('marina'), email: 'marina.alves@financepro.com.br', phone: '(81) 98811-2233', isWhatsapp: true, city: 'Recife', state: 'PE' },
        { code: '2002', name: 'Rafael Moura', unitId: findUser('rafael')?.defaultUnitId || defaultUnitId, role: findRole('Consultor'), dept: findDept('COMERCIAL'), user: findUser('rafael'), email: 'rafael.moura@financepro.com.br', phone: '(11) 97744-5566', isWhatsapp: true, city: 'São Paulo', state: 'SP' },
        { code: '2003', name: 'Beatriz Nogueira', unitId: findUser('beatriz')?.defaultUnitId || defaultUnitId, role: findRole('Auditor'), dept: findDept('AUDITORIA'), user: findUser('beatriz'), email: 'beatriz.audit@financepro.com.br', phone: '(81) 98822-3344', isWhatsapp: true, city: 'Recife', state: 'PE' },
        { code: '2004', name: 'Dr. Thiago Vasconcelos', unitId: findUser('thiago')?.defaultUnitId || defaultUnitId, role: findRole('Advogado'), dept: findDept('JURÍDICO'), user: findUser('thiago'), email: 'thiago.juridico@financepro.com.br', phone: '(81) 98833-4455', isWhatsapp: true, city: 'Recife', state: 'PE' },
        { code: '2005', name: 'Camila Freitas', unitId: findUser('camila')?.defaultUnitId || defaultUnitId, role: findRole('Negociador'), dept: findDept('NEGOCIAÇÃO'), user: findUser('camila'), email: 'camila.neg@financepro.com.br', phone: '(85) 98844-5566', isWhatsapp: true, city: 'Fortaleza', state: 'CE' },
        { code: '2006', name: 'Lucas Andrade', unitId: findUser('lucas')?.defaultUnitId || defaultUnitId, role: findRole('Cobrador'), dept: findDept('COBRANÇA'), user: findUser('lucas'), email: 'lucas.cobranca@financepro.com.br', phone: '(81) 98855-6677', isWhatsapp: true, city: 'Recife', state: 'PE' },
      ];

      await db.insert(collaborators).values(
        seedCollabs.map((c) => ({
          code: c.code,
          name: c.name,
          active: true,
          unitId: c.unitId,
          roleId: c.role?.id || null,
          jobTitle: c.role?.name || 'Consultor Comercial',
          departmentId: c.dept?.id || null,
          userId: c.user?.id || null,
          email: c.email,
          phone: c.phone,
          isWhatsapp: c.isWhatsapp,
          city: c.city,
          state: c.state,
        }))
      );
    }
  }

  // 5. Base inicial FEBRABAN (fallback offline + complementada pela BrasilAPI em tempo real)
  const existingFeb = await db.select({ value: count() }).from(febrabanBanks);
  if (Number(existingFeb[0]?.value || 0) === 0) {
    await db.insert(febrabanBanks).values([
      { code: '001', name: 'Banco do Brasil S.A.', fullName: 'Banco do Brasil S.A.', ispb: '00000000' },
      { code: '033', name: 'Banco Santander (Brasil) S.A.', fullName: 'Banco Santander (Brasil) S.A.', ispb: '90400888' },
      { code: '077', name: 'Banco Inter S.A.', fullName: 'Banco Inter S.A.', ispb: '00416968' },
      { code: '104', name: 'Caixa Econômica Federal', fullName: 'Caixa Econômica Federal', ispb: '00360305' },
      { code: '208', name: 'Banco BTG Pactual S.A.', fullName: 'Banco BTG Pactual S.A.', ispb: '30306294' },
      { code: '237', name: 'Banco Bradesco S.A.', fullName: 'Banco Bradesco S.A.', ispb: '60746948' },
      { code: '260', name: 'Nu Pagamentos S.A. (Nubank)', fullName: 'Nu Pagamentos S.A. - Instituição de Pagamento', ispb: '18236120' },
      { code: '336', name: 'Banco C6 S.A.', fullName: 'Banco C6 S.A.', ispb: '31872495' },
      { code: '341', name: 'Itaú Unibanco S.A.', fullName: 'Itaú Unibanco S.A.', ispb: '60701190' },
      { code: '422', name: 'Banco Safra S.A.', fullName: 'Banco Safra S.A.', ispb: '58160789' },
      { code: '623', name: 'Banco Pan S.A.', fullName: 'Banco Pan S.A.', ispb: '59285411' },
      { code: '655', name: 'Banco Votorantim S.A. (BV)', fullName: 'Banco Votorantim S.A.', ispb: '59588111' },
      { code: '707', name: 'Banco Daycoval S.A.', fullName: 'Banco Daycoval S.A.', ispb: '62232889' },
      { code: '748', name: 'Banco Cooperativo Sicredi S.A.', fullName: 'Banco Cooperativo Sicredi S.A.', ispb: '01181521' },
      { code: '756', name: 'Banco Cooperativo Sicoob S.A.', fullName: 'Banco Cooperativo Sicoob S.A.', ispb: '02038232' },
    ]).onConflictDoNothing();
  }

  // 6. Modalidades (alimenta Admissão & Dossiês e Serviços Bancários)
  const existingModalities = await db.select({ value: count() }).from(modalities);
  if (Number(existingModalities[0]?.value || 0) === 0) {
    await db.insert(modalities).values([
      { type: 'Veicular', description: 'CDC Veículo', hasVehicleSection: true, active: true },
      { type: 'Veicular', description: 'Leasing Veículo', hasVehicleSection: true, active: true },
      { type: 'Veicular', description: 'Consórcio de Veículos', hasVehicleSection: true, active: true },
      { type: 'Veicular', description: 'Refinanciamento de Veículo', hasVehicleSection: true, active: true },
      { type: 'Bancário', description: 'Crédito Pessoal', hasVehicleSection: false, active: true },
      { type: 'Cartão', description: 'Cartão de Crédito', hasVehicleSection: false, active: true },
      { type: 'Consignado', description: 'Empréstimo Consignado', hasVehicleSection: false, active: true },
      { type: 'Bancário', description: 'Cheque Especial', hasVehicleSection: false, active: true },
    ]);
  }

  // 7. Bancos, Serviços Bancários e Contatos
  const existingBanks = await db.select({ value: count() }).from(banks);
  if (Number(existingBanks[0]?.value || 0) === 0) {
    const allMods = await db.select().from(modalities);
    const cdcMod = allMods.find((m) => m.description.includes('CDC')) || allMods[0];
    const cardMod = allMods.find((m) => m.description.includes('Cartão')) || allMods[0];
    const empMod = allMods.find((m) => m.description.includes('Crédito Pessoal')) || allMods[0];

    const insertedBanks = await db.insert(banks).values([
      { code: '655', name: 'Banco BV Financeira', febrabanCode: '655', status: 'ATIVO', notes: 'Financiamento veicular e refinanciamento.' },
      { code: '033', name: 'Banco Santander', febrabanCode: '033', status: 'ATIVO', notes: 'Convênio cobrança boletos + carteira veicular.' },
      { code: '341', name: 'Itaú Unibanco', febrabanCode: '341', status: 'ATIVO', notes: 'Cartões, crédito pessoal e veículos.' },
      { code: '237', name: 'Banco Bradesco', febrabanCode: '237', status: 'ATIVO', notes: 'Consignado, veículos e empréstimos.' },
      { code: '623', name: 'Banco Pan', febrabanCode: '623', status: 'ATIVO', notes: 'Carteira veicular e cheque especial.' },
    ]).returning();

    const [bv, santander, itau, bradesco, pan] = insertedBanks;

    await db.insert(bankServices).values([
      { bankId: bv.id, name: 'Quitação BV 32%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '32', defaultInstallments: 1 },
      { bankId: bv.id, name: 'Revisão BV Veicular 45%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '45', defaultInstallments: 12 },
      { bankId: bv.id, name: 'Acordo BV Estendido 58%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '58', defaultInstallments: 24 },
      { bankId: santander.id, name: 'Quitação Santander 35%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '35', defaultInstallments: 1 },
      { bankId: santander.id, name: 'Repactuação Santander 48%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '48', defaultInstallments: 18 },
      { bankId: santander.id, name: 'Parcelamento CDC 60%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '60', defaultInstallments: 30 },
      { bankId: itau.id, name: 'Quitação Itaú 30%', modalityId: cardMod?.id || null, modalityDescription: cardMod?.description || 'Cartão de Crédito', negotiationPercent: '30', defaultInstallments: 1 },
      { bankId: itau.id, name: 'Revisão Itaú 42%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '42', defaultInstallments: 12 },
      { bankId: itau.id, name: 'Acordo Itaú 52%', modalityId: cardMod?.id || null, modalityDescription: cardMod?.description || 'Cartão de Crédito', negotiationPercent: '52', defaultInstallments: 24 },
      { bankId: bradesco.id, name: 'Quitação Bradesco 33%', modalityId: empMod?.id || null, modalityDescription: empMod?.description || 'Crédito Pessoal', negotiationPercent: '33', defaultInstallments: 1 },
      { bankId: bradesco.id, name: 'Revisão Bradesco 46%', modalityId: empMod?.id || null, modalityDescription: empMod?.description || 'Crédito Pessoal', negotiationPercent: '46', defaultInstallments: 12 },
      { bankId: bradesco.id, name: 'Acordo Bradesco 55%', modalityId: empMod?.id || null, modalityDescription: empMod?.description || 'Crédito Pessoal', negotiationPercent: '55', defaultInstallments: 24 },
      { bankId: pan.id, name: 'Quitação Pan 35%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '35', defaultInstallments: 1 },
      { bankId: pan.id, name: 'Acordo Pan 50%', modalityId: cdcMod?.id || null, modalityDescription: cdcMod?.description || 'CDC Veículo', negotiationPercent: '50', defaultInstallments: 18 },
    ]);

    await db.insert(bankContacts).values([
      { bankId: bv.id, name: 'Mesa de Acordos BV', sector: 'Negociação Veicular', phone: '(11) 4004-9000', mobile: '(11) 99100-6550', isWhatsapp: true, email: 'acordos@bv.com.br' },
      { bankId: santander.id, name: 'Central Recuperação Santander', sector: 'Recuperação de Crédito', phone: '(11) 4004-3535', mobile: '(11) 99200-0330', isWhatsapp: false, email: 'mesa.recuperacao@santander.com.br' },
      { bankId: itau.id, name: 'Célula Jurídica Itaú', sector: 'Contencioso & Acordos', phone: '(11) 4004-4828', mobile: '(11) 99300-3410', isWhatsapp: true, email: 'acordos.juridico@itau-unibanco.com.br' },
    ]);
  }

  // 8. Unidades de Medida e Produtos
  const existingMU = await db.select({ value: count() }).from(measurementUnits);
  if (Number(existingMU[0]?.value || 0) === 0) {
    const insertedMU = await db.insert(measurementUnits).values([
      { name: 'UN', conversionFactor: '1' },
      { name: 'SRV', conversionFactor: '1' },
      { name: 'PCT', conversionFactor: '1' },
      { name: 'HR', conversionFactor: '1' },
    ]).returning();

    const srvUnit = insertedMU.find((u) => u.name === 'SRV') || insertedMU[0];
    const unUnit = insertedMU[0];

    const existingProducts = await db.select({ value: count() }).from(products);
    if (Number(existingProducts[0]?.value || 0) === 0) {
      await db.insert(products).values([
        { type: 'SERVICO', description: 'Assessoria Revisional & Defesa Veicular', unitId: srvUnit.id },
        { type: 'SERVICO', description: 'Renegociação Extrajudicial Bancária (Cartão / Empréstimo)', unitId: srvUnit.id },
        { type: 'SERVICO', description: 'Laudo Técnico & Cálculo Pericial BACEN', unitId: srvUnit.id },
        { type: 'MATERIAL', description: 'Kit Documentação & Procuração Impressa', unitId: unUnit.id },
      ]);
    }
  }

  // 9. Séries e Numeração por Unidade
  const existingSeries = await db.select({ value: count() }).from(seriesCatalog);
  if (Number(existingSeries[0]?.value || 0) === 0) {
    const insertedSeries = await db.insert(seriesCatalog).values([
      { sigla: 'ADM', description: 'Admissão Geral Matriz', generalNumber: 105, isDefault: true },
      { sigla: 'REC', description: 'Unidade Recife', generalNumber: 1, isDefault: false },
      { sigla: 'SAL', description: 'Unidade Salvador', generalNumber: 1, isDefault: false },
      { sigla: 'FOR', description: 'Unidade Fortaleza', generalNumber: 1, isDefault: false },
      { sigla: 'MAC', description: 'Unidade Maceió', generalNumber: 1, isDefault: false },
      { sigla: 'JOP', description: 'Unidade João Pessoa', generalNumber: 1, isDefault: false },
      { sigla: 'NAT', description: 'Unidade Natal', generalNumber: 1, isDefault: false },
    ]).returning();

    const allUnits = await db.select().from(units);
    const admSeries = insertedSeries.find((s) => s.sigla === 'ADM');
    if (admSeries && allUnits.length > 0) {
      await db.insert(seriesUnitNumbering).values(
        allUnits.map((u, idx) => ({
          seriesId: admSeries.id,
          unitId: u.id,
          currentNumber: idx === 0 ? 105 : 1,
        }))
      );
    }
  }

  // 10. Enriquecer Razão Social / E-mail / WhatsApp Padrão das Unidades existentes (sem sobrescrever edições)
  const currentUnits = await db.select().from(units);
  for (const u of currentUnits) {
    if (!u.legalName) {
      const stateDddMap: Record<string, string> = {
        PE: '81',
        BA: '71',
        CE: '85',
        AL: '82',
        PB: '83',
        SP: '11',
        RN: '84',
      };
      const ddd = stateDddMap[u.state] || '81';
      await db
        .update(units)
        .set({
          legalName: `FinancePro Assessoria Financeira ${u.name} Ltda`,
          email: u.email || `contato.${u.code.toLowerCase()}@financepro.com.br`,
          whatsappNumber: u.whatsappNumber || `55${ddd}99900100${u.id}`,
        })
        .where(eq(units.id, u.id));
    }
  }

  // 11. Checklist de Auditoria de Processos (alimenta Config & AuditModule)
  const existingChecklist = await db.select({ value: count() }).from(auditChecklistItems);
  if (Number(existingChecklist[0]?.value || 0) === 0) {
    await db.insert(auditChecklistItems).values([
      {
        sortOrder: 1,
        title: 'Documento Pessoal Legível (CNH ou RG/CPF)',
        description: 'Conferir validade, nitidez frente/verso e titularidade exata com o CPF/CNPJ cadastrado.',
        modalityCondition: '',
        active: true,
      },
      {
        sortOrder: 2,
        title: 'Comprovante de Residência Atualizado (Até 90 Dias)',
        description: 'Validar CEP, logradouro e vínculo de endereço do Titular ou Responsável pelo Bem.',
        modalityCondition: '',
        active: true,
      },
      {
        sortOrder: 3,
        title: 'CRLV Digital & Verificação de Gravame / Busca e Apreensão',
        description: 'Obrigatório para contratos veiculares: validar Placa, RENAVAM, Chassi e alerta Detran/Escavador.',
        modalityCondition: 'Veicular',
        active: true,
      },
      {
        sortOrder: 4,
        title: 'Procuração Ad Judicia & Contrato Assinado (2 Vias)',
        description: 'Verificar assinaturas eletrônicas ou físicas e poderes específicos para negociação bancária.',
        modalityCondition: '',
        active: true,
      },
      {
        sortOrder: 5,
        title: 'Validação de Taxa Mínima da Unidade & Cenário Revisional',
        description: 'Confirmar que os honorários contratados respeitam o piso mínimo da unidade de origem.',
        modalityCondition: '',
        active: true,
      },
      {
        sortOrder: 6,
        title: 'Extrato / Fatura / Evolução da Dívida Bancária',
        description: 'Conferir saldo devedor, parcelas pagas/vencidas e código FEBRABAN do credor.',
        modalityCondition: '',
        active: true,
      },
    ]);
  }

  // 12. Tópicos Padrão da Central de Ajuda
  const existingHelp = await db.select({ value: count() }).from(helpCenterTopics);
  if (Number(existingHelp[0]?.value || 0) === 0) {
    await db.insert(helpCenterTopics).values([
      {
        topicKey: 'cfg_uazapi_grupos',
        menuPath: 'Configurações > WhatsApp UaZapi & Grupos',
        title: 'Governança de Instâncias UaZapi, QR Code e Associação por Grupos',
        summary: 'Como parear números WhatsApp via QR Code e vincular múltiplas linhas a Grupos de Usuários e Setores.',
        keywords: ['uazapi', 'whatsapp', 'qrcode', 'grupos', 'prospeccao', 'admissao'],
        htmlContent:
          '<h3>Arquitetura Recomendada de Canais UaZapi</h3><p>As credenciais criptografadas (AES-256-GCM) e o pareamento via QR Code ficam centralizados em <strong>Configurações &gt; WhatsApp UaZapi &amp; Grupos</strong> por segurança.</p><ul><li><strong>Múltiplos Números por Grupo:</strong> Associe cada instância aos Grupos de Acesso autorizados (ex.: Consultores Comerciais, Cobrança, Jurídico).</li><li><strong>Escopo por Módulo:</strong> Defina se o número atua em Prospecção, Admissão ou Cobrança sem expor tokens nas telas operacionais.</li></ul>',
      },
      {
        topicKey: 'adm_ficha_dossie',
        menuPath: 'Admissão & Dossiês > Nova Ficha',
        title: 'Preenchimento da Ficha de Admissão e Vínculo Titular ↔ Responsável',
        summary: 'Regras de piso mínimo por unidade, múltiplos contratos por CPF e upload seguro no bucketdainvicta.',
        keywords: ['admissao', 'dossie', 'titular', 'responsavel', 'taxa minima', 'bucket'],
        htmlContent:
          '<h3>Fluxo de Admissão Contratual</h3><p>Valide o CPF do Titular e, quando houver veículo em nome de terceiro, vincule o <strong>Responsável pelo Bem</strong>. Anexe CNH, comprovante de residência, CRLV e procuração antes de submeter à Auditoria.</p>',
      },
      {
        topicKey: 'aud_checklist_boletos',
        menuPath: 'Auditoria & Boletos > Fila de Conferência',
        title: 'Conferência de Checklist Condicional e Emissão dos 2 Boletos Iniciais',
        summary: 'Como utilizar os cartões de checklist por modalidade e aprovar fichas gerando cobrança e processo jurídico.',
        keywords: ['auditoria', 'checklist', 'santander', 'boletos', 'escavador'],
        htmlContent:
          '<h3>Checklist de Auditoria</h3><p>Os itens ativos configurados na aba de Governança aparecem automaticamente conforme a modalidade do contrato (ex.: itens exclusivos para <em>Veicular</em>). Ao aprovar, o sistema gera os 2 boletos iniciais e abre o acompanhamento processual.</p>',
      },
      {
        topicKey: 'gotalk_mensagens_hsm',
        menuPath: 'Configurações > Mensagens & Canais GoTalk',
        title: 'Auditoria de Mensagens GoTalk, Canais e Disparo de Templates HSM',
        summary: 'Consulta paginada de conversas, histórico por telefone e preenchimento de variáveis {{n}} em templates.',
        keywords: ['gotalk', 'hsm', 'template', 'canais', 'historico'],
        htmlContent:
          '<h3>Operação Oficial GoTalk</h3><p>Clique em qualquer número de telefone na grade para abrir o <strong>Histórico Consolidado do Número</strong>. Em atendimentos ativos, utilize o botão <strong>Enviar Template HSM</strong> preenchendo todas as variáveis obrigatórias.</p>',
      },
      {
        topicKey: 'fin_regua_ivi',
        menuPath: 'Financeiro & Régua > Conciliação 07h',
        title: 'Conciliação Diária 07:00h, Folha de Rosto e Régua de Cobrança Ivi',
        summary: 'Automação de baixa bancária, liberação das parcelas seguintes e lembretes preventivos (-15d, -5d, +7d).',
        keywords: ['financeiro', 'regua', 'ivi', 'folha de rosto', 'boletos'],
        htmlContent:
          '<h3>Gestão de Recebíveis</h3><p>Após a liquidação das 2 parcelas iniciais de entrada, aprove a <strong>Folha de Rosto</strong> para emitir o carnê remanescente e ativar a régua preventiva multicanal.</p>',
      },
    ]);
  }

  // 13. Catálogo de Serviços da Agenda & Configurações Padrão (Agendamentos)
  const existingScheduleServices = await db.select({ value: count() }).from(scheduleServices);
  if (Number(existingScheduleServices[0]?.value || 0) === 0) {
    await db.insert(scheduleServices).values([
      {
        name: 'Análise Contratual & Cálculo Revisional',
        durationMinutes: 30,
        priceCents: 0,
        color: '#e0e7ff',
        active: true,
      },
      {
        name: 'Atendimento Inicial — Financiamento Veicular',
        durationMinutes: 45,
        priceCents: 0,
        color: '#dcfce7',
        active: true,
      },
      {
        name: 'Reunião de Negociação & Acordo Bancário',
        durationMinutes: 30,
        priceCents: 0,
        color: '#fef3c7',
        active: true,
      },
      {
        name: 'Conferência Documental & Admissão Expressa',
        durationMinutes: 30,
        priceCents: 0,
        color: '#fce7f3',
        active: true,
      },
    ]);
  }

  const existingSchedConfig = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'schedule_config'))
    .limit(1);
  if (!existingSchedConfig[0]) {
    await db
      .insert(systemSettings)
      .values({
        key: 'schedule_config',
        value: {
          startTime: '08:00',
          endTime: '19:00',
          slotIntervalMinutes: 30,
          statusColors: {
            aguardando: '#fbbf24',
            agendado: '#3b82f6',
            confirmado: '#10b981',
            cancelado_cliente: '#ef4444',
            cancelado_consultor: '#9ca3af',
            nao_compareceu: '#7f1d1d',
          },
        },
      })
      .onConflictDoNothing();
  }

  // 14. Financial Cadastros Seed (Bearers, Document Types, Chart of Accounts, Suppliers)
  const [firstUnit] = await db.select().from(units).limit(1);
  const unitIdVal = firstUnit?.id || 1;

  const existingBearers = await db.select({ value: count() }).from(bearers);
  if (Number(existingBearers[0]?.value || 0) === 0) {
    await db.insert(bearers).values([
      { code: '033', name: 'Santander Principal', type: 'banco', unitId: unitIdVal },
      { code: '001', name: 'Banco do Brasil', type: 'banco', unitId: unitIdVal },
      { code: 'CC01', name: 'Caixa Interna Matriz', type: 'caixa', unitId: unitIdVal },
    ]);
  }

  const existingDocTypes = await db.select({ value: count() }).from(documentTypes);
  if (Number(existingDocTypes[0]?.value || 0) === 0) {
    await db.insert(documentTypes).values([
      { description: 'Boleto Bancário', category: 'ambos', isFiscal: true, requiresNumber: true },
      { description: 'Nota Fiscal de Prestação de Serviços', category: 'receber', isFiscal: true, requiresNumber: true },
      { description: 'Recibo de Pagamento', category: 'pagar', isFiscal: false, requiresNumber: false },
      { description: 'Contrato de Parceria', category: 'ambos', isFiscal: false, requiresNumber: false },
    ]);
  }

  const existingChart = await db.select({ value: count() }).from(chartOfAccounts);
  if (Number(existingChart[0]?.value || 0) === 0) {
    await db.insert(chartOfAccounts).values([
      { code: '1.1', name: 'Receita de Honorários Contratuais', type: 'receita', isAnalytic: true },
      { code: '1.2', name: 'Receita de Acordos e Juros', type: 'receita', isAnalytic: true },
      { code: '2.1', name: 'Despesas com Pessoal e Salários', type: 'despesa', isAnalytic: true },
      { code: '2.2', name: 'Despesas com Tecnologia e APIs', type: 'despesa', isAnalytic: true },
      { code: '2.3', name: 'Despesas de Escritório e Utilidades', type: 'despesa', isAnalytic: true },
    ]);
  }

  // Ensure sample supplier (natureza = F)
  const existingSuppliers = await db.select({ value: count() }).from(clients).where(eq(clients.natureza, 'F'));
  if (Number(existingSuppliers[0]?.value || 0) === 0) {
    await db.insert(clients).values([
      {
        fullName: 'TechCorp Sistemas e Servicos Ltda',
        cpfCnpj: '33.444.555/0001-99',
        personNature: 'PJ',
        natureza: 'F',
        phone: '(11) 3456-7890',
        email: 'contato@techcorp.com.br',
        address: 'Rua da Tecnologia',
        addressNumber: '500',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310-100',
        unitId: unitIdVal,
      },
      {
        fullName: 'Advocacia & Consultoria Associados',
        cpfCnpj: '11.222.333/0001-88',
        personNature: 'PJ',
        natureza: 'F',
        phone: '(81) 3222-4455',
        email: 'juridico@advocacia.com.br',
        address: 'Av. Boa Viagem',
        addressNumber: '1000',
        city: 'Recife',
        state: 'PE',
        zipCode: '51020-000',
        unitId: unitIdVal,
      },
    ]);
  }
  // Ensure sample bank accounts
  const existingBankAccs = await db.select({ value: count() }).from(bankAccounts);
  if (Number(existingBankAccs[0]?.value || 0) === 0) {
    await db.insert(bankAccounts).values([
      { bankName: 'Santander', agency: '1234', accountNumber: '56789-0', accountType: 'corrente', initialBalanceCents: 15000000, currentBalanceCents: 18500000, unitId: unitIdVal },
      { bankName: 'Banco do Brasil', agency: '4321', accountNumber: '98765-4', accountType: 'corrente', initialBalanceCents: 8000000, currentBalanceCents: 9500000, unitId: unitIdVal },
      { bankName: 'Caixa Interna Matriz', agency: '0001', accountNumber: '00001-9', accountType: 'caixa', initialBalanceCents: 200000, currentBalanceCents: 150000, unitId: unitIdVal },
    ]);
  }

  // Ensure sample bank movements for current month
  const existingMovs = await db.select({ value: count() }).from(bankMovements);
  if (Number(existingMovs[0]?.value || 0) === 0) {
    const accRows = await db.select().from(bankAccounts).orderBy(asc(bankAccounts.id));
    const chartRows = await db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.id));
    const paidTitleRows = await db.select().from(financialTitles).limit(1);
    const santanderAcc = accRows[0];
    const bbAcc = accRows[1] || santanderAcc;
    const revCat = chartRows.find((c) => c.type === 'receita');
    const expCat = chartRows.find((c) => c.type === 'despesa');
    const now = new Date();
    const mkDate = (dayOffset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), Math.max(1, Math.min(28, now.getDate() + dayOffset)), 10, 0, 0);
      return d;
    };
    const isoToday = now.toISOString().slice(0, 10);
    if (santanderAcc) {
      await db.insert(bankMovements).values([
        {
          bankAccountId: santanderAcc.id,
          movementType: 'CREDITO',
          amountCents: 385000,
          description: paidTitleRows[0] ? `Baixa Título ${paidTitleRows[0].titleCode} · Honorários` : 'Recebimento Honorários Contratuais',
          documentNumber: 'BOL-00412',
          movementDate: mkDate(-3),
          categoryId: revCat?.id ?? null,
          categoryName: revCat ? `${revCat.code} - ${revCat.name}` : '',
          origin: 'BAIXA_RECEBER',
          status: 'CONCILIADO',
          reconciled: true,
          reconciliationDate: isoToday,
          titleId: paidTitleRows[0]?.id ?? null,
          titleSource: paidTitleRows[0] ? 'RECEBER' : '',
          unitId: unitIdVal,
        },
        {
          bankAccountId: santanderAcc.id,
          movementType: 'DEBITO',
          amountCents: 8990,
          description: 'Tarifa bancária mensal pacote corporativo',
          documentNumber: 'TAR-1126',
          movementDate: mkDate(-2),
          categoryId: expCat?.id ?? null,
          categoryName: expCat ? `${expCat.code} - ${expCat.name}` : '',
          origin: 'TARIFA',
          status: 'PENDENTE',
          reconciled: false,
          unitId: unitIdVal,
        },
        {
          bankAccountId: santanderAcc.id,
          movementType: 'CREDITO',
          amountCents: 250000,
          description: 'Depósito aporte operacional unidade Matriz',
          documentNumber: 'DEP-0891',
          movementDate: mkDate(-1),
          categoryId: revCat?.id ?? null,
          categoryName: revCat ? `${revCat.code} - ${revCat.name}` : '',
          origin: 'DEPOSITO',
          status: 'PENDENTE',
          reconciled: false,
          unitId: unitIdVal,
        },
        {
          bankAccountId: bbAcc.id,
          movementType: 'DEBITO',
          amountCents: 145000,
          description: 'Pagamento licença infraestrutura cloud e APIs',
          documentNumber: 'NF-8841',
          movementDate: mkDate(0),
          categoryId: expCat?.id ?? null,
          categoryName: expCat ? `${expCat.code} - ${expCat.name}` : '',
          origin: 'MANUAL',
          status: 'PENDENTE',
          reconciled: false,
          unitId: unitIdVal,
        },
      ]);
    }
  }

  // Backfill originalValueCents / currentBalanceCents / clientName / documentNumber on existing titles
  const allExistingTitles = await db.select().from(financialTitles);
  const allClientRows = await db.select().from(clients);
  const allBankAccs = await db.select().from(bankAccounts).orderBy(asc(bankAccounts.id));
  const allDocTypes = await db.select().from(documentTypes).orderBy(asc(documentTypes.id));
  const allBearers = await db.select().from(bearers).orderBy(asc(bearers.id));
  const allChart = await db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.id));

  const firstBoletoDoc = allDocTypes.find((d) => d.description.toLowerCase().includes('boleto')) || allDocTypes[0];
  const firstBearer = allBearers[0];
  const firstRevChart = allChart.find((c) => c.type === 'receita') || allChart[0];
  const firstExpChart = allChart.find((c) => c.type === 'despesa') || allChart[0];

  for (const row of allExistingTitles) {
    if (row.originalValueCents === 0 && row.amountCents > 0) {
      const cl = allClientRows.find((c) => c.id === row.clientId);
      const isPaid = String(row.status).toLowerCase() === 'pago' || String(row.status).toLowerCase() === 'cancelado';
      await db
        .update(financialTitles)
        .set({
          originalValueCents: row.amountCents,
          currentBalanceCents: isPaid ? 0 : row.amountCents,
          documentNumber: row.documentNumber || row.titleCode,
          description:
            row.description ||
            `Honorários Contratuais · Parcela ${row.installmentNumber}/${row.totalInstallments}`,
          clientName: row.clientName || cl?.fullName || '',
          documentTypeId: row.documentTypeId ?? firstBoletoDoc?.id ?? null,
          bearerId: row.bearerId ?? firstBearer?.id ?? null,
          chartAccountId: row.chartAccountId ?? firstRevChart?.id ?? null,
          bankAccountId: row.bankAccountId ?? allBankAccs[0]?.id ?? null,
          forecastDate: row.forecastDate ?? row.dueDate,
        })
        .where(eq(financialTitles.id, row.id));
    }
  }

  // Ensure sample Contas a Pagar (scope = 'PAGAR')
  const existingPayables = await db
    .select({ value: count() })
    .from(financialTitles)
    .where(eq(financialTitles.scope, 'PAGAR'));
  if (Number(existingPayables[0]?.value || 0) === 0) {
    const supplierRows = allClientRows.filter((c) => c.natureza === 'F' || c.personNature === 'PJ');
    const sup1 = supplierRows[0] || allClientRows[0];
    const sup2 = supplierRows[1] || sup1;
    if (sup1) {
      const dShift = (days: number) => new Date(Date.now() + days * 86400000);
      const insertedPayables = await db
        .insert(financialTitles)
        .values([
          {
            titleCode: 'PAG-2026-2001',
            scope: 'PAGAR',
            titleType: 'PADRAO',
            origin: 'MANUAL',
            documentNumber: 'NF-8841',
            description: 'Licença mensal infraestrutura cloud, servidor SQL e APIs',
            clientId: sup1.id,
            clientName: sup1.fullName,
            unitId: unitIdVal,
            chartAccountId: firstExpChart?.id ?? null,
            documentTypeId: firstBoletoDoc?.id ?? null,
            bearerId: firstBearer?.id ?? null,
            bankAccountId: allBankAccs[0]?.id ?? null,
            installmentNumber: 1,
            totalInstallments: 1,
            isInitialFee: false,
            amountCents: 145000,
            originalValueCents: 145000,
            currentBalanceCents: 0,
            issueDate: dShift(-18),
            dueDate: dShift(-5),
            forecastDate: dShift(-5),
            paidAt: dShift(-5),
            status: 'pago',
            collectionStatus: 'EM_DIA',
            boletoProvider: 'banco_brasil',
          },
          {
            titleCode: 'PAG-2026-2002',
            scope: 'PAGAR',
            titleType: 'PADRAO',
            origin: 'MANUAL',
            documentNumber: 'BOL-90422',
            description: 'Suporte técnico e manutenção sistemas de prospecção',
            clientId: sup1.id,
            clientName: sup1.fullName,
            unitId: unitIdVal,
            chartAccountId: firstExpChart?.id ?? null,
            documentTypeId: firstBoletoDoc?.id ?? null,
            bearerId: firstBearer?.id ?? null,
            bankAccountId: allBankAccs[0]?.id ?? null,
            installmentNumber: 1,
            totalInstallments: 3,
            isInitialFee: false,
            amountCents: 220000,
            originalValueCents: 220000,
            currentBalanceCents: 220000,
            issueDate: dShift(-20),
            dueDate: dShift(-3),
            forecastDate: dShift(-3),
            status: 'ABERTO',
            collectionStatus: 'EM_DIA',
            boletoProvider: 'santander',
          },
          {
            titleCode: 'PAG-2026-2003',
            scope: 'PAGAR',
            titleType: 'PADRAO',
            origin: 'MANUAL',
            documentNumber: 'HON-3310',
            description: 'Parecer jurídico externo e diligência cartorária',
            clientId: sup2.id,
            clientName: sup2.fullName,
            unitId: unitIdVal,
            chartAccountId: firstExpChart?.id ?? null,
            documentTypeId: firstBoletoDoc?.id ?? null,
            bearerId: firstBearer?.id ?? null,
            bankAccountId: allBankAccs[0]?.id ?? null,
            installmentNumber: 1,
            totalInstallments: 1,
            isInitialFee: false,
            amountCents: 185000,
            originalValueCents: 185000,
            currentBalanceCents: 185000,
            issueDate: dShift(-35),
            dueDate: dShift(-12),
            forecastDate: dShift(-12),
            status: 'ABERTO',
            collectionStatus: 'EM_DIA',
            boletoProvider: 'santander',
          },
          {
            titleCode: 'PAG-2026-2004',
            scope: 'PAGAR',
            titleType: 'PADRAO',
            origin: 'MANUAL',
            documentNumber: 'ALUG-1126',
            description: 'Locação sala comercial unidade Matriz (condomínio incluso)',
            clientId: sup2.id,
            clientName: sup2.fullName,
            unitId: unitIdVal,
            chartAccountId: firstExpChart?.id ?? null,
            documentTypeId: firstBoletoDoc?.id ?? null,
            bearerId: firstBearer?.id ?? null,
            bankAccountId: allBankAccs[0]?.id ?? null,
            installmentNumber: 1,
            totalInstallments: 1,
            isInitialFee: false,
            amountCents: 480000,
            originalValueCents: 480000,
            currentBalanceCents: 480000,
            issueDate: dShift(-2),
            dueDate: dShift(6),
            forecastDate: dShift(6),
            status: 'ABERTO',
            collectionStatus: 'EM_DIA',
            boletoProvider: 'santander',
          },
        ])
        .returning();

      const paidPayable = insertedPayables.find((p) => p.status === 'pago');
      if (paidPayable) {
        await db.insert(titleSettlements).values({
          titleId: paidPayable.id,
          settlementDate: paidPayable.paidAt || new Date(),
          principalCents: paidPayable.amountCents,
          amountCents: paidPayable.amountCents,
          origin: 'BAIXA MANUAL',
          paymentMethod: 'PIX',
          history: `Baixa - ${paidPayable.description}`,
          bankAccountId: allBankAccs[0]?.id ?? null,
          createdByName: 'Sistema',
        });
      }
    }
  }

  // Ensure initial settlements exist for already paid RECEBER titles
  const existingSettlements = await db.select({ value: count() }).from(titleSettlements);
  if (Number(existingSettlements[0]?.value || 0) === 0) {
    const paidReceivers = allExistingTitles.filter(
      (t) => String(t.status).toLowerCase() === 'pago' && (t.scope || 'RECEBER') === 'RECEBER'
    );
    const movRows = await db.select().from(bankMovements).orderBy(asc(bankMovements.id)).limit(1);
    for (const pr of paidReceivers.slice(0, 3)) {
      await db.insert(titleSettlements).values({
        titleId: pr.id,
        settlementDate: pr.paidAt || new Date(),
        principalCents: pr.amountCents,
        amountCents: pr.amountCents,
        origin: 'BAIXA MANUAL',
        paymentMethod: 'Boleto Bancário',
        history: `Liquidação título ${pr.titleCode}`,
        bankAccountId: allBankAccs[0]?.id ?? null,
        movementId: movRows[0]?.id ?? null,
        createdByName: 'Sistema',
      });
    }
  }
}

