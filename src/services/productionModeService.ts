import { and, count, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  appointments,
  auditLogs,
  bankAccounts,
  bankContacts,
  bankMovements,
  bankServices,
  banks,
  bearers,
  backupExecutions,
  backupSchedules,
  clientAssetLinks,
  clients,
  collaborators,
  collectionCases,
  collectionNotes,
  collectionReports,
  commercialDeals,
  communicationArchives,
  companyLegalProcessAttachments,
  companyLegalProcessDeadlines,
  companyLegalProcessHearings,
  companyLegalProcessMovements,
  companyLegalProcesses,
  coordinatorTaskAttachments,
  coordinatorTaskShares,
  coordinatorTaskSubtasks,
  coordinatorTasks,
  customFormSubmissions,
  customForms,
  documentObjects,
  financialTitles,
  gotalkOperators,
  internalMessages,
  iviAuditDecisionsCache,
  iviKnowledgeArticles,
  legalMovements,
  legalProcesses,
  negotiationGoals,
  negotiations,
  prospectionLeads,
  recalcScenarios,
  scheduleBlocks,
  scheduleWaitlist,
  seriesCatalog,
  seriesUnitNumbering,
  systemSettings,
  titleSettlements,
  trainingSessions,
  users,
  vaultMigrationBatches,
  vaultMigrationItems,
  whatsappCallLogs,
  whatsappMessages,
  whatsappThreads,
} from '../db/schema.ts';

export const PRODUCTION_MODE_LOCK_KEY = 'production_mode_lock';

const DEMO_SEEDED_EMAILS = [
  'admin@financepro.com.br',
  'marina.alves@financepro.com.br',
  'rafael.moura@financepro.com.br',
  'beatriz.audit@financepro.com.br',
  'thiago.juridico@financepro.com.br',
  'camila.neg@financepro.com.br',
  'lucas.cobranca@financepro.com.br',
];

const DEMO_SEEDED_UIDS = [
  'corp-admin-demo',
  'corp-cons-marina',
  'corp-cons-rafael',
  'corp-aud-beatriz',
  'corp-jur-thiago',
  'corp-neg-camila',
  'corp-cob-lucas',
];

export interface ProductionModeLockRecord {
  locked: boolean;
  activatedAt: string | null;
  activatedByUserId: number | null;
  activatedByName: string | null;
  activatedByEmail: string | null;
  lastPurgeAt: string | null;
  lastPurgedCounts: Record<string, number> | null;
}

export interface ProductionModeStatusResponse {
  locked: boolean;
  activatedAt: string | null;
  activatedByName: string | null;
  activatedByEmail: string | null;
  lastPurgeAt: string | null;
  lastPurgedCounts: Record<string, number> | null;
  counts: {
    clients: number;
    admissions: number;
    financialTitles: number;
    bankAccounts: number;
    bankMovements: number;
    legalProcesses: number;
    negotiations: number;
    prospectionLeads: number;
    appointments: number;
    collaborators: number;
    banks: number;
    documents: number;
    demoUsers: number;
    totalOperationalRecords: number;
  };
}

let cachedLockState: boolean | null = null;

export function invalidateProductionModeLockCache(): void {
  cachedLockState = null;
}

export async function getProductionModeLockRecord(): Promise<ProductionModeLockRecord> {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, PRODUCTION_MODE_LOCK_KEY))
      .limit(1);

    const raw = (rows[0]?.value || {}) as Partial<ProductionModeLockRecord>;
    const locked = Boolean(raw.locked === true);
    cachedLockState = locked;
    return {
      locked,
      activatedAt: raw.activatedAt || null,
      activatedByUserId: typeof raw.activatedByUserId === 'number' ? raw.activatedByUserId : null,
      activatedByName: raw.activatedByName || null,
      activatedByEmail: raw.activatedByEmail || null,
      lastPurgeAt: raw.lastPurgeAt || null,
      lastPurgedCounts: raw.lastPurgedCounts || null,
    };
  } catch {
    return {
      locked: cachedLockState === true,
      activatedAt: null,
      activatedByUserId: null,
      activatedByName: null,
      activatedByEmail: null,
      lastPurgeAt: null,
      lastPurgedCounts: null,
    };
  }
}

export async function isProductionModeLocked(): Promise<boolean> {
  if (cachedLockState === true) return true;
  const record = await getProductionModeLockRecord();
  return record.locked;
}

async function countRows(table: Parameters<typeof db.select>[0] extends never ? never : any): Promise<number> {
  const rows = await db.select({ value: count() }).from(table);
  return Number(rows[0]?.value || 0);
}

export async function getProductionModeStatus(currentUserId?: number): Promise<ProductionModeStatusResponse> {
  const [
    lockRecord,
    clientsCount,
    admissionsCount,
    titlesCount,
    bankAccountsCount,
    bankMovementsCount,
    legalCount,
    companyLegalCount,
    negotiationsCount,
    dealsCount,
    leadsCount,
    appointmentsCount,
    collaboratorsCount,
    banksCount,
    documentsCount,
    demoUsersRows,
  ] = await Promise.all([
    getProductionModeLockRecord(),
    countRows(clients),
    countRows(admissions),
    countRows(financialTitles),
    countRows(bankAccounts),
    countRows(bankMovements),
    countRows(legalProcesses),
    countRows(companyLegalProcesses),
    countRows(negotiations),
    countRows(commercialDeals),
    countRows(prospectionLeads),
    countRows(appointments),
    countRows(collaborators),
    countRows(banks),
    countRows(documentObjects),
    db
      .select({ id: users.id, email: users.email, uid: users.uid })
      .from(users)
      .where(
        or(
          inArray(users.email, DEMO_SEEDED_EMAILS),
          inArray(users.uid, DEMO_SEEDED_UIDS)
        )
      ),
  ]);

  const demoUsersCount = demoUsersRows.filter((u) => u.id !== currentUserId).length;
  const legalTotal = legalCount + companyLegalCount;
  const negTotal = negotiationsCount + dealsCount;

  const totalOperationalRecords =
    clientsCount +
    admissionsCount +
    titlesCount +
    bankAccountsCount +
    bankMovementsCount +
    legalTotal +
    negTotal +
    leadsCount +
    appointmentsCount +
    collaboratorsCount +
    banksCount +
    documentsCount +
    demoUsersCount;

  return {
    locked: lockRecord.locked,
    activatedAt: lockRecord.activatedAt,
    activatedByName: lockRecord.activatedByName,
    activatedByEmail: lockRecord.activatedByEmail,
    lastPurgeAt: lockRecord.lastPurgeAt,
    lastPurgedCounts: lockRecord.lastPurgedCounts,
    counts: {
      clients: clientsCount,
      admissions: admissionsCount,
      financialTitles: titlesCount,
      bankAccounts: bankAccountsCount,
      bankMovements: bankMovementsCount,
      legalProcesses: legalTotal,
      negotiations: negTotal,
      prospectionLeads: leadsCount,
      appointments: appointmentsCount,
      collaborators: collaboratorsCount,
      banks: banksCount,
      documents: documentsCount,
      demoUsers: demoUsersCount,
      totalOperationalRecords,
    },
  };
}

export interface ProductionCleanupResult {
  lockRecord: ProductionModeLockRecord;
  purgedCounts: Record<string, number>;
  preservedAdminUserId: number;
  preservedUsersCount: number;
}

export async function activateProductionModeAndPurge(actor: {
  id: number;
  name: string;
  email: string;
}): Promise<ProductionCleanupResult> {
  const existingLock = await getProductionModeLockRecord();
  const nowIso = new Date().toISOString();

  const result = await db.transaction(async (tx) => {
    const purgedCounts: Record<string, number> = {};

    const runDelete = async (key: string, queryPromise: Promise<{ rowCount?: number | null }>) => {
      const res = await queryPromise;
      purgedCounts[key] = Number(res?.rowCount ?? 0);
    };

    // 1. Identificar usuários fictícios semeados (nunca excluir o Admin executor nem usuários reais criados pelo cliente)
    const candidateDemoUsers = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          ne(users.id, actor.id),
          or(
            inArray(users.email, DEMO_SEEDED_EMAILS),
            inArray(users.uid, DEMO_SEEDED_UIDS)
          )
        )
      );
    const demoUserIds = candidateDemoUsers.map((u) => u.id);

    // 2. Tarefas da Coordenação (filhos -> pais)
    await runDelete('coordinator_task_attachments', tx.delete(coordinatorTaskAttachments));
    await runDelete('coordinator_task_shares', tx.delete(coordinatorTaskShares));
    await runDelete('coordinator_task_subtasks', tx.delete(coordinatorTaskSubtasks));
    await runDelete('coordinator_tasks', tx.delete(coordinatorTasks));

    // 3. Respostas de Formulários & Sessões de Treinamento & Cache Auditoria Ivi
    await runDelete('custom_form_submissions', tx.delete(customFormSubmissions));
    await runDelete('training_sessions', tx.delete(trainingSessions));
    await runDelete('ivi_audit_decisions_cache', tx.delete(iviAuditDecisionsCache));

    // 4. Itens/Lotes de Migração R2 de teste
    await runDelete('vault_migration_items', tx.delete(vaultMigrationItems));
    await runDelete('vault_migration_batches', tx.delete(vaultMigrationBatches));

    // 5. Processos Jurídicos Corporativos (Governança)
    await runDelete('company_legal_process_attachments', tx.delete(companyLegalProcessAttachments));
    await runDelete('company_legal_process_hearings', tx.delete(companyLegalProcessHearings));
    await runDelete('company_legal_process_deadlines', tx.delete(companyLegalProcessDeadlines));
    await runDelete('company_legal_process_movements', tx.delete(companyLegalProcessMovements));
    await runDelete('company_legal_processes', tx.delete(companyLegalProcesses));

    // 6. Cobrança, Baixas, Movimentações e Títulos Financeiros
    await runDelete('collection_notes', tx.delete(collectionNotes));
    await runDelete('collection_reports', tx.delete(collectionReports));
    await runDelete('collection_cases', tx.delete(collectionCases));
    await runDelete('title_settlements', tx.delete(titleSettlements));
    await runDelete('bank_movements', tx.delete(bankMovements));
    await runDelete('financial_titles', tx.delete(financialTitles));
    await tx.update(bearers).set({ associatedBankAccountId: null });
    await runDelete('bank_accounts', tx.delete(bankAccounts));

    // 7. Negociações & Pipeline Comercial
    await runDelete('commercial_deals', tx.delete(commercialDeals));
    await runDelete('negotiation_goals', tx.delete(negotiationGoals));
    await runDelete('negotiations', tx.delete(negotiations));

    // 8. Jurídico Clientes & Cenários Revisionais
    await runDelete('legal_movements', tx.delete(legalMovements));
    await runDelete('legal_processes', tx.delete(legalProcesses));
    await runDelete('recalc_scenarios', tx.delete(recalcScenarios));

    // 9. Comunicações, WhatsApp, Agenda & Prospecção
    await runDelete('communication_archives', tx.delete(communicationArchives));
    await runDelete('whatsapp_call_logs', tx.delete(whatsappCallLogs));
    await runDelete('whatsapp_messages', tx.delete(whatsappMessages));
    await runDelete('whatsapp_threads', tx.delete(whatsappThreads));
    await runDelete('internal_messages', tx.delete(internalMessages));
    await runDelete('schedule_waitlist', tx.delete(scheduleWaitlist));
    await runDelete('schedule_blocks', tx.delete(scheduleBlocks));
    await runDelete('appointments', tx.delete(appointments));
    await runDelete('prospection_leads', tx.delete(prospectionLeads));
    await runDelete(
      'ivi_knowledge_prospection',
      tx.delete(iviKnowledgeArticles).where(eq(iviKnowledgeArticles.scope, 'prospection'))
    );

    // 10. Documentos, Admissões, Vínculos e Clientes (incluindo fornecedores de teste)
    await runDelete('document_objects', tx.delete(documentObjects));
    await runDelete('admissions', tx.delete(admissions));
    await runDelete('client_asset_links', tx.delete(clientAssetLinks));
    await runDelete('clients', tx.delete(clients));

    // 11. Bancos credores de teste e seus contatos/serviços (mantém febraban_banks oficial intacto)
    await runDelete('bank_contacts', tx.delete(bankContacts));
    await runDelete('bank_services', tx.delete(bankServices));
    await runDelete('banks', tx.delete(banks));

    // 12. Colaboradores e logs de auditoria antigos
    await runDelete('collaborators', tx.delete(collaborators));
    await runDelete('audit_logs_previous', tx.delete(auditLogs));

    // 13. Desvincular e remover apenas usuários fictícios (@financepro.com.br de seed)
    if (demoUserIds.length > 0) {
      await tx
        .update(customForms)
        .set({ createdByUserId: null })
        .where(inArray(customForms.createdByUserId, demoUserIds));
      await tx
        .update(gotalkOperators)
        .set({ collaboratorId: null })
        .where(inArray(gotalkOperators.collaboratorId, demoUserIds));
      await tx
        .update(backupSchedules)
        .set({ createdByUserId: null })
        .where(inArray(backupSchedules.createdByUserId, demoUserIds));
      await tx
        .update(backupExecutions)
        .set({ executedByUserId: null })
        .where(inArray(backupExecutions.executedByUserId, demoUserIds));

      await runDelete('demo_users', tx.delete(users).where(inArray(users.id, demoUserIds)));
    } else {
      purgedCounts.demo_users = 0;
    }

    // 14. Reiniciar contadores de séries documentais para produção limpa
    await tx.update(seriesCatalog).set({ generalNumber: 1 });
    await tx.update(seriesUnitNumbering).set({ currentNumber: 1 });

    // 15. Gravar trava permanente no banco (system_settings)
    const lockRecord: ProductionModeLockRecord = {
      locked: true,
      activatedAt: existingLock.activatedAt || nowIso,
      activatedByUserId: existingLock.activatedByUserId ?? actor.id,
      activatedByName: existingLock.activatedByName || actor.name,
      activatedByEmail: existingLock.activatedByEmail || actor.email,
      lastPurgeAt: nowIso,
      lastPurgedCounts: purgedCounts,
    };

    await tx
      .insert(systemSettings)
      .values({
        key: PRODUCTION_MODE_LOCK_KEY,
        value: lockRecord as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: lockRecord as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    // 16. Registrar evento único de auditoria da entrada em Modo Produção
    await tx.insert(auditLogs).values({
      userId: actor.id,
      userName: actor.name,
      action: 'PRODUCTION_MODE_ACTIVATED',
      entityType: 'system',
      entityId: PRODUCTION_MODE_LOCK_KEY,
      details: {
        lockPermanent: true,
        purgedCounts,
        activatedByEmail: actor.email,
      },
      unitId: null,
    });

    const survivingUsers = await tx.select({ value: count() }).from(users);

    return {
      lockRecord,
      purgedCounts,
      preservedAdminUserId: actor.id,
      preservedUsersCount: Number(survivingUsers[0]?.value || 1),
    };
  });

  // Atualiza trava em memória imediatamente após commit
  cachedLockState = true;
  // Also make sure any direct SQL sequence/vacuum is not needed; keep PostgreSQL sequences monotonic or fine.
  void sql;

  return result;
}
