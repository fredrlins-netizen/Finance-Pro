export interface AuditFieldChange {
  field: string;
  label: string;
  previousLabel: string;
  newLabel: string;
  previousValue: string;
  newValue: string;
  from: string;
  to: string;
}

export interface NormalizedAuditLog {
  id: number;
  userId: number | null;
  userName: string;
  action: string;
  entityType: string;
  entityLabel: string;
  entityId: string;
  unitId: number | null;
  createdAt: string;
  changes: AuditFieldChange[];
  summaryText: string;
  rawDetails: Record<string, unknown> | null;
}

const SENSITIVE_FIELD_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'temppassword',
  'temp_password',
  'newpassword',
  'uazapitokenencrypted',
  'uazapi_token_encrypted',
  'agentsessiontokenhash',
  'agent_session_token_hash',
  'captchatoken',
  'secret',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'clientsecretencrypted',
  'client_secret_encrypted',
  'pfxbase64',
  'pfxbase64encrypted',
  'pfx_base64_encrypted',
  'pfxpassword',
  'pfxpasswordencrypted',
  'pfx_password_encrypted',
  'certpemencrypted',
  'cert_pem_encrypted',
  'keypemencrypted',
  'key_pem_encrypted',
]);

export const ENTITY_LABELS_PT: Record<string, string> = {
  user: 'Usuários & Acessos',
  users: 'Usuários & Acessos',
  user_group: 'Grupos RBAC',
  user_groups: 'Grupos RBAC',
  work_schedule: 'Quadro de Horários',
  work_schedules: 'Quadro de Horários',
  unit: 'Unidades',
  units: 'Unidades',
  client: 'Clientes',
  clients: 'Clientes',
  client_asset_link: 'Vínculos de Bens do Cliente',
  client_asset_links: 'Vínculos de Bens do Cliente',
  admission: 'Admissões / Contratos',
  admissions: 'Admissões / Contratos',
  document_object: 'Documentos do Dossiê',
  document_objects: 'Documentos do Dossiê',
  prospection_lead: 'Prospecção / Leads',
  prospection_leads: 'Prospecção / Leads',
  appointment: 'Agendamentos',
  appointments: 'Agendamentos',
  schedule_block: 'Bloqueios de Agenda',
  schedule_blocks: 'Bloqueios de Agenda',
  schedule_service: 'Serviços de Agenda',
  schedule_services: 'Serviços de Agenda',
  schedule_waitlist: 'Lista de Espera',
  legal_process: 'Jurídico & Escavador',
  legal_processes: 'Jurídico & Escavador',
  legal_movement: 'Movimentações Jurídicas',
  legal_movements: 'Movimentações Jurídicas',
  negotiation: 'Negociações Bancárias',
  negotiations: 'Negociações Bancárias',
  negotiation_goal: 'Metas de Negociação',
  negotiation_goals: 'Metas de Negociação',
  commercial_deal: 'Pipeline Comercial',
  commercial_deals: 'Pipeline Comercial',
  financial_title: 'Títulos Financeiros',
  financial_titles: 'Títulos Financeiros',
  CONTA_RECEBER: 'Contas a Receber',
  CONTA_PAGAR: 'Contas a Pagar',
  title_settlement: 'Baixas de Títulos',
  title_settlements: 'Baixas de Títulos',
  bank_account: 'Contas Correntes',
  bank_accounts: 'Contas Correntes',
  bank_account_api_config: 'Configuração API Bancária',
  bank_account_api_configs: 'Configuração API Bancária',
  bank_movement: 'Movimentação Bancária',
  bank_movements: 'Movimentação Bancária',
  collection_case: 'Casos de Cobrança',
  collection_cases: 'Casos de Cobrança',
  collection_note: 'Ocorrências de Cobrança',
  collection_notes: 'Ocorrências de Cobrança',
  collection_report: 'Relatórios de Cobrança',
  collection_reports: 'Relatórios de Cobrança',
  coordinator_task: 'Tarefas de Coordenação',
  coordinator_tasks: 'Tarefas de Coordenação',
  coordinator_task_subtask: 'Subtarefas de Coordenação',
  coordinator_task_subtasks: 'Subtarefas de Coordenação',
  coordinator_task_column: 'Colunas de Tarefas',
  coordinator_task_columns: 'Colunas de Tarefas',
  custom_form: 'Formulários',
  custom_forms: 'Formulários',
  custom_form_submission: 'Respostas de Formulários',
  custom_form_submissions: 'Respostas de Formulários',
  form_template: 'Modelos de Formulário',
  form_templates: 'Modelos de Formulário',
  report_template: 'Relatórios Gerais',
  report_templates: 'Relatórios Gerais',
  company_legal_process: 'Acompanhamento Jurídico',
  company_legal_processes: 'Acompanhamento Jurídico',
  company_legal_process_movement: 'Andamentos Acomp. Jurídico',
  company_legal_process_movements: 'Andamentos Acomp. Jurídico',
  company_legal_process_deadline: 'Prazos Acomp. Jurídico',
  company_legal_process_deadlines: 'Prazos Acomp. Jurídico',
  company_legal_process_hearing: 'Audiências Acomp. Jurídico',
  company_legal_process_hearings: 'Audiências Acomp. Jurídico',
  custom_field: 'Campos Dinâmicos',
  custom_fields: 'Campos Dinâmicos',
  payment_category: 'Categorias de Pagamento',
  payment_categories: 'Categorias de Pagamento',
  system_setting: 'Configurações do Sistema',
  system_settings: 'Configurações do Sistema',
  audit_checklist_item: 'Checklist de Auditoria',
  audit_checklist_items: 'Checklist de Auditoria',
  help_center_topic: 'Central de Ajuda',
  help_center_topics: 'Central de Ajuda',
  role_catalog: 'Cargos',
  roles_catalog: 'Cargos',
  department: 'Departamentos',
  departments: 'Departamentos',
  collaborator: 'Colaboradores',
  collaborators: 'Colaboradores',
  bank: 'Bancos',
  banks: 'Bancos',
  modality: 'Modalidades',
  modalities: 'Modalidades',
  product: 'Produtos',
  products: 'Produtos',
  series_catalog: 'Séries / Numeração',
  measurement_unit: 'Unidades de Medida',
  measurement_units: 'Unidades de Medida',
  document_type: 'Tipos de Documento',
  document_types: 'Tipos de Documento',
  bearer: 'Portadores',
  bearers: 'Portadores',
  chart_of_account: 'Plano de Contas',
  chart_of_accounts: 'Plano de Contas',
  whatsapp_thread: 'Atendimentos WhatsApp',
  whatsapp_threads: 'Atendimentos WhatsApp',
  whatsapp_message: 'Mensagens WhatsApp',
  whatsapp_messages: 'Mensagens WhatsApp',
  internal_message: 'Mensagens Internas',
  internal_messages: 'Mensagens Internas',
  recalc_scenario: 'Simulações Recálculo',
  recalc_scenarios: 'Simulações Recálculo',
  vault_migration_batch: 'Migração Cofre R2',
  vault_migration_batches: 'Migração Cofre R2',
  vault_migration_item: 'Itens Migração Cofre R2',
  vault_migration_items: 'Itens Migração Cofre R2',
  backup_schedule: 'Agendamentos de Backup',
  backup_schedules: 'Agendamentos de Backup',
  backup_execution: 'Execuções de Backup & Restore',
  backup_executions: 'Execuções de Backup & Restore',
  uazapi_instance: 'WhatsApp UaZapi',
  unit_whatsapp_credentials: 'WhatsApp UaZapi',
  gotalk_channel: 'Canais GoTalk',
  gotalk_channels: 'Canais GoTalk',
  gotalk_operator: 'Operadores GoTalk',
  gotalk_operators: 'Operadores GoTalk',
  gotalk_hsm_template: 'Templates HSM GoTalk',
  gotalk_hsm_templates: 'Templates HSM GoTalk',
  audit_checklist: 'Checklist de Auditoria',
  config: 'Configurações do Sistema',
  whatsapp_call_log: 'Ligações WhatsApp',
  whatsapp_call_logs: 'Ligações WhatsApp',
  communication_archive: 'Arquivo de Comunicações',
  communication_archives: 'Arquivo de Comunicações',
  supplier: 'Fornecedores',
  suppliers: 'Fornecedores',
  all: 'Todas as Rotinas',
};

export const FIELD_LABELS_PT: Record<string, string> = {
  id: 'ID',
  uid: 'UID',
  code: 'Código',
  name: 'Nome',
  full_name: 'Nome Completo',
  fullName: 'Nome Completo',
  legal_name: 'Razão Social',
  legalName: 'Razão Social',
  email: 'E-mail',
  role: 'Perfil Funcional',
  group_id: 'Grupo RBAC',
  groupId: 'Grupo RBAC',
  default_unit_id: 'Unidade Padrão',
  defaultUnitId: 'Unidade Padrão',
  allowed_unit_ids: 'Unidades Autorizadas',
  allowedUnitIds: 'Unidades Autorizadas',
  unit_id: 'Unidade',
  unitId: 'Unidade',
  whatsapp_phone: 'WhatsApp',
  whatsappPhone: 'WhatsApp',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  secondary_phone: 'Telefone Secundário',
  secondaryPhone: 'Telefone Secundário',
  active: 'Status Ativo',
  suspended: 'Usuário Suspenso',
  suspended_reason: 'Motivo da Suspensão',
  suspendedReason: 'Motivo da Suspensão',
  suspended_at: 'Data/Hora da Suspensão',
  suspendedAt: 'Data/Hora da Suspensão',
  suspended_by: 'Autor da Suspensão / Liberação',
  suspendedBy: 'Autor da Suspensão / Liberação',
  failed_login_attempts: 'Tentativas de Login Falhas',
  failedLoginAttempts: 'Tentativas de Login Falhas',
  locked_until: 'Bloqueio Temporário Até',
  lockedUntil: 'Bloqueio Temporário Até',
  must_change_password: 'Exigir Troca de Senha',
  mustChangePassword: 'Exigir Troca de Senha',
  session_version: 'Versão da Sessão',
  sessionVersion: 'Versão da Sessão',
  points: 'Pontuação',
  target_type: 'Escopo do Horário',
  targetType: 'Escopo do Horário',
  target_id: 'ID do Alvo',
  targetId: 'ID do Alvo',
  target_label: 'Descrição / Turno',
  targetLabel: 'Descrição / Turno',
  start_time: 'Horário Inicial',
  startTime: 'Horário Inicial',
  end_time: 'Horário Final',
  endTime: 'Horário Final',
  allowed_days: 'Dias Permitidos',
  allowedDays: 'Dias Permitidos',
  closing_warning_message: 'Aviso de Encerramento (-15 min)',
  closingWarningMessage: 'Aviso de Encerramento (-15 min)',
  cpf_cnpj: 'CPF / CNPJ',
  cpfCnpj: 'CPF / CNPJ',
  rg: 'RG',
  birth_date: 'Data de Nascimento',
  birthDate: 'Data de Nascimento',
  profession: 'Profissão',
  marital_status: 'Estado Civil',
  maritalStatus: 'Estado Civil',
  address: 'Endereço',
  address_number: 'Número',
  addressNumber: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'UF',
  zip_code: 'CEP',
  zipCode: 'CEP',
  notes: 'Observações',
  client_type: 'Tipo de Cliente',
  clientType: 'Tipo de Cliente',
  status: 'Status',
  suspension_reason: 'Motivo da Suspensão',
  suspensionReason: 'Motivo da Suspensão',
  cancelled_reason: 'Motivo do Cancelamento',
  cancelledReason: 'Motivo do Cancelamento',
  protocol_code: 'Protocolo',
  protocolCode: 'Protocolo',
  contract_number: 'Nº do Contrato',
  contractNumber: 'Nº do Contrato',
  bank_name: 'Banco',
  bankName: 'Banco',
  modality: 'Modalidade',
  series: 'Série',
  debt_amount_cents: 'Valor da Dívida (centavos)',
  debtAmountCents: 'Valor da Dívida (centavos)',
  service_fee_cents: 'Honorários (centavos)',
  serviceFeeCents: 'Honorários (centavos)',
  amount_cents: 'Valor (centavos)',
  amountCents: 'Valor (centavos)',
  current_balance_cents: 'Saldo Atual (centavos)',
  currentBalanceCents: 'Saldo Atual (centavos)',
  due_date: 'Data de Vencimento',
  dueDate: 'Data de Vencimento',
  paid_at: 'Data de Pagamento',
  paidAt: 'Data de Pagamento',
  description: 'Descrição',
  title: 'Título',
  stage: 'Etapa',
  channel: 'Canal',
  process_number: 'Nº do Processo',
  processNumber: 'Nº do Processo',
  court_name: 'Comarca / Vara',
  courtName: 'Comarca / Vara',
  action_type: 'Tipo de Ação',
  actionType: 'Tipo de Ação',
  has_search_seizure: 'Risco Busca e Apreensão',
  hasSearchSeizure: 'Risco Busca e Apreensão',
  vehicle_seized: 'Veículo Apreendido',
  vehicleSeized: 'Veículo Apreendido',
  negotiation_status: 'Status da Negociação',
  negotiationStatus: 'Status da Negociação',
  collection_status: 'Status de Cobrança',
  collectionStatus: 'Status de Cobrança',
  module_permissions: 'Permissões de Módulo',
  modulePermissions: 'Permissões de Módulo',
  field_permissions: 'Permissões de Campos',
  fieldPermissions: 'Permissões de Campos',
  min_admission_cost_cents: 'Custo Mínimo Admissão (centavos)',
  minAdmissionCostCents: 'Custo Mínimo Admissão (centavos)',
  sort_order: 'Ordem',
  sortOrder: 'Ordem',
  modality_condition: 'Condição de Modalidade',
  modalityCondition: 'Condição de Modalidade',
  module: 'Módulo',
  field_key: 'Chave do Campo',
  fieldKey: 'Chave do Campo',
  label: 'Rótulo (Label)',
  field_type: 'Tipo do Campo',
  fieldType: 'Tipo do Campo',
  provider_code: 'Código do Provedor',
  providerCode: 'Código do Provedor',
  key: 'Chave',
  value: 'Valor Configurado',
  scheduled_for: 'Data/Hora Agendada',
  scheduledFor: 'Data/Hora Agendada',
  consultant_id: 'Consultor',
  consultantId: 'Consultor',
  collaborator_id: 'Colaborador',
  collaboratorId: 'Colaborador',
  assigned_user_id: 'Responsável Atribuído',
  assignedUserId: 'Responsável Atribuído',
  assigned_lawyer_id: 'Advogado Responsável',
  assignedLawyerId: 'Advogado Responsável',
  audit_rejection_reason: 'Motivo da Devolução',
  auditRejectionReason: 'Motivo da Devolução',
  audit_manual_notes: 'Parecer do Auditor',
  auditManualNotes: 'Parecer do Auditor',
  password_hash: 'Senha (Hash)',
  passwordHash: 'Senha (Hash)',
  temp_password: 'Senha Temporária',
  tempPassword: 'Senha Temporária',
  created_at: 'Criado em',
  createdAt: 'Criado em',
  updated_at: 'Atualizado em',
  updatedAt: 'Atualizado em',
};

export function humanizeFieldLabel(field: string): string {
  const clean = String(field || '').trim();
  if (!clean) return 'Campo';
  if (FIELD_LABELS_PT[clean]) return FIELD_LABELS_PT[clean];

  const spaced = clean
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) return clean;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function getEntityLabel(entityType: string): string {
  const raw = String(entityType || '').trim();
  if (!raw) return 'Rotina do Sistema';
  if (ENTITY_LABELS_PT[raw]) return ENTITY_LABELS_PT[raw];
  const lower = raw.toLowerCase();
  if (ENTITY_LABELS_PT[lower]) return ENTITY_LABELS_PT[lower];
  return humanizeFieldLabel(raw);
}

export function isSensitiveField(fieldName: string): boolean {
  const normalized = String(fieldName || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (SENSITIVE_FIELD_KEYS.has(normalized)) return true;
  return (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token_encrypted')
  );
}

export function formatAuditValue(value: unknown, fieldName = ''): string {
  if (fieldName && isSensitiveField(fieldName)) {
    return '[PROTEGIDO]';
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '—';
    return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    const json = JSON.stringify(value);
    return json.length > 500 ? `${json.slice(0, 497)}...` : json;
  } catch {
    return String(value);
  }
}

export function getEntityTypeAliases(entityType: string): string[] {
  const raw = String(entityType || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const aliasSet = new Set<string>([raw, lower]);

  if (lower.endsWith('ies') && lower.length > 3) {
    aliasSet.add(`${lower.slice(0, -3)}y`);
  } else if (
    (lower.endsWith('sses') || lower.endsWith('ches') || lower.endsWith('shes') || lower.endsWith('xes')) &&
    lower.length > 4
  ) {
    aliasSet.add(lower.slice(0, -2));
  } else if (lower.endsWith('s') && lower.length > 2) {
    aliasSet.add(lower.slice(0, -1));
  } else {
    aliasSet.add(`${lower}s`);
    if (lower.endsWith('y')) {
      aliasSet.add(`${lower.slice(0, -1)}ies`);
    }
    if (lower.endsWith('s') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) {
      aliasSet.add(`${lower}es`);
    }
  }

  if (lower === 'legal_process' || lower === 'legal_processes') {
    aliasSet.add('legal_process');
    aliasSet.add('legal_processes');
  }
  if (lower === 'company_legal_process' || lower === 'company_legal_processes') {
    aliasSet.add('company_legal_process');
    aliasSet.add('company_legal_processes');
  }
  if (lower === 'work_schedule' || lower === 'work_schedules' || lower === 'schedule') {
    aliasSet.add('work_schedule');
    aliasSet.add('work_schedules');
    aliasSet.add('schedule');
  }
  if (lower === 'financial_title' || lower === 'financial_titles' || lower === 'conta_receber' || lower === 'conta_pagar') {
    aliasSet.add('financial_title');
    aliasSet.add('financial_titles');
    aliasSet.add('CONTA_RECEBER');
    aliasSet.add('CONTA_PAGAR');
  }
  if (lower === 'uazapi_instance' || lower === 'unit_whatsapp_credentials' || lower === 'uazapi') {
    aliasSet.add('uazapi_instance');
    aliasSet.add('unit_whatsapp_credentials');
  }
  if (lower === 'gotalk_channel' || lower === 'gotalk_channels' || lower === 'gotalk') {
    aliasSet.add('gotalk_channel');
    aliasSet.add('gotalk_channels');
    aliasSet.add('gotalk_operators');
    aliasSet.add('gotalk_hsm_templates');
  }
  if (lower === 'audit_checklist' || lower === 'audit_checklist_item' || lower === 'audit_checklist_items') {
    aliasSet.add('audit_checklist');
    aliasSet.add('audit_checklist_item');
    aliasSet.add('audit_checklist_items');
  }
  if (lower === 'config' || lower === 'system_setting' || lower === 'system_settings') {
    aliasSet.add('config');
    aliasSet.add('system_setting');
    aliasSet.add('system_settings');
    aliasSet.add('integration');
  }
  if (lower === 'backup_schedule' || lower === 'backup_schedules' || lower === 'backup_execution' || lower === 'backup_executions') {
    aliasSet.add('backup_schedule');
    aliasSet.add('backup_schedules');
    aliasSet.add('backup_execution');
    aliasSet.add('backup_executions');
  }
  if (lower === 'r2_migration' || lower === 'vault_migration_batch' || lower === 'vault_migration_batches') {
    aliasSet.add('r2_migration');
    aliasSet.add('vault_migration_batch');
    aliasSet.add('vault_migration_batches');
    aliasSet.add('vault_migration_items');
  }
  if (lower === 'supplier' || lower === 'suppliers') {
    aliasSet.add('supplier');
    aliasSet.add('suppliers');
    aliasSet.add('clients');
  }

  return Array.from(aliasSet);
}

export function normalizeAuditLogChanges(
  rawDetails: Record<string, unknown> | null | undefined,
  action = ''
): AuditFieldChange[] {
  if (!rawDetails || typeof rawDetails !== 'object') return [];

  const upperAct = String(action || '').toUpperCase();
  const isInsert = upperAct.includes('INSERT') || upperAct.includes('CREATED');
  const isDelete = upperAct.includes('DELETE') || upperAct.includes('REMOVE');

  const changesList = Array.isArray(rawDetails.changes) ? rawDetails.changes : null;
  if (changesList && changesList.length > 0) {
    const normalized: AuditFieldChange[] = [];
    for (const item of changesList) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const field = String(rec.field || rec.column || 'campo').trim();
      const label = String(rec.label || '').trim() || humanizeFieldLabel(field);
      const prevRaw = rec.previousValue !== undefined ? rec.previousValue : rec.from;
      const nextRaw = rec.newValue !== undefined ? rec.newValue : rec.to;
      const previousValue = formatAuditValue(prevRaw, field);
      const newValue = formatAuditValue(nextRaw, field);
      const explicitPrevLabel = String(rec.previousLabel || '').trim();
      const explicitNewLabel = String(rec.newLabel || '').trim();
      const previousLabel =
        explicitPrevLabel ||
        (isInsert && (previousValue === '—' || previousValue.includes('Novo registro'))
          ? '— (Novo registro)'
          : label);
      const newLabel =
        explicitNewLabel ||
        (isDelete && (newValue === '—' || newValue.includes('Removido')) ? '— (Removido)' : label);
      normalized.push({
        field,
        label: newLabel !== '— (Removido)' ? newLabel : label,
        previousLabel,
        newLabel,
        previousValue,
        newValue,
        from: previousValue,
        to: newValue,
      });
    }
    if (normalized.length > 0) return normalized;
  }

  const ignoredKeys = new Set([
    'autoAudit',
    'tableName',
    'operation',
    'route',
    'source',
    'method',
  ]);
  const fallbackChanges: AuditFieldChange[] = [];
  for (const [k, v] of Object.entries(rawDetails)) {
    if (ignoredKeys.has(k)) continue;
    const formatted = formatAuditValue(v, k);
    const lbl = humanizeFieldLabel(k);
    fallbackChanges.push({
      field: k,
      label: lbl,
      previousLabel: isDelete ? lbl : '—',
      newLabel: isDelete ? '— (Removido)' : lbl,
      previousValue: isDelete ? formatted : '—',
      newValue: isDelete ? '— (Removido)' : formatted,
      from: isDelete ? formatted : '—',
      to: isDelete ? '— (Removido)' : formatted,
    });
  }
  return fallbackChanges;
}

export function normalizeAuditLogRecord<
  T extends {
    id: number;
    userId?: number | null;
    userName: string;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown> | null;
    unitId?: number | null;
    createdAt: Date | string;
  }
>(row: T): NormalizedAuditLog {
  const detailsObj =
    row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : null;
  const changes = normalizeAuditLogChanges(detailsObj, row.action);
  const createdAtIso =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || '');
  const summaryText =
    changes.length > 0
      ? changes
          .slice(0, 3)
          .map((c) => `${c.label}: ${c.previousValue} → ${c.newValue}`)
          .join(' | ') + (changes.length > 3 ? ` (+${changes.length - 3} campos)` : '')
      : row.action;

  return {
    id: row.id,
    userId: row.userId ?? null,
    userName: row.userName || 'Sistema',
    action: row.action,
    entityType: row.entityType,
    entityLabel: getEntityLabel(row.entityType),
    entityId: String(row.entityId ?? ''),
    unitId: row.unitId ?? null,
    createdAt: createdAtIso,
    changes,
    summaryText,
    rawDetails: detailsObj,
  };
}

export function computeRecordDiff(
  beforeObj: Record<string, unknown> | null,
  afterObj: Record<string, unknown> | null
): AuditFieldChange[] {
  const keys = new Set<string>([
    ...Object.keys(beforeObj || {}),
    ...Object.keys(afterObj || {}),
  ]);
  const out: AuditFieldChange[] = [];
  for (const key of keys) {
    if (key === 'updatedAt' || key === 'updated_at') continue;
    const prevVal = beforeObj ? beforeObj[key] : undefined;
    const nextVal = afterObj ? afterObj[key] : undefined;
    const prevStr = formatAuditValue(prevVal, key);
    const nextStr = formatAuditValue(nextVal, key);
    if (beforeObj && afterObj) {
      if (JSON.stringify(prevVal ?? null) === JSON.stringify(nextVal ?? null)) continue;
    } else if (!beforeObj && nextStr === '—') {
      continue;
    } else if (!afterObj && prevStr === '—') {
      continue;
    }
    const lbl = humanizeFieldLabel(key);
    out.push({
      field: key,
      label: lbl,
      previousLabel: beforeObj ? lbl : '— (Novo registro)',
      newLabel: afterObj ? lbl : '— (Removido)',
      previousValue: beforeObj ? prevStr : '— (Novo registro)',
      newValue: afterObj ? nextStr : '— (Removido)',
      from: beforeObj ? prevStr : '— (Novo registro)',
      to: afterObj ? nextStr : '— (Removido)',
    });
  }
  return out;
}
