import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  clients,
  collectionCases,
  financialTitles,
  legalMovements,
  legalProcesses,
  negotiations,
} from '../db/schema.ts';

export type ClientLifecycleTargetStatus = 'suspenso' | 'cancelado' | 'ativo';

export interface SyncClientLegalParams {
  clientId: number;
  targetStatus: ClientLifecycleTargetStatus;
  reason: string;
  actorUserId?: number | null;
  actorUserName: string;
  unitId?: number | null;
  originLabel: string;
  cancelFutureTitles?: boolean;
}

export interface SyncClientLegalResult {
  client: typeof clients.$inferSelect;
  affectedProcessesCount: number;
  updatedProcessIds: number[];
  escavadorMonitored: boolean;
  escavadorActionSummary: string;
}

export async function syncClientLegalAndEscavadorStatus(
  params: SyncClientLegalParams
): Promise<SyncClientLegalResult | null> {
  const {
    clientId,
    targetStatus,
    actorUserId,
    actorUserName,
    originLabel,
    cancelFutureTitles,
  } = params;

  const existingClients = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const existingClient = existingClients[0];
  if (!existingClient) return null;

  const cleanReason =
    String(params.reason || '').trim() ||
    (targetStatus === 'ativo'
      ? `Retorno ao status normal confirmado em ${originLabel}.`
      : `Alteração de status registrada em ${originLabel}.`);

  const now = new Date();

  const [updatedClient] = await db
    .update(clients)
    .set({
      status: targetStatus,
      ...(targetStatus === 'suspenso'
        ? { suspensionReason: cleanReason }
        : targetStatus === 'cancelado'
        ? { cancelledReason: cleanReason, cancelledAt: now }
        : { suspensionReason: null, cancelledReason: null, cancelledAt: null }),
    })
    .where(eq(clients.id, clientId))
    .returning();

  // Localiza processos do cliente diretamente ou vinculados via ficha de admissão/terceiro
  const relatedAdms = await db
    .select({ id: admissions.id })
    .from(admissions)
    .where(or(eq(admissions.clientId, clientId), eq(admissions.assetOwnerId, clientId)));
  const admIds = relatedAdms.map((a) => a.id);

  const procs =
    admIds.length > 0
      ? await db
          .select()
          .from(legalProcesses)
          .where(or(eq(legalProcesses.clientId, clientId), inArray(legalProcesses.admissionId, admIds)))
      : await db
          .select()
          .from(legalProcesses)
          .where(eq(legalProcesses.clientId, clientId));

  const docLabel = existingClient.cpfCnpj || 'CPF/CNPJ não informado';
  const escavadorMonitored = targetStatus === 'ativo';

  const escavadorActionSummary = escavadorMonitored
    ? `Ivi reinseriu automaticamente ${existingClient.fullName} (${docLabel}) na pesquisa contínua do Escavador após retorno ao status normal.`
    : `Ivi retirou automaticamente ${existingClient.fullName} (${docLabel}) da pesquisa do Escavador (${
        targetStatus === 'cancelado' ? 'Contrato Cancelado' : 'Cliente Suspenso'
      }).`;

  const updatedProcessIds: number[] = [];

  for (const proc of procs) {
    if (targetStatus === 'suspenso' || targetStatus === 'cancelado') {
      const savedPreviousStatus =
        proc.status !== 'suspenso' && proc.status !== 'cancelado'
          ? proc.status
          : proc.previousStatus || 'em_acompanhamento';

      const actionTitle =
        targetStatus === 'cancelado'
          ? 'CONTRATO CANCELADO / BLOQUEIO JURÍDICO'
          : 'CLIENTE SUSPENSO / BLOQUEIO JURÍDICO';

      const escavadorNote = `Ivi retirou automaticamente o CPF/CNPJ ${docLabel} da pesquisa do Escavador (${originLabel} -> ${targetStatus.toUpperCase()}). Causa: ${cleanReason}`;

      await db
        .update(legalProcesses)
        .set({
          status: targetStatus,
          previousStatus: savedPreviousStatus,
          statusChangeReason: cleanReason,
          escavadorMonitored: false,
          escavadorLastActionNote: escavadorNote,
          escavadorUpdatedAt: now,
          lastMovementAt: now,
        })
        .where(eq(legalProcesses.id, proc.id));

      await db.insert(legalMovements).values({
        processId: proc.id,
        source: 'integracao_cobranca',
        originalDispatch: `[${actionTitle} · Origem: ${originLabel}] Responsável: ${actorUserName}. Causa registrada: ${cleanReason}. Dados retirados da pesquisa Escavador pela Ivi: ${existingClient.fullName} (${docLabel}).`,
        iviTranslationPtBr: `Integração automática (${originLabel} -> Jurídico & Escavador): o acompanhamento deste processo foi alterado para ${
          targetStatus === 'cancelado' ? 'Cancelado' : 'Suspenso'
        } pelo motivo "${cleanReason}". A Ivi retirou automaticamente o CPF/CNPJ ${docLabel} das varreduras e pesquisas do Escavador até eventual regularização.`,
        openedAt: now,
        readCompletedAt: now,
        contactChannel: 'sistema',
        contactSummary: `Causa (${originLabel}): ${cleanReason}`,
        lawyerId: actorUserId ?? proc.assignedLawyerId ?? null,
      });

      updatedProcessIds.push(proc.id);
    } else {
      const fallbackRestored = proc.vehicleSeized
        ? 'apreendido'
        : proc.hasUnreadMovement
        ? 'alerta_movimentacao'
        : 'em_acompanhamento';
      const restoredStatus =
        proc.previousStatus &&
        proc.previousStatus !== 'suspenso' &&
        proc.previousStatus !== 'cancelado'
          ? proc.previousStatus
          : fallbackRestored;

      const escavadorNote = `Ivi efetuou o retorno automático do CPF/CNPJ ${docLabel} para a varredura do Escavador (${originLabel} -> Status Normal). Motivo/Obs: ${cleanReason}`;

      await db
        .update(legalProcesses)
        .set({
          status: restoredStatus,
          previousStatus: null,
          statusChangeReason: cleanReason,
          escavadorMonitored: true,
          escavadorLastActionNote: escavadorNote,
          escavadorUpdatedAt: now,
          lastMovementAt: now,
        })
        .where(eq(legalProcesses.id, proc.id));

      await db.insert(legalMovements).values({
        processId: proc.id,
        source: 'integracao_cobranca',
        originalDispatch: `[RETORNO AO STATUS NORMAL -> ${restoredStatus.toUpperCase()} · Origem: ${originLabel}] Responsável: ${actorUserName}. Observação: ${cleanReason}. Dados reinseridos na varredura Escavador pela Ivi: ${existingClient.fullName} (${docLabel}).`,
        iviTranslationPtBr: `Integração automática (${originLabel} -> Jurídico & Escavador): o cliente ${existingClient.fullName} retornou ao status normal. O processo foi restaurado no Jurídico (${restoredStatus.replace(
          /_/g,
          ' '
        )}) e a Ivi recolocou automaticamente o CPF/CNPJ ${docLabel} na varredura contínua do Escavador.`,
        openedAt: now,
        readCompletedAt: now,
        contactChannel: 'sistema',
        contactSummary: `Reativação (${originLabel}): ${cleanReason}`,
        lawyerId: actorUserId ?? proc.assignedLawyerId ?? null,
      });

      updatedProcessIds.push(proc.id);
    }
  }

  // Sincronizar fila de Cobrança & Negociações & Títulos Futuros
  if (targetStatus === 'suspenso' || targetStatus === 'cancelado') {
    await db
      .update(collectionCases)
      .set({ status: targetStatus, updatedAt: now })
      .where(and(eq(collectionCases.clientId, clientId), ne(collectionCases.status, 'pago')));

    await db
      .update(negotiations)
      .set({ status: targetStatus === 'cancelado' ? 'cancelada' : 'suspensa', updatedAt: now })
      .where(eq(negotiations.clientId, clientId));

    if (targetStatus === 'cancelado' && cancelFutureTitles) {
      await db
        .update(financialTitles)
        .set({ status: 'CANCELADO', currentBalanceCents: 0, updatedAt: now })
        .where(
          and(
            eq(financialTitles.clientId, clientId),
            ne(financialTitles.status, 'pago'),
            ne(financialTitles.status, 'PAGO'),
            ne(financialTitles.status, 'PARCIAL')
          )
        );
    }
  } else {
    await db
      .update(collectionCases)
      .set({ status: 'em_cobranca', updatedAt: now })
      .where(
        and(
          eq(collectionCases.clientId, clientId),
          or(eq(collectionCases.status, 'suspenso'), eq(collectionCases.status, 'cancelado'))
        )
      );

    await db
      .update(negotiations)
      .set({ status: 'em_negociacao', updatedAt: now })
      .where(
        and(
          eq(negotiations.clientId, clientId),
          or(eq(negotiations.status, 'suspensa'), eq(negotiations.status, 'cancelada'))
        )
      );
  }

  await db.insert(auditLogs).values({
    userId: actorUserId ?? null,
    userName: actorUserName,
    action: `CLIENT_${targetStatus.toUpperCase()}_ESCAVADOR_SYNC`,
    entityType: 'client',
    entityId: String(clientId),
    details: {
      originLabel,
      targetStatus,
      reason: cleanReason,
      affectedProcessesCount: updatedProcessIds.length,
      updatedProcessIds,
      escavadorMonitored,
      cpfCnpj: docLabel,
      cancelFutureTitles: Boolean(cancelFutureTitles),
    },
    unitId: params.unitId ?? updatedClient.unitId,
  });

  return {
    client: updatedClient,
    affectedProcessesCount: updatedProcessIds.length,
    updatedProcessIds,
    escavadorMonitored,
    escavadorActionSummary,
  };
}
