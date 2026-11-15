export type ModuleId =
  | 'overview'
  | 'cad_clientes'
  | 'cad_cargos'
  | 'cad_colaboradores'
  | 'cad_departamentos'
  | 'cad_bancos'
  | 'cad_modalidades'
  | 'cad_produtos'
  | 'cad_series'
  | 'prospection'
  | 'appointments'
  | 'admission'
  | 'audit'
  | 'legal'
  | 'negotiations'
  | 'finance'
  | 'finance_cadastros'
  | 'finance_cad_fornecedores'
  | 'finance_cad_documentos'
  | 'finance_cad_portadores'
  | 'finance_cad_plano_contas'
  | 'finance_conta_corrente'
  | 'finance_movimento'
  | 'finance_conciliacao'
  | 'finance_receber'
  | 'finance_pagar'
  | 'finance_regua'
  | 'finance_operacao'
  | 'collection'
  | 'collection_coordenacao'
  | 'collection_operacional'
  | 'managerial_dashboard'
  | 'config';

export interface NavigationIntent {
  clientId?: number;
  admissionId?: number;
  processId?: number;
  leadId?: number;
  tab?: string;
  triggerNew?: boolean;
  notes?: string;
  clientName?: string;
  clientPhone?: string;
  unitId?: number;
  highlightMovementId?: number;
  titleId?: number;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
  legalName?: string;
  city: string;
  state: string;
  cnpj: string;
  phone: string;
  email?: string;
  whatsappNumber?: string;
  zipCode?: string;
  address: string;
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  minAdmissionCostCents: number;
  active: boolean;
}

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: string;
  groupId: number | null;
  defaultUnitId: number | null;
  allowedUnitIds: number[];
  mustChangePassword: boolean;
  points: number;
}

export interface UserGroup {
  id: number;
  name: string;
  description: string;
  modulePermissions: Record<string, boolean>;
  fieldPermissions: Record<string, Record<string, 'edit' | 'read' | 'hidden'>>;
}

export interface Client {
  id: number;
  personNature?: string;
  fullName: string;
  cpfCnpj: string;
  rg: string;
  birthDate: string;
  profession?: string;
  maritalStatus?: string;
  phone: string;
  whatsapp: string;
  secondaryPhone?: string;
  secondaryIsWhatsapp?: boolean;
  email: string;
  address: string;
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
  zipCode: string;
  notes?: string;
  clientType: string;
  status: string;
  suspensionReason?: string | null;
  cancelledReason?: string | null;
  unitId: number;
}

export interface ClientAssetLink {
  id: number;
  titularClientId: number;
  assetOwnerClientId: number;
  relationshipLabel: string;
  vehiclePlate: string;
  vehicleModel: string;
  renavam: string;
}

export interface AdmissionScenarioCol {
  id: string;
  name: string;
  servicePercent: number;
  installmentsToPay: number;
  originalDebtCents: number;
  recalcInstallmentCents: number;
  recalcDebtCents: number;
  savingsCents: number;
  dueDay: number;
}

export interface AuditCritiqueRound {
  id: string;
  round: number;
  author: string;
  reason: string;
  createdAt: string;
  commercialResponse?: string;
  respondedBy?: string;
  respondedAt?: string;
}

export interface AuditLogEntry {
  id: number;
  userId?: number | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown> | null;
  unitId?: number | null;
  createdAt: string;
}

export interface IviAuditFinding {
  severity: 'ok' | 'atencao' | 'critico';
  category: string;
  title: string;
  detail: string;
}

export interface AuditConsiderationEntry {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface IviChecklistVerificationItem {
  checklistItemId?: number;
  ruleCode: string;
  ruleTitle: string;
  category: 'checklist' | 'documentacao' | 'regra_operacional';
  classification: 'CONFORME' | 'MEDIDA_ATENCAO' | 'INCONSISTENCIA';
  detail: string;
  recommendedAction: string;
}

export interface IviAuditAnalysisSnapshot {
  verdict: 'APROVAR' | 'CONFERIR_PONTOS' | 'DEVOLVER_COMERCIAL';
  verdictLabel: string;
  executiveSummary: string;
  keyFindings: IviAuditFinding[];
  missingDocs: string[];
  suggestedChecklistTitles: string[];
  suggestedCritiqueDraft: string;
  nextStepRecommendation: string;
  provider: string;
  analyzedAt: string;
  inconsistenciesCount?: number;
  attentionMeasuresCount?: number;
  checklistItemsChecked?: IviChecklistVerificationItem[];
  fromDatabaseCache?: boolean;
  aiCallsSaved?: number;
  cacheKeyHash?: string;
}

export interface IviDocumentInspectionResult {
  documentId: number;
  fileName: string;
  documentDetected: string;
  legibility: 'LEGIVEL' | 'PARCIAL' | 'ILEGIVEL';
  matchesDossier: 'CONFERE' | 'DIVERGENCIA' | 'NAO_IDENTIFICADO';
  extractedFields: Array<{
    label: string;
    foundInDoc: string;
    expectedInDossier: string;
    match: boolean;
  }>;
  alerts: string[];
  summary: string;
  suggestedCritiqueText: string;
  provider: string;
}

export interface IviAuditRuleCheck {
  ruleCode: string;
  ruleTitle: string;
  source: 'checklist_sistema' | 'regra_operacional' | 'documentacao';
  status: 'ATENDE' | 'ATENCAO' | 'IMPEDITIVO';
  explanation: string;
  checklistItemId?: number;
}

export interface IviAuditInsightsPayload {
  admissionId: number;
  protocolCode: string;
  analyzedAt: string;
  provider: string;
  recommendedDecision: 'APROVAR' | 'SALVAR_EM_ANALISE' | 'DEVOLVER_ADMISSAO';
  recommendedDecisionLabel: string;
  decisionRationale: string;
  suggestedSearchSeizureFlag: boolean;
  suggestedChecklistItemIds: number[];
  suggestedRejectionReason: string;
  ruleChecks: IviAuditRuleCheck[];
  documentInspection: IviDocumentInspectionResult | null;
  availableDocumentsCount: number;
  fromDatabaseCache?: boolean;
  aiCallsSaved?: number;
  inconsistenciesCount?: number;
  attentionMeasuresCount?: number;
}

export interface Admission {
  id: number;
  protocolCode: string;
  clientId: number;
  assetOwnerId: number | null;
  clientRoleSelected?: string;
  unitId: number;
  origin?: string;
  consultantId: number | null;
  consultantName?: string;
  debtType: string;
  modality?: string;
  series?: string;
  indicationSource?: string;
  indicationOther?: string;
  bankName: string;
  contractNumber: string;
  vehicleInfo: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleYear?: string;
  vehiclePlate?: string;
  vehicleChassis?: string;
  vehicleRenavam?: string;
  isElectricVehicle?: boolean;
  debtTotalInstallments?: number;
  debtPaidInstallments?: number;
  debtOverdueInstallments?: number;
  financedAmountCents?: number;
  currentInstallmentCents?: number;
  debtDueDay?: number;
  paymentType?: string;
  debtAmountCents: number;
  serviceFeeCents: number;
  serviceMgmtCents?: number;
  serviceInitialCents?: number;
  serviceDiscountCents?: number;
  serviceAdditionCents?: number;
  billingFeeCents?: number;
  notes?: string;
  scenariosJson?: AdmissionScenarioCol[];
  installmentsCount: number;
  initialInstallmentCents: number;
  status: string;
  auditRejectionReason: string | null;
  auditCritiquesJson?: AuditCritiqueRound[];
  auditChecklistStateJson?: Record<string, boolean>;
  auditManualNotes?: string;
  auditManualNotesBy?: string;
  auditManualNotesAt?: string | null;
  auditConsiderationsJson?: AuditConsiderationEntry[];
  iviAuditAnalysisJson?: IviAuditAnalysisSnapshot | null;
  returnedCount: number;
  auditorId: number | null;
  activeReviewerId?: number | null;
  activeReviewerName?: string;
  activeReviewerSince?: string | null;
  auditedAt?: string | null;
  submittedToAuditAt?: string | null;
  slaMinutes: number | null;
  escavadorAlert: boolean;
  createdAt: string;
}

export interface DocumentObject {
  id: number;
  clientId: number;
  admissionId: number | null;
  folderPath: string;
  fileName: string;
  docCategory: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  storageUri: string;
  uploadedBy: string;
  unitId?: number;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdAt: string;
}

export interface RecalcScenario {
  id: number;
  clientId: number;
  admissionId: number | null;
  unitId: number;
  contractRateMonthlyPct: string;
  bacenAvgRateMonthlyPct: string;
  originalInstallmentCents: number;
  fairInstallmentCents: number;
  installmentsTotal: number;
  projectedSavingsCents: number;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface ScheduleBlock {
  id: number;
  consultantId: number | null;
  collaboratorId?: number | null;
  collaboratorName?: string;
  unitId: number;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  weekdays?: number[];
  startAt: string;
  endAt: string;
  reason: string;
  createdBy: string;
}

export interface ProspectionTranscriptItem {
  sender: string;
  text: string;
  provider?: string;
  timestamp: string;
  type?: 'text' | 'audio' | 'call';
  audioTranscript?: string;
  authorName?: string;
  callId?: string;
  mediaSha256?: string;
  mediaStorageUri?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  sourceProvider?: string;
  externalMessageId?: string;
}

export interface ProspectionLead {
  id: number;
  name: string;
  phone: string;
  email: string;
  channel: string;
  unitId: number;
  stage: string;
  iviProviderUsed: string | null;
  aiTranscript: ProspectionTranscriptItem[];
  summaryText?: string;
  summaryAuthor?: string;
  summaryUpdatedAt?: string | null;
  hasPhoneCall?: boolean;
  primaryThreadId?: number | null;
  lastArchiveSha256?: string;
  lastArchiveAt?: string | null;
  assignedUserId: number | null;
  lastMessageAt: string;
}

export interface WhatsappCallLogItem {
  id: number;
  unitId: number;
  leadId: number | null;
  threadId?: number | null;
  callId: string;
  direction?: string;
  fromNumber: string;
  toNumber: string;
  callType: string;
  status: string;
  durationSeconds?: number;
  provider: string;
  errorDetail: string;
  recordingSha256?: string;
  recordingStorageUri?: string;
  recordingMimeType?: string;
  recordingFileName?: string;
  audioTranscript?: string;
  initiatedByName: string;
  endedAt?: string | null;
  createdAt: string;
}

export interface CommunicationArchiveItem {
  id: number;
  unitId: number;
  leadId: number | null;
  threadId: number | null;
  callLogId: number | null;
  provider: string;
  archiveType: string;
  contactName: string;
  contactPhone: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  storageUri: string;
  transcriptText: string;
  createdByName: string;
  createdAt: string;
}

export interface Appointment {
  id: number;
  leadId: number | null;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  clientAddress?: string;
  clientDocument?: string;
  unitId: number;
  groupId?: number | null;
  attendantId: number | null;
  consultantId: number;
  collaboratorId?: number | null;
  collaboratorName?: string;
  serviceId?: number | null;
  serviceName?: string;
  modality: string;
  scheduledFor: string;
  endAt?: string | null;
  status: string;
  notes: string;
  createdByName?: string;
  updatedByName?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface ScheduleServiceItem {
  id: number;
  name: string;
  durationMinutes: number;
  priceCents: number;
  color: string;
  active: boolean;
}

export interface ScheduleWaitlistItem {
  id: number;
  clientId: number;
  clientName: string;
  clientPhone?: string;
  clientDocument?: string;
  serviceId: number;
  serviceName: string;
  serviceDurationMinutes: number;
  preferredCollaboratorId: number | null;
  preferredCollaboratorName?: string;
  unitId: number;
  desiredDate: string;
  desiredTime: string;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface ScheduleStatusColors {
  aguardando: string;
  agendado: string;
  confirmado: string;
  cancelado_cliente: string;
  cancelado_consultor: string;
  nao_compareceu: string;
}

export interface ScheduleConfig {
  startTime: string;
  endTime: string;
  slotIntervalMinutes: 15 | 30 | 45 | 60;
  statusColors: ScheduleStatusColors;
}

export interface ScheduleCollaboratorNode {
  id: number;
  name: string;
  active: boolean;
  unitId: number;
  roleId: number | null;
  jobTitle: string;
  userId: number | null;
  groupId: number | null;
  photoUrl: string;
  participatesInScheduleQueue: boolean;
  queuePosition?: number | null;
  isNextInQueue?: boolean;
}

export interface ScheduleBootstrapPayload {
  units: Unit[];
  groups: UserGroup[];
  collaborators: ScheduleCollaboratorNode[];
  services: ScheduleServiceItem[];
  appointments: Appointment[];
  blocks: ScheduleBlock[];
  waitlist: ScheduleWaitlistItem[];
  config: ScheduleConfig;
  rotationQueues: Record<string, number[]>;
  lastUpdatedAt: string;
}

export interface LegalProcess {
  id: number;
  processNumber: string;
  clientId: number;
  admissionId: number | null;
  unitId: number;
  courtName: string;
  actionType: string;
  hasSearchSeizure: boolean;
  vehicleSeized: boolean;
  status: string;
  previousStatus?: string | null;
  statusChangeReason?: string | null;
  escavadorMonitored?: boolean;
  escavadorLastActionNote?: string | null;
  escavadorUpdatedAt?: string | null;
  hasUnreadMovement: boolean;
  lastMovementAt: string | null;
  assignedLawyerId: number | null;
  createdAt?: string;
}

export interface LegalMovement {
  id: number;
  processId: number;
  source: string;
  originalDispatch: string;
  iviTranslationPtBr: string;
  openedAt: string | null;
  readCompletedAt: string | null;
  clientContactedAt: string | null;
  contactChannel: string | null;
  contactSummary: string | null;
  emailSent: boolean;
  lawyerId: number | null;
  createdAt: string;
}

export interface Negotiation {
  id: number;
  admissionId: number;
  clientId: number;
  unitId: number;
  negotiatorId: number | null;
  bankName: string;
  originalDebtCents: number;
  targetReductionPct: number;
  currentReductionPct: number;
  estimatedSavingsCents: number;
  targetDeadline: string;
  status: string;
  lastMassEmailAt: string | null;
  chatLogs: Array<{ channel: string; note: string; author: string; timestamp: string }>;
}

export interface FinancialTitle {
  id: number;
  titleCode: string;
  scope?: 'RECEBER' | 'PAGAR' | string;
  titleType?: 'PADRAO' | 'ADIANTAMENTO' | 'DEVOLUCAO' | 'FATURA' | string;
  origin?: string;
  documentNumber?: string;
  description?: string;
  clientId: number;
  clientName?: string;
  admissionId: number | null;
  unitId: number;
  categoryId: number | null;
  chartAccountId?: number | null;
  documentTypeId?: number | null;
  bearerId?: number | null;
  departmentId?: number | null;
  bankAccountId?: number | null;
  sellerId?: number | null;
  assignedCollaboratorId?: number | null;
  installmentNumber: number;
  totalInstallments: number;
  isInitialFee: boolean;
  amountCents: number;
  originalValueCents?: number;
  currentBalanceCents?: number;
  interestCents?: number;
  fineCents?: number;
  discountCents?: number;
  discountValidUntil?: string | null;
  issueDate?: string;
  dueDate: string;
  forecastDate?: string | null;
  paidAt: string | null;
  status: string;
  collectionStatus?: 'EM_DIA' | 'COBRAR' | 'NAO_COBRAR' | string;
  accountingType?: 'CONTABIL' | 'NAO_CONTABIL' | string;
  boletoProvider: string;
  barcode: string;
  ourNumber: string;
  receiptDocId: number | null;
  collectorId: number | null;
  coverSheetApproved?: boolean;
  reguaStageSent: string[];
  parentId?: number | null;
  recurrenceId?: string;
  invoiceGroupId?: string;
  originTitleIds?: number[];
  isProtested?: boolean;
  isProvision?: boolean;
  releaseLogJson?: Array<{ type: 'PROTEST' | 'PROVISION'; user: string; reason: string; releasedAt: string }>;
  advanceLinks?: Array<{ titleId: number; documentNumber: string; amountCents: number; date: string }>;
  returnLinks?: Array<{ titleId: number; documentNumber: string; amountCents: number; date: string }>;
  contractNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TitleSettlement {
  id: number;
  titleId: number;
  settlementDate: string;
  principalCents: number;
  interestCents: number;
  fineCents: number;
  discountCents: number;
  amountCents: number;
  origin: string;
  paymentMethod: string;
  history: string;
  bankAccountId?: number | null;
  movementId?: number | null;
  batchUuid?: string;
  createdByName?: string;
  createdAt?: string;
}

export interface DocumentTypeItem {
  id: number;
  description: string;
  category: string;
  isFiscal: boolean;
  requiresNumber: boolean;
  active: boolean;
}

export interface BearerItem {
  id: number;
  code: string;
  name: string;
  type: string;
  associatedBankAccountId?: number | null;
  active: boolean;
}

export interface ReguaBatchCandidate {
  titleId: number;
  titleCode: string;
  documentNumber: string;
  description: string;
  clientId: number;
  clientName: string;
  clientPhone: string;
  clientWhatsapp: string;
  clientEmail: string;
  unitId: number;
  dueDate: string;
  daysOffset: number;
  stageTag: '-15d' | '-5d' | '+7d';
  balanceCents: number;
  installmentNumber: number;
  totalInstallments: number;
  alreadySentStages: string[];
  suggestedMessage: string;
}

export interface CollectionCase {
  id: number;
  titleId: number;
  clientId: number;
  unitId: number;
  assignedCollectorId: number | null;
  stateCode: string;
  priorityValueCents: number;
  status: string;
  conversationSummary: string;
  audioTranscript: string;
  pointsAwarded: number;
}

export interface CollectionCancelRequestInfo {
  requestDate: string;
  admissionId?: number | null;
  admissionContract?: string;
  notes?: string;
}

export interface CollectionNote {
  id: number;
  titleId: number | null;
  clientId: number;
  collaboratorId: number | null;
  collaboratorName: string;
  userId: number | null;
  unitId: number | null;
  contactDate: string;
  contactTime: string;
  channel: string;
  negotiationStatus: string;
  note: string;
  cancelRequest: CollectionCancelRequestInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappThread {
  id: number;
  clientId: number | null;
  unitId: number;
  contactName: string;
  contactPhone: string;
  provider: string;
  gotalkContactId?: string | null;
  gotalkAttendanceId?: string | null;
  uazapiInstanceId?: string | null;
  operatorName?: string | null;
  department?: string | null;
  assignedOperatorId?: number | null;
  unreadCount: number;
  lastMessagePreview: string;
  updatedAt: string;
}

export interface WhatsappMessage {
  id: number;
  threadId: number;
  externalMessageId?: string | null;
  direction: string;
  contentType: string;
  body: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
  mediaSha256?: string | null;
  mediaStorageUri?: string | null;
  iviAudioTranscript: string | null;
  ackStatus?: number | null;
  deletedInOrigin?: boolean;
  operatorName?: string | null;
  department?: string | null;
  senderName: string;
  createdAt: string;
}

export interface GotalkChannelPublic {
  id: number;
  name: string;
  phoneNumber: string | null;
  unitId: number | null;
  notes?: string;
  isPrimary: boolean;
  isActive: boolean;
}

export interface GotalkOperatorPublic {
  id: number;
  gotalkOperatorId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  collaboratorId: number | null;
}

export interface GotalkHsmTemplate {
  id: number;
  templateName: string;
  gotalkTemplateId: string | null;
  category: string | null;
  language: string | null;
  status: string | null;
  bodyText: string | null;
  headerText: string | null;
  footerText: string | null;
}

export interface UazapiInstancePublic {
  id: number;
  unitId: number;
  label: string;
  uazapiInstanceId: string;
  uazapiServerUrl: string;
  hasToken: boolean;
  defaultPhone?: string;
  connectedPhone: string | null;
  profileName: string | null;
  isConnected: boolean;
  allowedGroupIds?: number[];
  allowedModules?: string[];
  assignedCollaboratorId?: number | null;
  isDefaultForUnit?: boolean;
  active?: boolean;
  webhookUrl: string | null;
  webhookRegisteredAt: string | null;
  webhookLastError: string | null;
  updatedAt: string;
}

export interface UazapiStatus {
  configured: boolean;
  envConfigured?: boolean;
  serverUrl: string;
  encryptionKeyDedicated?: boolean;
  webhookSecretConfigured?: boolean;
  instancesCount: number;
  instances: UazapiInstancePublic[];
  lastWebhookAt?: string | null;
  lastCheckAt?: string | null;
  lastError?: string | null;
}

export interface AuditChecklistItem {
  id: number;
  sortOrder: number;
  title: string;
  description: string;
  modalityCondition: string;
  active: boolean;
  updatedAt?: string;
}

export interface HelpCenterTopic {
  id: number;
  topicKey: string;
  menuPath: string;
  title: string;
  summary: string;
  keywords: string[];
  htmlContent: string;
  updatedAt?: string;
}

export interface PortalBrandingConfig {
  companyName: string;
  primaryColor: string;
  textColor: string;
  logoDataUrl: string;
  marketingHeadline: string;
  marketingDescription: string;
  loginLeftBg: string;
  loginLeftText: string;
  loginBackgroundImageUrl: string;
  loginRightBg: string;
  loginRightText: string;
  sidebarBg: string;
  sidebarText: string;
  headerBg: string;
  headerText: string;
  canvasBg: string;
  canvasBackgroundImageUrl: string;
}

export interface ConfigUserItem {
  id: number;
  uid: string;
  name: string;
  email: string;
  role: string;
  groupId: number | null;
  defaultUnitId: number | null;
  allowedUnitIds: number[];
  whatsappPhone: string;
  active: boolean;
  points: number;
}

// --- CADASTROS COMUNS ---

export interface RoleCatalogItem {
  id: number;
  name: string;
  participatesInScheduleQueue: boolean;
  sortOrder: number;
  active: boolean;
}

export interface DepartmentItem {
  id: number;
  code: string;
  name: string;
  managerName: string;
  status: 'ATIVO' | 'INATIVO' | string;
}

export interface CollaboratorItem {
  id: number;
  code: string;
  name: string;
  active: boolean;
  participatesInScheduleQueue: boolean;
  unitId: number;
  roleId: number | null;
  jobTitle: string;
  departmentId: number | null;
  userId: number | null;
  email: string;
  phone: string;
  isWhatsapp: boolean;
  birthDate: string;
  maritalStatus: string;
  photoUrl: string;
  zipCode: string;
  address: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  notes: string;
}

export interface FebrabanBankItem {
  code: string;
  name: string;
  fullName: string;
  ispb: string;
}

export interface ModalityItem {
  id: number;
  type: string;
  description: string;
  hasVehicleSection: boolean;
  active: boolean;
}

export interface BankServiceItem {
  id?: number;
  bankId?: number;
  name: string;
  modalityId: number | null;
  modalityDescription: string;
  negotiationPercent: string;
  defaultInstallments: number;
}

export interface BankContactItem {
  id?: number;
  bankId?: number;
  name: string;
  sector: string;
  phone: string;
  mobile: string;
  isWhatsapp: boolean;
  email: string;
}

export interface BankItem {
  id: number;
  code: string;
  name: string;
  febrabanCode: string;
  status: 'ATIVO' | 'INATIVO' | string;
  notes: string;
  services: BankServiceItem[];
  contacts: BankContactItem[];
}

export interface MeasurementUnitItem {
  id: number;
  name: string;
  conversionFactor: string;
}

export interface ProductItem {
  id: number;
  type: 'SERVICO' | 'MATERIAL' | string;
  description: string;
  unitId: number | null;
  unitName?: string;
}

export interface SeriesUnitNumberingItem {
  id?: number;
  seriesId?: number;
  unitId: number;
  currentNumber: number;
}

export interface SeriesItem {
  id: number;
  sigla: string;
  description: string;
  generalNumber: number;
  isDefault: boolean;
  unitNumbering: SeriesUnitNumberingItem[];
}

export interface CadastrosBootstrapPayload {
  banks: BankItem[];
  febrabanBanks: FebrabanBankItem[];
  modalities: ModalityItem[];
  series: SeriesItem[];
  collaborators: CollaboratorItem[];
  roles: RoleCatalogItem[];
  departments: DepartmentItem[];
  maritalStatuses: string[];
}

export interface ChartAccountItem {
  id: number;
  code: string;
  name: string;
  type: 'receita' | 'despesa' | 'ativo' | 'passivo' | string;
  parentId?: number | null;
  isAnalytic: boolean;
  active: boolean;
}

export interface BankAccount {
  id: number;
  bankName: string;
  agency: string;
  accountNumber: string;
  accountType: string;
  initialBalanceCents: number;
  currentBalanceCents: number;
  unitId?: number | null;
  active: boolean;
  createdAt?: string;
}

export type BankMovementType = 'CREDITO' | 'DEBITO';
export type BankMovementOrigin =
  | 'BAIXA_RECEBER'
  | 'BAIXA_PAGAR'
  | 'MANUAL'
  | 'TARIFA'
  | 'TRANSFERENCIA'
  | 'DEPOSITO'
  | 'SAQUE';
export type BankMovementStatus = 'CONCILIADO' | 'PENDENTE';

export interface BankMovement {
  id: number;
  bankAccountId: number;
  movementType: BankMovementType | string;
  amountCents: number;
  description: string;
  documentNumber: string;
  movementDate: string;
  categoryId?: number | null;
  categoryName: string;
  origin: BankMovementOrigin | string;
  status: BankMovementStatus | string;
  reconciled: boolean;
  reconciliationDate: string;
  compensationDate: string;
  titleId?: number | null;
  titleSource: 'RECEBER' | 'PAGAR' | '' | string;
  transferId: string;
  documentTypeId?: number | null;
  bearerId?: number | null;
  departmentId?: number | null;
  unitId?: number | null;
  createdAt?: string;
}

export interface CollectionReportColumn {
  key: string;
  label: string;
  format?: 'text' | 'currency' | 'number' | 'percent' | 'date';
}

export interface CollectionReportChartPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface CollectionReport {
  id: number;
  title: string;
  reportType: string;
  prompt: string;
  executiveSummary: string;
  insightsJson: string[];
  columnsJson: CollectionReportColumn[];
  rowsJson: Array<Record<string, string | number>>;
  chartSeriesJson: CollectionReportChartPoint[];
  provider: string;
  createdByUserId?: number | null;
  createdByName: string;
  unitId?: number | null;
  createdAt: string;
}

export interface IviCollectionInsightCard {
  id: string;
  severity: 'critico' | 'atencao' | 'oportunidade';
  category: string;
  title: string;
  description: string;
  recommendedAction: string;
  filterPreset?: {
    overdueOnly?: boolean;
    filterStatus?: string;
    filterCollaborator?: string;
    filterAgingBucket?: string;
    filterUf?: string;
  };
}

export interface IviCollectionInsightsPayload {
  analyzedAt: string;
  provider: string;
  executiveHeadline: string;
  insights: IviCollectionInsightCard[];
}

export interface IviWhatsappSummaryPayload {
  summary: string;
  sentiment: string;
  commitments: string[];
  recommendedNextStep: string;
  provider: string;
  analyzedAt: string;
}

export interface OperatorMirrorPayload {
  collaborator: CollaboratorItem;
  linkedUser: {
    id: number;
    name: string;
    email: string;
    role: string;
    points: number;
    rankPosition: number | null;
  } | null;
  metrics: {
    totalAssignedCount: number;
    overdueCount: number;
    openBalanceCents: number;
    overdueBalanceCents: number;
    paidCount: number;
    recoveredCents: number;
    notesCount: number;
    cancelRequestsCount: number;
  };
  queue: Array<{
    titleId: number;
    caseId: number | null;
    clientId: number;
    clientName: string;
    clientCpfCnpj: string;
    clientStatus: string;
    documentNumber: string;
    titleCode: string;
    description: string;
    dueDate: string;
    agingDays: number;
    amountCents: number;
    currentBalanceCents: number;
    status: string;
    collectionStatus: string;
    stateCode: string;
    conversationSummary: string;
    pointsAwarded: number;
  }>;
  notes: CollectionNote[];
}

export interface ManagerialMonthlyCollectionPoint {
  monthKey: string;
  monthLabel: string;
  receivedCents: number;
  overdueCents: number;
  openedCents: number;
  recoveredCount: number;
}

export interface ManagerialAgingBucket {
  key: string;
  label: string;
  count: number;
  balanceCents: number;
}

export interface ManagerialCollectionStatusPoint {
  status: string;
  label: string;
  count: number;
  balanceCents: number;
}

export interface ManagerialOperatorPerformance {
  name: string;
  recoveredCents: number;
  openBalanceCents: number;
  overdueBalanceCents: number;
  titlesCount: number;
  paidCount: number;
  notesCount: number;
  points: number;
}

export interface ManagerialLegalStatusPoint {
  status: string;
  label: string;
  count: number;
}

export interface ManagerialLegalActionPoint {
  actionType: string;
  label: string;
  count: number;
}

export interface ManagerialLegalCourtPoint {
  courtName: string;
  count: number;
  searchSeizureCount: number;
}

export interface ManagerialLegalMovementTimelinePoint {
  dateKey: string;
  dateLabel: string;
  escavadorWebhook: number;
  escavadorFallback: number;
  detranScan: number;
  total: number;
}

export interface ManagerialLegalFeedItem {
  id: number;
  processId: number;
  processNumber: string;
  clientName: string;
  courtName: string;
  actionType: string;
  status: string;
  source: string;
  originalDispatch: string;
  iviTranslationPtBr: string;
  hasUnreadMovement: boolean;
  hasSearchSeizure: boolean;
  vehicleSeized: boolean;
  createdAt: string;
}

export interface ManagerialIviCapabilityPoint {
  area: string;
  label: string;
  automationsCount: number;
  cacheOrSelfResolved: number;
  escalatedOrManual: number;
  efficiencyPct: number;
}

export interface ManagerialIviTimelinePoint {
  monthKey: string;
  monthLabel: string;
  aiExecutions: number;
  dbCacheHits: number;
  legalTranslations: number;
  audioTranscripts: number;
}

export interface ManagerialDashboardPayload {
  meta: {
    generatedAt: string;
    unitScope: 'active' | 'all';
    unitLabel: string;
    periodDays: number;
    totalUnitsIncluded: number;
  };
  kpis: {
    totalActiveTitles: number;
    overdueTitlesCount: number;
    totalReceivableBalanceCents: number;
    overdueBalanceCents: number;
    recoveredPeriodCents: number;
    recoveryRatePct: number;
    defaultRatePct: number;
    activeLegalProcesses: number;
    unreadLegalMovements: number;
    seizureRiskProcesses: number;
    iviTotalInteractions: number;
    iviAiCallsSaved: number;
  };
  collection: {
    monthlyTrend: ManagerialMonthlyCollectionPoint[];
    agingBuckets: ManagerialAgingBucket[];
    statusBreakdown: ManagerialCollectionStatusPoint[];
    operatorRanking: ManagerialOperatorPerformance[];
  };
  legal: {
    realtimeSnapshotAt: string;
    summary: {
      totalProcesses: number;
      escavadorMonitored: number;
      unreadMovements: number;
      searchSeizureCount: number;
      vehicleSeizedCount: number;
      suspendedOrCancelledCount: number;
      avgResponseHours: number;
    };
    byStatus: ManagerialLegalStatusPoint[];
    byActionType: ManagerialLegalActionPoint[];
    byCourt: ManagerialLegalCourtPoint[];
    movementsTimeline: ManagerialLegalMovementTimelinePoint[];
    recentLiveFeed: ManagerialLegalFeedItem[];
  };
  ivi: {
    summary: {
      totalAutomations: number;
      auditSweepsCount: number;
      aiCallsSaved: number;
      cacheHitRatioPct: number;
      legalTranslationsCount: number;
      prospectionLeadsHandled: number;
      humanEscalationRatePct: number;
      audioTranscriptionsCount: number;
      savedReportsCount: number;
    };
    byCapability: ManagerialIviCapabilityPoint[];
    auditVerdicts: Array<{ verdict: string; label: string; count: number }>;
    providerUsage: Array<{ provider: string; count: number }>;
    efficiencyTimeline: ManagerialIviTimelinePoint[];
  };
}

export interface TaskTimerPauseEntry {
  startedAt: string;
  pausedAt: string;
  durationSeconds: number;
  reason: string;
  userName: string;
}

export interface CoordinatorTaskColumn {
  id: number;
  ownerUserId: number;
  title: string;
  color: string;
  isFinal: boolean;
  sortOrder: number;
}

export interface CoordinatorTaskSubtask {
  id: number;
  taskId: number;
  sortOrder: number;
  title: string;
  description: string;
  solutionNotes: string;
  priority: 'alta' | 'media' | 'baixa' | string;
  criticality: 'baixo' | 'medio' | 'alto' | 'critico' | 'emergencial' | string;
  assignedCollaboratorId: number | null;
  assignedCollaboratorName: string;
  dueAt: string | null;
  estimatedMinutes: number | null;
  requiresPredecessor: boolean;
  status: 'PENDENTE' | 'CONCLUIDO' | string;
  timerRunningSince: string | null;
  timerAccumulatedSeconds: number;
  timerPauseLogsJson: TaskTimerPauseEntry[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoordinatorTaskShare {
  id: number;
  taskId: number;
  ownerUserId: number;
  sharedWithUserId: number;
  sharedWithName: string;
  sharedByName: string;
  permission: 'edit' | 'view' | string;
  createdAt: string;
}

export interface CoordinatorTaskAttachment {
  id: number;
  taskId: number;
  subtaskId: number | null;
  documentObjectId: number | null;
  source: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  externalUrl: string;
  addedByName: string;
  createdAt: string;
}

export interface CoordinatorTaskItem {
  id: number;
  ownerUserId: number;
  ownerName: string;
  unitId: number | null;
  clientId: number | null;
  clientName: string;
  titleId: number | null;
  collaboratorId: number | null;
  collaboratorName: string;
  projectLabel: string;
  originType: 'direta' | 'nota_rapida' | 'cobranca' | string;
  title: string;
  description: string;
  solutionNotes: string;
  occurrenceNotes: string;
  blockingReason: string;
  priority: 'alta' | 'media' | 'baixa' | string;
  criticality: 'baixo' | 'medio' | 'alto' | 'critico' | 'emergencial' | string;
  statusColumnId: number | null;
  statusKey: string;
  statusLabel: string;
  isCompleted: boolean;
  dueAt: string | null;
  estimatedMinutes: number | null;
  timerRunningSince: string | null;
  timerAccumulatedSeconds: number;
  timerPauseLogsJson: TaskTimerPauseEntry[];
  iviReviewNote: string;
  completedAt: string | null;
  completedByName: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields from API
  isOwner: boolean;
  mySharePermission: 'owner' | 'edit' | 'view';
  derivedEstimatedMinutes: number | null;
  subtasks: CoordinatorTaskSubtask[];
  shares: CoordinatorTaskShare[];
  attachments: CoordinatorTaskAttachment[];
}

export interface CoordinatorEligibleUser {
  id: number;
  name: string;
  email: string;
  role: string;
  groupName: string;
}

export interface CoordinatorTasksBootstrapPayload {
  currentUserId: number;
  currentUserName: string;
  columns: CoordinatorTaskColumn[];
  tasks: CoordinatorTaskItem[];
  coordinators: CoordinatorEligibleUser[];
}

export interface StateDebtRecoveryMetric {
  uf: string;
  clientsCount: number;
  openTitlesCount: number;
  debtBalanceCents: number;
  overdueDebtCents: number;
  recoveredTotalCents: number;
  recoveryRatePct: number;
  monthOpenCount: number;
  monthDebtCents: number;
  monthOverdueDebtCents: number;
  monthRecoveredCents: number;
  monthRecoveryRatePct: number;
}

export interface IviStateMonthAnalysis {
  month: string;
  executiveSummary: string;
  highlights: string[];
  focusUfs: string[];
  provider: string;
  generatedAt: string;
}

export interface UazapiInstanceOption {
  id: number;
  unitId: number;
  label: string;
  uazapiInstanceId: string;
  connectedPhone: string | null;
  profileName: string | null;
  isConnected: boolean;
  active: boolean;
}

