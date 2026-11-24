import type { Express, Request, Response } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  bankAccountApiConfigs,
  bankAccounts,
  banks,
  clients,
  financialTitles,
  santanderEmissionLogs,
  units,
} from '../db/schema.ts';
import {
  AuthRequest,
  getAllowedUnitIds,
  isUnitPermitted,
  requireAnyModule,
  requireAuth,
  requireModule,
} from '../middleware/auth.ts';
import {
  consultSantanderTitleStatus,
  createOrSyncSantanderWorkspace,
  emitOrReissueSantanderBoletoForTitle,
  emitSantanderBoletoForTitle,
  emitSantanderPixForTitle,
  generateQrCodeDataUrl,
  getOrInitSantanderConfigForAccount,
  getSantanderLogsForAccount,
  getSantanderOpenTitlesPreview,
  listConfiguredSantanderAccounts,
  sanitizeSantanderConfigForFrontend,
  saveSantanderConfigForAccount,
  sendSantanderBoletoInstruction,
  syncSantanderOpenTitlesSettlements,
  testSantanderConnection,
} from '../services/santander.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';

type BroadcastFn = (event: string, payload: unknown) => void;

const ALLOWED_INSTRUCTIONS = new Set([
  'BAIXAR',
  'PROTESTAR',
  'SUSTAR_PROTESTO',
  'ALTERAR_VENCIMENTO',
  'ALTERAR_VALOR',
]);

export function registerSantanderRoutes(app: Express, broadcast: BroadcastFn) {
  // 1. Carregar configuração Santander de uma Conta Corrente (sem segredos)
  app.get(
    '/api/finance/bank-accounts/:id/santander-config',
    requireAuth,
    requireModule('finance'),
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parsePositiveIntId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });

        const loaded = await getOrInitSantanderConfigForAccount(id);
        if (!loaded) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
        if (!isUnitPermitted(req, loaded.account.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para acessar esta conta bancária.' });
        }

        const [logs, availableBanks] = await Promise.all([
          getSantanderLogsForAccount(id, 40),
          db.select().from(banks).orderBy(asc(banks.name)),
        ]);

        res.json({
          account: loaded.account,
          config: sanitizeSantanderConfigForFrontend(loaded.config),
          logs,
          availableBanks,
        });
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar configuração Santander.') });
      }
    }
  );

  // 2. Salvar configuração API Santander (OAuth2, mTLS, Boletos v2 e PIX v2)
  app.put(
    '/api/finance/bank-accounts/:id/santander-config',
    requireAuth,
    requireModule('finance'),
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parsePositiveIntId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });

        const [existingAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
        if (!existingAcc) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
        if (!isUnitPermitted(req, existingAcc.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para configurar conta bancária desta unidade.' });
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const actorName = req.authUser?.name || req.authUser?.email || 'Usuário';

        const savedConfig = await saveSantanderConfigForAccount({
          bankAccountId: id,
          updatedBy: actorName,
          body,
        });

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: actorName,
          action: 'UPDATE_SANTANDER_API_CONFIG',
          entityType: 'bank_account_api_config',
          entityId: String(id),
          details: {
            bankName: existingAcc.bankName,
            environment: savedConfig.environment,
            executionMode: savedConfig.executionMode,
            boletoEnabled: savedConfig.boletoEnabled,
            pixEnabled: savedConfig.pixEnabled,
            covenantCode: savedConfig.covenantCode,
            workspaceId: savedConfig.workspaceId,
            pixKey: savedConfig.pixKey,
            hasCertificate: savedConfig.hasPfx || (savedConfig.hasCertPem && savedConfig.hasKeyPem),
          },
          unitId: existingAcc.unitId || req.activeUnitId,
        });

        const [freshAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
        broadcast('finance_updated', { entity: 'bank_account', id });

        res.json({ account: freshAcc || existingAcc, config: savedConfig });
      } catch (error) {
        const msg = sanitizeErrorMessage(error, 'Erro ao salvar configuração da API Santander.');
        res.status(400).json({ error: msg });
      }
    }
  );

  // 3. Testar conexão OAuth2 + mTLS (Boleto / PIX / Homologação)
  app.post(
    '/api/finance/bank-accounts/:id/santander/test-connection',
    requireAuth,
    requireModule('finance'),
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parsePositiveIntId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });

        const [existingAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
        if (!existingAcc) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
        if (!isUnitPermitted(req, existingAcc.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para testar esta conta bancária.' });
        }

        const rawScope = String((req.body as { scope?: string })?.scope || 'all');
        const scope: 'all' | 'boleto' | 'pix' =
          rawScope === 'boleto' ? 'boleto' : rawScope === 'pix' ? 'pix' : 'all';

        const result = await testSantanderConnection({
          bankAccountId: id,
          scope,
          actorName: req.authUser?.name || 'Usuário',
        });

        const logs = await getSantanderLogsForAccount(id, 40);
        res.json({ ...result, logs });
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Falha ao testar conexão Santander.') });
      }
    }
  );

  // 4. Criar ou sincronizar Workspace de Cobrança Santander (POST /workspaces)
  app.post(
    '/api/finance/bank-accounts/:id/santander/workspaces',
    requireAuth,
    requireModule('finance'),
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parsePositiveIntId(req.params.id);
        if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });

        const [existingAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
        if (!existingAcc) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
        if (!isUnitPermitted(req, existingAcc.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para provisionar workspace nesta unidade.' });
        }

        const description = typeof (req.body as { description?: string })?.description === 'string'
          ? (req.body as { description: string }).description
          : undefined;

        const result = await createOrSyncSantanderWorkspace({
          bankAccountId: id,
          description,
          actorName: req.authUser?.name || 'Usuário',
        });

        const loaded = await getOrInitSantanderConfigForAccount(id);
        const logs = await getSantanderLogsForAccount(id, 40);

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'SANTANDER_WORKSPACE_SYNC',
          entityType: 'bank_account_api_config',
          entityId: String(id),
          details: { workspaceId: result.workspaceId, mode: result.mode },
          unitId: existingAcc.unitId || req.activeUnitId,
        });

        res.json({
          ...result,
          config: loaded ? sanitizeSantanderConfigForFrontend(loaded.config) : null,
          logs,
        });
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao criar Workspace Santander.') });
      }
    }
  );

  // 5. Listar contas correntes Santander ativas disponíveis para outros módulos (Contas a Receber, Auditoria, Cobrança)
  app.get(
    '/api/santander/accounts',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const allowedUnits = getAllowedUnitIds(req);
        const all = await listConfiguredSantanderAccounts();
        const filtered =
          allowedUnits === null
            ? all
            : all.filter((a) => a.unitId === null || allowedUnits.includes(a.unitId));
        res.json({ accounts: filtered });
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao listar contas Santander configuradas.') });
      }
    }
  );

  // 6. Consultar dados completos de cobrança (Boleto + PIX + QR Code DataURL + Sacado + Beneficiário) para PDF / Modal em qualquer módulo
  app.get(
    '/api/santander/titles/:titleId/payment-data',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const titleId = parsePositiveIntId(req.params.titleId);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });

        const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
        if (!title) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, title.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para visualizar dados de cobrança desta unidade.' });
        }

        const [[clientRow], [unitRow], santanderAccounts] = await Promise.all([
          db.select().from(clients).where(eq(clients.id, title.clientId)).limit(1),
          db.select().from(units).where(eq(units.id, title.unitId)).limit(1),
          listConfiguredSantanderAccounts(),
        ]);

        const allowedUnits = getAllowedUnitIds(req);
        const visibleAccounts =
          allowedUnits === null
            ? santanderAccounts
            : santanderAccounts.filter((a) => a.unitId === null || allowedUnits.includes(a.unitId));

        const activeAccount =
          visibleAccounts.find((a) => a.id === title.bankAccountId) ||
          visibleAccounts.find((a) => a.isDefaultBoletoAccount && a.apiIntegrationEnabled) ||
          visibleAccounts.find((a) => a.apiIntegrationEnabled) ||
          visibleAccounts[0] ||
          null;

        const qrCodeDataUrl = title.pixCopiaECola
          ? await generateQrCodeDataUrl(title.pixCopiaECola)
          : '';

        const logs = await db
          .select()
          .from(santanderEmissionLogs)
          .where(eq(santanderEmissionLogs.titleId, titleId))
          .limit(20);

        res.json({
          title,
          client: clientRow || null,
          unit: unitRow || null,
          account: activeAccount,
          availableAccounts: visibleAccounts,
          qrCodeDataUrl,
          logs,
        });
      } catch (error) {
        res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar dados de pagamento do título.') });
      }
    }
  );

  // 7. Emitir Boleto Registrado / Boleto SX (com QR Code PIX híbrido opcional)
  app.post(
    '/api/santander/titles/:titleId/emit-boleto',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const titleId = parsePositiveIntId(req.params.titleId);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });

        const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
        if (!existing) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, existing.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para emitir boleto nesta unidade.' });
        }

        const body = (req.body || {}) as { bankAccountId?: number; includePixQr?: boolean };
        const bankAccountId = body.bankAccountId ? parsePositiveIntId(body.bankAccountId) : undefined;
        if (bankAccountId) {
          const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
          if (!acc || !isUnitPermitted(req, acc.unitId)) {
            return res.status(403).json({ error: 'Conta corrente não encontrada ou sem permissão.' });
          }
        }

        const actorName = req.authUser?.name || 'Usuário';
        const result = await emitSantanderBoletoForTitle({
          titleId,
          bankAccountId,
          includePixQr: body.includePixQr,
          actorName,
        });

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: actorName,
          action: 'SANTANDER_EMIT_BOLETO',
          entityType: 'financial_title',
          entityId: String(titleId),
          details: {
            bankAccountId: result.account.id,
            environment: result.environment,
            executionMode: result.executionMode,
            ourNumber: result.ourNumber,
            digitableLine: result.digitableLine,
            hasHybridPix: Boolean(result.qrCodePix),
          },
          unitId: existing.unitId,
        });

        broadcast('finance_updated', { entity: 'financial_title', id: titleId });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao emitir boleto Santander.') });
      }
    }
  );

  // 8. Emitir Cobrança PIX QR Code (cob imediata ou cobv com vencimento)
  app.post(
    '/api/santander/titles/:titleId/emit-pix',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const titleId = parsePositiveIntId(req.params.titleId);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });

        const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
        if (!existing) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, existing.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para gerar cobrança PIX nesta unidade.' });
        }

        const body = (req.body || {}) as {
          bankAccountId?: number;
          chargeType?: 'cob' | 'cobv';
          expirationSeconds?: number;
        };
        const bankAccountId = body.bankAccountId ? parsePositiveIntId(body.bankAccountId) : undefined;
        if (bankAccountId) {
          const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
          if (!acc || !isUnitPermitted(req, acc.unitId)) {
            return res.status(403).json({ error: 'Conta corrente não encontrada ou sem permissão.' });
          }
        }

        const chargeType = body.chargeType === 'cob' ? 'cob' : body.chargeType === 'cobv' ? 'cobv' : undefined;
        const actorName = req.authUser?.name || 'Usuário';

        const result = await emitSantanderPixForTitle({
          titleId,
          bankAccountId,
          chargeType,
          expirationSeconds: body.expirationSeconds ? Number(body.expirationSeconds) : undefined,
          actorName,
        });

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: actorName,
          action: 'SANTANDER_EMIT_PIX',
          entityType: 'financial_title',
          entityId: String(titleId),
          details: {
            bankAccountId: result.account.id,
            environment: result.environment,
            executionMode: result.executionMode,
            txid: result.txid,
            chargeType: result.chargeType,
            pixStatus: result.pixStatus,
          },
          unitId: existing.unitId,
        });

        broadcast('finance_updated', { entity: 'financial_title', id: titleId });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao gerar PIX QR Code Santander.') });
      }
    }
  );

  // 9. Consultar situação do Boleto e/ou PIX no Santander
  app.post(
    '/api/santander/titles/:titleId/consult',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const titleId = parsePositiveIntId(req.params.titleId);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });

        const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
        if (!existing) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, existing.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para consultar título desta unidade.' });
        }

        const result = await consultSantanderTitleStatus({
          titleId,
          actorName: req.authUser?.name || 'Usuário',
        });
        const qrCodeDataUrl = result.title.pixCopiaECola
          ? await generateQrCodeDataUrl(result.title.pixCopiaECola)
          : '';

        res.json({ ...result, qrCodeDataUrl });
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar status no Santander.') });
      }
    }
  );

  // 10. Enviar instrução ao Boleto registrado (PATCH: BAIXAR, PROTESTAR, SUSTAR_PROTESTO, ALTERAR_VENCIMENTO, ALTERAR_VALOR)
  app.post(
    '/api/santander/titles/:titleId/instruction',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const titleId = parsePositiveIntId(req.params.titleId);
        if (!titleId) return res.status(400).json({ error: 'ID de título inválido.' });

        const [existing] = await db.select().from(financialTitles).where(eq(financialTitles.id, titleId)).limit(1);
        if (!existing) return res.status(404).json({ error: 'Título financeiro não encontrado.' });
        if (!isUnitPermitted(req, existing.unitId)) {
          return res.status(403).json({ error: 'Sem permissão para instruir boleto desta unidade.' });
        }

        const body = (req.body || {}) as {
          operation?: string;
          newDueDate?: string;
          newAmountCents?: number;
        };
        const op = String(body.operation || '').trim().toUpperCase();
        if (!ALLOWED_INSTRUCTIONS.has(op)) {
          return res.status(400).json({ error: 'Operação de instrução Santander inválida.' });
        }
        if (op === 'ALTERAR_VENCIMENTO' && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.newDueDate || ''))) {
          return res.status(400).json({ error: 'Informe uma nova data de vencimento válida (YYYY-MM-DD).' });
        }
        if (op === 'ALTERAR_VALOR' && (!body.newAmountCents || Number(body.newAmountCents) <= 0)) {
          return res.status(400).json({ error: 'Informe um novo valor em centavos maior que zero.' });
        }

        const actorName = req.authUser?.name || 'Usuário';
        const result = await sendSantanderBoletoInstruction({
          titleId,
          operation: op as 'BAIXAR' | 'PROTESTAR' | 'SUSTAR_PROTESTO' | 'ALTERAR_VENCIMENTO' | 'ALTERAR_VALOR',
          newDueDate: body.newDueDate,
          newAmountCents: body.newAmountCents ? Number(body.newAmountCents) : undefined,
          actorName,
        });

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: actorName,
          action: `SANTANDER_BOLETO_${op}`,
          entityType: 'financial_title',
          entityId: String(titleId),
          details: { operation: op, newDueDate: body.newDueDate, newAmountCents: body.newAmountCents },
          unitId: existing.unitId,
        });

        broadcast('finance_updated', { entity: 'financial_title', id: titleId });
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao enviar instrução ao Santander.') });
      }
    }
  );

  // 11. Webhook Receptor Santander Boletos (Notificação assíncrona de liquidação/baixa)
  app.post('/api/santander/webhooks/boleto', async (req: Request, res: Response) => {
    try {
      const configuredSecret = process.env.SANTANDER_WEBHOOK_SECRET;
      if (configuredSecret && req.headers['x-webhook-secret'] !== configuredSecret) {
        return res.status(401).json({ error: 'Assinatura de webhook inválida.' });
      }
      const payload = (req.body || {}) as Record<string, unknown>;
      const workspaceId = String(payload.workspaceId || '').trim();
      const nsuCode = String(payload.nsuCode || '').trim();
      const bankNumber = String(payload.bankNumber || '').trim();
      const bankSlipId = String(payload.bankSlipId || payload.id || '').trim();
      const remoteStatus = String(payload.status || 'LIQUIDADO').trim().toUpperCase();

      if (!nsuCode && !bankNumber && !bankSlipId) {
        return res.status(400).json({ error: 'Identificador de boleto ausente no webhook.' });
      }

      const candidates = bankSlipId
        ? await db
            .select()
            .from(financialTitles)
            .where(eq(financialTitles.santanderBankSlipId, bankSlipId))
            .limit(1)
        : nsuCode
        ? await db
            .select()
            .from(financialTitles)
            .where(eq(financialTitles.santanderNsuCode, nsuCode))
            .limit(1)
        : await db
            .select()
            .from(financialTitles)
            .where(eq(financialTitles.ourNumber, bankNumber))
            .limit(1);

      const title = candidates[0];
      if (!title) {
        return res.status(404).json({ error: 'Título não localizado para o webhook.' });
      }

      if (workspaceId && title.santanderWorkspaceId && workspaceId !== title.santanderWorkspaceId) {
        return res.status(403).json({ error: 'Workspace divergente da configuração do título.' });
      }

      const isPaid = remoteStatus.includes('LIQUID') || remoteStatus.includes('PAGO');
      await db
        .update(financialTitles)
        .set({
          santanderStatus: remoteStatus,
          ...(isPaid && String(title.status).toUpperCase() !== 'PAGO'
            ? { status: 'PAGO', currentBalanceCents: 0, paidAt: new Date() }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(financialTitles.id, title.id));

      if (title.bankAccountId) {
        await db.insert(santanderEmissionLogs).values({
          bankAccountId: title.bankAccountId,
          titleId: title.id,
          apiScope: 'webhook',
          operation: 'WEBHOOK_BOLETO_EVENT',
          environment: 'production',
          executionMode: 'live_mtls',
          endpoint: '/api/santander/webhooks/boleto',
          httpStatus: 200,
          ok: true,
          externalRef: bankSlipId || nsuCode || bankNumber,
          requestSummaryJson: { remoteStatus, workspaceId },
          responseSummaryJson: { titleId: title.id, statusUpdated: isPaid ? 'PAGO' : remoteStatus },
          createdByName: 'Webhook Santander',
        });
      }

      broadcast('finance_updated', { entity: 'financial_title', id: title.id });
      res.json({ received: true, titleId: title.id, santanderStatus: remoteStatus });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao processar webhook de boleto Santander.') });
    }
  });

  // 12. Webhook Receptor Santander PIX (Notificação assíncrona padrão Bacen /api/v2)
  app.post('/api/santander/webhooks/pix', async (req: Request, res: Response) => {
    try {
      const configuredSecret = process.env.SANTANDER_WEBHOOK_SECRET;
      if (configuredSecret && req.headers['x-webhook-secret'] !== configuredSecret) {
        return res.status(401).json({ error: 'Assinatura de webhook PIX inválida.' });
      }
      const body = (req.body || {}) as {
        pix?: Array<{ txid?: string; valor?: string; horario?: string; endToEndId?: string }>;
        txid?: string;
      };
      const items = Array.isArray(body.pix) ? body.pix : body.txid ? [{ txid: body.txid }] : [];
      if (items.length === 0) {
        return res.status(200).json({ received: true, processed: 0 });
      }

      const txids = items.map((i) => String(i.txid || '').trim()).filter(Boolean);
      if (txids.length === 0) {
        return res.status(200).json({ received: true, processed: 0 });
      }

      const matchedTitles = await db
        .select()
        .from(financialTitles)
        .where(inArray(financialTitles.pixTxid, txids));

      const configs = await db.select().from(bankAccountApiConfigs);
      const validCfgAccounts = new Set(configs.map((c) => c.bankAccountId));

      let processed = 0;
      for (const t of matchedTitles) {
        if (t.bankAccountId && !validCfgAccounts.has(t.bankAccountId)) continue;
        await db
          .update(financialTitles)
          .set({
            pixStatus: 'CONCLUIDA',
            status: 'PAGO',
            currentBalanceCents: 0,
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(financialTitles.id, t.id)));

        if (t.bankAccountId) {
          await db.insert(santanderEmissionLogs).values({
            bankAccountId: t.bankAccountId,
            titleId: t.id,
            apiScope: 'webhook',
            operation: 'WEBHOOK_PIX_LIQUIDACAO',
            environment: 'production',
            executionMode: 'live_mtls',
            endpoint: '/api/santander/webhooks/pix',
            httpStatus: 200,
            ok: true,
            externalRef: t.pixTxid,
            requestSummaryJson: { txid: t.pixTxid },
            responseSummaryJson: { titleId: t.id, pixStatus: 'CONCLUIDA' },
            createdByName: 'Webhook PIX Santander',
          });
        }
        processed++;
        broadcast('finance_updated', { entity: 'financial_title', id: t.id });
      }

      res.json({ received: true, processed });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao processar webhook PIX Santander.') });
    }
  });

  // 13. Emitir ou Reemitir Boleto (com ou sem alteração de vencimento) para títulos marcados
  app.post(
    '/api/santander/titles/emit-reissue',
    requireAuth,
    requireAnyModule('finance', 'audit', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const body = (req.body || {}) as {
          titleIds?: unknown;
          bankAccountId?: unknown;
          alterDueDate?: boolean;
          newDueDate?: string;
          includePixQr?: boolean;
        };

        const rawIds = Array.isArray(body.titleIds) ? body.titleIds : [];
        const titleIds = Array.from(
          new Set(rawIds.map((id) => parsePositiveIntId(id)).filter((id): id is number => id !== null))
        ).slice(0, 100);

        if (titleIds.length === 0) {
          return res.status(400).json({ error: 'Marque ao menos 1 título válido para emitir ou reemitir boleto.' });
        }

        const bankAccountId = body.bankAccountId ? parsePositiveIntId(body.bankAccountId) : undefined;
        if (bankAccountId) {
          const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
          if (!acc || !isUnitPermitted(req, acc.unitId)) {
            return res.status(403).json({ error: 'Conta corrente não encontrada ou sem permissão.' });
          }
          if (acc.apiProvider !== 'santander') {
            return res.status(400).json({
              error: `A conta "${acc.bankName}" não possui integração API Santander para emissão de boletos.`,
            });
          }
        }

        const alterDueDate = Boolean(body.alterDueDate);
        const newDueDate = typeof body.newDueDate === 'string' ? body.newDueDate.trim() : '';
        if (alterDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
          return res.status(400).json({ error: 'Informe uma nova data de vencimento válida (YYYY-MM-DD).' });
        }

        const matchedTitles = await db
          .select()
          .from(financialTitles)
          .where(inArray(financialTitles.id, titleIds));
        const titleMap = new Map(matchedTitles.map((t) => [t.id, t]));

        const actorName = req.authUser?.name || 'Usuário';
        const results: Array<{
          titleId: number;
          documentNumber: string;
          mode: 'EMISSAO' | 'REEMISSAO';
          ok: boolean;
          dueDate?: string;
          ourNumber?: string;
          digitableLine?: string;
          error?: string;
        }> = [];

        let emittedCount = 0;
        let reissuedCount = 0;
        let errorCount = 0;

        for (const tid of titleIds) {
          const t = titleMap.get(tid);
          if (!t) {
            errorCount++;
            results.push({ titleId: tid, documentNumber: `#${tid}`, mode: 'EMISSAO', ok: false, error: 'Título não encontrado.' });
            continue;
          }
          if (!isUnitPermitted(req, t.unitId)) {
            errorCount++;
            results.push({
              titleId: tid,
              documentNumber: t.documentNumber || t.titleCode,
              mode: 'EMISSAO',
              ok: false,
              error: 'Sem permissão nesta unidade.',
            });
            continue;
          }
          const hadBoleto = Boolean(t.barcode || t.digitableLine || t.santanderBankSlipId);
          try {
            const emitted = await emitOrReissueSantanderBoletoForTitle({
              titleId: tid,
              bankAccountId,
              includePixQr: body.includePixQr,
              alterDueDate,
              newDueDate: alterDueDate ? newDueDate : undefined,
              actorName,
            });
            if (emitted.mode === 'REEMISSAO') reissuedCount++;
            else emittedCount++;

            await db.insert(auditLogs).values({
              userId: req.authUser!.id,
              userName: actorName,
              action: emitted.mode === 'REEMISSAO' ? 'SANTANDER_REISSUE_BOLETO' : 'SANTANDER_EMIT_BOLETO',
              entityType: 'financial_title',
              entityId: String(tid),
              details: {
                mode: emitted.mode,
                alterDueDate,
                newDueDate: alterDueDate ? newDueDate : null,
                ourNumber: emitted.ourNumber,
                digitableLine: emitted.digitableLine,
              },
              unitId: t.unitId,
            });

            results.push({
              titleId: tid,
              documentNumber: t.documentNumber || t.titleCode,
              mode: emitted.mode,
              ok: true,
              dueDate: emitted.title?.dueDate ? new Date(emitted.title.dueDate).toISOString() : undefined,
              ourNumber: emitted.ourNumber,
              digitableLine: emitted.digitableLine,
            });
          } catch (err) {
            errorCount++;
            results.push({
              titleId: tid,
              documentNumber: t.documentNumber || t.titleCode,
              mode: hadBoleto ? 'REEMISSAO' : 'EMISSAO',
              ok: false,
              error: err instanceof Error ? err.message : 'Erro ao processar boleto.',
            });
          }
        }

        if (emittedCount + reissuedCount > 0) {
          broadcast('finance_updated', { entity: 'financial_title' });
        }

        res.json({
          emittedCount,
          reissuedCount,
          errorCount,
          results,
        });
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao emitir/reemitir boletos.') });
      }
    }
  );

  // 14. Pré-visualizar títulos em aberto elegíveis para baixa via API Santander
  app.get(
    '/api/santander/settlements/open-preview',
    requireAuth,
    requireAnyModule('finance', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const bankAccountId = req.query.bankAccountId ? parsePositiveIntId(req.query.bankAccountId) : null;
        const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : null;
        const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : null;
        const allowedUnitIds = getAllowedUnitIds(req);
        const preview = await getSantanderOpenTitlesPreview({
          bankAccountId,
          allowedUnitIds,
          startDate,
          endDate,
        });
        res.json(preview);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar prévia de baixa via API.') });
      }
    }
  );

  // 15. Executar consulta & baixa automática de títulos em aberto via API Santander
  app.post(
    '/api/santander/settlements/sync-open',
    requireAuth,
    requireAnyModule('finance', 'collection'),
    async (req: AuthRequest, res: Response) => {
      try {
        const body = (req.body || {}) as {
          bankAccountId?: unknown;
          simulateLiquidatedTitleIds?: unknown;
          startDate?: string | null;
          endDate?: string | null;
          settlementDate?: string;
        };

        const allowedUnitIds = getAllowedUnitIds(req);
        let bankAccountId = parsePositiveIntId(body.bankAccountId);

        if (!bankAccountId) {
          const santAccs = await listConfiguredSantanderAccounts();
          const filtered =
            allowedUnitIds === null
              ? santAccs
              : santAccs.filter((a) => a.unitId === null || allowedUnitIds.includes(a.unitId));
          const defAcc =
            filtered.find((a) => a.isDefaultBoletoAccount && a.apiIntegrationEnabled) ||
            filtered.find((a) => a.apiIntegrationEnabled) ||
            filtered[0];
          if (!defAcc) {
            return res.status(400).json({ error: 'Nenhuma conta corrente Santander configurada.' });
          }
          bankAccountId = defAcc.id;
        }

        const simIds = Array.isArray(body.simulateLiquidatedTitleIds)
          ? body.simulateLiquidatedTitleIds
              .map((id) => parsePositiveIntId(id))
              .filter((id): id is number => id !== null)
          : [];

        const result = await syncSantanderOpenTitlesSettlements({
          bankAccountId,
          allowedUnitIds,
          simulateLiquidatedTitleIds: simIds,
          startDate: typeof body.startDate === 'string' ? body.startDate.trim() : null,
          endDate: typeof body.endDate === 'string' ? body.endDate.trim() : null,
          settlementDate: typeof body.settlementDate === 'string' ? body.settlementDate : undefined,
          actorName: req.authUser?.name || 'Usuário',
          actorId: req.authUser?.id ?? null,
        });

        if (result.baixados.length > 0) {
          broadcast('finance_updated', { entity: 'financial_title' });
        }

        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao processar baixa via API bancária.') });
      }
    }
  );
}

