import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const units = pgTable('units', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  legalName: text('legal_name').notNull().default(''),
  city: text('city').notNull(),
  state: text('state').notNull(),
  cnpj: text('cnpj').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  whatsappNumber: text('whatsapp_number').notNull().default(''),
  zipCode: text('zip_code').notNull().default(''),
  address: text('address').notNull().default(''),
  addressNumber: text('address_number').notNull().default(''),
  complement: text('complement').notNull().default(''),
  neighborhood: text('neighborhood').notNull().default(''),
  minAdmissionCostCents: integer('min_admission_cost_cents').notNull().default(150000),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userGroups = pgTable('user_groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  modulePermissions: jsonb('module_permissions').$type<Record<string, boolean>>().notNull().default({}),
  fieldPermissions: jsonb('field_permissions').$type<Record<string, Record<string, 'edit' | 'read' | 'hidden'>>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default('Colaborador'),
  role: text('role').notNull().default('consultant'),
  groupId: integer('group_id').references(() => userGroups.id),
  defaultUnitId: integer('default_unit_id').references(() => units.id),
  allowedUnitIds: jsonb('allowed_unit_ids').$type<number[]>().notNull().default([]),
  passwordHash: text('password_hash').notNull().default(''),
  tempPassword: text('temp_password'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  whatsappPhone: text('whatsapp_phone').notNull().default(''),
  active: boolean('active').notNull().default(true),
  points: integer('points').notNull().default(0),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  sessionVersion: integer('session_version').notNull().default(1),
  suspended: boolean('suspended').notNull().default(false),
  suspendedReason: text('suspended_reason').notNull().default(''),
  suspendedAt: timestamp('suspended_at'),
  suspendedBy: text('suspended_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workSchedules = pgTable('work_schedules', {
  id: serial('id').primaryKey(),
  targetType: text('target_type').notNull(), // 'unit' | 'user' | 'group' | 'unit_group'
  targetId: integer('target_id').notNull(),
  unitId: integer('unit_id'),
  groupId: integer('group_id'),
  targetLabel: text('target_label').notNull(),
  startTime: text('start_time').notNull().default('08:00'),
  endTime: text('end_time').notNull().default('18:00'),
  allowedDays: jsonb('allowed_days').$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  closingWarningMessage: text('closing_warning_message').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customFields = pgTable('custom_fields', {
  id: serial('id').primaryKey(),
  module: text('module').notNull(),
  fieldKey: text('field_key').notNull(),
  label: text('label').notNull(),
  fieldType: text('field_type').notNull().default('text'),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  personNature: text('person_nature').notNull().default('PF'), // 'PF' | 'PJ'
  fullName: text('full_name').notNull(),
  cpfCnpj: text('cpf_cnpj').notNull().unique(),
  rg: text('rg').notNull().default(''),
  birthDate: text('birth_date').notNull().default(''),
  profession: text('profession').notNull().default(''),
  maritalStatus: text('marital_status').notNull().default(''),
  phone: text('phone').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  secondaryPhone: text('secondary_phone').notNull().default(''),
  secondaryIsWhatsapp: boolean('secondary_is_whatsapp').notNull().default(false),
  email: text('email').notNull().default(''),
  address: text('address').notNull().default(''),
  addressNumber: text('address_number').notNull().default(''),
  complement: text('complement').notNull().default(''),
  neighborhood: text('neighborhood').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zipCode: text('zip_code').notNull().default(''),
  notes: text('notes').notNull().default(''),
  clientType: text('client_type').notNull().default('titular'), // 'titular' | 'responsavel_bem' | 'ambos'
  natureza: text('natureza').notNull().default('C'), // 'C' (Cliente/Pessoa) | 'F' (Fornecedor)
  status: text('status').notNull().default('ativo'), // 'ativo' | 'suspenso' | 'cancelado'
  suspensionReason: text('suspension_reason'),
  cancelledReason: text('cancelled_reason'),
  cancelledAt: timestamp('cancelled_at'),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  customValues: jsonb('custom_values').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clientAssetLinks = pgTable('client_asset_links', {
  id: serial('id').primaryKey(),
  titularClientId: integer('titular_client_id').references(() => clients.id).notNull(),
  assetOwnerClientId: integer('asset_owner_client_id').references(() => clients.id).notNull(),
  relationshipLabel: text('relationship_label').notNull().default('Responsável pelo Bem'),
  vehiclePlate: text('vehicle_plate').notNull().default(''),
  vehicleModel: text('vehicle_model').notNull().default(''),
  renavam: text('renavam').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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

export const admissions = pgTable('admissions', {
  id: serial('id').primaryKey(),
  protocolCode: text('protocol_code').notNull().unique(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  assetOwnerId: integer('asset_owner_id').references(() => clients.id),
  clientRoleSelected: text('client_role_selected').notNull().default('responsavel'), // 'responsavel' | 'titular'
  unitId: integer('unit_id').references(() => units.id).notNull(),
  origin: text('origin').notNull().default(''), // '' | 'prospeccao' | 'propaganda' | 'recuperacao'
  consultantId: integer('consultant_id').references(() => users.id),
  consultantName: text('consultant_name').notNull().default(''),
  debtType: text('debt_type').notNull().default('veicular'), // 'veicular' | 'cartao' | 'emprestimo' | 'cheque_especial'
  modality: text('modality').notNull().default('CDC Veículo'),
  series: text('series').notNull().default('ADM'),
  indicationSource: text('indication_source').notNull().default(''), // '' | 'indicacao' | 'radio' | 'outro'
  indicationOther: text('indication_other').notNull().default(''),
  bankName: text('bank_name').notNull(),
  contractNumber: text('contract_number').notNull(),
  vehicleInfo: text('vehicle_info').notNull().default(''),
  vehicleBrand: text('vehicle_brand').notNull().default(''),
  vehicleModel: text('vehicle_model').notNull().default(''),
  vehicleColor: text('vehicle_color').notNull().default(''),
  vehicleYear: text('vehicle_year').notNull().default(''),
  vehiclePlate: text('vehicle_plate').notNull().default(''),
  vehicleChassis: text('vehicle_chassis').notNull().default(''),
  vehicleRenavam: text('vehicle_renavam').notNull().default(''),
  isElectricVehicle: boolean('is_electric_vehicle').notNull().default(false),
  debtTotalInstallments: integer('debt_total_installments').notNull().default(48),
  debtPaidInstallments: integer('debt_paid_installments').notNull().default(0),
  debtOverdueInstallments: integer('debt_overdue_installments').notNull().default(0),
  financedAmountCents: bigint('financed_amount_cents', { mode: 'number' }).notNull().default(0),
  currentInstallmentCents: integer('current_installment_cents').notNull().default(0),
  debtDueDay: integer('debt_due_day').notNull().default(10),
  paymentType: text('payment_type').notNull().default('boleto'),
  debtAmountCents: bigint('debt_amount_cents', { mode: 'number' }).notNull().default(0),
  serviceFeeCents: integer('service_fee_cents').notNull().default(0),
  serviceMgmtCents: integer('service_mgmt_cents').notNull().default(0),
  serviceInitialCents: integer('service_initial_cents').notNull().default(0),
  serviceDiscountCents: integer('service_discount_cents').notNull().default(0),
  serviceAdditionCents: integer('service_addition_cents').notNull().default(0),
  billingFeeCents: integer('billing_fee_cents').notNull().default(0),
  notes: text('notes').notNull().default(''),
  scenariosJson: jsonb('scenarios_json').$type<AdmissionScenarioCol[]>().notNull().default([]),
  installmentsCount: integer('installments_count').notNull().default(6),
  initialInstallmentCents: integer('initial_installment_cents').notNull().default(0),
  status: text('status').notNull().default('pendente'), // 'pendente' | 'negociacao' | 'analise_cliente' | 'aguardando_auditoria' | 'devolvida_admissao' | 'retorno_auditoria' | 'reprovada' | 'aprovada' | 'em_andamento' | 'auditada' | 'finalizada' | 'concluido'
  auditRejectionReason: text('audit_rejection_reason'),
  auditCritiquesJson: jsonb('audit_critiques_json').$type<AuditCritiqueRound[]>().notNull().default([]),
  auditChecklistStateJson: jsonb('audit_checklist_state_json').$type<Record<string, boolean>>().notNull().default({}),
  auditManualNotes: text('audit_manual_notes').notNull().default(''),
  auditManualNotesBy: text('audit_manual_notes_by').notNull().default(''),
  auditManualNotesAt: timestamp('audit_manual_notes_at'),
  auditConsiderationsJson: jsonb('audit_considerations_json').$type<AuditConsiderationEntry[]>().notNull().default([]),
  iviAuditAnalysisJson: jsonb('ivi_audit_analysis_json').$type<IviAuditAnalysisSnapshot | null>().default(null),
  returnedCount: integer('returned_count').notNull().default(0),
  auditorId: integer('auditor_id').references(() => users.id),
  activeReviewerId: integer('active_reviewer_id').references(() => users.id),
  activeReviewerName: text('active_reviewer_name').notNull().default(''),
  activeReviewerSince: timestamp('active_reviewer_since'),
  submittedToAuditAt: timestamp('submitted_to_audit_at').defaultNow(),
  auditedAt: timestamp('audited_at'),
  slaMinutes: integer('sla_minutes'),
  escavadorAlert: boolean('escavador_alert').notNull().default(false),
  integrativeCode: text('integrative_code'),
  legacyProtocolCode: text('legacy_protocol_code').notNull().default(''),
  legacySourcePath: text('legacy_source_path').notNull().default(''),
  migrationBatchId: integer('migration_batch_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documentObjects = pgTable('document_objects', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  admissionId: integer('admission_id').references(() => admissions.id),
  folderPath: text('folder_path').notNull(),
  fileName: text('file_name').notNull(),
  docCategory: text('doc_category').notNull(), // 'ficha_admissao' | 'contrato' | 'procuracao' | 'pessoal' | 'residencia' | 'crlv' | 'aditivo' | 'termo_cancelamento' | 'comprovante' | 'audio_whatsapp'
  mimeType: text('mime_type').notNull().default('application/pdf'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  sha256Hash: text('sha256_hash').notNull(),
  storageUri: text('storage_uri').notNull(),
  uploadedBy: text('uploaded_by').notNull().default('Sistema'),
  unitId: integer('unit_id').notNull().default(1),
  integrativeCode: text('integrative_code'),
  relativeSubpath: text('relative_subpath').notNull().default(''),
  legacySourcePath: text('legacy_source_path').notNull().default(''),
  versionNumber: integer('version_number').notNull().default(1),
  previousSha256: text('previous_sha256').notNull().default(''),
  lastSyncedAt: timestamp('last_synced_at'),
  archivedAt: timestamp('archived_at'),
  migrationBatchId: integer('migration_batch_id'),
  deletedAt: timestamp('deleted_at'),
  deletedBy: text('deleted_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const prospectionLeads = pgTable('prospection_leads', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull().default(''),
  channel: text('channel').notNull(), // 'instagram' | 'facebook' | 'whatsapp_gotalk' | 'whatsapp_uazapi' | 'telefone' | 'email_maton'
  unitId: integer('unit_id').references(() => units.id).notNull(),
  stage: text('stage').notNull().default('novo'), // 'novo' | 'em_atendimento_ivi' | 'escalado_humano' | 'agendado' | 'fechado' | 'analise' | 'nao_fechado' | 'recuperado'
  iviProviderUsed: text('ivi_provider_used').default('gemini'),
  aiTranscript: jsonb('ai_transcript')
    .$type<
      Array<{
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
      }>
    >()
    .notNull()
    .default([]),
  summaryText: text('summary_text').notNull().default(''),
  summaryAuthor: text('summary_author').notNull().default(''),
  summaryUpdatedAt: timestamp('summary_updated_at'),
  hasPhoneCall: boolean('has_phone_call').notNull().default(false),
  primaryThreadId: integer('primary_thread_id'),
  lastArchiveSha256: text('last_archive_sha256').notNull().default(''),
  lastArchiveAt: timestamp('last_archive_at'),
  assignedUserId: integer('assigned_user_id').references(() => users.id),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const iviKnowledgeArticles = pgTable('ivi_knowledge_articles', {
  id: serial('id').primaryKey(),
  questionPattern: text('question_pattern').notNull(),
  answerTemplate: text('answer_template').notNull(),
  category: text('category').notNull().default('geral'),
  sourceChannel: text('source_channel').notNull().default('whatsapp'),
  hitCount: integer('hit_count').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scheduleServices = pgTable('schedule_services', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(30),
  priceCents: integer('price_cents').notNull().default(0),
  color: text('color').notNull().default('#e0e7ff'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const appointments = pgTable('appointments', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id').references(() => prospectionLeads.id),
  clientId: integer('client_id').references(() => clients.id),
  clientName: text('client_name').notNull(),
  clientPhone: text('client_phone').notNull(),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  groupId: integer('group_id').references(() => userGroups.id),
  attendantId: integer('attendant_id').references(() => users.id),
  consultantId: integer('consultant_id').references(() => users.id).notNull(),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id),
  serviceId: integer('service_id').references(() => scheduleServices.id),
  serviceName: text('service_name').notNull().default(''),
  modality: text('modality').notNull().default(''), // '' | 'presencial' | 'online' | 'telefone' | 'video'
  scheduledFor: timestamp('scheduled_for').notNull(),
  endAt: timestamp('end_at'),
  status: text('status').notNull().default('agendado'), // 'aguardando' | 'agendado' | 'confirmado' | 'cancelado_cliente' | 'cancelado_consultor' | 'nao_compareceu' | 'cumprido' | 'faltoso' | 'cancelado'
  notifiedInternal: boolean('notified_internal').notNull().default(true),
  notifiedWhatsapp: boolean('notified_whatsapp').notNull().default(true),
  notes: text('notes').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  updatedByName: text('updated_by_name').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scheduleWaitlist = pgTable('schedule_waitlist', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  serviceId: integer('service_id').references(() => scheduleServices.id).notNull(),
  preferredCollaboratorId: integer('preferred_collaborator_id').references(() => collaborators.id),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  desiredDate: text('desired_date').notNull(), // YYYY-MM-DD
  desiredTime: text('desired_time').notNull().default('08:00'),
  notes: text('notes').notNull().default(''),
  createdBy: text('created_by').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const legalProcesses = pgTable('legal_processes', {
  id: serial('id').primaryKey(),
  processNumber: text('process_number').notNull().unique(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  admissionId: integer('admission_id').references(() => admissions.id),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  courtName: text('court_name').notNull(),
  actionType: text('action_type').notNull().default('busca_apreensao'), // 'busca_apreensao' | 'revisional' | 'execucao'
  hasSearchSeizure: boolean('has_search_seizure').notNull().default(false),
  vehicleSeized: boolean('vehicle_seized').notNull().default(false),
  status: text('status').notNull().default('em_acompanhamento'), // 'em_acompanhamento' | 'alerta_movimentacao' | 'apreendido' | 'revertido' | 'suspenso' | 'cancelado'
  previousStatus: text('previous_status'),
  statusChangeReason: text('status_change_reason'),
  escavadorMonitored: boolean('escavador_monitored').notNull().default(true),
  escavadorLastActionNote: text('escavador_last_action_note'),
  escavadorUpdatedAt: timestamp('escavador_updated_at'),
  hasUnreadMovement: boolean('has_unread_movement').notNull().default(false),
  lastMovementAt: timestamp('last_movement_at').defaultNow(),
  assignedLawyerId: integer('assigned_lawyer_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const legalMovements = pgTable('legal_movements', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => legalProcesses.id).notNull(),
  source: text('source').notNull().default('escavador_webhook'), // 'escavador_webhook' | 'escavador_fallback' | 'detran_scan'
  originalDispatch: text('original_dispatch').notNull(),
  iviTranslationPtBr: text('ivi_translation_pt_br').notNull(),
  openedAt: timestamp('opened_at'),
  readCompletedAt: timestamp('read_completed_at'),
  clientContactedAt: timestamp('client_contacted_at'),
  contactChannel: text('contact_channel'), // 'telefone' | 'whatsapp' | 'email'
  contactSummary: text('contact_summary'),
  emailSent: boolean('email_sent').notNull().default(false),
  lawyerId: integer('lawyer_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export interface NegotiationContactItem {
  id: number;
  date: string;
  type: 'LIGACAO_REALIZADA' | 'LIGACAO_RECEBIDA' | 'WHATSAPP' | 'EMAIL' | 'PRESENCIAL' | 'REUNIAO' | 'OUTROS' | string;
  result: 'PROPOSTA_APRESENTADA' | 'RECUSA' | 'SEM_RESPOSTA' | 'PROMESSA_RETORNO' | 'ACORDO' | 'OUTROS' | string;
  target?: 'CLIENTE' | 'BANCO';
  bankContactId?: number | null;
  bankContactName?: string;
  description: string;
  responsible: string;
}

export interface NegotiationProposalItem {
  id: number;
  date: string;
  origin: 'NOSSA_PROPOSTA' | 'PROPOSTA_BANCO' | 'CONTRA_PROPOSTA_NOSSA' | 'CONTRA_PROPOSTA_BANCO' | string;
  proposedValue: string;
  proposedValueCents?: number;
  discountPercentage?: string;
  installments?: number;
  installmentValue?: string;
  entryValue?: string;
  status: 'AGUARDANDO' | 'ACEITA' | 'RECUSADA' | 'CONTRA_PROPOSTA' | 'EXPIRADA' | string;
  bankContactId?: number | null;
  bankContactName?: string;
  notes?: string;
}

export interface NegotiationIviAdvisorPayload {
  summaryClient: string;
  summaryBank: string;
  strategicDiagnosis: string;
  recommendedDiscountPct: number;
  recommendedTargetValueCents: number;
  recommendedInstallments: number;
  nextBestActions: string[];
  suggestedBankWhatsappDraft: string;
  suggestedClientWhatsappDraft: string;
  riskAlerts: string[];
  provider: string;
  generatedAt: string;
}

export const negotiations = pgTable('negotiations', {
  id: serial('id').primaryKey(),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  clientName: text('client_name').notNull().default(''),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  negotiatorId: integer('negotiator_id').references(() => users.id),
  collaboratorId: integer('collaborator_id'),
  collaboratorName: text('collaborator_name').notNull().default(''),
  bankId: integer('bank_id'),
  bankName: text('bank_name').notNull(),
  titleId: integer('title_id'),
  contractNumber: text('contract_number').notNull().default(''),
  openDate: text('open_date').notNull().default(''),
  originalDebtCents: bigint('original_debt_cents', { mode: 'number' }).notNull(),
  debtValueText: text('debt_value_text').notNull().default('0.00'),
  targetReductionPct: integer('target_reduction_pct').notNull().default(55),
  currentReductionPct: integer('current_reduction_pct').notNull().default(20),
  estimatedSavingsCents: bigint('estimated_savings_cents', { mode: 'number' }).notNull().default(0),
  targetDeadline: timestamp('target_deadline').notNull(),
  status: text('status').notNull().default('em_negociacao'), // legacy: 'em_negociacao' | 'proxima_meta' | 'meta_alcancada' | 'prazo_critico' | 'suspensa'
  negotiationStatus: text('negotiation_status').notNull().default('EM_ANDAMENTO'), // 'ABERTA' | 'EM_ANDAMENTO' | 'ACORDO_FECHADO' | 'ACORDO_QUEBRADO' | 'CANCELADA' | 'ENCERRADA'
  contactsJson: jsonb('contacts_json').$type<NegotiationContactItem[]>().notNull().default([]),
  proposalsJson: jsonb('proposals_json').$type<NegotiationProposalItem[]>().notNull().default([]),
  nextContactDate: text('next_contact_date'),
  nextContactDescription: text('next_contact_description'),
  notes: text('notes').notNull().default(''),
  closedDate: text('closed_date'),
  closedValueCents: bigint('closed_value_cents', { mode: 'number' }),
  closedValueText: text('closed_value_text'),
  closedInstallments: integer('closed_installments'),
  selectedBankContactId: integer('selected_bank_contact_id'),
  iviInsightsJson: jsonb('ivi_insights_json').$type<NegotiationIviAdvisorPayload | null>().default(null),
  lastMassEmailAt: timestamp('last_mass_email_at'),
  chatLogs: jsonb('chat_logs').$type<Array<{ channel: string; note: string; author: string; timestamp: string }>>().notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const paymentCategories = pgTable('payment_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  providerCode: text('provider_code').notNull().default('custom'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bearers = pgTable('bearers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().default(''),
  name: text('name').notNull(),
  type: text('type').notNull().default('banco'), // 'banco' | 'caixa' | 'cartao' | 'outro'
  associatedBankAccountId: integer('associated_bank_account_id'),
  active: boolean('active').notNull().default(true),
  unitId: integer('unit_id').references(() => units.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documentTypes = pgTable('document_types', {
  id: serial('id').primaryKey(),
  description: text('description').notNull(),
  category: text('category').notNull().default('ambos'), // 'ambos' | 'pagar' | 'receber'
  isFiscal: boolean('is_fiscal').notNull().default(false),
  requiresNumber: boolean('requires_number').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull().default('despesa'), // 'receita' | 'despesa'
  parentId: integer('parent_id'),
  isAnalytic: boolean('is_analytic').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const financialTitles = pgTable('financial_titles', {
  id: serial('id').primaryKey(),
  titleCode: text('title_code').notNull().unique(),
  scope: text('scope').notNull().default('RECEBER'), // 'RECEBER' | 'PAGAR'
  titleType: text('title_type').notNull().default('PADRAO'), // 'PADRAO' | 'ADIANTAMENTO' | 'DEVOLUCAO' | 'FATURA'
  origin: text('origin').notNull().default('AUDITORIA'), // 'MANUAL' | 'RECORRENCIA' | 'AUDITORIA' | 'IMPORTACAO' | 'FATURAMENTO'
  documentNumber: text('document_number').notNull().default(''),
  description: text('description').notNull().default(''),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  clientName: text('client_name').notNull().default(''),
  admissionId: integer('admission_id').references(() => admissions.id),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  categoryId: integer('category_id').references(() => paymentCategories.id),
  chartAccountId: integer('chart_account_id').references(() => chartOfAccounts.id, { onDelete: 'set null' }),
  documentTypeId: integer('document_type_id').references(() => documentTypes.id, { onDelete: 'set null' }),
  bearerId: integer('bearer_id').references(() => bearers.id, { onDelete: 'set null' }),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),
  sellerId: integer('seller_id'),
  assignedCollaboratorId: integer('assigned_collaborator_id'),
  installmentNumber: integer('installment_number').notNull().default(1),
  totalInstallments: integer('total_installments').notNull().default(2),
  isInitialFee: boolean('is_initial_fee').notNull().default(true),
  amountCents: integer('amount_cents').notNull(),
  originalValueCents: integer('original_value_cents').notNull().default(0),
  currentBalanceCents: integer('current_balance_cents').notNull().default(0),
  interestCents: integer('interest_cents').notNull().default(0),
  fineCents: integer('fine_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  discountValidUntil: timestamp('discount_valid_until'),
  issueDate: timestamp('issue_date').defaultNow().notNull(),
  dueDate: timestamp('due_date').notNull(),
  forecastDate: timestamp('forecast_date'),
  paidAt: timestamp('paid_at'),
  status: text('status').notNull().default('aberto'), // 'aberto'|'ABERTO'|'PARCIAL'|'pago'|'PAGO'|'vencido'|'cancelado'|'CANCELADO'|'ADIANTAMENTO'|'ADIANTAMENTO_PARCIAL'|'DEVOLUCAO'|'DEVOLUCAO_PARCIAL'|'DEVOLUCAO_VINCULADA'|'AGRUPADO'|'FATURA_GERADA'|'PROTESTADO'|'PROVISAO'
  collectionStatus: text('collection_status').notNull().default('COBRAR'), // 'EM_DIA' | 'COBRAR' | 'NAO_COBRAR'
  accountingType: text('accounting_type').notNull().default('NAO_CONTABIL'), // 'CONTABIL' | 'NAO_CONTABIL'
  boletoProvider: text('boleto_provider').notNull().default('santander'),
  barcode: text('barcode').notNull().default(''),
  ourNumber: text('our_number').notNull().default(''),
  receiptDocId: integer('receipt_doc_id').references(() => documentObjects.id),
  collectorId: integer('collector_id').references(() => users.id),
  coverSheetApproved: boolean('cover_sheet_approved').notNull().default(false),
  reguaStageSent: jsonb('regua_stage_sent').$type<string[]>().notNull().default([]),
  parentId: integer('parent_id'),
  recurrenceId: text('recurrence_id').notNull().default(''),
  invoiceGroupId: text('invoice_group_id').notNull().default(''),
  originTitleIds: jsonb('origin_title_ids').$type<number[]>().notNull().default([]),
  isProtested: boolean('is_protested').notNull().default(false),
  isProvision: boolean('is_provision').notNull().default(false),
  releaseLogJson: jsonb('release_log_json')
    .$type<Array<{ type: 'PROTEST' | 'PROVISION'; user: string; reason: string; releasedAt: string }>>()
    .notNull()
    .default([]),
  advanceLinks: jsonb('advance_links')
    .$type<Array<{ titleId: number; documentNumber: string; amountCents: number; date: string }>>()
    .notNull()
    .default([]),
  returnLinks: jsonb('return_links')
    .$type<Array<{ titleId: number; documentNumber: string; amountCents: number; date: string }>>()
    .notNull()
    .default([]),
  contractNumber: text('contract_number').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const titleSettlements = pgTable('title_settlements', {
  id: serial('id').primaryKey(),
  titleId: integer('title_id').references(() => financialTitles.id, { onDelete: 'cascade' }).notNull(),
  settlementDate: timestamp('settlement_date').notNull().defaultNow(),
  principalCents: integer('principal_cents').notNull().default(0),
  interestCents: integer('interest_cents').notNull().default(0),
  fineCents: integer('fine_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  amountCents: integer('amount_cents').notNull(),
  origin: text('origin').notNull().default('BAIXA MANUAL'), // 'BAIXA MANUAL' | 'BAIXA EM LOTE' | 'FATURA GERADA' | 'COMPENSACAO'
  paymentMethod: text('payment_method').notNull().default('Depósito / Transferência'),
  history: text('history').notNull().default(''),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),
  movementId: integer('movement_id'),
  batchUuid: text('batch_uuid').notNull().default(''),
  createdByName: text('created_by_name').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const collectionCases = pgTable('collection_cases', {
  id: serial('id').primaryKey(),
  titleId: integer('title_id').references(() => financialTitles.id).notNull(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  assignedCollectorId: integer('assigned_collector_id').references(() => users.id),
  stateCode: text('state_code').notNull().default('PE'),
  priorityValueCents: integer('priority_value_cents').notNull().default(0),
  status: text('status').notNull().default('em_cobranca'), // 'em_cobranca' | 'acordo_firmado' | 'pago' | 'suspenso' | 'cancelado'
  conversationSummary: text('conversation_summary').notNull().default(''),
  audioTranscript: text('audio_transcript').notNull().default(''),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gotalkChannels = pgTable('gotalk_channels', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phoneNumber: text('phone_number'),
  // ID técnico interno da GoTalk — nunca retornar ao frontend
  channelId: text('channel_id').unique(),
  unitId: integer('unit_id').references(() => units.id),
  notes: text('notes').notNull().default(''),
  isPrimary: boolean('is_primary').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const gotalkOperators = pgTable('gotalk_operators', {
  id: serial('id').primaryKey(),
  gotalkOperatorId: text('gotalk_operator_id').notNull().unique(),
  name: text('name'),
  email: text('email'),
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  collaboratorId: integer('collaborator_id').references(() => users.id),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const gotalkHsmTemplates = pgTable('gotalk_hsm_templates', {
  id: serial('id').primaryKey(),
  templateName: text('template_name').notNull().unique(),
  gotalkTemplateId: text('gotalk_template_id'),
  category: text('category'),
  language: text('language'),
  status: text('status'),
  bodyText: text('body_text'),
  headerText: text('header_text'),
  footerText: text('footer_text'),
  channelDbId: integer('channel_db_id').references(() => gotalkChannels.id),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

export const unitWhatsappCredentials = pgTable('unit_whatsapp_credentials', {
  id: serial('id').primaryKey(),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  label: text('label').notNull().default('Principal'),
  uazapiInstanceId: text('uazapi_instance_id').notNull().unique(),
  uazapiServerUrl: text('uazapi_server_url').notNull().default('https://centralhub.uazapi.com'),
  uazapiTokenEncrypted: text('uazapi_token_encrypted').notNull(),
  defaultPhone: text('default_phone').notNull().default(''),
  connectedPhone: text('connected_phone'),
  profileName: text('profile_name'),
  isConnected: boolean('is_connected').notNull().default(false),
  allowedGroupIds: jsonb('allowed_group_ids').$type<number[]>().notNull().default([]),
  allowedModules: jsonb('allowed_modules').$type<string[]>().notNull().default(['prospection', 'admission', 'collection']),
  assignedCollaboratorId: integer('assigned_collaborator_id'),
  isDefaultForUnit: boolean('is_default_for_unit').notNull().default(false),
  active: boolean('active').notNull().default(true),
  webhookUrl: text('webhook_url'),
  webhookRegisteredAt: timestamp('webhook_registered_at'),
  webhookLastError: text('webhook_last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const whatsappThreads = pgTable('whatsapp_threads', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id),
  bankId: integer('bank_id'),
  bankContactId: integer('bank_contact_id'),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  contactName: text('contact_name').notNull(),
  contactPhone: text('contact_phone').notNull(),
  provider: text('provider').notNull().default('gotalk'), // 'gotalk' | 'uazapi'
  gotalkContactId: text('gotalk_contact_id'),
  gotalkAttendanceId: text('gotalk_attendance_id'),
  uazapiInstanceId: text('uazapi_instance_id'),
  channelDbId: integer('channel_db_id').references(() => gotalkChannels.id),
  operatorName: text('operator_name'),
  department: text('department'),
  assignedOperatorId: integer('assigned_operator_id').references(() => users.id),
  unreadCount: integer('unread_count').notNull().default(0),
  lastMessagePreview: text('last_message_preview').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const whatsappMessages = pgTable('whatsapp_messages', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id').references(() => whatsappThreads.id).notNull(),
  externalMessageId: text('external_message_id'),
  direction: text('direction').notNull().default('inbound'), // 'inbound' | 'outbound'
  contentType: text('content_type').notNull().default('text'), // 'text' | 'audio' | 'image' | 'document'
  body: text('body').notNull(),
  mediaUrl: text('media_url'),
  attachmentUrl: text('attachment_url'),
  attachmentName: text('attachment_name'),
  attachmentMimeType: text('attachment_mime_type'),
  mediaSha256: text('media_sha256'),
  mediaStorageUri: text('media_storage_uri'),
  iviAudioTranscript: text('ivi_audio_transcript'),
  ackStatus: integer('ack_status'), // 1=server, 2=delivered, 3=read
  deletedInOrigin: boolean('deleted_in_origin').notNull().default(false),
  operatorName: text('operator_name'),
  department: text('department'),
  senderName: text('sender_name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const internalMessages = pgTable('internal_messages', {
  id: serial('id').primaryKey(),
  senderId: integer('sender_id').references(() => users.id),
  senderName: text('sender_name').notNull(),
  senderGroupId: integer('sender_group_id'),
  recipientId: integer('recipient_id').references(() => users.id),
  targetSector: text('target_sector').notNull().default('geral'),
  targetGroupId: integer('target_group_id').references(() => userGroups.id),
  targetGroupName: text('target_group_name').notNull().default(''),
  targetUnitId: integer('target_unit_id').references(() => units.id),
  targetUnitName: text('target_unit_name').notNull().default(''),
  isAutoIvi: boolean('is_auto_ivi').notNull().default(false),
  eventType: text('event_type').notNull().default('manual_message'),
  relatedEntityType: text('related_entity_type').notNull().default(''),
  relatedEntityId: text('related_entity_id').notNull().default(''),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  readByUserIds: jsonb('read_by_user_ids').$type<number[]>().notNull().default([]),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  userName: text('user_name').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  unitId: integer('unit_id').references(() => units.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const recalcScenarios = pgTable('recalc_scenarios', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  admissionId: integer('admission_id').references(() => admissions.id),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  contractRateMonthlyPct: text('contract_rate_monthly_pct').notNull().default('2.85'),
  bacenAvgRateMonthlyPct: text('bacen_avg_rate_monthly_pct').notNull().default('1.52'),
  originalInstallmentCents: integer('original_installment_cents').notNull().default(0),
  fairInstallmentCents: integer('fair_installment_cents').notNull().default(0),
  installmentsTotal: integer('installments_total').notNull().default(48),
  projectedSavingsCents: bigint('projected_savings_cents', { mode: 'number' }).notNull().default(0),
  notes: text('notes').notNull().default(''),
  createdBy: text('created_by').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scheduleBlocks = pgTable('schedule_blocks', {
  id: serial('id').primaryKey(),
  consultantId: integer('consultant_id').references(() => users.id),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  allDay: boolean('all_day').notNull().default(true),
  startTime: text('start_time').notNull().default('08:00'),
  endTime: text('end_time').notNull().default('18:00'),
  weekdays: jsonb('weekdays').$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// =============================================================================
// CADASTROS COMUNS (Alimenta Admissão & Dossiês, Prospecção, Auditoria e Financeiro)
// =============================================================================

export const rolesCatalog = pgTable('roles_catalog', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  participatesInScheduleQueue: boolean('participates_in_schedule_queue').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().default(''),
  name: text('name').notNull().unique(),
  managerName: text('manager_name').notNull().default(''),
  status: text('status').notNull().default('ATIVO'), // 'ATIVO' | 'INATIVO'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const collaborators = pgTable('collaborators', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().default(''),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  participatesInScheduleQueue: boolean('participates_in_schedule_queue').notNull().default(false),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  roleId: integer('role_id').references(() => rolesCatalog.id),
  jobTitle: text('job_title').notNull().default(''),
  departmentId: integer('department_id').references(() => departments.id),
  userId: integer('user_id').references(() => users.id),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  isWhatsapp: boolean('is_whatsapp').notNull().default(false),
  birthDate: text('birth_date').notNull().default(''),
  maritalStatus: text('marital_status').notNull().default(''),
  photoUrl: text('photo_url').notNull().default(''),
  zipCode: text('zip_code').notNull().default(''),
  address: text('address').notNull().default(''),
  addressNumber: text('address_number').notNull().default(''),
  complement: text('complement').notNull().default(''),
  neighborhood: text('neighborhood').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const febrabanBanks = pgTable('febraban_banks', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull().default(''),
  ispb: text('ispb').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const modalities = pgTable('modalities', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // ex: 'Veicular' | 'Bancário' | 'Consignado'
  description: text('description').notNull(),
  hasVehicleSection: boolean('has_vehicle_section').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const banks = pgTable('banks', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().default(''),
  name: text('name').notNull(),
  febrabanCode: text('febraban_code').notNull().default(''),
  status: text('status').notNull().default('ATIVO'), // 'ATIVO' | 'INATIVO'
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bankServices = pgTable('bank_services', {
  id: serial('id').primaryKey(),
  bankId: integer('bank_id').references(() => banks.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  modalityId: integer('modality_id').references(() => modalities.id, { onDelete: 'set null' }),
  modalityDescription: text('modality_description').notNull().default(''),
  negotiationPercent: text('negotiation_percent').notNull().default('45'),
  defaultInstallments: integer('default_installments').notNull().default(12),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bankContacts = pgTable('bank_contacts', {
  id: serial('id').primaryKey(),
  bankId: integer('bank_id').references(() => banks.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  sector: text('sector').notNull().default(''),
  phone: text('phone').notNull().default(''),
  mobile: text('mobile').notNull().default(''),
  isWhatsapp: boolean('is_whatsapp').notNull().default(false),
  email: text('email').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const measurementUnits = pgTable('measurement_units', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  conversionFactor: text('conversion_factor').notNull().default('1'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  type: text('type').notNull().default('SERVICO'), // 'SERVICO' | 'MATERIAL'
  description: text('description').notNull(),
  unitId: integer('unit_id').references(() => measurementUnits.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const seriesCatalog = pgTable('series_catalog', {
  id: serial('id').primaryKey(),
  sigla: text('sigla').notNull().unique(),
  description: text('description').notNull(),
  generalNumber: integer('general_number').notNull().default(1),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const seriesUnitNumbering = pgTable('series_unit_numbering', {
  id: serial('id').primaryKey(),
  seriesId: integer('series_id').references(() => seriesCatalog.id, { onDelete: 'cascade' }).notNull(),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'cascade' }).notNull(),
  currentNumber: integer('current_number').notNull().default(1),
});

// =============================================================================
// GOVERNANÇA CORPORATIVA: CHECKLIST DE AUDITORIA & CENTRAL DE AJUDA
// =============================================================================

export const auditChecklistItems = pgTable('audit_checklist_items', {
  id: serial('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(1),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  modalityCondition: text('modality_condition').notNull().default(''), // '' = Sempre visível
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const helpCenterTopics = pgTable('help_center_topics', {
  id: serial('id').primaryKey(),
  topicKey: text('topic_key').notNull().unique(),
  menuPath: text('menu_path').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  htmlContent: text('html_content').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const whatsappCallLogs = pgTable('whatsapp_call_logs', {
  id: serial('id').primaryKey(),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  leadId: integer('lead_id').references(() => prospectionLeads.id),
  threadId: integer('thread_id').references(() => whatsappThreads.id),
  callId: text('call_id').notNull().default(''),
  direction: text('direction').notNull().default('outbound'), // 'outbound' | 'inbound'
  fromNumber: text('from_number').notNull().default(''),
  toNumber: text('to_number').notNull(),
  callType: text('call_type').notNull().default('voice'), // 'voice' | 'video'
  status: text('status').notNull().default('initiated'), // 'initiated' | 'ringing' | 'ended' | 'failed'
  durationSeconds: integer('duration_seconds').notNull().default(0),
  provider: text('provider').notNull().default('uazapi'), // 'uazapi' | 'gotalk'
  errorDetail: text('error_detail').notNull().default(''),
  recordingSha256: text('recording_sha256').notNull().default(''),
  recordingStorageUri: text('recording_storage_uri').notNull().default(''),
  recordingMimeType: text('recording_mime_type').notNull().default(''),
  recordingFileName: text('recording_file_name').notNull().default(''),
  audioTranscript: text('audio_transcript').notNull().default(''),
  initiatedByName: text('initiated_by_name').notNull().default('Sistema'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const communicationArchives = pgTable('communication_archives', {
  id: serial('id').primaryKey(),
  unitId: integer('unit_id').references(() => units.id).notNull(),
  leadId: integer('lead_id').references(() => prospectionLeads.id),
  threadId: integer('thread_id').references(() => whatsappThreads.id),
  callLogId: integer('call_log_id').references(() => whatsappCallLogs.id),
  provider: text('provider').notNull().default('uazapi'), // 'uazapi' | 'gotalk' | 'telefone'
  archiveType: text('archive_type').notNull().default('conversation_snapshot'), // 'conversation_snapshot' | 'audio_message' | 'call_recording'
  contactName: text('contact_name').notNull().default(''),
  contactPhone: text('contact_phone').notNull().default(''),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  sha256Hash: text('sha256_hash').notNull(),
  storageUri: text('storage_uri').notNull(),
  transcriptText: text('transcript_text').notNull().default(''),
  createdByName: text('created_by_name').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  bankName: text('bank_name').notNull(),
  agency: text('agency').notNull().default(''),
  accountNumber: text('account_number').notNull().default(''),
  accountType: text('account_type').notNull().default('corrente'), // 'corrente' | 'poupanca' | 'caixa'
  initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
  currentBalanceCents: integer('current_balance_cents').notNull().default(0),
  unitId: integer('unit_id').references(() => units.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bankMovements = pgTable('bank_movements', {
  id: serial('id').primaryKey(),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id).notNull(),
  movementType: text('movement_type').notNull().default('DEBITO'), // 'CREDITO' | 'DEBITO'
  amountCents: integer('amount_cents').notNull(),
  description: text('description').notNull(),
  documentNumber: text('document_number').notNull().default(''),
  movementDate: timestamp('movement_date').notNull().defaultNow(),
  categoryId: integer('category_id').references(() => chartOfAccounts.id, { onDelete: 'set null' }),
  categoryName: text('category_name').notNull().default(''),
  origin: text('origin').notNull().default('MANUAL'), // 'BAIXA_RECEBER' | 'BAIXA_PAGAR' | 'MANUAL' | 'TARIFA' | 'TRANSFERENCIA' | 'DEPOSITO' | 'SAQUE'
  status: text('status').notNull().default('PENDENTE'), // 'CONCILIADO' | 'PENDENTE'
  reconciled: boolean('reconciled').notNull().default(false),
  reconciliationDate: text('reconciliation_date').notNull().default(''),
  compensationDate: text('compensation_date').notNull().default(''),
  titleId: integer('title_id'),
  titleSource: text('title_source').notNull().default(''), // 'RECEBER' | 'PAGAR' | ''
  transferId: text('transfer_id').notNull().default(''),
  documentTypeId: integer('document_type_id'),
  bearerId: integer('bearer_id'),
  departmentId: integer('department_id'),
  unitId: integer('unit_id').references(() => units.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// =============================================================================
// CACHE E BASE DE DECISÕES DA IVI EM AUDITORIA (Redução de custo IA & agilidade)
// =============================================================================

export const iviAuditDecisionsCache = pgTable('ivi_audit_decisions_cache', {
  id: serial('id').primaryKey(),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'cascade' }).notNull(),
  documentId: integer('document_id'),
  decisionType: text('decision_type').notNull(), // 'checklist_sweep' | 'document_insights' | 'document_inspection'
  cacheKeyHash: text('cache_key_hash').notNull(),
  verdict: text('verdict').notNull().default('CONFERIR_PONTOS'),
  inconsistenciesCount: integer('inconsistencies_count').notNull().default(0),
  attentionCount: integer('attention_count').notNull().default(0),
  summaryText: text('summary_text').notNull().default(''),
  checklistReportJson: jsonb('checklist_report_json').$type<IviChecklistVerificationItem[]>().notNull().default([]),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
  sourceEngine: text('source_engine').notNull().default('local_rules_db'),
  aiCallsSaved: integer('ai_calls_saved').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// COBRANÇA: NOTAS OPERACIONAIS E SOLICITAÇÕES DE CANCELAMENTO (Coordenação & Operacional)
// =============================================================================

export interface CollectionCancelRequestInfo {
  requestDate: string;
  admissionId?: number | null;
  admissionContract?: string;
  notes?: string;
}

export interface CollectionDebtSnapshot {
  originalCents: number;
  interestCents: number;
  fineCents: number;
  discountCents: number;
  balanceCents: number;
}

export interface CollectionNoteAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  documentId?: number | null;
  storageUri?: string;
  dataUrl?: string;
}

export const collectionNotes = pgTable('collection_notes', {
  id: serial('id').primaryKey(),
  titleId: integer('title_id').references(() => financialTitles.id, { onDelete: 'set null' }),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id),
  collaboratorName: text('collaborator_name').notNull().default(''),
  userId: integer('user_id').references(() => users.id),
  unitId: integer('unit_id').references(() => units.id),
  contactDate: text('contact_date').notNull().default(''),
  contactTime: text('contact_time').notNull().default('00:00'),
  channel: text('channel').notNull().default('TELEFONE'),
  negotiationStatus: text('negotiation_status').notNull().default('AGUARDANDO_CONTATO'),
  otherStatusDetail: text('other_status_detail').notNull().default(''),
  nextContactDate: text('next_contact_date').notNull().default(''),
  note: text('note').notNull(),
  debtSnapshotJson: jsonb('debt_snapshot_json').$type<CollectionDebtSnapshot | null>().default(null),
  attachmentsJson: jsonb('attachments_json').$type<CollectionNoteAttachment[]>().notNull().default([]),
  cancelRequest: jsonb('cancel_request').$type<CollectionCancelRequestInfo | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// COBRANÇA: RELATÓRIOS & PLANILHAS SALVAS DA IVI NO DASHBOARD
// =============================================================================

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

export const collectionReports = pgTable('collection_reports', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  reportType: text('report_type').notNull().default('custom_ivi'), // 'carteira_vencida' | 'ranking_operadores' | 'recebimentos' | 'inadimplencia_uf' | 'custom_ivi'
  prompt: text('prompt').notNull().default(''),
  executiveSummary: text('executive_summary').notNull().default(''),
  insightsJson: jsonb('insights_json').$type<string[]>().notNull().default([]),
  columnsJson: jsonb('columns_json').$type<CollectionReportColumn[]>().notNull().default([]),
  rowsJson: jsonb('rows_json').$type<Array<Record<string, string | number>>>().notNull().default([]),
  chartSeriesJson: jsonb('chart_series_json').$type<CollectionReportChartPoint[]>().notNull().default([]),
  provider: text('provider').notNull().default('gemini'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdByName: text('created_by_name').notNull().default('Sistema'),
  unitId: integer('unit_id').references(() => units.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// =============================================================================
// COBRANÇA -> COORDENAÇÃO: ORGANIZAÇÃO DE TAREFAS & COMPARTILHAMENTO
// =============================================================================

export interface TaskTimerPauseEntry {
  startedAt: string;
  pausedAt: string;
  durationSeconds: number;
  reason: string;
  userName: string;
}

export const coordinatorTaskColumns = pgTable('coordinator_task_columns', {
  id: serial('id').primaryKey(),
  ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  color: text('color').notNull().default('#64748b'),
  isFinal: boolean('is_final').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const coordinatorTasks = pgTable('coordinator_tasks', {
  id: serial('id').primaryKey(),
  ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ownerName: text('owner_name').notNull().default(''),
  unitId: integer('unit_id').references(() => units.id),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
  clientName: text('client_name').notNull().default(''),
  titleId: integer('title_id').references(() => financialTitles.id, { onDelete: 'set null' }),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id, { onDelete: 'set null' }),
  collaboratorName: text('collaborator_name').notNull().default(''),
  projectLabel: text('project_label').notNull().default(''),
  originType: text('origin_type').notNull().default('direta'), // 'direta' | 'nota_rapida' | 'cobranca'
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  solutionNotes: text('solution_notes').notNull().default(''),
  occurrenceNotes: text('occurrence_notes').notNull().default(''),
  blockingReason: text('blocking_reason').notNull().default(''),
  priority: text('priority').notNull().default('media'), // 'alta' | 'media' | 'baixa'
  criticality: text('criticality').notNull().default('medio'), // 'baixo' | 'medio' | 'alto' | 'critico' | 'emergencial'
  statusColumnId: integer('status_column_id').references(() => coordinatorTaskColumns.id, { onDelete: 'set null' }),
  statusKey: text('status_key').notNull().default('PENDENTE'), // 'PENDENTE' | 'EM_EXECUCAO' | 'CONCLUIDO' | custom
  statusLabel: text('status_label').notNull().default('Pendente'),
  isCompleted: boolean('is_completed').notNull().default(false),
  dueAt: timestamp('due_at'),
  estimatedMinutes: integer('estimated_minutes'),
  timerRunningSince: timestamp('timer_running_since'),
  timerAccumulatedSeconds: integer('timer_accumulated_seconds').notNull().default(0),
  timerPauseLogsJson: jsonb('timer_pause_logs_json').$type<TaskTimerPauseEntry[]>().notNull().default([]),
  iviReviewNote: text('ivi_review_note').notNull().default(''),
  completedAt: timestamp('completed_at'),
  completedByName: text('completed_by_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const coordinatorTaskSubtasks = pgTable('coordinator_task_subtasks', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').references(() => coordinatorTasks.id, { onDelete: 'cascade' }).notNull(),
  sortOrder: integer('sort_order').notNull().default(1),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  solutionNotes: text('solution_notes').notNull().default(''),
  priority: text('priority').notNull().default('media'), // 'alta' | 'media' | 'baixa'
  criticality: text('criticality').notNull().default('medio'),
  assignedCollaboratorId: integer('assigned_collaborator_id').references(() => collaborators.id, { onDelete: 'set null' }),
  assignedCollaboratorName: text('assigned_collaborator_name').notNull().default(''),
  dueAt: timestamp('due_at'),
  estimatedMinutes: integer('estimated_minutes'),
  requiresPredecessor: boolean('requires_predecessor').notNull().default(false),
  status: text('status').notNull().default('PENDENTE'), // 'PENDENTE' | 'CONCLUIDO'
  timerRunningSince: timestamp('timer_running_since'),
  timerAccumulatedSeconds: integer('timer_accumulated_seconds').notNull().default(0),
  timerPauseLogsJson: jsonb('timer_pause_logs_json').$type<TaskTimerPauseEntry[]>().notNull().default([]),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const coordinatorTaskShares = pgTable('coordinator_task_shares', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').references(() => coordinatorTasks.id, { onDelete: 'cascade' }).notNull(),
  ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sharedWithUserId: integer('shared_with_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sharedWithName: text('shared_with_name').notNull(),
  sharedByName: text('shared_by_name').notNull().default(''),
  permission: text('permission').notNull().default('edit'), // 'edit' | 'view'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const coordinatorTaskAttachments = pgTable('coordinator_task_attachments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').references(() => coordinatorTasks.id, { onDelete: 'cascade' }).notNull(),
  subtaskId: integer('subtask_id').references(() => coordinatorTaskSubtasks.id, { onDelete: 'cascade' }),
  documentObjectId: integer('document_object_id').references(() => documentObjects.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('local_bucket'), // 'local_bucket' | 'external_link'
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  externalUrl: text('external_url').notNull().default(''),
  addedByName: text('added_by_name').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const negotiationGoals = pgTable('negotiation_goals', {
  id: serial('id').primaryKey(),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id, { onDelete: 'cascade' }),
  collaboratorName: text('collaborator_name').notNull().default('Geral'),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  targetCount: integer('target_count').notNull().default(10),
  targetSavingsCents: bigint('target_savings_cents', { mode: 'number' }).notNull().default(5000000),
  targetValue: text('target_value').notNull().default('50000.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const commercialDeals = pgTable('commercial_deals', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  clientName: text('client_name').notNull().default(''),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  titleId: integer('title_id').references(() => financialTitles.id, { onDelete: 'set null' }),
  bankId: integer('bank_id').references(() => banks.id, { onDelete: 'set null' }),
  bankName: text('bank_name').notNull().default(''),
  collaboratorId: integer('collaborator_id').references(() => collaborators.id, { onDelete: 'set null' }),
  collaboratorName: text('collaborator_name').notNull().default(''),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  stage: text('stage').notNull().default('TRIAGEM'), // 'TRIAGEM' | 'PROPOSTA' | 'AGUARDANDO_BANCO' | 'FECHADO' | 'PERDIDO'
  debtValueCents: bigint('debt_value_cents', { mode: 'number' }).notNull().default(0),
  debtValue: text('debt_value').notNull().default('0.00'),
  proposedValueCents: bigint('proposed_value_cents', { mode: 'number' }),
  proposedValue: text('proposed_value'),
  discountPercentage: text('discount_percentage'),
  lossReason: text('loss_reason'),
  notes: text('notes').notNull().default(''),
  convertedNegotiationId: integer('converted_negotiation_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// ANÁLISES & CONSULTAS: FORMULÁRIOS DINÂMICOS & RESPOSTAS COM IVI IA
// =============================================================================

export interface CustomFormField {
  id: string;
  key: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'currency'
    | 'date'
    | 'select'
    | 'radio'
    | 'checkbox_group'
    | 'boolean'
    | 'rating'
    | 'cpf_cnpj'
    | 'phone'
    | 'email'
    | 'file_note'
    | 'section_header';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  width?: 'full' | 'half';
  conditionalFieldId?: string;
  conditionalEquals?: string;
  maxRating?: number;
  weight?: number;
}

export interface CustomFormSettings {
  submitLabel?: string;
  successMessage?: string;
  autoScoreEnabled?: boolean;
  iviAutoAnalyze?: boolean;
  requireClientLink?: boolean;
  requiresReview?: boolean;
}

export const customForms = pgTable('custom_forms', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('operacional'), // 'operacional' | 'triagem' | 'auditoria' | 'negociacao' | 'juridico' | 'cobranca' | 'atendimento' | 'nps'
  status: text('status').notNull().default('rascunho'), // 'rascunho' | 'publicado' | 'arquivado'
  linkedEntity: text('linked_entity').notNull().default('geral'), // 'geral' | 'cliente' | 'admissao' | 'negociacao' | 'processo' | 'cobranca'
  isTemplate: boolean('is_template').notNull().default(false),
  publicSlug: text('public_slug').unique(),
  allowAnonymous: boolean('allow_anonymous').notNull().default(false),
  fieldsJson: jsonb('fields_json').$type<CustomFormField[]>().notNull().default([]),
  settingsJson: jsonb('settings_json').$type<CustomFormSettings>().notNull().default({}),
  iviPromptOrigin: text('ivi_prompt_origin').notNull().default(''),
  version: integer('version').notNull().default(1),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default('Sistema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const customFormSubmissions = pgTable('custom_form_submissions', {
  id: serial('id').primaryKey(),
  formId: integer('form_id').references(() => customForms.id, { onDelete: 'cascade' }).notNull(),
  protocolCode: text('protocol_code').notNull().unique(),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
  clientName: text('client_name').notNull().default(''),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  negotiationId: integer('negotiation_id').references(() => negotiations.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('recebido'), // 'recebido' | 'em_analise' | 'aprovado' | 'pendente_ajuste' | 'arquivado'
  answersJson: jsonb('answers_json').$type<Record<string, unknown>>().notNull().default({}),
  calculatedScore: integer('calculated_score'),
  iviSummary: text('ivi_summary').notNull().default(''),
  iviClassification: text('ivi_classification').notNull().default(''),
  submittedByUserId: integer('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  submittedByName: text('submitted_by_name').notNull().default('Operador'),
  sourceChannel: text('source_channel').notNull().default('interno'), // 'interno' | 'link_publico' | 'whatsapp'
  reviewedByName: text('reviewed_by_name').notNull().default(''),
  reviewedNotes: text('reviewed_notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =============================================================================
// ANÁLISES & CONSULTAS -> FORMULÁRIOS: MODELOS DE DOCUMENTOS A4 (form_templates)
// =============================================================================

export const formTemplates = pgTable('form_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  content: text('content').default(''),
  header: text('header').default(''),
  footer: text('footer').default(''),
  menuIds: jsonb('menu_ids').$type<string[]>().notNull().default([]),
  docxTemplate: text('docx_template'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// =============================================================================
// ANÁLISES & CONSULTAS -> RELATÓRIOS GERAIS (report_templates)
// =============================================================================

export const reportTemplates = pgTable('report_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  category: varchar('category', { length: 100 }).notNull().default('Outros'),
  targetLayout: varchar('target_layout', { length: 20 }).notNull().default('responsive'),
  contentMode: varchar('content_mode', { length: 20 }).notNull().default('both'),
  sqlQuery: text('sql_query').notNull(),
  layout: jsonb('layout').$type<Record<string, any>>().notNull().default({}),
  filters: jsonb('filters').$type<any[]>().notNull().default([]),
  subreports: jsonb('subreports').$type<any[]>().notNull().default([]),
  charts: jsonb('charts').$type<any[]>().notNull().default([]),
  allowedUsers: integer('allowed_users').array(),
  allowedGroups: integer('allowed_groups').array(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

// =============================================================================
// GOVERNANÇA -> ACOMPANHAMENTO JURÍDICO (Processos Judiciais da Empresa)
// =============================================================================

export const companyLegalProcesses = pgTable('company_legal_processes', {
  id: serial('id').primaryKey(),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  processNumber: text('process_number').notNull(),
  court: text('court').notNull().default(''),
  jurisdiction: text('jurisdiction').notNull().default(''),
  type: text('type').notNull().default('CÍVEL'), // 'TRABALHISTA' | 'CÍVEL' | 'TRIBUTÁRIO' | 'CONSUMIDOR' | 'CRIMINAL' | 'ADMINISTRATIVO' | 'OUTRO'
  role: text('role').notNull().default('RÉU'), // 'AUTOR' | 'RÉU' | 'TERCEIRO'
  opposingParty: text('opposing_party').notNull().default(''),
  opposingPartyDocument: text('opposing_party_document').notNull().default(''),
  opposingPartyLawyer: text('opposing_party_lawyer').notNull().default(''),
  opposingPartyLawyerOab: text('opposing_party_lawyer_oab').notNull().default(''),
  partnerId: integer('partner_id').references(() => clients.id, { onDelete: 'set null' }),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  clientName: text('client_name').notNull().default(''),
  contractNumber: text('contract_number').notNull().default(''),
  responsibleLawyer: text('responsible_lawyer').notNull().default(''),
  responsibleLawyerOab: text('responsible_lawyer_oab').notNull().default(''),
  status: text('status').notNull().default('ATIVO'), // 'ATIVO' | 'SUSPENSO' | 'ARQUIVADO' | 'ENCERRADO_PROCEDENTE' | 'ENCERRADO_IMPROCEDENTE' | 'ACORDO'
  subject: text('subject').notNull().default(''),
  causeValue: text('cause_value').notNull().default(''),
  provisionValue: text('provision_value').notNull().default(''),
  riskLevel: text('risk_level').notNull().default('MEDIO'), // 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO'
  distributionDate: text('distribution_date').notNull().default(''),
  lastMovementDate: text('last_movement_date').notNull().default(''),
  notes: text('notes').notNull().default(''),
  notesHeader: text('notes_header').notNull().default(''),
  notesFooter: text('notes_footer').notNull().default(''),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const companyLegalProcessMovements = pgTable('company_legal_process_movements', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => companyLegalProcesses.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull().default(''),
  type: text('type').notNull().default('DESPACHO'), // 'DESPACHO' | 'DECISAO' | 'PETICAO' | 'CERTIDAO' | 'SENTENCA' | 'AUDIENCIA'
  description: text('description').notNull().default(''),
  source: text('source').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const companyLegalProcessDeadlines = pgTable('company_legal_process_deadlines', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => companyLegalProcesses.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull().default('CONTESTAÇÃO'), // 'CONTESTAÇÃO' | 'RECURSO' | 'MANIFESTAÇÃO' | 'CUMPRIMENTO' | 'AUDIÊNCIA' | 'OUTRO'
  description: text('description').notNull().default(''),
  dueDate: text('due_date').notNull().default(''),
  status: text('status').notNull().default('PENDENTE'), // 'PENDENTE' | 'CUMPRIDO' | 'VENCIDO'
  responsibleId: integer('responsible_id').references(() => collaborators.id, { onDelete: 'set null' }),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const companyLegalProcessHearings = pgTable('company_legal_process_hearings', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => companyLegalProcesses.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull().default('INICIAL'), // 'INICIAL' | 'INSTRUÇÃO' | 'JULGAMENTO' | 'CONCILIAÇÃO' | 'OUTRO'
  date: text('date').notNull().default(''),
  time: text('time').notNull().default(''),
  location: text('location').notNull().default(''),
  status: text('status').notNull().default('AGENDADA'), // 'AGENDADA' | 'REALIZADA' | 'ADIADA' | 'CANCELADA'
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const companyLegalProcessAttachments = pgTable('company_legal_process_attachments', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => companyLegalProcesses.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull().default(''),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  sha256Hash: text('sha256_hash').notNull().default(''),
  storageUri: text('storage_uri').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// =============================================================================
// GOVERNANÇA -> MIGRAÇÃO 64 GB (CLOUDFLARE R2) & CÓDIGO SEGURO INTEGRATIVO
// =============================================================================

export const vaultMigrationBatches = pgTable('vault_migration_batches', {
  id: serial('id').primaryKey(),
  batchCode: text('batch_code').notNull().unique(),
  title: text('title').notNull().default('Ingestão Base Local (64 GB)'),
  sourceRootPath: text('source_root_path').notNull().default(''),
  syncMode: text('sync_mode').notNull().default('incremental'), // 'incremental' | 'mirror_review'
  status: text('status').notNull().default('aguardando_agente'), // 'aguardando_agente' | 'em_andamento' | 'pausado' | 'concluido' | 'concluido_com_pendencias' | 'cancelado'
  agentSessionTokenHash: text('agent_session_token_hash').notNull().default(''),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  targetUnitIds: jsonb('target_unit_ids').$type<number[]>().notNull().default([]),
  totalFilesScanned: integer('total_files_scanned').notNull().default(0),
  totalBytesScanned: bigint('total_bytes_scanned', { mode: 'number' }).notNull().default(0),
  createdCount: integer('created_count').notNull().default(0),
  updatedContentCount: integer('updated_content_count').notNull().default(0),
  updatedPathCount: integer('updated_path_count').notNull().default(0),
  deduplicatedCount: integer('deduplicated_count').notNull().default(0),
  unmatchedCount: integer('unmatched_count').notNull().default(0),
  blockedCount: integer('blocked_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  uploadedBytes: bigint('uploaded_bytes', { mode: 'number' }).notNull().default(0),
  savedBytesByDedup: bigint('saved_bytes_by_dedup', { mode: 'number' }).notNull().default(0),
  integrativeSealedAt: timestamp('integrative_sealed_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default('Administrador'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vaultMigrationItems = pgTable('vault_migration_items', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').references(() => vaultMigrationBatches.id, { onDelete: 'cascade' }).notNull(),
  unitFolderName: text('unit_folder_name').notNull().default(''),
  extractedUnitCode: text('extracted_unit_code').notNull().default(''),
  unitId: integer('unit_id').references(() => units.id, { onDelete: 'set null' }),
  contractFolderName: text('contract_folder_name').notNull().default(''),
  extractedContractNumber: text('extracted_contract_number').notNull().default(''),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'set null' }),
  admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  documentObjectId: integer('document_object_id').references(() => documentObjects.id, { onDelete: 'set null' }),
  relativeSubpath: text('relative_subpath').notNull(),
  fileName: text('file_name').notNull(),
  legacySourcePath: text('legacy_source_path').notNull().default(''),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  sha256Hash: text('sha256_hash').notNull().default(''),
  storageUri: text('storage_uri').notNull().default(''),
  action: text('action').notNull().default('pending'), // 'create' | 'update_content' | 'update_path' | 'unchanged' | 'unmatched_unit' | 'unmatched_contract' | 'blocked_ext' | 'error'
  status: text('status').notNull().default('pending'), // 'pending' | 'awaiting_upload' | 'completed' | 'unmatched' | 'blocked' | 'failed'
  errorMessage: text('error_message').notNull().default(''),
  integrativeCode: text('integrative_code').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// =============================================================================
// GOVERNANÇA -> BACKUP & RESTORE EM NUVEM (GOOGLE DRIVE) & AGENDAMENTO AUTOMÁTICO
// =============================================================================

export const backupSchedules = pgTable('backup_schedules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  cloudProvider: text('cloud_provider').notNull().default('google_drive'), // 'google_drive' | 'server_snapshot'
  targetFolderId: text('target_folder_id').notNull().default(''),
  targetFolderName: text('target_folder_name').notNull().default('FinancePro_Backups'),
  daysOfWeek: jsonb('days_of_week').$type<number[]>().notNull().default([1, 2, 3, 4, 5]), // 0=Dom .. 6=Sáb
  executionTime: text('execution_time').notNull().default('02:00'), // HH:MM (America/Sao_Paulo)
  includeUsersAndGroups: boolean('include_users_and_groups').notNull().default(true),
  includeAuditLogs: boolean('include_audit_logs').notNull().default(true),
  compressGzip: boolean('compress_gzip').notNull().default(true),
  retentionCount: integer('retention_count').notNull().default(10),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: text('last_run_status').notNull().default('pendente'), // 'pendente' | 'executando' | 'sucesso' | 'erro'
  lastRunMessage: text('last_run_message').notNull().default(''),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default('Administrador'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const backupExecutions = pgTable('backup_executions', {
  id: serial('id').primaryKey(),
  scheduleId: integer('schedule_id').references(() => backupSchedules.id, { onDelete: 'set null' }),
  operationType: text('operation_type').notNull().default('backup'), // 'backup' | 'restore'
  triggerType: text('trigger_type').notNull().default('manual'), // 'manual' | 'agendado'
  cloudProvider: text('cloud_provider').notNull().default('google_drive'), // 'google_drive' | 'local_download' | 'server_snapshot'
  fileName: text('file_name').notNull(),
  driveFileId: text('drive_file_id').notNull().default(''),
  driveFolderId: text('drive_folder_id').notNull().default(''),
  driveWebViewLink: text('drive_web_view_link').notNull().default(''),
  localVaultSha256: text('local_vault_sha256').notNull().default(''),
  localVaultUri: text('local_vault_uri').notNull().default(''),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  sha256Hash: text('sha256_hash').notNull().default(''),
  totalTables: integer('total_tables').notNull().default(0),
  totalRows: integer('total_rows').notNull().default(0),
  usersCount: integer('users_count').notNull().default(0),
  userGroupsCount: integer('user_groups_count').notNull().default(0),
  includesUsersAndGroups: boolean('includes_users_and_groups').notNull().default(true),
  tablesSummaryJson: jsonb('tables_summary_json').$type<Record<string, number>>().notNull().default({}),
  status: text('status').notNull().default('concluido'), // 'em_andamento' | 'concluido' | 'erro'
  driveSyncStatus: text('drive_sync_status').notNull().default('sincronizado'), // 'sincronizado' | 'pendente_sync' | 'nao_aplicavel' | 'erro'
  errorMessage: text('error_message').notNull().default(''),
  executedByUserId: integer('executed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  executedByName: text('executed_by_name').notNull().default('Sistema'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
