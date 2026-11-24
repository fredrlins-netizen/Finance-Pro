import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { db, isTransientSqlError, pool, probeDatabaseHealth } from './src/db/index.ts';
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
  companyLegalProcesses,
  negotiations,
  paymentCategories,
  financialTitles,
  collectionCases,
  bearers,
  documentTypes,
  chartOfAccounts,
  bankAccounts,
  bankAccountApiConfigs,
  bankMovements,
  banks,
  unitWhatsappCredentials,
  whatsappThreads,
  whatsappMessages,
  gotalkChannels,
  gotalkOperators,
  gotalkHsmTemplates,
  internalMessages,
  systemSettings,
  auditLogs,
  recalcScenarios,
  scheduleBlocks,
  collaborators,
  whatsappCallLogs,
  communicationArchives,
  type AdmissionScenarioCol,
  type AuditCritiqueRound,
} from './src/db/schema.ts';
import { fillDocxTemplateBuffer, generateAdmissionDocx } from './src/services/docx.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from './src/db/seed.ts';
import { registerCadastrosRoutes, syncFebrabanBanksFromBrasilApi } from './src/routes/cadastrosRoutes.ts';
import { registerConfigRoutes } from './src/routes/configRoutes.ts';
import { registerAppointmentsRoutes } from './src/routes/appointmentsRoutes.ts';
import { registerFinancialRoutes } from './src/routes/financialRoutes.ts';
import { registerAuditRoutes } from './src/routes/auditRoutes.ts';
import { registerCollectionRoutes } from './src/routes/collectionRoutes.ts';
import { registerCollectionTasksRoutes } from './src/routes/collectionTasksRoutes.ts';
import { registerNegotiationsRoutes } from './src/routes/negotiationsRoutes.ts';
import { registerManagerialRoutes } from './src/routes/managerialRoutes.ts';
import { registerFormsRoutes } from './src/routes/formsRoutes.ts';
import { registerReportsRoutes } from './src/routes/reportsRoutes.ts';
import { registerCompanyLegalRoutes } from './src/routes/companyLegalRoutes.ts';
import { registerDataHubRoutes } from './src/routes/dataHubRoutes.ts';
import { registerMigrationRoutes } from './src/routes/migrationRoutes.ts';
import { registerUnitFilesRoutes } from './src/routes/unitFilesRoutes.ts';
import { registerBackupRoutes } from './src/routes/backupRoutes.ts';
import { registerInternalMessagingRoutes } from './src/routes/internalMessagingRoutes.ts';
import { registerTrainingDocsRoutes } from './src/routes/trainingDocsRoutes.ts';
import { registerSantanderRoutes } from './src/routes/santanderRoutes.ts';
import {
  buildUserPermissionSummary,
  evaluateDocumentAccess,
  evaluateScopePermissions,
  loadFolderRulesForUser,
  normalizeFolderPath,
} from './src/services/documentAccessService.ts';
import { ensureSystemModuleDocsSeed } from './src/services/systemDocsCatalog.ts';
import { dispatchIviSectorNotification } from './src/services/internalMessaging.ts';
import { autoAuditRequestMiddleware } from './src/services/autoAudit.ts';
import { getEntityTypeAliases, normalizeAuditLogRecord } from './src/utils/auditDiff.ts';
import { startBackupScheduler } from './src/services/backupScheduler.ts';
import { syncClientLegalAndEscavadorStatus } from './src/services/legalSync.ts';
import { createIviLiveWebSocketServer } from './src/services/iviLiveBridge.ts';
import {
  AuthRequest,
  checkUserScheduleWindow,
  getAllowedUnitIds,
  hashPassword,
  isUnitPermitted,
  normalizeModulePermissions,
  recordSessionActivity,
  requireAdmin,
  requireAnyModule,
  requireAuth,
  requireModule,
  revokeSessionToken,
  signCorporateToken,
  verifyPassword,
  verifySocketSessionToken,
} from './src/middleware/auth.ts';
import {
  parseFiniteNumber,
  parsePositiveIntArray,
  parsePositiveIntId,
  parseSafeDate,
  sanitizeErrorMessage,
} from './src/utils/validation.ts';
import {
  getIviChainConfig,
  iviDraftCollectionMessage,
  iviRespondProspection,
  iviSummarizeConversation,
  iviTranscribeAudioNote,
  iviTranslateLegalDispatch,
  runIviOrchestrator,
} from './src/services/ivi.ts';
import {
  authenticate as authenticateGotalk,
  fetchGotalkAllChannels,
  fetchGotalkHsmTemplates,
  fetchGotalkOperators,
  getGotalkStatus,
  getGotalkWebhookSecret,
  isGotalkConfigured,
  markGotalkWebhookReceived,
  normalizePhone,
  parseAckValue,
  phonesMatchBR,
  runGotalkPostmanParityProbe,
  sendGotalkActiveNotification,
  sendGotalkFile,
  sendGotalkMessage,
  sendGotalkTemplateByName,
  timingSafeEqualStr,
  toGotalkPhone,
} from './src/services/gotalk.ts';
import {
  connectUazapiInstance,
  DEFAULT_UAZAPI_SERVER_URL,
  decryptUazapiToken,
  disconnectUazapiInstance,
  encryptUazapiToken,
  fetchUazapiInstancesWithAdminToken,
  findUazapiChats,
  findUazapiMessages,
  getDefaultUazapiServerUrl,
  getEnvUazapiCredentials,
  getUazapiAdminToken,
  getUazapiGlobalRuntimeState,
  getUazapiInstanceStatus,
  getUazapiWebhookConfig,
  getUazapiWebhookSecret,
  makeUazapiCall,
  markUazapiWebhookReceived,
  registerUazapiWebhook,
  sendUazapiMedia,
  sendUazapiText,
  terminateUazapiCall,
  UazapiCredentials,
} from './src/services/uazapi.ts';
import { hydrateMessagingConfigsFromDb } from './src/services/messagingConfigPersistence.ts';
import {
  canPreviewInline,
  deletePhysicalBucketObjectIfUnreferenced,
  getBucketObjectBuffer,
  getBucketRuntimeStats,
  putBucketObject,
  sanitizeFileName,
  tryProvisionCloudBucket,
  validateUploadFile,
} from './src/services/bucketStorage.ts';
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const CAPTCHA_SECRET = crypto
  .createHash('sha256')
  .update(process.env.SQL_PASSWORD || 'financepro-captcha-secret')
  .digest('hex');

interface CaptchaChallenge {
  id: string;
  mathQuestion: string;
  mathAnswer: number;
  imagePrompt: string;
  targetCategory: string;
  tiles: Array<{ id: string; category: string; label: string }>;
  exp: number;
}

const IMAGE_CATEGORIES = [
  { category: 'veiculo', prompt: 'Selecione todos os blocos de VEÍCULO', labels: ['Veículo Sedan', 'Veículo SUV', 'Pickup'] },
  { category: 'contrato', prompt: 'Selecione todos os blocos de CONTRATO', labels: ['Contrato PDF', 'Procuração', 'Aditivo'] },
  { category: 'seguranca', prompt: 'Selecione todos os blocos de SEGURANÇA', labels: ['Cadeado', 'Chave Digital', 'Escudo'] },
  { category: 'banco', prompt: 'Selecione todos os blocos de BANCO / BOLETO', labels: ['Banco Central', 'Boleto', 'Cofre'] },
];

function createCaptchaChallenge(): { token: string; mathQuestion: string; imagePrompt: string; tiles: Array<{ id: string; category: string; label: string }> } {
  const a = Math.floor(Math.random() * 14) + 4;
  const b = Math.floor(Math.random() * 9) + 2;
  const targetIdx = Math.floor(Math.random() * IMAGE_CATEGORIES.length);
  const target = IMAGE_CATEGORIES[targetIdx];
  const others = IMAGE_CATEGORIES.filter((_, i) => i !== targetIdx);

  const tiles = [
    { id: 't1', category: target.category, label: target.labels[0] },
    { id: 't2', category: target.category, label: target.labels[1] },
    { id: 't3', category: others[0].category, label: others[0].labels[0] },
    { id: 't4', category: others[1].category, label: others[1].labels[0] },
    { id: 't5', category: others[2].category, label: others[2].labels[1] },
    { id: 't6', category: others[0].category, label: others[0].labels[2] },
  ].sort(() => Math.random() - 0.5);

  const challenge: CaptchaChallenge = {
    id: crypto.randomUUID(),
    mathQuestion: `${a} + ${b} = ?`,
    mathAnswer: a + b,
    imagePrompt: target.prompt,
    targetCategory: target.category,
    tiles,
    exp: Date.now() + 10 * 60 * 1000,
  };

  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
  const sig = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('base64url');
  return {
    token: `${payload}.${sig}`,
    mathQuestion: challenge.mathQuestion,
    imagePrompt: challenge.imagePrompt,
    tiles,
  };
}

function verifyCaptchaChallenge(token: string, mathInput: string, selectedTileIds: string[]): { ok: boolean; error?: string } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, error: 'Desafio CAPTCHA ausente.' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, error: 'Token CAPTCHA inválido.' };
  const [payload, sig] = parts;
  if (!payload || !sig) return { ok: false, error: 'Token CAPTCHA inválido.' };
  const expected = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, error: 'Token CAPTCHA inválido.' };
  }
  let challenge: CaptchaChallenge;
  try {
    challenge = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CaptchaChallenge;
  } catch {
    return { ok: false, error: 'Token CAPTCHA corrompido.' };
  }
  if (!challenge || typeof challenge.exp !== 'number' || challenge.exp < Date.now()) {
    return { ok: false, error: 'CAPTCHA expirado. Atualize o desafio.' };
  }
  if (Number(mathInput) !== challenge.mathAnswer) {
    return { ok: false, error: 'Resposta do CAPTCHA matemático incorreta.' };
  }
  const expectedIds = (Array.isArray(challenge.tiles) ? challenge.tiles : [])
    .filter((t) => t.category === challenge.targetCategory)
    .map((t) => t.id)
    .sort();
  const receivedIds = [...new Set(Array.isArray(selectedTileIds) ? selectedTileIds : [])].sort();
  if (expectedIds.length !== receivedIds.length || expectedIds.some((id, idx) => id !== receivedIds[idx])) {
    return { ok: false, error: 'Seleção do CAPTCHA de imagens incorreta.' };
  }
  return { ok: true };
}

let sqlProxyChild: ChildProcess | null = null;
let ensureProxyPromise: Promise<void> | null = null;
let lastProxyFailureAt = 0;
let lastSqlVerifiedAt = 0;
let proxySignalHandlersRegistered = false;
const SQL_HEALTH_RECHECK_MS = 30_000;

function testUnixSocket(socketPath: string): Promise<'ok' | 'econnrefused' | 'enoent'> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection(socketPath);
    const done = (result: 'ok' | 'econnrefused' | 'enoent') => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done('ok'));
    socket.once('timeout', () => done('econnrefused'));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') done('enoent');
      else done('econnrefused');
    });
  });
}

async function terminateStaleSqlProxies(instanceConnection: string): Promise<void> {
  if (sqlProxyChild && sqlProxyChild.exitCode === null && !sqlProxyChild.killed) {
    try {
      sqlProxyChild.kill('SIGTERM');
    } catch {
      // ignore kill failure
    }
    sqlProxyChild = null;
  }

  const pidsToStop: number[] = [];
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (!pid || pid === process.pid) continue;
      try {
        const cmdRaw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        if (cmdRaw.includes('/app/cloud_sql_proxy') && cmdRaw.includes(instanceConnection)) {
          pidsToStop.push(pid);
        }
      } catch {
        // process may have exited
      }
    }
  } catch {
    // /proc unavailable
  }

  for (const pid of pidsToStop) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
  if (pidsToStop.length > 0) {
    await new Promise((r) => setTimeout(r, 300));
    for (const pid of pidsToStop) {
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }
}

async function ensureSqlHostProxySocket(force = false): Promise<void> {
  const sqlHost = (process.env.SQL_HOST || '').trim();
  if (!sqlHost.startsWith('/app/cloudsql/')) return;
  if (!fs.existsSync('/app/cloud_sql_proxy')) return;

  const instanceConnection = path.basename(sqlHost);
  if (!instanceConnection || !instanceConnection.includes(':')) return;

  if (!force && Date.now() - lastProxyFailureAt < 5000 && lastProxyFailureAt > 0) {
    return;
  }

  if (ensureProxyPromise) {
    return ensureProxyPromise;
  }

  const socketPath = path.join(sqlHost, '.s.PGSQL.5432');

  ensureProxyPromise = (async () => {
    try {
      const status = await testUnixSocket(socketPath);
      if (status === 'ok') {
        if (!force && Date.now() - lastSqlVerifiedAt < SQL_HEALTH_RECHECK_MS) {
          return;
        }
        const sqlHealthy = await probeDatabaseHealth(3500);
        if (sqlHealthy) {
          lastSqlVerifiedAt = Date.now();
          lastProxyFailureAt = 0;
          return;
        }
        console.warn('[cloud_sql_proxy] Socket responded locally but SQL probe failed; restarting stale proxy...');
        await terminateStaleSqlProxies(instanceConnection);
        try {
          if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        } catch {
          // ignore unlink error
        }
      } else {
        if (status === 'econnrefused') {
          try {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
          } catch {
            // ignore unlink errors if race cleared it
          }
        }
        await terminateStaleSqlProxies(instanceConnection);
      }

      if (!proxySignalHandlersRegistered) {
        proxySignalHandlersRegistered = true;
        const cleanupProxy = () => {
          if (sqlProxyChild && sqlProxyChild.exitCode === null && !sqlProxyChild.killed) {
            try {
              sqlProxyChild.kill('SIGTERM');
            } catch {
              // ignore cleanup failure
            }
          }
        };
        process.once('SIGINT', cleanupProxy);
        process.once('SIGTERM', cleanupProxy);
      }

      const child = spawn(
        '/app/cloud_sql_proxy',
        [
          instanceConnection,
          '--unix-socket=/app/cloudsql',
          '--sql-data',
          '--sql-data-endpoint=sqladmin.googleapis.com',
          '--sqladmin-api-endpoint=sqladmin.googleapis.com',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      sqlProxyChild = child;

      child.stderr?.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text && /error|failed|denied/i.test(text)) {
          console.error('[cloud_sql_proxy]', text);
        }
      });

      child.on('exit', () => {
        if (sqlProxyChild === child) {
          sqlProxyChild = null;
          lastSqlVerifiedAt = 0;
        }
      });

      let connected = false;
      for (let i = 0; i < 40; i++) {
        if (child.exitCode !== null || child.killed) break;
        if ((await testUnixSocket(socketPath)) === 'ok') {
          connected = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      if (connected && (await probeDatabaseHealth(5000))) {
        lastSqlVerifiedAt = Date.now();
        lastProxyFailureAt = 0;
      } else {
        lastSqlVerifiedAt = 0;
        lastProxyFailureAt = Date.now();
      }
    } catch (err) {
      lastSqlVerifiedAt = 0;
      lastProxyFailureAt = Date.now();
      console.error('ensureSqlHostProxySocket warning:', err);
    } finally {
      ensureProxyPromise = null;
    }
  })();

  return ensureProxyPromise;
}

async function startServer() {
  await ensureSqlHostProxySocket(true);
  await hydrateMessagingConfigsFromDb();
  const app = express();
  app.disable('x-powered-by');

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const iviLiveWss = createIviLiveWebSocketServer();
  const wsAuthMap = new Map<WebSocket, { authenticated: boolean; userId: number; role: string; allowedUnitIds: number[] }>();

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/ivi-live') {
      iviLiveWss.handleUpgrade(request, socket, head);
    }
  });

  const broadcast = (event: string, payload: unknown) => {
    const payloadObj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    const targetUnit =
      typeof payloadObj?.targetUnitId === 'number'
        ? payloadObj.targetUnitId
        : typeof payloadObj?.unitId === 'number'
        ? payloadObj.unitId
        : null;
    const msg = JSON.stringify({ event, payload, ts: Date.now() });
    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      const authInfo = wsAuthMap.get(client);
      if (!authInfo?.authenticated) return;
      if (targetUnit !== null && authInfo.role !== 'admin' && !authInfo.allowedUnitIds.includes(targetUnit)) {
        return;
      }
      client.send(msg);
    });
  };

  wss.on('connection', (ws) => {
    const authTimer = setTimeout(() => {
      if (!wsAuthMap.get(ws)?.authenticated) {
        try {
          ws.close(4001, 'Authentication required');
        } catch {
          // ignore
        }
      }
    }, 5000);

    ws.on('message', async (rawData) => {
      try {
        const parsed = JSON.parse(String(rawData || '{}')) as { type?: string; token?: string };
        if (parsed.type === 'auth' && typeof parsed.token === 'string') {
          const verified = await verifySocketSessionToken(parsed.token.trim());
          if (!verified) {
            clearTimeout(authTimer);
            wsAuthMap.delete(ws);
            ws.close(4001, 'Invalid session');
            return;
          }
          clearTimeout(authTimer);
          wsAuthMap.set(ws, {
            authenticated: true,
            userId: verified.userId,
            role: verified.role,
            allowedUnitIds: verified.allowedUnitIds,
          });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'connected', payload: { status: 'online' } }));
          }
        }
      } catch {
        // ignore invalid socket frames
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      wsAuthMap.delete(ws);
    });
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(autoAuditRequestMiddleware);

  async function runWithSqlReconnect<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientSqlError(err)) throw err;
      lastSqlVerifiedAt = 0;
      await ensureSqlHostProxySocket(true);
      return await fn();
    }
  }

  app.use('/api', async (req, _res, next) => {
    if (req.path === '/health' || req.path === '/auth/captcha') return next();
    if (
      !sqlProxyChild ||
      sqlProxyChild.exitCode !== null ||
      sqlProxyChild.killed ||
      Date.now() - lastSqlVerifiedAt >= SQL_HEALTH_RECHECK_MS
    ) {
      await ensureSqlHostProxySocket(false);
    }
    next();
  });

  // Public health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'FinancePro Assessoria' });
  });

  // Public CAPTCHA endpoint
  app.get('/api/auth/captcha', (_req, res) => {
    res.json(createCaptchaChallenge());
  });

  // Public Corporate Login (Email + Password + Math CAPTCHA + Image CAPTCHA + Schedule Enforcement)
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password, captchaToken, mathAnswer, selectedTiles } = req.body as {
        email: string;
        password: string;
        captchaToken: string;
        mathAnswer: string;
        selectedTiles: string[];
      };

      const cap = verifyCaptchaChallenge(captchaToken, mathAnswer, selectedTiles || []);
      if (!cap.ok) {
        return res.status(400).json({ error: cap.error });
      }

      const authPayload = await runWithSqlReconnect(async () => {
        await ensureInitialSeed();
        const rows = await db
          .select()
          .from(users)
          .where(eq(users.email, (email || '').trim().toLowerCase()))
          .limit(1);
        const user = rows[0];
        if (!user || !user.active) {
          return { status: 401 as const, body: { error: 'E-mail não cadastrado ou usuário inativo.' } };
        }

        if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
          const minsLeft = Math.max(1, Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000));
          return {
            status: 423 as const,
            body: {
              error: `Conta temporariamente bloqueada por tentativas inválidas. Aguarde ${minsLeft} min ou use "Esqueci a senha".`,
            },
          };
        }

        const matchesPassword = verifyPassword(password || '', user.passwordHash);
        const matchesTemp = Boolean(user.tempPassword && password === user.tempPassword);
        if (!matchesPassword && !matchesTemp) {
          const nextAttempts = (user.failedLoginAttempts || 0) + 1;
          const lockUntil = nextAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
          await db
            .update(users)
            .set({ failedLoginAttempts: nextAttempts, ...(lockUntil ? { lockedUntil: lockUntil } : {}) })
            .where(eq(users.id, user.id));
          return {
            status: 401 as const,
            body: {
              error: lockUntil
                ? 'Limite de 5 tentativas atingido. Conta bloqueada por 15 minutos.'
                : `Senha incorreta. Tentativa ${nextAttempts}/5.`,
            },
          };
        }

        const scheduleCheck = await checkUserScheduleWindow(user, user.defaultUnitId || 1);
        if (!scheduleCheck.allowed) {
          return { status: 403 as const, body: { error: scheduleCheck.message } };
        }

        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await db
            .update(users)
            .set({ failedLoginAttempts: 0, lockedUntil: null })
            .where(eq(users.id, user.id));
        }

        const token = signCorporateToken({
          userId: user.id,
          uid: user.uid,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion || 1,
        });
        recordSessionActivity(token);

        await db.insert(auditLogs).values({
          userId: user.id,
          userName: user.name,
          action: 'LOGIN_CORPORATIVO',
          entityType: 'user',
          entityId: String(user.id),
          details: { method: matchesTemp ? 'temp_password' : 'password_dual_captcha' },
          unitId: user.defaultUnitId,
        });

        return {
          status: 200 as const,
          body: {
            token,
            user: {
              id: user.id,
              uid: user.uid,
              email: user.email,
              name: user.name,
              role: user.role,
              groupId: user.groupId,
              defaultUnitId: user.defaultUnitId,
              allowedUnitIds: user.allowedUnitIds,
              mustChangePassword: user.mustChangePassword || matchesTemp,
              points: user.points,
            },
          },
        };
      });

      return res.status(authPayload.status).json(authPayload.body);
    } catch (error) {
      console.error('Login failed:', error);
      if (isTransientSqlError(error)) {
        return res.status(503).json({
          error: 'Conexão com o banco de dados em reconexão automática. Tente entrar novamente em alguns segundos.',
        });
      }
      res.status(500).json({ error: 'Falha interna ao autenticar.' });
    }
  });

  // Protected: Sync active user interaction (resets 3-hour idle timer)
  app.post('/api/auth/activity', requireAuth, (_req: AuthRequest, res) => {
    res.json({ ok: true });
  });

  // Protected/Graceful: Explicit Logout (revokes current token immediately on backend)
  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const tok = authHeader.split('Bearer ')[1]?.trim();
      if (tok) revokeSessionToken(tok);
    }
    res.json({ ok: true });
  });

  // Public Forgot Password (generates temp password internally and notifies admin, zero credential/PII leak in HTTP response)
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      await ensureInitialSeed();
      const { email } = req.body as { email: string };
      const cleanEmail = (email || '').trim().toLowerCase();
      const genericMsg =
        'Se o e-mail estiver cadastrado, o administrador foi notificado pelos canais internos para liberação segura da senha temporária.';
      if (!cleanEmail) {
        return res.status(400).json({ error: 'Informe o e-mail corporativo.' });
      }
      const rows = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
      const targetUser = rows[0];
      if (!targetUser || !targetUser.active) {
        return res.json({ message: genericMsg });
      }

      const tempPassword = `FP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      await db
        .update(users)
        .set({ tempPassword, mustChangePassword: true })
        .where(eq(users.id, targetUser.id));

      // Notify Admin via Internal Message + WhatsApp Thread log (no secret returned to caller)
      const admins = await db.select().from(users).where(eq(users.role, 'admin'));
      const adminTarget = admins[0];
      const alertText = `[ALERTA SEGURANÇA] Colaborador ${targetUser.name} solicitou redefinição de senha em ${new Date().toLocaleString('pt-BR')}.`;

      if (adminTarget) {
        await db.insert(internalMessages).values({
          senderId: targetUser.id,
          senderName: 'Segurança FinancePro',
          recipientId: adminTarget.id,
          targetSector: 'administracao',
          subject: 'Solicitação de Esqueci a Senha',
          body: alertText,
        });
      }

      const threads = await db.select().from(whatsappThreads).limit(1);
      if (threads[0]) {
        await db.insert(whatsappMessages).values({
          threadId: threads[0].id,
          direction: 'outbound',
          contentType: 'text',
          body: `[Alerta Segurança Admin] ${alertText}`,
          senderName: 'Ivi Segurança',
        });
      }

      await db.insert(auditLogs).values({
        userId: targetUser.id,
        userName: targetUser.name,
        action: 'FORGOT_PASSWORD_REQUEST',
        entityType: 'user',
        entityId: String(targetUser.id),
        details: { requestRecorded: true },
        unitId: targetUser.defaultUnitId,
      });

      broadcast('internal:message', {
        subject: 'Solicitação de Esqueci a Senha',
        targetUnitId: adminTarget?.defaultUnitId || 1,
      });

      res.json({ message: genericMsg });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Falha ao processar recuperação de senha.' });
    }
  });

  // Protected: Change password (required after temp password login)
  app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { newPassword } = req.body as { newPassword: string };
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      }
      await db
        .update(users)
        .set({
          passwordHash: hashPassword(newPassword),
          tempPassword: null,
          mustChangePassword: false,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, req.authUser!.id));
      res.json({ ok: true });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Erro ao atualizar senha.' });
    }
  });

  // Protected: Current session + allowed units + group permissions
  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const [allUnits, folderRules] = await Promise.all([
        db.select().from(units).orderBy(units.id),
        loadFolderRulesForUser(),
      ]);
      const allowedUnits =
        req.authUser!.role === 'admin'
          ? allUnits
          : allUnits.filter((u) => req.authUser!.allowedUnitIds.includes(u.id));
      const groups = req.authUser!.groupId
        ? await db.select().from(userGroups).where(eq(userGroups.id, req.authUser!.groupId))
        : [];
      const group = groups[0]
        ? { ...groups[0], modulePermissions: normalizeModulePermissions(groups[0].modulePermissions) }
        : null;
      const docPermissionSummary = buildUserPermissionSummary(
        req.authUser!,
        req.activeUnitId || 1,
        folderRules
      );
      res.json({
        user: req.authUser,
        activeUnitId: req.activeUnitId,
        units: allowedUnits,
        allUnits,
        group,
        docPermissionSummary,
      });
    } catch (error) {
      console.error('Auth me error:', error);
      res.status(500).json({ error: 'Erro ao carregar perfil.' });
    }
  });

  // ---------------------------------------------------------------------------
  // LOOKUPS EXTERNOS (ViaCEP & BrasilAPI / FEBRABAN) - PRD Seção 8
  // ---------------------------------------------------------------------------
  app.get('/api/lookup/cep/:cep', requireAuth, async (req: AuthRequest, res) => {
    const cleanCep = (req.params.cep || '').replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      return res.status(400).json({ error: 'CEP deve conter 8 dígitos.' });
    }
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = (await resp.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string; cep?: string };
      if (data.erro) return res.status(404).json({ error: 'CEP não localizado na base ViaCEP.' });
      res.json({
        cep: data.cep || cleanCep,
        address: [data.logradouro, data.bairro].filter(Boolean).join(' - '),
        city: data.localidade || '',
        state: data.uf || '',
      });
    } catch {
      res.status(502).json({ error: 'Serviço ViaCEP indisponível no momento.' });
    }
  });

  app.get('/api/lookup/banks', requireAuth, async (_req: AuthRequest, res) => {
    const fallbackBanks = [
      { code: 33, name: 'Banco Santander (Brasil) S.A.' },
      { code: 655, name: 'Banco Votorantim / BV Financeira' },
      { code: 341, name: 'Itaú Unibanco / Itaucard' },
      { code: 237, name: 'Banco Bradesco Financiamentos' },
      { code: 1, name: 'Banco do Brasil S.A.' },
      { code: 104, name: 'Caixa Econômica Federal' },
      { code: 623, name: 'Banco Pan S.A.' },
      { code: 336, name: 'Banco C6 S.A.' },
      { code: 260, name: 'Nu Pagamentos S.A. (Nubank)' },
      { code: 403, name: 'Cora SCD S.A.' },
    ];
    try {
      const resp = await fetch('https://brasilapi.com.br/api/banks/v1', {
        signal: AbortSignal.timeout(4000),
      });
      if (!resp.ok) return res.json({ banks: fallbackBanks, source: 'febraban_cache' });
      const raw = (await resp.json()) as Array<{ code: number | null; name: string; fullName?: string }>;
      const banks = raw
        .filter((b) => b.code && b.name)
        .slice(0, 80)
        .map((b) => ({ code: b.code!, name: b.fullName || b.name }));
      res.json({ banks: banks.length ? banks : fallbackBanks, source: 'brasilapi' });
    } catch {
      res.json({ banks: fallbackBanks, source: 'febraban_cache' });
    }
  });

  // Protected: Bootstrap / Overview Dashboard (escopado por unidades autorizadas)
  app.get('/api/overview', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (typeof uId === 'number' && allowedUnits.includes(uId));

      const [allUnits, allClients, allAdmissions, allLeads, allAppointments, allProcesses, allNegotiations, allTitles, allCases, allDocs, allUsers, allMsgs] =
        await Promise.all([
          db.select().from(units).orderBy(units.id),
          db.select({ id: clients.id, unitId: clients.unitId }).from(clients),
          db.select().from(admissions).orderBy(desc(admissions.id)),
          db.select().from(prospectionLeads).orderBy(desc(prospectionLeads.id)),
          db.select().from(appointments).orderBy(desc(appointments.scheduledFor)),
          db.select().from(legalProcesses).orderBy(desc(legalProcesses.id)),
          db.select().from(negotiations).orderBy(desc(negotiations.id)),
          db.select().from(financialTitles).orderBy(desc(financialTitles.dueDate)),
          db.select().from(collectionCases).orderBy(desc(collectionCases.id)),
          db.select({ id: documentObjects.id, unitId: documentObjects.unitId, sizeBytes: documentObjects.sizeBytes, deletedAt: documentObjects.deletedAt }).from(documentObjects),
          db.select({ id: users.id, name: users.name, role: users.role, points: users.points, defaultUnitId: users.defaultUnitId }).from(users),
          db.select().from(internalMessages).orderBy(desc(internalMessages.id)).limit(25),
        ]);

      const scopedDocs = allDocs.filter((d) => !d.deletedAt && allowUnit(d.unitId));
      const scopedClients = allClients.filter((c) => allowUnit(c.unitId));

      res.json({
        units: allowedUnits === null ? allUnits : allUnits.filter((u) => allowedUnits.includes(u.id)),
        clientsCount: scopedClients.length,
        admissions: allAdmissions.filter((a) => allowUnit(a.unitId)),
        leads: allLeads.filter((l) => allowUnit(l.unitId)),
        appointments: allAppointments.filter((a) => allowUnit(a.unitId)),
        processes: allProcesses.filter((p) => allowUnit(p.unitId)),
        negotiations: allNegotiations.filter((n) => allowUnit(n.unitId)),
        titles: allTitles.filter((t) => allowUnit(t.unitId)),
        collectionCases: allCases.filter((c) => allowUnit(c.unitId)),
        documentsCount: scopedDocs.length,
        totalVaultBytes: scopedDocs.reduce((acc, d) => acc + Number(d.sizeBytes || 0), 0),
        collaborators: allowedUnits === null ? allUsers : allUsers.filter((u) => !u.defaultUnitId || allowUnit(u.defaultUnitId)),
        internalMessages: allMsgs
          .filter((m) => m.targetUnitId === null || allowUnit(m.targetUnitId))
          .slice(0, 15),
      });
    } catch (error) {
      console.error('Overview error:', error);
      res.status(500).json({ error: 'Erro ao carregar resumo executivo.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. PROSPECÇÃO, AGENDA & BLOQUEIOS (schedule_blocks) + IVI
  // ---------------------------------------------------------------------------
  function formatPhoneWithPlus55(raw: string): string {
    const trimmed = String(raw || '').trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return '+55 ';
    const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    if (local.length === 11) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }
    return `+55 ${local}`;
  }

  function parseDataUriBuffer(dataUri: string, defaultMime = 'audio/webm'): { buffer: Buffer; mimeType: string } | null {
    const m = /^data:([^;,]+)?;base64,(.+)$/i.exec(String(dataUri || '').trim());
    if (!m) return null;
    try {
      const mimeType = m[1] || defaultMime;
      const buffer = Buffer.from(m[2], 'base64');
      if (!buffer.length) return null;
      return { buffer, mimeType };
    } catch {
      return null;
    }
  }

  async function downloadMediaToBucket(
    url: string,
    opts: { folderPath: string; fileName: string; fallbackMime: string; headers?: Record<string, string> }
  ): Promise<{
    sha256Hash: string;
    storageUri: string;
    mimeType: string;
    sizeBytes: number;
    dataUri: string;
  } | null> {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const resp = await fetch(url, {
        headers: opts.headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return null;
      const arr = await resp.arrayBuffer();
      const buffer = Buffer.from(arr);
      if (!buffer.length || buffer.length > 25 * 1024 * 1024) return null;
      const mimeType = (resp.headers.get('content-type') || opts.fallbackMime).split(';')[0].trim();
      const stored = await putBucketObject(buffer, {
        folderPath: opts.folderPath,
        mimeType,
        originalName: sanitizeFileName(opts.fileName),
      });
      return {
        sha256Hash: stored.sha256Hash,
        storageUri: stored.storageUri,
        mimeType,
        sizeBytes: stored.sizeBytes,
        dataUri: `data:${mimeType};base64,${buffer.toString('base64')}`,
      };
    } catch {
      return null;
    }
  }

  async function archiveLeadConversationSnapshot(
    leadId: number,
    providerOverride?: string,
    actorName = 'Sistema'
  ): Promise<{ archive: typeof communicationArchives.$inferSelect; lead: typeof prospectionLeads.$inferSelect } | null> {
    const leadRows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return null;

    const callRows = await db
      .select()
      .from(whatsappCallLogs)
      .where(eq(whatsappCallLogs.leadId, lead.id))
      .orderBy(desc(whatsappCallLogs.createdAt));

    const threadRows = lead.primaryThreadId
      ? await db
          .select()
          .from(whatsappMessages)
          .where(eq(whatsappMessages.threadId, lead.primaryThreadId))
          .orderBy(whatsappMessages.createdAt)
      : [];

    const snapshotObj = {
      schemaVersion: '1.0',
      archivedAt: new Date().toISOString(),
      archivedBy: actorName,
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        channel: lead.channel,
        stage: lead.stage,
        unitId: lead.unitId,
        summaryText: lead.summaryText,
        summaryAuthor: lead.summaryAuthor,
        summaryUpdatedAt: lead.summaryUpdatedAt,
      },
      timeline: lead.aiTranscript || [],
      callLogs: callRows,
      whatsappMessages: threadRows,
    };

    const jsonBuffer = Buffer.from(JSON.stringify(snapshotObj, null, 2), 'utf8');
    const fileName = `conversa-lead-${lead.id}-${Date.now()}.json`;
    const stored = await putBucketObject(jsonBuffer, {
      folderPath: `bucketdainvicta/U${lead.unitId}/CONVERSATIONS/L${lead.id}`,
      mimeType: 'application/json',
      originalName: fileName,
    });

    const provider =
      providerOverride ||
      (lead.channel === 'whatsapp_uazapi'
        ? 'uazapi'
        : lead.channel === 'whatsapp_gotalk'
        ? 'gotalk'
        : 'telefone');

    const [archive] = await db
      .insert(communicationArchives)
      .values({
        unitId: lead.unitId,
        leadId: lead.id,
        threadId: lead.primaryThreadId ?? null,
        callLogId: callRows[0]?.id ?? null,
        provider,
        archiveType: 'conversation_snapshot',
        contactName: lead.name || 'Cliente WhatsApp',
        contactPhone: lead.phone,
        fileName,
        mimeType: 'application/json',
        sizeBytes: stored.sizeBytes,
        sha256Hash: stored.sha256Hash,
        storageUri: stored.storageUri,
        transcriptText: lead.summaryText || '',
        createdByName: actorName,
      })
      .returning();

    const [updatedLead] = await db
      .update(prospectionLeads)
      .set({
        lastArchiveSha256: stored.sha256Hash,
        lastArchiveAt: new Date(),
      })
      .where(eq(prospectionLeads.id, lead.id))
      .returning();

    return { archive, lead: updatedLead || lead };
  }

  async function mirrorCommunicationToProspection(params: {
    unitId: number;
    phone: string;
    contactName: string;
    channel: 'whatsapp_gotalk' | 'whatsapp_uazapi' | 'telefone';
    provider: 'gotalk' | 'uazapi' | 'telefone';
    threadId?: number | null;
    direction: 'inbound' | 'outbound';
    contentType: 'text' | 'audio' | 'image' | 'document' | 'call';
    body: string;
    audioTranscript?: string | null;
    authorName?: string;
    externalMessageId?: string | null;
    callId?: string | null;
    mediaSha256?: string | null;
    mediaStorageUri?: string | null;
    mediaMimeType?: string | null;
    mediaFileName?: string | null;
    timestamp?: Date;
    triggerIviAutoSummarize?: boolean;
  }): Promise<typeof prospectionLeads.$inferSelect | null> {
    try {
      const allLeads = await db.select().from(prospectionLeads);
      let lead =
        (params.threadId && allLeads.find((l) => l.primaryThreadId === params.threadId)) ||
        allLeads.find((l) => phonesMatchBR(l.phone, params.phone));

      const rawNameClean = String(params.contactName || '').trim();
      const nameIsDigitsOnly =
        !rawNameClean || rawNameClean.replace(/\D/g, '').length >= 8 && rawNameClean.replace(/[\s()+-]/g, '') === rawNameClean.replace(/\D/g, '');
      const formattedPhone = formatPhoneWithPlus55(params.phone);

      const newItem = {
        sender: params.direction === 'inbound' ? 'cliente' : 'operador',
        text: params.body || `[${params.contentType.toUpperCase()}]`,
        provider: params.provider,
        type: (params.contentType === 'audio' ? 'audio' : params.contentType === 'call' ? 'call' : 'text') as 'text' | 'audio' | 'call',
        audioTranscript: params.audioTranscript || undefined,
        authorName: params.authorName || undefined,
        callId: params.callId || undefined,
        mediaSha256: params.mediaSha256 || undefined,
        mediaStorageUri: params.mediaStorageUri || undefined,
        mediaMimeType: params.mediaMimeType || undefined,
        mediaFileName: params.mediaFileName || undefined,
        sourceProvider: params.provider,
        externalMessageId: params.externalMessageId || undefined,
        timestamp: (params.timestamp || new Date()).toISOString(),
      };

      if (!lead) {
        const initialTranscript = [newItem];
        let summaryText = '';
        let summaryAuthor = '';
        let summaryUpdatedAt: Date | null = null;
        if (params.triggerIviAutoSummarize !== false && params.contentType !== 'call') {
          const sumRes = await iviSummarizeConversation({
            leadName: nameIsDigitsOnly ? 'Cliente WhatsApp' : rawNameClean,
            channel: params.channel,
            transcript: initialTranscript,
          });
          summaryText = sumRes.summary;
          summaryAuthor = 'Ivi IA';
          summaryUpdatedAt = new Date();
        }
        const [created] = await db
          .insert(prospectionLeads)
          .values({
            name: nameIsDigitsOnly ? '' : rawNameClean,
            phone: formattedPhone,
            email: '',
            channel: params.channel,
            unitId: params.unitId || 1,
            stage: params.direction === 'inbound' ? 'em_atendimento_ivi' : 'escalado_humano',
            iviProviderUsed: 'gemini',
            aiTranscript: initialTranscript,
            summaryText,
            summaryAuthor,
            summaryUpdatedAt,
            hasPhoneCall: params.contentType === 'call',
            primaryThreadId: params.threadId ?? null,
            lastMessageAt: params.timestamp || new Date(),
          })
          .returning();
        lead = created;
      } else {
        const existingTranscript = Array.isArray(lead.aiTranscript) ? lead.aiTranscript : [];
        if (
          params.externalMessageId &&
          existingTranscript.some((item) => item.externalMessageId === params.externalMessageId)
        ) {
          return lead;
        }
        const nextTranscript = [...existingTranscript, newItem];
        let nextSummaryText = lead.summaryText;
        let nextSummaryAuthor = lead.summaryAuthor;
        let nextSummaryUpdatedAt = lead.summaryUpdatedAt;

        if (params.triggerIviAutoSummarize && params.contentType !== 'call') {
          const sumRes = await iviSummarizeConversation({
            leadName: lead.name || 'Cliente sem nome',
            channel: lead.channel,
            transcript: nextTranscript,
          });
          nextSummaryText = sumRes.summary;
          nextSummaryAuthor = params.authorName || 'Ivi IA';
          nextSummaryUpdatedAt = new Date();
        }

        const [updated] = await db
          .update(prospectionLeads)
          .set({
            primaryThreadId: lead.primaryThreadId ?? params.threadId ?? null,
            hasPhoneCall: lead.hasPhoneCall || params.contentType === 'call',
            aiTranscript: nextTranscript,
            summaryText: nextSummaryText,
            summaryAuthor: nextSummaryAuthor,
            summaryUpdatedAt: nextSummaryUpdatedAt,
            lastMessageAt: params.timestamp || new Date(),
          })
          .where(eq(prospectionLeads.id, lead.id))
          .returning();
        lead = updated || lead;
      }

      if (lead) {
        await archiveLeadConversationSnapshot(lead.id, params.provider, params.authorName || 'Sistema');
      }
      return lead;
    } catch (err) {
      console.warn('mirrorCommunicationToProspection warning:', err);
      return null;
    }
  }

  app.get('/api/prospection', requireAuth, requireModule('prospection'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const allowUnit = (uId: number | null | undefined) =>
        allowedUnits === null || (typeof uId === 'number' && allowedUnits.includes(uId));

      const [leads, kb, appts, allUsers, blocks, callLogs, archives] = await Promise.all([
        db.select().from(prospectionLeads).orderBy(desc(prospectionLeads.lastMessageAt)),
        db
          .select()
          .from(iviKnowledgeArticles)
          .where(and(eq(iviKnowledgeArticles.scope, 'prospection'), eq(iviKnowledgeArticles.active, true)))
          .orderBy(desc(iviKnowledgeArticles.hitCount), desc(iviKnowledgeArticles.id)),
        db.select().from(appointments).orderBy(desc(appointments.scheduledFor)),
        db.select({ id: users.id, name: users.name, role: users.role, defaultUnitId: users.defaultUnitId }).from(users),
        db.select().from(scheduleBlocks).orderBy(desc(scheduleBlocks.startAt)),
        db.select().from(whatsappCallLogs).orderBy(desc(whatsappCallLogs.createdAt)).limit(150),
        db.select().from(communicationArchives).orderBy(desc(communicationArchives.createdAt)).limit(250),
      ]);
      res.json({
        leads: leads.filter((l) => allowUnit(l.unitId)),
        knowledgeBase: kb,
        appointments: appts.filter((a) => allowUnit(a.unitId)),
        consultants: allowedUnits === null ? allUsers : allUsers.filter((u) => !u.defaultUnitId || allowUnit(u.defaultUnitId)),
        scheduleBlocks: blocks.filter((b) => allowUnit(b.unitId)),
        callLogs: callLogs.filter((c) => allowUnit(c.unitId)),
        archives: archives.filter((a) => allowUnit(a.unitId)),
      });
    } catch (error) {
      console.error('Prospection get error:', error);
      res.status(500).json({ error: 'Erro ao carregar prospecção.' });
    }
  });

  app.post('/api/prospection/schedule-blocks', requireAuth, requireModule('prospection'), async (req: AuthRequest, res) => {
    try {
      const { consultantId, unitId, startAt, endAt, reason } = req.body as {
        consultantId: number;
        unitId?: number;
        startAt: string;
        endAt: string;
        reason: string;
      };
      const parsedConsultantId = parsePositiveIntId(consultantId);
      if (!parsedConsultantId) return res.status(400).json({ error: 'Consultor inválido.' });
      const start = parseSafeDate(startAt);
      const end = parseSafeDate(endAt);
      if (!start || !end || end <= start) {
        return res.status(400).json({ error: 'Período de bloqueio inválido (início/fim).' });
      }
      if (!reason?.trim()) return res.status(400).json({ error: 'Informe o motivo do bloqueio de agenda.' });
      const targetUnitId = unitId ? parsePositiveIntId(unitId) : (req.activeUnitId || 1);
      if (!targetUnitId || !isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada.' });
      }
      const [block] = await db
        .insert(scheduleBlocks)
        .values({
          consultantId: parsedConsultantId,
          unitId: targetUnitId,
          startAt: start,
          endAt: end,
          reason: reason.trim(),
          createdBy: req.authUser!.name,
        })
        .returning();
      res.json({ block });
    } catch (error) {
      console.error('Schedule block error:', error);
      res.status(500).json({ error: 'Erro ao registrar bloqueio de agenda.' });
    }
  });

  app.post('/api/prospection/leads', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { name, phone, email, channel, unitId, initialMessage, mode } = req.body as {
        name?: string;
        phone: string;
        email?: string;
        channel: string;
        unitId?: number;
        initialMessage?: string;
        mode?: 'ivi' | 'human';
      };
      const targetUnit = unitId !== undefined && unitId !== null ? parsePositiveIntId(unitId) : (req.activeUnitId || 1);
      if (!targetUnit || !isUnitPermitted(req, targetUnit)) {
        return res.status(403).json({ error: 'Unidade inválida ou não autorizada.' });
      }
      if (!phone || !String(phone).trim()) {
        return res.status(400).json({ error: 'Telefone do lead é obrigatório.' });
      }
      const cleanName = String(name || '').trim();
      const formattedPhone = formatPhoneWithPlus55(String(phone));
      const isPhoneChannel = channel === 'telefone';
      const transcript: Array<{
        sender: string;
        text: string;
        provider?: string;
        timestamp: string;
        type?: 'text' | 'audio' | 'call';
        authorName?: string;
      }> = [];
      let stage = mode === 'human' ? 'escalado_humano' : 'novo';
      let providerUsed = 'gemini';
      let summaryText = '';
      let summaryAuthor = '';
      let summaryUpdatedAt: Date | null = null;

      if (initialMessage?.trim()) {
        transcript.push({
          sender: 'cliente',
          text: initialMessage.trim(),
          type: isPhoneChannel ? 'call' : 'text',
          timestamp: new Date().toISOString(),
        });
        if (mode !== 'human' && !isPhoneChannel) {
          const iviRes = await iviRespondProspection(initialMessage, channel, cleanName || 'Cliente WhatsApp');
          providerUsed = iviRes.provider;
          stage = iviRes.needsHuman ? 'escalado_humano' : 'em_atendimento_ivi';
          transcript.push({
            sender: 'ivi',
            text: iviRes.reply,
            provider: iviRes.provider,
            type: 'text',
            authorName: 'Ivi IA',
            timestamp: new Date().toISOString(),
          });
          const sumRes = await iviSummarizeConversation({
            leadName: cleanName || 'Cliente sem nome',
            channel,
            transcript,
          });
          summaryText = sumRes.summary;
          summaryAuthor = 'Ivi IA';
          summaryUpdatedAt = new Date();
        }
      }

      const [lead] = await db
        .insert(prospectionLeads)
        .values({
          name: cleanName,
          phone: formattedPhone,
          email: email || '',
          channel,
          unitId: targetUnit,
          stage,
          iviProviderUsed: providerUsed,
          aiTranscript: transcript,
          summaryText,
          summaryAuthor,
          summaryUpdatedAt,
          hasPhoneCall: isPhoneChannel,
        })
        .returning();

      if (stage === 'escalado_humano') {
        await dispatchIviSectorNotification(
          {
            targetSector: 'prospeccao',
            targetUnitId: targetUnit,
            relatedEntityType: 'lead',
            relatedEntityId: lead.id,
            senderName: 'Ivi IA · Prospecção',
            subject: `Lead escalado para atendimento · ${cleanName || formattedPhone}`,
            body: `A Ivi encaminhou o lead ${cleanName || 'Sem nome'} (${formattedPhone} · canal ${channel}) para tratativa comercial em Prospecção.`,
          },
          db,
          broadcast
        );
      }

      res.json({ lead });
    } catch (error) {
      console.error('Create lead error:', error);
      res.status(500).json({ error: 'Erro ao cadastrar lead.' });
    }
  });

  app.post('/api/prospection/leads/:id/ivi-reply', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { message, mode, replyWithAudio } = req.body as {
        message: string;
        mode?: 'ivi' | 'human';
        replyWithAudio?: boolean;
      };
      const rows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      if (mode === 'human') {
        const nextTranscript = [
          ...(Array.isArray(lead.aiTranscript) ? lead.aiTranscript : []),
          {
            sender: 'operador',
            text: message,
            type: 'text' as const,
            authorName: req.authUser!.name,
            timestamp: new Date().toISOString(),
          },
        ];
        const sumRes = await iviSummarizeConversation({
          leadName: lead.name || 'Cliente sem nome',
          channel: lead.channel,
          transcript: nextTranscript,
        });
        const [updated] = await db
          .update(prospectionLeads)
          .set({
            aiTranscript: nextTranscript,
            stage: 'escalado_humano',
            summaryText: sumRes.summary,
            summaryAuthor: req.authUser!.name,
            summaryUpdatedAt: new Date(),
            lastMessageAt: new Date(),
          })
          .where(eq(prospectionLeads.id, leadId))
          .returning();

        const snap = await archiveLeadConversationSnapshot(leadId, undefined, req.authUser!.name);
        await dispatchIviSectorNotification(
          {
            targetSector: 'prospeccao',
            targetUnitId: lead.unitId,
            relatedEntityType: 'lead',
            relatedEntityId: leadId,
            senderName: 'Ivi IA · Prospecção',
            subject: `Atendimento humano assumido · ${lead.name || lead.phone}`,
            body: `${req.authUser!.name} assumiu a tratativa do lead ${lead.name || lead.phone} em Prospecção.`,
          },
          db,
          broadcast
        );
        return res.json({ lead: snap?.lead || updated, ivi: { provider: sumRes.provider, needsHuman: true } });
      }

      const iviRes = await iviRespondProspection(message, lead.channel, lead.name || 'Cliente WhatsApp', {
        replyWithAudio: Boolean(replyWithAudio),
        createdByName: req.authUser!.name,
      });
      const nextTranscript = [
        ...(Array.isArray(lead.aiTranscript) ? lead.aiTranscript : []),
        { sender: 'cliente', text: message, type: 'text' as const, timestamp: new Date().toISOString() },
        {
          sender: 'ivi',
          text: iviRes.reply,
          provider: iviRes.provider,
          type: (iviRes.audioCacheHash ? 'audio' : 'text') as 'text' | 'audio',
          authorName: 'Ivi IA',
          audioCacheHash: iviRes.audioCacheHash || undefined,
          audioMimeType: iviRes.audioMimeType || undefined,
          audioCached: Boolean(iviRes.audioCached),
          timestamp: new Date().toISOString(),
        },
      ];
      const sumRes = await iviSummarizeConversation({
        leadName: lead.name || 'Cliente sem nome',
        channel: lead.channel,
        transcript: nextTranscript,
      });

      const [updated] = await db
        .update(prospectionLeads)
        .set({
          aiTranscript: nextTranscript,
          iviProviderUsed: iviRes.provider,
          stage: iviRes.needsHuman ? 'escalado_humano' : 'em_atendimento_ivi',
          summaryText: sumRes.summary,
          summaryAuthor: 'Ivi IA',
          summaryUpdatedAt: new Date(),
          lastMessageAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId))
        .returning();

      const snap = await archiveLeadConversationSnapshot(leadId, undefined, 'Ivi IA');
      if (iviRes.needsHuman) {
        await dispatchIviSectorNotification(
          {
            targetSector: 'prospeccao',
            targetUnitId: lead.unitId,
            relatedEntityType: 'lead',
            relatedEntityId: leadId,
            senderName: 'Ivi IA · Prospecção',
            subject: `Escalação Automática Ivi · ${lead.name || lead.phone}`,
            body: `A Ivi detectou necessidade de intervenção comercial humana no lead ${lead.name || lead.phone} (${lead.channel}).`,
          },
          db,
          broadcast
        );
      }
      res.json({ lead: snap?.lead || updated, ivi: iviRes });
    } catch (error) {
      console.error('Ivi reply error:', error);
      res.status(500).json({ error: 'Erro ao acionar Ivi.' });
    }
  });

  app.post('/api/prospection/leads/:id/transcribe-audio', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { audioDataUri, mimeType, audioDescription, sender } = req.body as {
        audioDataUri?: string;
        mimeType?: string;
        audioDescription?: string;
        sender?: 'cliente' | 'operador';
      };
      const rows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      const payload = audioDataUri || audioDescription || '';
      if (!payload.trim()) return res.status(400).json({ error: 'Envie o áudio ou descrição para transcrição.' });

      const trans = await iviTranscribeAudioNote(payload, mimeType || 'audio/webm');

      // Store binary audio securely inside bucketdainvicta + communication_archives
      let mediaSha256: string | undefined;
      let mediaStorageUri: string | undefined;
      let mediaMimeType: string | undefined;
      let mediaFileName: string | undefined;
      const parsedAudio = audioDataUri ? parseDataUriBuffer(audioDataUri, mimeType || 'audio/webm') : null;
      const provider =
        lead.channel === 'whatsapp_uazapi'
          ? 'uazapi'
          : lead.channel === 'whatsapp_gotalk'
          ? 'gotalk'
          : 'telefone';

      if (parsedAudio) {
        const ext = parsedAudio.mimeType.includes('ogg')
          ? 'ogg'
          : parsedAudio.mimeType.includes('mpeg') || parsedAudio.mimeType.includes('mp3')
          ? 'mp3'
          : parsedAudio.mimeType.includes('wav')
          ? 'wav'
          : 'webm';
        mediaFileName = sanitizeFileName(
          audioDescription && audioDescription.includes('.') ? audioDescription : `audio-lead-${lead.id}-${Date.now()}.${ext}`
        );
        const stored = await putBucketObject(parsedAudio.buffer, {
          folderPath: `bucketdainvicta/U${lead.unitId}/PROSPECTION/L${lead.id}/AUDIO`,
          mimeType: parsedAudio.mimeType,
          originalName: mediaFileName,
        });
        mediaSha256 = stored.sha256Hash;
        mediaStorageUri = stored.storageUri;
        mediaMimeType = parsedAudio.mimeType;

        await db.insert(communicationArchives).values({
          unitId: lead.unitId,
          leadId: lead.id,
          threadId: lead.primaryThreadId ?? null,
          provider,
          archiveType: 'audio_message',
          contactName: lead.name || 'Cliente WhatsApp',
          contactPhone: lead.phone,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          sizeBytes: stored.sizeBytes,
          sha256Hash: stored.sha256Hash,
          storageUri: stored.storageUri,
          transcriptText: trans.transcript,
          createdByName: req.authUser!.name,
        });
      }

      const effectiveSender = sender || 'cliente';
      const nextTranscript: Array<{
        sender: string;
        text: string;
        provider?: string;
        timestamp: string;
        type?: 'text' | 'audio' | 'call';
        audioTranscript?: string;
        authorName?: string;
        mediaSha256?: string;
        mediaStorageUri?: string;
        mediaMimeType?: string;
        mediaFileName?: string;
        sourceProvider?: string;
        audioCacheHash?: string;
        audioMimeType?: string;
        audioCached?: boolean;
      }> = [
        ...(Array.isArray(lead.aiTranscript) ? lead.aiTranscript : []),
        {
          sender: effectiveSender,
          text: audioDescription?.trim() ? `[Áudio]: ${audioDescription.trim()}` : '[Mensagem de Áudio WhatsApp]',
          type: 'audio' as const,
          audioTranscript: trans.transcript,
          provider: trans.provider,
          authorName: req.authUser!.name,
          mediaSha256,
          mediaStorageUri,
          mediaMimeType,
          mediaFileName,
          sourceProvider: provider,
          timestamp: new Date().toISOString(),
        },
      ];

      let iviAudioReply: Awaited<ReturnType<typeof iviRespondProspection>> | null = null;
      if (effectiveSender === 'cliente' && trans.transcript.trim()) {
        iviAudioReply = await iviRespondProspection(
          trans.transcript,
          lead.channel,
          lead.name || 'Cliente WhatsApp',
          {
            clientSentAudio: true,
            replyWithAudio: true,
            createdByName: req.authUser!.name,
          }
        );
        nextTranscript.push({
          sender: 'ivi',
          text: iviAudioReply.reply,
          provider: iviAudioReply.provider,
          type: (iviAudioReply.audioCacheHash ? 'audio' : 'text') as 'text' | 'audio',
          authorName: 'Ivi IA (Resposta Verbal)',
          audioCacheHash: iviAudioReply.audioCacheHash || undefined,
          audioMimeType: iviAudioReply.audioMimeType || undefined,
          audioCached: Boolean(iviAudioReply.audioCached),
          timestamp: new Date().toISOString(),
        });
      }

      const sumRes = await iviSummarizeConversation({
        leadName: lead.name || 'Cliente sem nome',
        channel: lead.channel,
        transcript: nextTranscript,
      });

      await db
        .update(prospectionLeads)
        .set({
          aiTranscript: nextTranscript,
          stage: iviAudioReply?.needsHuman ? 'escalado_humano' : lead.stage,
          summaryText: sumRes.summary,
          summaryAuthor: `Ivi IA (${req.authUser!.name})`,
          summaryUpdatedAt: new Date(),
          lastMessageAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId));

      const snap = await archiveLeadConversationSnapshot(leadId, provider, req.authUser!.name);
      res.json({
        lead: snap?.lead,
        transcript: trans.transcript,
        provider: trans.provider,
        mediaSha256,
        iviAudioReply: iviAudioReply
          ? {
              reply: iviAudioReply.reply,
              audioCacheHash: iviAudioReply.audioCacheHash,
              audioCached: iviAudioReply.audioCached,
            }
          : null,
      });
    } catch (error) {
      console.error('Transcribe audio error:', error);
      res.status(500).json({ error: 'Erro ao transcrever áudio pela Ivi.' });
    }
  });

  app.post('/api/prospection/leads/:id/summarize', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const rows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      const sumRes = await iviSummarizeConversation({
        leadName: lead.name || 'Cliente sem nome',
        channel: lead.channel,
        transcript: Array.isArray(lead.aiTranscript) ? lead.aiTranscript : [],
      });
      const [updated] = await db
        .update(prospectionLeads)
        .set({
          summaryText: sumRes.summary,
          summaryAuthor: `Ivi IA (${req.authUser!.name})`,
          summaryUpdatedAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId))
        .returning();

      res.json({ lead: updated });
    } catch (error) {
      console.error('Summarize lead error:', error);
      res.status(500).json({ error: 'Erro ao gerar resumo com a Ivi.' });
    }
  });

  app.put('/api/prospection/leads/:id/summary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { summaryText } = req.body as { summaryText: string };
      const existingLead = await db.select({ unitId: prospectionLeads.unitId }).from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      if (!existingLead[0]) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, existingLead[0].unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });
      const [updated] = await db
        .update(prospectionLeads)
        .set({
          summaryText: String(summaryText || '').trim(),
          summaryAuthor: req.authUser!.name,
          summaryUpdatedAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Lead não encontrado.' });
      res.json({ lead: updated });
    } catch (error) {
      console.error('Save summary error:', error);
      res.status(500).json({ error: 'Erro ao salvar resumo da conversa.' });
    }
  });

  app.patch('/api/prospection/leads/:id/contact', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { name, phone } = req.body as { name: string; phone: string };
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Informe o nome do cliente.' });
      const existingLead = await db.select({ unitId: prospectionLeads.unitId }).from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      if (!existingLead[0]) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, existingLead[0].unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });
      const formattedPhone = formatPhoneWithPlus55(phone);
      const [updated] = await db
        .update(prospectionLeads)
        .set({
          name: name.trim(),
          phone: formattedPhone,
        })
        .where(eq(prospectionLeads.id, leadId))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Lead não encontrado.' });
      res.json({ lead: updated });
    } catch (error) {
      console.error('Update contact error:', error);
      res.status(500).json({ error: 'Erro ao atualizar contato.' });
    }
  });

  app.post('/api/prospection/leads/:id/call', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { isVideo, provider } = (req.body || {}) as { isVideo?: boolean; provider?: 'uazapi' | 'gotalk' };
      const rows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      const chosenProvider =
        provider === 'gotalk' || (provider !== 'uazapi' && lead.channel === 'whatsapp_gotalk')
          ? 'gotalk'
          : 'uazapi';

      let callRes: { dispatched: boolean; callId: string | null; status: string; detail: string };
      let fromNumber = '';

      if (chosenProvider === 'gotalk') {
        const ch = await db.select().from(gotalkChannels).where(eq(gotalkChannels.isActive, true)).limit(1);
        fromNumber = ch[0]?.phoneNumber || ch[0]?.name || 'GoTalk';
        callRes = {
          dispatched: true,
          callId: `gt-call-${Date.now()}`,
          status: 'initiated',
          detail: 'Ligação GoTalk registrada para acompanhamento. Após concluir, grave ou anexe o áudio para transcrição da Ivi.',
        };
      } else {
        const creds = await resolveUazapiCredentials({ unitId: lead.unitId, moduleId: 'prospection' });
        fromNumber = creds?.instanceId || '';
        callRes = await makeUazapiCall(creds, lead.phone, Boolean(isVideo));
      }

      const [callLog] = await db
        .insert(whatsappCallLogs)
        .values({
          unitId: lead.unitId,
          leadId: lead.id,
          threadId: lead.primaryThreadId ?? null,
          callId: callRes.callId || '',
          direction: 'outbound',
          fromNumber,
          toNumber: formatPhoneWithPlus55(lead.phone),
          callType: isVideo ? 'video' : 'voice',
          status: callRes.status,
          provider: chosenProvider,
          errorDetail: callRes.dispatched ? '' : callRes.detail,
          initiatedByName: req.authUser!.name,
        })
        .returning();

      const nextTranscript = [
        ...(Array.isArray(lead.aiTranscript) ? lead.aiTranscript : []),
        {
          sender: 'operador',
          type: 'call' as const,
          text: callRes.dispatched
            ? `Ligação de voz via ${chosenProvider.toUpperCase()} (${formatPhoneWithPlus55(lead.phone)}). Você pode gravar ou anexar o áudio da chamada para arquivar no BucketDaInvicta e transcrever com a Ivi.`
            : `Tentativa de ligação ${chosenProvider.toUpperCase()} (${callRes.detail}). Utilize discagem direta e anexe/grave a chamada ou preencha o resumo lateral.`,
          authorName: req.authUser!.name,
          callId: callRes.callId || String(callLog.id),
          sourceProvider: chosenProvider,
          timestamp: new Date().toISOString(),
        },
      ];

      await db
        .update(prospectionLeads)
        .set({
          hasPhoneCall: true,
          aiTranscript: nextTranscript,
          lastMessageAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId));

      const snap = await archiveLeadConversationSnapshot(leadId, chosenProvider, req.authUser!.name);
      res.json({ lead: snap?.lead, callLog, callResult: callRes });
    } catch (error) {
      console.error('Prospection call error:', error);
      res.status(500).json({ error: 'Erro ao iniciar ligação.' });
    }
  });

  app.post('/api/prospection/leads/:id/call/terminate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const { callId, durationSeconds } = req.body as { callId: string; durationSeconds?: number };
      const rows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      const creds = await resolveUazapiCredentials({ unitId: lead.unitId, moduleId: 'prospection' });
      const result = callId?.startsWith('gt-call-')
        ? { ok: true, detail: 'Ligação GoTalk encerrada.' }
        : await terminateUazapiCall(creds, callId);
      if (callId) {
        await db
          .update(whatsappCallLogs)
          .set({
            status: 'ended',
            durationSeconds: Number(durationSeconds || 0),
            endedAt: new Date(),
          })
          .where(eq(whatsappCallLogs.callId, callId));
      }
      await archiveLeadConversationSnapshot(leadId, undefined, req.authUser!.name);
      res.json(result);
    } catch (error) {
      console.error('UaZapi terminate call error:', error);
      res.status(500).json({ error: 'Erro ao encerrar ligação.' });
    }
  });

  app.post('/api/prospection/leads/:id/calls/:callLogId/recording', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      const callLogId = parsePositiveIntId(req.params.callLogId);
      if (!leadId || !callLogId) return res.status(400).json({ error: 'Identificadores de lead/ligação inválidos.' });
      const { audioDataUri, mimeType, fileName, durationSeconds } = req.body as {
        audioDataUri: string;
        mimeType?: string;
        fileName?: string;
        durationSeconds?: number;
      };
      const [leadRows, callRows] = await Promise.all([
        db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1),
        db.select().from(whatsappCallLogs).where(eq(whatsappCallLogs.id, callLogId)).limit(1),
      ]);
      const lead = leadRows[0];
      const callLog = callRows[0];
      if (!lead || !callLog) return res.status(404).json({ error: 'Lead ou registro de ligação não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });

      const parsed = parseDataUriBuffer(audioDataUri, mimeType || 'audio/webm');
      if (!parsed) return res.status(400).json({ error: 'Arquivo de áudio da gravação inválido.' });

      const ext = parsed.mimeType.includes('mp3') || parsed.mimeType.includes('mpeg')
        ? 'mp3'
        : parsed.mimeType.includes('ogg')
        ? 'ogg'
        : parsed.mimeType.includes('wav')
        ? 'wav'
        : 'webm';
      const safeName = sanitizeFileName(fileName || `gravacao-ligacao-${callLog.id}-${Date.now()}.${ext}`);

      const stored = await putBucketObject(parsed.buffer, {
        folderPath: `bucketdainvicta/U${lead.unitId}/CALLS/L${lead.id}`,
        mimeType: parsed.mimeType,
        originalName: safeName,
      });

      const trans = await iviTranscribeAudioNote(audioDataUri, parsed.mimeType);

      const [updatedCall] = await db
        .update(whatsappCallLogs)
        .set({
          status: 'ended',
          durationSeconds: Number(durationSeconds || callLog.durationSeconds || 0),
          recordingSha256: stored.sha256Hash,
          recordingStorageUri: stored.storageUri,
          recordingMimeType: parsed.mimeType,
          recordingFileName: safeName,
          audioTranscript: trans.transcript,
          endedAt: callLog.endedAt || new Date(),
        })
        .where(eq(whatsappCallLogs.id, callLog.id))
        .returning();

      await db.insert(communicationArchives).values({
        unitId: lead.unitId,
        leadId: lead.id,
        threadId: lead.primaryThreadId ?? null,
        callLogId: callLog.id,
        provider: callLog.provider,
        archiveType: 'call_recording',
        contactName: lead.name || 'Cliente WhatsApp',
        contactPhone: lead.phone,
        fileName: safeName,
        mimeType: parsed.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256Hash: stored.sha256Hash,
        storageUri: stored.storageUri,
        transcriptText: trans.transcript,
        createdByName: req.authUser!.name,
      });

      const nextTranscript = [
        ...(Array.isArray(lead.aiTranscript) ? lead.aiTranscript : []),
        {
          sender: 'operador',
          type: 'audio' as const,
          text: `[Gravação de Ligação ${callLog.provider.toUpperCase()}]: ${safeName}`,
          audioTranscript: trans.transcript,
          provider: trans.provider,
          authorName: req.authUser!.name,
          callId: callLog.callId || String(callLog.id),
          mediaSha256: stored.sha256Hash,
          mediaStorageUri: stored.storageUri,
          mediaMimeType: parsed.mimeType,
          mediaFileName: safeName,
          sourceProvider: callLog.provider,
          timestamp: new Date().toISOString(),
        },
      ];

      const sumRes = await iviSummarizeConversation({
        leadName: lead.name || 'Cliente sem nome',
        channel: lead.channel,
        transcript: nextTranscript,
      });

      await db
        .update(prospectionLeads)
        .set({
          hasPhoneCall: true,
          aiTranscript: nextTranscript,
          summaryText: sumRes.summary,
          summaryAuthor: `Ivi IA (${req.authUser!.name})`,
          summaryUpdatedAt: new Date(),
          lastMessageAt: new Date(),
        })
        .where(eq(prospectionLeads.id, leadId));

      const snap = await archiveLeadConversationSnapshot(leadId, callLog.provider, req.authUser!.name);
      res.json({ lead: snap?.lead, callLog: updatedCall, archive: snap?.archive, transcript: trans.transcript });
    } catch (error) {
      console.error('Save call recording error:', error);
      res.status(500).json({ error: 'Erro ao gravar e transcrever ligação no BucketDaInvicta.' });
    }
  });

  app.post('/api/prospection/leads/:id/archive', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = parsePositiveIntId(req.params.id);
      if (!leadId) return res.status(400).json({ error: 'ID de lead inválido.' });
      const [lead] = await db.select({ unitId: prospectionLeads.unitId }).from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
      if (!isUnitPermitted(req, lead.unitId)) return res.status(403).json({ error: 'Unidade do lead não autorizada.' });
      const snap = await archiveLeadConversationSnapshot(leadId, undefined, req.authUser!.name);
      if (!snap) return res.status(404).json({ error: 'Lead não encontrado.' });
      res.json(snap);
    } catch (error) {
      console.error('Archive lead snapshot error:', error);
      res.status(500).json({ error: 'Erro ao arquivar conversa no BucketDaInvicta.' });
    }
  });

  app.post('/api/prospection/appointments', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { leadId, clientName, clientPhone, unitId, modality, scheduledFor, notes } = req.body as {
        leadId?: number;
        clientName: string;
        clientPhone: string;
        unitId?: number;
        modality: string;
        scheduledFor: string;
        notes?: string;
      };
      const targetUnit = unitId !== undefined && unitId !== null ? parsePositiveIntId(unitId) : (req.activeUnitId || 1);
      if (!targetUnit || !isUnitPermitted(req, targetUnit)) {
        return res.status(403).json({ error: 'Unidade inválida ou não autorizada.' });
      }
      const targetDate = scheduledFor ? parseSafeDate(scheduledFor) : new Date(Date.now() + 86400000);
      if (!targetDate) {
        return res.status(400).json({ error: 'Data/hora do agendamento (scheduledFor) inválida.' });
      }
      if (!clientName || !String(clientName).trim()) {
        return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
      }

      // Load lead summary if leadId provided so Observações receives full discussion summary + user/date/time
      let finalNotes = String(notes || '').trim();
      if (leadId) {
        const leadRows = await db.select().from(prospectionLeads).where(eq(prospectionLeads.id, leadId)).limit(1);
        const leadRow = leadRows[0];
        if (leadRow?.summaryText?.trim() && !finalNotes.includes(leadRow.summaryText.trim())) {
          const whenStr = leadRow.summaryUpdatedAt ? new Date(leadRow.summaryUpdatedAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
          const summaryHeader = `[Resumo Prospecção · ${leadRow.summaryAuthor || 'Ivi IA'} · ${whenStr}]\n${leadRow.summaryText.trim()}`;
          finalNotes = finalNotes ? `${summaryHeader}\n\n${finalNotes}` : summaryHeader;
        }
      }

      // Round-robin queue among unblocked consultants for this unit
      const [allConsultants, activeBlocks, allCollabs] = await Promise.all([
        db.select().from(users).where(eq(users.role, 'consultant')),
        db.select().from(scheduleBlocks),
        db.select().from(collaborators),
      ]);
      const blockedIds = new Set(
        activeBlocks
          .filter((b) => b.consultantId !== null && targetDate >= new Date(b.startAt) && targetDate <= new Date(b.endAt))
          .map((b) => b.consultantId as number)
      );
      const unitConsultants = allConsultants.filter(
        (c) => !blockedIds.has(c.id) && (c.defaultUnitId === targetUnit || (c.allowedUnitIds || []).includes(targetUnit))
      );
      const unblockedFallback = allConsultants.filter((c) => !blockedIds.has(c.id));
      const poolList = unitConsultants.length > 0 ? unitConsultants : unblockedFallback.length > 0 ? unblockedFallback : allConsultants;
      const existingAppts = await db.select().from(appointments);
      const counts = new Map<number, number>();
      poolList.forEach((c) => counts.set(c.id, 0));
      existingAppts.forEach((a) => {
        if (counts.has(a.consultantId)) counts.set(a.consultantId, (counts.get(a.consultantId) || 0) + 1);
      });
      const chosenConsultant = [...poolList].sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0))[0];
      const linkedCollab = chosenConsultant
        ? allCollabs.find((col) => col.userId === chosenConsultant.id)
        : undefined;
      const startAtDate = new Date(scheduledFor || Date.now() + 86400000);
      const endAtDate = new Date(startAtDate.getTime() + 30 * 60000);

      const [appt] = await db
        .insert(appointments)
        .values({
          leadId: leadId || null,
          clientName,
          clientPhone,
          unitId: targetUnit,
          attendantId: req.authUser!.id,
          consultantId: chosenConsultant?.id || req.authUser!.id,
          collaboratorId: linkedCollab?.id ?? null,
          modality: modality || 'presencial',
          scheduledFor: startAtDate,
          endAt: endAtDate,
          status: 'agendado',
          notifiedInternal: true,
          notifiedWhatsapp: true,
          notes: finalNotes,
          createdByName: req.authUser!.name,
          updatedByName: req.authUser!.name,
          updatedAt: new Date(),
        })
        .returning();

      if (leadId) {
        await db.update(prospectionLeads).set({ stage: 'agendado', assignedUserId: chosenConsultant?.id }).where(eq(prospectionLeads.id, leadId));
      }

      // Notify Agendamentos + Consultor Comercial via Ivi
      await dispatchIviSectorNotification(
        {
          targetSector: 'agendamentos',
          targetUnitId: targetUnit,
          recipientId: chosenConsultant?.id ?? null,
          targetGroupId: chosenConsultant?.groupId ?? null,
          relatedEntityType: 'appointment',
          relatedEntityId: appt.id,
          senderName: 'Ivi IA · Agendamentos',
          subject: `Novo Agendamento (${(modality || 'presencial').toUpperCase()}) · ${clientName}`,
          body: `Cliente ${clientName} (${clientPhone}) agendado para ${new Date(appt.scheduledFor).toLocaleString('pt-BR')} com ${chosenConsultant?.name || 'consultor da unidade'}.`,
        },
        db,
        broadcast
      );

      res.json({ appointment: appt, consultant: chosenConsultant });
    } catch (error) {
      console.error('Appointment create error:', error);
      res.status(500).json({ error: 'Erro ao confirmar agendamento.' });
    }
  });

  app.patch('/api/prospection/appointments/:id/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de agendamento inválido.' });
      const { status } = req.body as { status: string };
      const [existing] = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade não autorizada.' });
      const [updated] = await db.update(appointments).set({ status }).where(eq(appointments.id, id)).returning();
      res.json({ appointment: updated });
    } catch (error) {
      console.error('Appointment status error:', error);
      res.status(500).json({ error: 'Erro ao atualizar status do agendamento.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. CLIENTES (TITULAR <-> RESPONSÁVEL), ADMISSÕES, RECÁLCULOS & BUCKETDAINVICTA ACL
  // ---------------------------------------------------------------------------
  app.get('/api/clients', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const [allClients, links, allAdmissions, allDocs, scenarios, allUsers, allThreads, bucketStats, folderRules] = await Promise.all([
        db.select().from(clients).orderBy(desc(clients.id)),
        db.select().from(clientAssetLinks),
        db.select().from(admissions).orderBy(desc(admissions.id)),
        db.select().from(documentObjects).orderBy(desc(documentObjects.id)),
        db.select().from(recalcScenarios).orderBy(desc(recalcScenarios.id)),
        db.select({ id: users.id, name: users.name, role: users.role, allowedUnitIds: users.allowedUnitIds }).from(users),
        db.select({ id: whatsappThreads.id, contactPhone: whatsappThreads.contactPhone, provider: whatsappThreads.provider }).from(whatsappThreads),
        getBucketRuntimeStats(),
        loadFolderRulesForUser(),
      ]);
      const allowedUnits = getAllowedUnitIds(req);
      const unitAllowed = (uId: number | null | undefined) =>
        allowedUnits === null || (typeof uId === 'number' && allowedUnits.includes(uId));
      const permittedClients = allClients.filter((c) => unitAllowed(c.unitId));
      const permittedAdmissions = allAdmissions.filter((a) => unitAllowed(a.unitId));
      const permittedDocs = allDocs
        .filter((d) => unitAllowed(d.unitId) && d.scope !== 'unit' && d.clientId !== null)
        .map((d) => ({
          ...d,
          effectivePermissions: evaluateDocumentAccess({
            authUser: req.authUser!,
            doc: d,
            folderRules,
            context: 'client_dossier',
          }),
        }))
        .filter((d) => d.effectivePermissions.view);
      const permittedScenarios = scenarios.filter((s) => unitAllowed(s.unitId));
      const threadPhones = Array.from(
        new Set(allThreads.map((t) => String(t.contactPhone || '').replace(/\D/g, '').slice(-8)).filter(Boolean))
      );
      res.json({
        clients: permittedClients,
        assetLinks: links,
        admissions: permittedAdmissions,
        documents: permittedDocs.filter((d) => !d.deletedAt),
        trashedDocuments: permittedDocs.filter((d) => Boolean(d.deletedAt)),
        recalcScenarios: permittedScenarios,
        consultants: allUsers,
        threadPhones,
        bucketStats,
      });
    } catch (error) {
      console.error('Clients fetch error:', error);
      res.status(500).json({ error: 'Erro ao carregar clientes e vínculos.' });
    }
  });

  app.get('/api/clients/search', requireAuth, async (req: AuthRequest, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const offset = Math.max(0, Number(req.query.offset || 0) || 0);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 15) || 15));
      const allRaw = await db.select().from(clients).orderBy(desc(clients.id));
      const allowedUnits = getAllowedUnitIds(req);
      const all = allowedUnits === null ? allRaw : allRaw.filter((c) => allowedUnits.includes(c.unitId));
      const matched =
        q.length < 3
          ? all
          : all.filter((c) => {
              const digits = q.replace(/\D/g, '');
              return (
                c.fullName.toLowerCase().includes(q) ||
                c.cpfCnpj.toLowerCase().includes(q) ||
                c.phone.toLowerCase().includes(q) ||
                (digits.length >= 3 &&
                  (c.cpfCnpj.replace(/\D/g, '').includes(digits) || c.phone.replace(/\D/g, '').includes(digits)))
              );
            });
      res.json({
        clients: matched.slice(offset, offset + limit),
        total: matched.length,
        hasMore: offset + limit < matched.length,
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro na pesquisa de clientes.') });
    }
  });

  app.post('/api/clients', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        personNature?: string;
        fullName?: string;
        cpfCnpj?: string;
        rg?: string;
        birthDate?: string;
        profession?: string;
        maritalStatus?: string;
        phone?: string;
        isWhatsapp?: boolean;
        secondaryPhone?: string;
        secondaryIsWhatsapp?: boolean;
        email?: string;
        zipCode?: string;
        address?: string;
        addressNumber?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        notes?: string;
        clientType?: string;
        unitId?: number;
      };
      if (!b.fullName?.trim()) {
        return res.status(400).json({ error: 'Nome / Razão social é obrigatório.' });
      }
      const cpfVal = b.cpfCnpj?.trim() || `CAD-${Date.now()}`;
      const existing = await db.select().from(clients).where(eq(clients.cpfCnpj, cpfVal)).limit(1);
      if (existing[0]) {
        return res.status(409).json({ error: `Já existe um cliente cadastrado com o CPF/CNPJ ${cpfVal}.`, client: existing[0] });
      }
      const phoneClean = (b.phone || '').replace(/\D/g, '');
      const [created] = await db
        .insert(clients)
        .values({
          personNature: b.personNature === 'PJ' ? 'PJ' : 'PF',
          fullName: b.fullName.trim(),
          cpfCnpj: cpfVal,
          rg: b.rg?.trim() || '',
          birthDate: b.birthDate?.trim() || '',
          profession: b.profession?.trim() || '',
          maritalStatus: b.maritalStatus?.trim() || '',
          phone: b.phone?.trim() || '',
          whatsapp: b.isWhatsapp === false ? '' : phoneClean,
          secondaryPhone: b.secondaryPhone?.trim() || '',
          secondaryIsWhatsapp: Boolean(b.secondaryIsWhatsapp),
          email: b.email?.trim() || '',
          zipCode: b.zipCode?.trim() || '',
          address: b.address?.trim() || '',
          addressNumber: b.addressNumber?.trim() || '',
          complement: b.complement?.trim() || '',
          neighborhood: b.neighborhood?.trim() || '',
          city: b.city?.trim() || '',
          state: b.state?.trim().toUpperCase() || '',
          notes: b.notes?.trim() || '',
          clientType: b.clientType || 'titular',
          unitId: b.unitId || req.activeUnitId || 1,
        })
        .returning();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CLIENT_CREATE',
        entityType: 'client',
        entityId: String(created.id),
        details: { fullName: created.fullName, cpfCnpj: created.cpfCnpj, personNature: created.personNature },
        unitId: created.unitId,
      });
      res.json({ client: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar cliente.') });
    }
  });

  app.patch('/api/clients/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const rows = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, rows[0].unitId)) {
        return res.status(403).json({ error: 'Unidade do cliente não autorizada.' });
      }
      const b = (req.body || {}) as Record<string, string | boolean | undefined>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const [updated] = await db
        .update(clients)
        .set({
          ...(b.personNature !== undefined ? { personNature: b.personNature === 'PJ' ? 'PJ' : 'PF' } : {}),
          ...(b.fullName !== undefined ? { fullName: str(b.fullName) } : {}),
          ...(b.cpfCnpj !== undefined ? { cpfCnpj: str(b.cpfCnpj) } : {}),
          ...(b.rg !== undefined ? { rg: str(b.rg) } : {}),
          ...(b.birthDate !== undefined ? { birthDate: str(b.birthDate) } : {}),
          ...(b.profession !== undefined ? { profession: str(b.profession) } : {}),
          ...(b.maritalStatus !== undefined ? { maritalStatus: str(b.maritalStatus) } : {}),
          ...(b.phone !== undefined
            ? {
                phone: str(b.phone),
                whatsapp: b.isWhatsapp === false ? '' : str(b.phone).replace(/\D/g, ''),
              }
            : {}),
          ...(b.secondaryPhone !== undefined ? { secondaryPhone: str(b.secondaryPhone) } : {}),
          ...(b.secondaryIsWhatsapp !== undefined ? { secondaryIsWhatsapp: Boolean(b.secondaryIsWhatsapp) } : {}),
          ...(b.email !== undefined ? { email: str(b.email) } : {}),
          ...(b.zipCode !== undefined ? { zipCode: str(b.zipCode) } : {}),
          ...(b.address !== undefined ? { address: str(b.address) } : {}),
          ...(b.addressNumber !== undefined ? { addressNumber: str(b.addressNumber) } : {}),
          ...(b.complement !== undefined ? { complement: str(b.complement) } : {}),
          ...(b.neighborhood !== undefined ? { neighborhood: str(b.neighborhood) } : {}),
          ...(b.city !== undefined ? { city: str(b.city) } : {}),
          ...(b.state !== undefined ? { state: str(b.state).toUpperCase() } : {}),
          ...(b.notes !== undefined ? { notes: str(b.notes) } : {}),
        })
        .where(eq(clients.id, id))
        .returning();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CLIENT_UPDATE',
        entityType: 'client',
        entityId: String(id),
        details: { fullName: updated.fullName, cpfCnpj: updated.cpfCnpj },
        unitId: updated.unitId,
      });
      res.json({ client: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar cliente.') });
    }
  });

  app.post('/api/recalc', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { clientId, admissionId, contractRateMonthlyPct, bacenAvgRateMonthlyPct, originalInstallmentCents, installmentsTotal, notes } = req.body as {
        clientId: number;
        admissionId?: number;
        contractRateMonthlyPct: number;
        bacenAvgRateMonthlyPct: number;
        originalInstallmentCents: number;
        installmentsTotal: number;
        notes?: string;
      };
      const parsedClientId = parsePositiveIntId(clientId);
      const parsedAdmId = admissionId !== undefined && admissionId !== null && String(admissionId) !== '' ? parsePositiveIntId(admissionId) : null;
      const rawContractRate = parseFiniteNumber(contractRateMonthlyPct);
      const rawBacenRate = parseFiniteNumber(bacenAvgRateMonthlyPct);
      const rawPmt = parseFiniteNumber(originalInstallmentCents);
      const rawInst = parseFiniteNumber(installmentsTotal);
      if (!parsedClientId || rawContractRate === null || rawBacenRate === null || rawPmt === null) {
        return res.status(400).json({ error: 'Parâmetros numéricos inválidos para recálculo.' });
      }
      const iContract = Math.max(0.001, rawContractRate / 100);
      const iBacen = Math.max(0.001, rawBacenRate / 100);
      const n = Math.max(2, Math.round(rawInst ?? 48));
      const pmt = Math.max(100, Math.round(rawPmt));

      // Present value under contract rate, then recalculate fair PMT at BACEN average rate
      const pv = pmt * ((1 - Math.pow(1 + iContract, -n)) / iContract);
      const fairPmt = Math.round(pv * (iBacen / (1 - Math.pow(1 + iBacen, -n))));
      const projectedSavingsCents = Math.max(0, (pmt - fairPmt) * n);

      const [scenario] = await db
        .insert(recalcScenarios)
        .values({
          clientId: parsedClientId,
          admissionId: parsedAdmId,
          unitId: req.activeUnitId || 1,
          contractRateMonthlyPct: String(rawContractRate),
          bacenAvgRateMonthlyPct: String(rawBacenRate),
          originalInstallmentCents: pmt,
          fairInstallmentCents: fairPmt,
          installmentsTotal: n,
          projectedSavingsCents,
          notes: notes || '',
          createdBy: req.authUser!.name,
        })
        .returning();

      res.json({ scenario });
    } catch (error) {
      console.error('Recalc error:', error);
      res.status(500).json({ error: 'Erro ao calcular cenário revisional.' });
    }
  });

  app.post('/api/clients/link-asset', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { titularClientId, assetOwnerClientId, relationshipLabel, vehiclePlate, vehicleModel, renavam } = req.body as {
        titularClientId: number;
        assetOwnerClientId: number;
        relationshipLabel: string;
        vehiclePlate?: string;
        vehicleModel?: string;
        renavam?: string;
      };
      const [link] = await db
        .insert(clientAssetLinks)
        .values({
          titularClientId,
          assetOwnerClientId,
          relationshipLabel: relationshipLabel || 'Responsável pelo Bem',
          vehiclePlate: vehiclePlate || '',
          vehicleModel: vehicleModel || '',
          renavam: renavam || '',
        })
        .returning();
      res.json({ link });
    } catch (error) {
      console.error('Link asset error:', error);
      res.status(500).json({ error: 'Erro ao vincular titular e responsável pelo bem.' });
    }
  });

  function computeAdmissionDebtSummary(body: Record<string, unknown>) {
    const brand = String(body.vehicleBrand || '').trim().toUpperCase();
    const model = String(body.vehicleModel || '').trim().toUpperCase();
    const color = String(body.vehicleColor || '').trim().toUpperCase();
    const year = String(body.vehicleYear || '').trim();
    const plate = String(body.vehiclePlate || '').trim().toUpperCase();
    const chassis = String(body.vehicleChassis || '').trim().toUpperCase();
    const renavam = String(body.vehicleRenavam || '').trim();
    const vehicleComposed = [brand, model, year, plate ? `Placa ${plate}` : ''].filter(Boolean).join(' · ');
    const vehicleInfo = String(body.vehicleInfo || '').trim() || vehicleComposed;

    const serviceMgmtCents = Math.max(0, Number(body.serviceMgmtCents || 0));
    const serviceInitialCents = Math.max(0, Number(body.serviceInitialCents || 0));
    const serviceDiscountCents = Math.max(0, Number(body.serviceDiscountCents || 0));
    const serviceAdditionCents = Math.max(0, Number(body.serviceAdditionCents || 0));
    const computedServiceTotal = Math.max(
      0,
      serviceMgmtCents + serviceInitialCents - serviceDiscountCents + serviceAdditionCents
    );
    const serviceFeeCents =
      Number(body.serviceFeeCents || 0) > 0 ? Number(body.serviceFeeCents) : computedServiceTotal;

    return {
      brand,
      model,
      color,
      year,
      plate,
      chassis,
      renavam,
      vehicleInfo,
      serviceMgmtCents,
      serviceInitialCents,
      serviceDiscountCents,
      serviceAdditionCents,
      serviceFeeCents,
    };
  }

  app.post('/api/admissions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const targetUnitId = parsePositiveIntId(body.unitId ?? req.activeUnitId ?? 1);
      const bankName = String(body.bankName || '').trim();
      const series = String(body.series || 'ADM').trim().toUpperCase();
      const clientIdInput = body.clientId ? parsePositiveIntId(body.clientId) : null;
      if (body.clientId !== undefined && body.clientId !== null && body.clientId !== '' && !clientIdInput) {
        return res.status(400).json({ error: 'clientId inválido.' });
      }
      const clientFullName = String(body.clientFullName || '').trim();
      const clientCpf = String(body.clientCpf || '').trim();
      const clientPhone = String(body.clientPhone || '').trim();
      const clientEmail = String(body.clientEmail || '').trim();

      if ((!clientIdInput && !clientFullName) || !bankName || !series || !targetUnitId) {
        return res.status(400).json({
          error: 'Campos obrigatórios para salvar: Cliente, Banco, Série e Unidade.',
        });
      }
      if (!isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada para este perfil.' });
      }

      const [unit] = await db.select().from(units).where(eq(units.id, targetUnitId)).limit(1);
      const computed = computeAdmissionDebtSummary(body);
      const requestedStatus = String(body.status || 'pendente');

      if (
        (requestedStatus === 'aguardando_auditoria' || requestedStatus === 'aprovada') &&
        unit &&
        computed.serviceFeeCents > 0 &&
        computed.serviceFeeCents < unit.minAdmissionCostCents
      ) {
        return res.status(400).json({
          error: `Custo de admissão abaixo do mínimo da unidade ${unit.name} (mínimo R$ ${(unit.minAdmissionCostCents / 100).toFixed(2)}).`,
        });
      }

      let titular;
      if (clientIdInput) {
        [titular] = await db.select().from(clients).where(eq(clients.id, clientIdInput)).limit(1);
      }
      if (!titular && clientCpf) {
        [titular] = await db.select().from(clients).where(eq(clients.cpfCnpj, clientCpf)).limit(1);
      }
      if (!titular) {
        if (!clientFullName) {
          return res.status(400).json({ error: 'Selecione ou cadastre um cliente responsável.' });
        }
        [titular] = await db
          .insert(clients)
          .values({
            fullName: clientFullName,
            cpfCnpj: clientCpf || `CPF-${Date.now()}`,
            phone: clientPhone,
            whatsapp: clientPhone.replace(/\D/g, ''),
            email: clientEmail,
            clientType: 'titular',
            unitId: targetUnitId,
          })
          .returning();
      }

      if (requestedStatus === 'aprovada') {
        const existingDocs = await db
          .select({ id: documentObjects.id })
          .from(documentObjects)
          .where(and(eq(documentObjects.clientId, titular.id), isNull(documentObjects.deletedAt)))
          .limit(1);
        if (!existingDocs[0]) {
          return res.status(400).json({
            error: 'Para aprovar a ficha é obrigatório ter ao menos 1 documento salvo na aba Documentos.',
          });
        }
      }

      let assetOwnerId: number | null = body.assetOwnerId ? Number(body.assetOwnerId) : null;
      const assetOwnerFullName = String(body.assetOwnerFullName || '').trim();
      const assetOwnerCpf = String(body.assetOwnerCpf || '').trim();
      if (!assetOwnerId && assetOwnerFullName && assetOwnerCpf) {
        let [owner] = await db.select().from(clients).where(eq(clients.cpfCnpj, assetOwnerCpf)).limit(1);
        if (!owner) {
          [owner] = await db
            .insert(clients)
            .values({
              fullName: assetOwnerFullName,
              cpfCnpj: assetOwnerCpf,
              phone: clientPhone,
              clientType: 'responsavel_bem',
              unitId: targetUnitId,
            })
            .returning();
        }
        assetOwnerId = owner.id;
      }

      if (assetOwnerId && assetOwnerId !== titular.id) {
        const existingLink = await db
          .select()
          .from(clientAssetLinks)
          .where(
            and(
              eq(clientAssetLinks.titularClientId, titular.id),
              eq(clientAssetLinks.assetOwnerClientId, assetOwnerId)
            )
          )
          .limit(1);
        if (!existingLink[0]) {
          await db.insert(clientAssetLinks).values({
            titularClientId: titular.id,
            assetOwnerClientId: assetOwnerId,
            relationshipLabel: 'Titular ↔ Responsável',
            vehicleModel: computed.model || computed.vehicleInfo,
            vehiclePlate: computed.plate,
            renavam: computed.renavam,
          });
        }
      }

      // Generate next sequential protocol number for selected series
      const allSeriesRows = await db
        .select({ id: admissions.id })
        .from(admissions)
        .where(eq(admissions.series, series));
      const nextSeq = allSeriesRows.length + 1;
      const explicitContract = String(body.contractNumber || '').trim();
      const protocolCode = `${series}-${String(nextSeq).padStart(4, '0')}-${Math.floor(10 + Math.random() * 89)}`;
      const finalContractNumber = explicitContract || `${series}-${String(nextSeq).padStart(4, '0')}`;

      const installmentsCount = Math.max(2, Number(body.installmentsCount || 6));
      const initialInstallmentCents =
        computed.serviceMgmtCents > 0
          ? computed.serviceMgmtCents
          : Math.round(computed.serviceFeeCents / installmentsCount);

      const modality = String(body.modality || 'CDC Veículo');
      const debtType =
        String(body.debtType || '').trim() ||
        (/ve[ií]culo/i.test(modality)
          ? 'veicular'
          : /cart[aã]o/i.test(modality)
          ? 'cartao'
          : /cheque/i.test(modality)
          ? 'cheque_especial'
          : 'emprestimo');

      const scenariosJson = Array.isArray(body.scenariosJson)
        ? (body.scenariosJson as AdmissionScenarioCol[])
        : [];
      const indicationSource = String(body.indicationSource || '');
      const indicationOther =
        indicationSource === 'outro' ? String(body.indicationOther || '').trim().toUpperCase() : '';

      const [admission] = await db
        .insert(admissions)
        .values({
          protocolCode,
          clientId: titular.id,
          assetOwnerId,
          clientRoleSelected: String(body.clientRoleSelected || 'responsavel'),
          unitId: targetUnitId,
          origin: String(body.origin || ''),
          consultantId: body.consultantId ? Number(body.consultantId) : req.authUser!.id,
          consultantName: String(body.consultantName || req.authUser!.name),
          debtType,
          modality,
          series,
          indicationSource,
          indicationOther,
          bankName,
          contractNumber: finalContractNumber,
          vehicleInfo: computed.vehicleInfo,
          vehicleBrand: computed.brand,
          vehicleModel: computed.model,
          vehicleColor: computed.color,
          vehicleYear: computed.year,
          vehiclePlate: computed.plate,
          vehicleChassis: computed.chassis,
          vehicleRenavam: computed.renavam,
          debtTotalInstallments: Number(body.debtTotalInstallments || 48),
          debtPaidInstallments: Number(body.debtPaidInstallments || 0),
          debtOverdueInstallments: Number(body.debtOverdueInstallments || 0),
          financedAmountCents: Math.max(0, Number(body.financedAmountCents || 0)),
          currentInstallmentCents: Math.max(0, Number(body.currentInstallmentCents || 0)),
          debtDueDay: Math.min(31, Math.max(1, Number(body.debtDueDay || 10))),
          paymentType: String(body.paymentType || 'boleto'),
          debtAmountCents: Math.max(0, Number(body.debtAmountCents || body.financedAmountCents || 0)),
          serviceFeeCents: computed.serviceFeeCents,
          serviceMgmtCents: computed.serviceMgmtCents,
          serviceInitialCents: computed.serviceInitialCents,
          serviceDiscountCents: computed.serviceDiscountCents,
          serviceAdditionCents: computed.serviceAdditionCents,
          billingFeeCents: Math.max(0, Number(body.billingFeeCents || 0)),
          notes: String(body.notes || ''),
          scenariosJson,
          installmentsCount,
          initialInstallmentCents,
          status: requestedStatus,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_ADMISSION',
        entityType: 'admission',
        entityId: String(admission.id),
        details: { protocolCode, debtType, bankName, series, status: requestedStatus },
        unitId: targetUnitId,
      });

      broadcast('audit:event', { type: 'NEW_ADMISSION', protocolCode });
      if (requestedStatus === 'aguardando_auditoria') {
        await dispatchIviSectorNotification(
          {
            targetSector: 'auditoria',
            targetUnitId: targetUnitId,
            relatedEntityType: 'admission',
            relatedEntityId: admission.id,
            senderName: 'Ivi IA · Fluxo Comercial',
            subject: `Nova ficha enviada para Auditoria · ${protocolCode}`,
            body: `O Comercial (${req.authUser!.name}) enviou a ficha ${protocolCode} (${titular.fullName} · ${bankName}) para conferência em Auditoria & Boletos.`,
          },
          db,
          broadcast
        );
      }
      res.json({ admission, titular });
    } catch (error) {
      console.error('Create admission error:', error);
      res.status(500).json({ error: 'Erro ao salvar ficha de admissão.' });
    }
  });

  app.patch('/api/admissions/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const rows = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      const existing = rows[0];
      if (!existing) return res.status(404).json({ error: 'Ficha de admissão não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });

      const body = (req.body || {}) as Record<string, unknown>;
      const printAutoTransitionOnly = body.printAutoTransition === true;

      if (!printAutoTransitionOnly && (existing.status === 'aprovada' || existing.status === 'auditada')) {
        return res.status(400).json({
          error: 'Registros aprovados ficam em somente leitura. A Auditoria deve devolver a ficha para permitir correção.',
        });
      }

      if (printAutoTransitionOnly) {
        if (existing.status !== 'pendente') {
          return res.json({ admission: existing });
        }
        const [updated] = await db
          .update(admissions)
          .set({ status: 'negociacao' })
          .where(eq(admissions.id, id))
          .returning();
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'ADMISSION_PRINT_STATUS_NEGOCIACAO',
          entityType: 'admission',
          entityId: String(id),
          details: { from: 'pendente', to: 'negociacao' },
          unitId: existing.unitId,
        });
        await dispatchIviSectorNotification(
          {
            targetSector: 'negociacoes',
            targetUnitId: existing.unitId,
            relatedEntityType: 'admission',
            relatedEntityId: id,
            senderName: 'Ivi IA · Admissão',
            subject: `Ficha em Negociação · ${existing.protocolCode}`,
            body: `A ficha ${existing.protocolCode} (${existing.bankName}) avançou para etapa de negociação após emissão do dossiê por ${req.authUser!.name}.`,
          },
          db,
          broadcast
        );
        return res.json({ admission: updated });
      }

      const targetUnitId = Number(body.unitId || existing.unitId);
      const bankName = String(body.bankName ?? existing.bankName).trim();
      const series = String(body.series ?? existing.series).trim().toUpperCase();
      const clientId = Number(body.clientId ?? existing.clientId);
      if (!clientId || !bankName || !series || !targetUnitId) {
        return res.status(400).json({ error: 'Cliente, Banco, Série e Unidade são obrigatórios.' });
      }

      const requestedStatus = String(body.status ?? existing.status);
      if (requestedStatus === 'aprovada') {
        const docs = await db
          .select({ id: documentObjects.id })
          .from(documentObjects)
          .where(
            and(
              or(eq(documentObjects.admissionId, id), eq(documentObjects.clientId, clientId)),
              isNull(documentObjects.deletedAt)
            )
          )
          .limit(1);
        if (!docs[0]) {
          return res.status(400).json({
            error: 'Não é possível aprovar sem ao menos um documento já salvo na ficha.',
          });
        }
        const critiques = Array.isArray(existing.auditCritiquesJson) ? existing.auditCritiquesJson : [];
        const hasOpenUnansweredCritique = critiques.some((c) => !c.commercialResponse?.trim());
        if (hasOpenUnansweredCritique) {
          return res.status(400).json({
            error: 'Existem críticas abertas da Auditoria sem resposta do Comercial. Responda antes de aprovar.',
          });
        }
      }

      const computed = computeAdmissionDebtSummary(body);
      const modality = String(body.modality ?? existing.modality);
      const debtType =
        String(body.debtType || '').trim() ||
        (/ve[ií]culo/i.test(modality)
          ? 'veicular'
          : /cart[aã]o/i.test(modality)
          ? 'cartao'
          : /cheque/i.test(modality)
          ? 'cheque_especial'
          : 'emprestimo');
      const indicationSource = String(body.indicationSource ?? existing.indicationSource);
      const indicationOther =
        indicationSource === 'outro' ? String(body.indicationOther || '').trim().toUpperCase() : '';
      const scenariosJson = Array.isArray(body.scenariosJson)
        ? (body.scenariosJson as AdmissionScenarioCol[])
        : existing.scenariosJson;

      const [updated] = await db
        .update(admissions)
        .set({
          clientId,
          assetOwnerId: body.assetOwnerId !== undefined ? (body.assetOwnerId ? Number(body.assetOwnerId) : null) : existing.assetOwnerId,
          clientRoleSelected: String(body.clientRoleSelected ?? existing.clientRoleSelected),
          unitId: targetUnitId,
          origin: String(body.origin ?? existing.origin),
          consultantId: body.consultantId ? Number(body.consultantId) : existing.consultantId,
          consultantName: String(body.consultantName ?? existing.consultantName),
          debtType,
          modality,
          series,
          indicationSource,
          indicationOther,
          bankName,
          contractNumber: String(body.contractNumber ?? existing.contractNumber),
          vehicleInfo: computed.vehicleInfo,
          vehicleBrand: computed.brand,
          vehicleModel: computed.model,
          vehicleColor: computed.color,
          vehicleYear: computed.year,
          vehiclePlate: computed.plate,
          vehicleChassis: computed.chassis,
          vehicleRenavam: computed.renavam,
          debtTotalInstallments: Number(body.debtTotalInstallments ?? existing.debtTotalInstallments),
          debtPaidInstallments: Number(body.debtPaidInstallments ?? existing.debtPaidInstallments),
          debtOverdueInstallments: Number(body.debtOverdueInstallments ?? existing.debtOverdueInstallments),
          financedAmountCents: Math.max(0, Number(body.financedAmountCents ?? existing.financedAmountCents)),
          currentInstallmentCents: Math.max(0, Number(body.currentInstallmentCents ?? existing.currentInstallmentCents)),
          debtDueDay: Math.min(31, Math.max(1, Number(body.debtDueDay ?? existing.debtDueDay))),
          paymentType: String(body.paymentType ?? existing.paymentType),
          debtAmountCents: Math.max(0, Number(body.debtAmountCents ?? existing.debtAmountCents)),
          serviceFeeCents: computed.serviceFeeCents,
          serviceMgmtCents: computed.serviceMgmtCents,
          serviceInitialCents: computed.serviceInitialCents,
          serviceDiscountCents: computed.serviceDiscountCents,
          serviceAdditionCents: computed.serviceAdditionCents,
          billingFeeCents: Math.max(0, Number(body.billingFeeCents ?? existing.billingFeeCents)),
          notes: String(body.notes ?? existing.notes),
          scenariosJson,
          status: requestedStatus,
        })
        .where(eq(admissions.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_ADMISSION',
        entityType: 'admission',
        entityId: String(id),
        details: { protocolCode: updated.protocolCode, status: updated.status },
        unitId: targetUnitId,
      });

      if (updated.status === 'aguardando_auditoria' && existing.status !== 'aguardando_auditoria') {
        await dispatchIviSectorNotification(
          {
            targetSector: 'auditoria',
            targetUnitId: targetUnitId,
            relatedEntityType: 'admission',
            relatedEntityId: updated.id,
            senderName: 'Ivi IA · Fluxo Comercial',
            subject: `Ficha encaminhada para Auditoria · ${updated.protocolCode}`,
            body: `A ficha ${updated.protocolCode} (${updated.bankName}) foi enviada para conferência documental em Auditoria & Boletos por ${req.authUser!.name}.`,
          },
          db,
          broadcast
        );
      } else if (updated.status === 'negociacao' && existing.status !== 'negociacao') {
        await dispatchIviSectorNotification(
          {
            targetSector: 'negociacoes',
            targetUnitId: targetUnitId,
            relatedEntityType: 'admission',
            relatedEntityId: updated.id,
            senderName: 'Ivi IA · Fluxo Comercial',
            subject: `Ficha movida para Negociações · ${updated.protocolCode}`,
            body: `A ficha ${updated.protocolCode} (${updated.bankName}) foi direcionada para Negociações Bancárias.`,
          },
          db,
          broadcast
        );
      }

      res.json({ admission: updated });
    } catch (error) {
      console.error('Update admission error:', error);
      res.status(500).json({ error: 'Erro ao atualizar ficha de admissão.' });
    }
  });

  app.post('/api/admissions/:id/respond-critique', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { responseText, resubmitToAudit } = (req.body || {}) as {
        responseText?: string;
        resubmitToAudit?: boolean;
      };
      if (!responseText?.trim()) {
        return res.status(400).json({ error: 'Informe a resposta do Comercial para a crítica.' });
      }
      const rows = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      const adm = rows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });

      const critiques = Array.isArray(adm.auditCritiquesJson) ? [...adm.auditCritiquesJson] : [];
      if (critiques.length === 0) {
        critiques.push({
          id: `crit-${Date.now()}`,
          round: 1,
          author: 'Auditoria',
          reason: adm.auditRejectionReason || 'Crítica registrada',
          createdAt: adm.auditedAt ? new Date(adm.auditedAt).toISOString() : new Date().toISOString(),
          commercialResponse: responseText.trim(),
          respondedBy: req.authUser!.name,
          respondedAt: new Date().toISOString(),
        });
      } else {
        const lastIdx = critiques.length - 1;
        critiques[lastIdx] = {
          ...critiques[lastIdx],
          commercialResponse: responseText.trim(),
          respondedBy: req.authUser!.name,
          respondedAt: new Date().toISOString(),
        };
      }

      const [updated] = await db
        .update(admissions)
        .set({
          auditCritiquesJson: critiques,
          ...(resubmitToAudit ? { status: 'aguardando_auditoria', submittedToAuditAt: new Date() } : {}),
        })
        .where(eq(admissions.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'ADMISSION_CRITIQUE_RESPONDED',
        entityType: 'admission',
        entityId: String(id),
        details: { responseText: responseText.trim(), resubmitToAudit: Boolean(resubmitToAudit) },
        unitId: adm.unitId,
      });

      if (resubmitToAudit) {
        await dispatchIviSectorNotification(
          {
            targetSector: 'auditoria',
            targetUnitId: adm.unitId,
            relatedEntityType: 'admission',
            relatedEntityId: id,
            senderName: 'Ivi IA · Retorno Comercial',
            subject: `Crítica respondida e reenviada · ${adm.protocolCode}`,
            body: `${req.authUser!.name} respondeu à crítica da Auditoria na ficha ${adm.protocolCode}: "${responseText.trim().slice(0, 140)}". Aguardando reavaliação.`,
          },
          db,
          broadcast
        );
      }

      res.json({ admission: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao responder crítica.') });
    }
  });

  app.delete('/api/admissions/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const rows = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      const adm = rows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });

      if (['aprovada', 'auditada', 'em_andamento', 'finalizada', 'concluido'].includes(adm.status)) {
        return res.status(400).json({ error: 'Registros aprovados ou finalizados não podem ser excluídos.' });
      }

      const [hasTitles, hasLegal, hasNeg, hasDocs, hasCompanyLegal] = await Promise.all([
        db.select({ id: financialTitles.id }).from(financialTitles).where(eq(financialTitles.admissionId, id)).limit(1),
        db.select({ id: legalProcesses.id }).from(legalProcesses).where(eq(legalProcesses.admissionId, id)).limit(1),
        db.select({ id: negotiations.id }).from(negotiations).where(eq(negotiations.admissionId, id)).limit(1),
        db.select({ id: documentObjects.id }).from(documentObjects).where(and(eq(documentObjects.admissionId, id), isNull(documentObjects.deletedAt))).limit(1),
        db.select({ id: companyLegalProcesses.id }).from(companyLegalProcesses).where(eq(companyLegalProcesses.admissionId, id)).limit(1),
      ]);

      if (hasTitles[0] || hasLegal[0] || hasNeg[0] || hasDocs[0] || hasCompanyLegal[0]) {
        return res.status(409).json({
          error: 'Exclusão bloqueada: existem boletos, processos jurídicos, cobranças, negociações ou documentos vinculados a esta ficha.',
        });
      }

      await db.transaction(async (tx) => {
        await tx.update(documentObjects).set({ admissionId: null }).where(eq(documentObjects.admissionId, id));
        await tx.update(recalcScenarios).set({ admissionId: null }).where(eq(recalcScenarios.admissionId, id));
        await tx.delete(admissions).where(eq(admissions.id, id));
        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DELETE_ADMISSION',
          entityType: 'admission',
          entityId: String(id),
          details: { protocolCode: adm.protocolCode },
          unitId: adm.unitId,
        });
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir ficha.') });
    }
  });

  app.get('/api/admissions/:id/history', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const aliases = getEntityTypeAliases('admission');
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            aliases.length > 0 ? inArray(auditLogs.entityType, aliases) : eq(auditLogs.entityType, 'admission'),
            eq(auditLogs.entityId, String(id))
          )
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(2000);
      res.json({ logs: rows.map((r) => normalizeAuditLogRecord(r)) });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao buscar histórico.') });
    }
  });

  async function resolveClientWhatsappInteractions(clientId: number, assetOwnerId?: number | null) {
    const [respRows, ownerRows, allThreads, allLeads, uazapiInstances] = await Promise.all([
      db.select().from(clients).where(eq(clients.id, clientId)).limit(1),
      assetOwnerId ? db.select().from(clients).where(eq(clients.id, assetOwnerId)).limit(1) : Promise.resolve([]),
      db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt)),
      db.select().from(prospectionLeads).orderBy(desc(prospectionLeads.lastMessageAt)),
      db
        .select({
          uazapiInstanceId: unitWhatsappCredentials.uazapiInstanceId,
          label: unitWhatsappCredentials.label,
          connectedPhone: unitWhatsappCredentials.connectedPhone,
          isConnected: unitWhatsappCredentials.isConnected,
        })
        .from(unitWhatsappCredentials),
    ]);

    const resp = respRows[0];
    const owner = ownerRows[0];
    const candidatePhones = Array.from(
      new Set(
        [resp?.phone, resp?.whatsapp, owner?.phone, owner?.whatsapp]
          .map((p) => String(p || '').trim())
          .filter((p) => p.replace(/\D/g, '').length >= 8)
      )
    );

    const matchedThreads = allThreads.filter((t) => {
      if (t.clientId === clientId || (assetOwnerId && t.clientId === assetOwnerId)) return true;
      return candidatePhones.some((p) => phonesMatchBR(t.contactPhone, p));
    });

    const threadIds = matchedThreads.map((t) => t.id);
    const rawMessages =
      threadIds.length > 0
        ? await db
            .select()
            .from(whatsappMessages)
            .where(inArray(whatsappMessages.threadId, threadIds))
            .orderBy(desc(whatsappMessages.createdAt))
            .limit(300)
        : [];

    const threadMap = new Map(matchedThreads.map((t) => [t.id, t]));
    const instanceLabelMap = new Map(uazapiInstances.map((i) => [i.uazapiInstanceId, i.label]));

    const enrichedThreads = matchedThreads.map((t) => ({
      ...t,
      instanceLabel: t.uazapiInstanceId ? instanceLabelMap.get(t.uazapiInstanceId) || t.uazapiInstanceId : null,
      ownerRole:
        owner && (t.clientId === owner.id || phonesMatchBR(t.contactPhone, owner.phone) || phonesMatchBR(t.contactPhone, owner.whatsapp))
          ? 'titular'
          : 'responsavel',
    }));

    const messages = rawMessages.reverse().map((m) => {
      const th = threadMap.get(m.threadId);
      return {
        ...m,
        provider: th?.provider || 'gotalk',
        contactPhone: th?.contactPhone || '',
        contactName: th?.contactName || '',
        uazapiInstanceId: th?.uazapiInstanceId || null,
      };
    });

    const matchedLeads = candidatePhones.length
      ? allLeads.filter((l) => candidatePhones.some((p) => phonesMatchBR(l.phone, p)))
      : [];

    return {
      threads: enrichedThreads,
      messages,
      atendimentos: matchedLeads,
      matchedPhones: candidatePhones,
      clientName: resp?.fullName || null,
      titularName: owner?.fullName || null,
    };
  }

  async function syncClientWhatsappConversations(clientId: number, assetOwnerId?: number | null, unitId?: number) {
    const [respRows, ownerRows, existingThreads, allCreds] = await Promise.all([
      db.select().from(clients).where(eq(clients.id, clientId)).limit(1),
      assetOwnerId ? db.select().from(clients).where(eq(clients.id, assetOwnerId)).limit(1) : Promise.resolve([]),
      db.select().from(whatsappThreads),
      db.select().from(unitWhatsappCredentials),
    ]);

    const resp = respRows[0];
    const owner = ownerRows[0];
    const phoneCandidates = Array.from(
      new Set(
        [resp?.whatsapp, resp?.phone, owner?.whatsapp, owner?.phone]
          .map((p) => String(p || '').trim())
          .filter((p) => p.replace(/\D/g, '').length >= 8)
      )
    );

    let syncedMessages = 0;
    let syncedThreads = 0;

    // 1. Auto-link any existing GoTalk or UaZapi threads that match client/titular phone
    for (const t of existingThreads) {
      if (!t.clientId && phoneCandidates.some((p) => phonesMatchBR(t.contactPhone, p))) {
        const matchedOwner = owner && (phonesMatchBR(t.contactPhone, owner.phone) || phonesMatchBR(t.contactPhone, owner.whatsapp));
        await db
          .update(whatsappThreads)
          .set({ clientId: matchedOwner ? owner.id : clientId })
          .where(eq(whatsappThreads.id, t.id));
      }
    }

    // 2. Pull matching UaZapi chats/messages from connected instances
    if (phoneCandidates.length > 0 && allCreds.length > 0) {
      const targetCreds = allCreds.filter((c) => c.isConnected);
      const credsToQuery = targetCreds.length > 0 ? targetCreds : allCreds.slice(0, 2);

      for (const credRow of credsToQuery) {
        const token = decryptUazapiToken(credRow.uazapiTokenEncrypted);
        if (!token) continue;
        const creds: UazapiCredentials = {
          unitId: credRow.unitId,
          instanceId: credRow.uazapiInstanceId,
          label: credRow.label,
          serverUrl: credRow.uazapiServerUrl,
          token,
        };
        try {
          const chats = await findUazapiChats(creds, 35, 0);
          for (const ch of chats) {
            if (!phoneCandidates.some((p) => phonesMatchBR(ch.phone, p))) continue;
            const matchedOwner = owner && (phonesMatchBR(ch.phone, owner.phone) || phonesMatchBR(ch.phone, owner.whatsapp));
            const targetClientId = matchedOwner ? owner.id : clientId;

            let thread = existingThreads.find(
              (t) => t.provider === 'uazapi' && phonesMatchBR(t.contactPhone, ch.phone) && (!t.uazapiInstanceId || t.uazapiInstanceId === credRow.uazapiInstanceId)
            );
            if (!thread) {
              const [created] = await db
                .insert(whatsappThreads)
                .values({
                  unitId: unitId || credRow.unitId || resp?.unitId || 1,
                  clientId: targetClientId,
                  contactName: ch.name || (matchedOwner ? owner?.fullName : resp?.fullName) || ch.phone,
                  contactPhone: normalizePhone(ch.phone) || ch.phone,
                  provider: 'uazapi',
                  uazapiInstanceId: credRow.uazapiInstanceId,
                  unreadCount: ch.unreadCount,
                  lastMessagePreview: ch.lastMessagePreview || 'Conversa UaZapi',
                  updatedAt: new Date(),
                })
                .returning();
              thread = created;
              existingThreads.push(created);
              syncedThreads++;
            } else if (!thread.clientId) {
              await db
                .update(whatsappThreads)
                .set({ clientId: targetClientId, uazapiInstanceId: credRow.uazapiInstanceId })
                .where(eq(whatsappThreads.id, thread.id));
            }

            const msgs = await findUazapiMessages(creds, ch.chatId, 25);
            for (const m of msgs) {
              if (!m.body) continue;
              const dup = await db
                .select({ id: whatsappMessages.id })
                .from(whatsappMessages)
                .where(eq(whatsappMessages.externalMessageId, m.id))
                .limit(1);
              if (dup[0]) continue;
              await db.insert(whatsappMessages).values({
                threadId: thread.id,
                externalMessageId: m.id,
                direction: m.fromMe ? 'outbound' : 'inbound',
                contentType: m.type,
                body: m.body,
                ackStatus: m.fromMe ? 2 : null,
                senderName: m.fromMe ? 'Consultor UaZapi' : m.senderName || thread.contactName,
                createdAt: new Date(m.timestampMs),
              });
              syncedMessages++;
            }
          }
        } catch {
          // keep resilient across multi-instances
        }
      }
    }

    const interactions = await resolveClientWhatsappInteractions(clientId, assetOwnerId);
    return { ...interactions, syncedThreads, syncedMessages };
  }

  app.get('/api/admissions/:id/interactions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });
      const data = await resolveClientWhatsappInteractions(adm.clientId, adm.assetOwnerId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar atendimentos.') });
    }
  });

  app.get('/api/clients/:clientId/interactions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const titularId = req.query.titularId ? parsePositiveIntId(req.query.titularId) : null;
      const [client] = await db.select({ unitId: clients.unitId }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (client && !isUnitPermitted(req, client.unitId)) {
        return res.status(403).json({ error: 'Unidade do cliente não autorizada.' });
      }
      const data = await resolveClientWhatsappInteractions(clientId, titularId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar conversas do cliente.') });
    }
  });

  app.post('/api/admissions/:id/sync-whatsapp', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });
      const data = await syncClientWhatsappConversations(adm.clientId, adm.assetOwnerId, adm.unitId);
      res.json({ ok: true, ...data });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao sincronizar conversas WhatsApp.') });
    }
  });

  app.post('/api/clients/:clientId/sync-whatsapp', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const { titularId, unitId } = (req.body || {}) as { titularId?: number | null; unitId?: number };
      const [client] = await db.select({ unitId: clients.unitId }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (client && !isUnitPermitted(req, client.unitId)) {
        return res.status(403).json({ error: 'Unidade do cliente não autorizada.' });
      }
      const data = await syncClientWhatsappConversations(clientId, titularId || null, unitId || req.activeUnitId);
      res.json({ ok: true, ...data });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao sincronizar conversas do cliente.') });
    }
  });

  app.post('/api/clients/:clientId/whatsapp/start', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = parsePositiveIntId(req.params.clientId);
      if (!clientId) return res.status(400).json({ error: 'ID de cliente inválido.' });
      const { provider, phone, unitId } = (req.body || {}) as {
        provider?: 'gotalk' | 'uazapi';
        phone?: string;
        unitId?: number;
      };
      const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!isUnitPermitted(req, client.unitId)) return res.status(403).json({ error: 'Unidade do cliente não autorizada.' });

      const chosenPhone = normalizePhone(phone || client.whatsapp || client.phone || '');
      if (!chosenPhone || chosenPhone.replace(/\D/g, '').length < 8) {
        return res.status(400).json({ error: 'Telefone válido obrigatório para iniciar conversa.' });
      }
      const chosenProvider = provider === 'uazapi' ? 'uazapi' : 'gotalk';
      const targetUnitId = unitId || client.unitId || req.activeUnitId || 1;

      const allThreads = await db.select().from(whatsappThreads);
      const existing = allThreads.find(
        (t) => t.provider === chosenProvider && (t.clientId === client.id || phonesMatchBR(t.contactPhone, chosenPhone))
      );
      if (existing) {
        if (!existing.clientId) {
          await db.update(whatsappThreads).set({ clientId: client.id }).where(eq(whatsappThreads.id, existing.id));
        }
        return res.json({ thread: existing, created: false });
      }

      let uazapiInstanceId: string | null = null;
      if (chosenProvider === 'uazapi') {
        const creds = await resolveUazapiCredentials({
          unitId: targetUnitId,
          groupId: req.authUser?.groupId ?? null,
        });
        uazapiInstanceId = creds?.instanceId || null;
      }
      let channelDbId: number | null = null;
      if (chosenProvider === 'gotalk') {
        const ch = await db.select().from(gotalkChannels).where(eq(gotalkChannels.isActive, true)).limit(1);
        channelDbId = ch[0]?.id || null;
      }

      const [created] = await db
        .insert(whatsappThreads)
        .values({
          clientId: client.id,
          unitId: targetUnitId,
          contactName: client.fullName,
          contactPhone: chosenPhone,
          provider: chosenProvider,
          uazapiInstanceId,
          channelDbId,
          operatorName: req.authUser!.name,
          lastMessagePreview: `Conversa iniciada via ${chosenProvider.toUpperCase()}`,
          updatedAt: new Date(),
        })
        .returning();

      res.json({ thread: created, created: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao iniciar conversa WhatsApp.') });
    }
  });

  app.post('/api/admissions/:id/export-docx', requireAuth, upload.single('template'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const [adm] = await db.select().from(admissions).where(eq(admissions.id, id)).limit(1);
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) return res.status(403).json({ error: 'Unidade da ficha não autorizada.' });

      const [clientRows, ownerRows, unitRows] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, adm.clientId)).limit(1),
        adm.assetOwnerId ? db.select().from(clients).where(eq(clients.id, adm.assetOwnerId)).limit(1) : Promise.resolve([]),
        db.select().from(units).where(eq(units.id, adm.unitId)).limit(1),
      ]);
      const respClient = clientRows[0];
      const titularClient = ownerRows[0];
      const unitRow = unitRows[0];

      const fmtMoney = (cents: number) =>
        (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const firstScenario = Array.isArray(adm.scenariosJson) && adm.scenariosJson[0] ? adm.scenariosJson[0] : null;
      const vars: Record<string, string> = {
        protocolo: adm.protocolCode,
        contrato: adm.contractNumber,
        serie: adm.series || 'ADM',
        unidade: unitRow?.name || 'Matriz',
        status: adm.status,
        origem: adm.origin || '-',
        cliente_nome: respClient?.fullName || '',
        cliente_cpf: respClient?.cpfCnpj || '',
        cliente_rg: respClient?.rg || '',
        cliente_telefone: respClient?.phone || '',
        cliente_email: respClient?.email || '',
        cliente_profissao: respClient?.profession || '',
        cliente_estado_civil: respClient?.maritalStatus || '',
        cliente_endereco: [respClient?.address, respClient?.addressNumber, respClient?.neighborhood, respClient?.city, respClient?.state].filter(Boolean).join(', '),
        titular_nome: titularClient?.fullName || '',
        titular_cpf: titularClient?.cpfCnpj || '',
        banco: adm.bankName,
        modalidade: adm.modality || adm.debtType,
        consultor: adm.consultantName || '',
        veiculo_marca: adm.vehicleBrand || '',
        veiculo_modelo: adm.vehicleModel || '',
        veiculo_cor: adm.vehicleColor || '',
        veiculo_ano: adm.vehicleYear || '',
        veiculo_placa: adm.vehiclePlate || '',
        veiculo_chassi: adm.vehicleChassis || '',
        veiculo_renavam: adm.vehicleRenavam || '',
        divida_original: fmtMoney(adm.debtAmountCents),
        valor_financiado: fmtMoney(adm.financedAmountCents),
        valor_parcela: fmtMoney(adm.currentInstallmentCents),
        divida_recalculada: firstScenario ? fmtMoney(firstScenario.recalcDebtCents) : fmtMoney(adm.debtAmountCents),
        economia: firstScenario ? fmtMoney(firstScenario.savingsCents) : fmtMoney(0),
        total_servicos: fmtMoney(adm.serviceFeeCents),
        parcela_01: fmtMoney(adm.serviceMgmtCents || adm.initialInstallmentCents),
        custos_iniciais: fmtMoney(adm.serviceInitialCents),
        valor_boletos: fmtMoney(adm.billingFeeCents),
        anotacoes: adm.notes || '',
        data_atual: new Date().toLocaleDateString('pt-BR'),
      };

      let outBuf: Buffer;
      if (req.file) {
        const lowerName = req.file.originalname.toLowerCase();
        if (lowerName.endsWith('.doc') && !lowerName.endsWith('.docx')) {
          return res.status(400).json({ error: 'Arquivos .doc legados não são suportados. Envie um template .docx.' });
        }
        outBuf = fillDocxTemplateBuffer(req.file.buffer, vars);
      } else {
        const lines: Array<{ text: string; bold?: boolean; heading?: boolean }> = [
          { text: `FINANCEPRO ASSESSORIA · FICHA DE ADMISSÃO (${adm.contractNumber})`, heading: true },
          { text: `Protocolo: ${adm.protocolCode} | Unidade: ${vars.unidade} | Status: ${adm.status.toUpperCase()} | Data: ${vars.data_atual}`, bold: true },
          { text: '' },
          { text: '01. DADOS DO CLIENTE E TITULAR', bold: true },
          { text: `Responsável: ${vars.cliente_nome} | CPF/CNPJ: ${vars.cliente_cpf} | RG: ${vars.cliente_rg || '—'}` },
          { text: `Telefone: ${vars.cliente_telefone} | E-mail: ${vars.cliente_email || '—'}` },
          { text: `Profissão: ${vars.cliente_profissao || '—'} | Estado Civil: ${vars.cliente_estado_civil || '—'}` },
          { text: `Endereço: ${vars.cliente_endereco || '—'}` },
          ...(titularClient ? [{ text: `Titular Vinculado: ${vars.titular_nome} | CPF/CNPJ: ${vars.titular_cpf}` }] : []),
          { text: '' },
          { text: '02. INFORMAÇÕES DA NEGOCIAÇÃO', bold: true },
          { text: `Banco Credor: ${vars.banco} | Modalidade: ${vars.modalidade} | Série: ${vars.serie}` },
          { text: `Consultor: ${vars.consultor || '—'} | Indicação: ${adm.indicationSource || '—'} ${adm.indicationOther || ''}` },
          ...(/ve[ií]culo/i.test(vars.modalidade)
            ? [
                { text: '' },
                { text: '03. INFORMAÇÕES DO VEÍCULO', bold: true },
                { text: `Marca/Modelo: ${vars.veiculo_marca} ${vars.veiculo_modelo} | Cor: ${vars.veiculo_cor} | Ano: ${vars.veiculo_ano}` },
                { text: `Placa: ${vars.veiculo_placa} | Chassi: ${vars.veiculo_chassi} | Renavam: ${vars.veiculo_renavam}` },
              ]
            : []),
          { text: '' },
          { text: '04. DÍVIDA ATUAL & CENÁRIO PRINCIPAL', bold: true },
          { text: `Parcelas: ${adm.debtTotalInstallments} totais / ${adm.debtPaidInstallments} pagas / ${adm.debtOverdueInstallments} em atraso | Dia venc.: ${adm.debtDueDay}` },
          { text: `Valor Financiado: ${vars.valor_financiado} | Valor da Parcela: ${vars.valor_parcela} | Dívida Base: ${vars.divida_original}` },
          { text: `1º Cenário: Nova Dívida ${vars.divida_recalculada} | Economia Estimada: ${vars.economia}` },
          { text: '' },
          { text: '05. SERVIÇOS E OUTRAS INFORMAÇÕES', bold: true },
          { text: `Gestão (Parcela 01): ${vars.parcela_01} | Custos Iniciais: ${vars.custos_iniciais} | Valor Boletos: ${vars.valor_boletos}` },
          { text: `Total Geral dos Serviços: ${vars.total_servicos}`, bold: true },
          ...(adm.notes ? [{ text: `Anotações: ${adm.notes}` }] : []),
          { text: '' },
          { text: '________________________________________        ________________________________________' },
          { text: 'Assinatura do Cliente / Titular                 Conferência FinancePro Assessoria' },
        ];
        outBuf = generateAdmissionDocx(lines);
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="Admissao_${adm.contractNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx"`);
      res.send(outBuf);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao exportar .docx.' });
    }
  });

  // Upload document to bucketdainvicta (AES-256-GCM encrypted CAS object bucket + SHA-256 deduplication; zero binary bloat in DB)
  app.post('/api/documents/upload', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const { clientId, admissionId, docCategory, unitFolderPath } = req.body as {
        clientId: string;
        admissionId?: string;
        docCategory: string;
        unitFolderPath?: string;
      };
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      if (!clientId || !Number(clientId)) return res.status(400).json({ error: 'clientId obrigatório para indexação no bucket.' });

      const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
      if (validationErr) return res.status(400).json({ error: validationErr });

      const targetUnitId = req.activeUnitId || 1;
      const cleanUnitFolder = normalizeFolderPath(unitFolderPath || '');
      const folderRules = await loadFolderRulesForUser(targetUnitId);
      const clientDocPerms = evaluateScopePermissions({
        authUser: req.authUser!,
        unitId: targetUnitId,
        scopeKey: 'clientDocs',
        folderPath: cleanUnitFolder,
        folderRules,
      });
      if (!clientDocPerms.view || !clientDocPerms.edit) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: `client:${clientId}`,
          details: { actionRequested: 'edit/upload', clientId: Number(clientId) },
          unitId: targetUnitId,
        });
        return res.status(403).json({
          error: 'Permissão negada: você não possui autorização para Alterar / Enviar documentos neste dossiê.',
        });
      }

      const safeFileName = sanitizeFileName(file.originalname);
      const folderPath = `bucketdainvicta/U${targetUnitId}/C${clientId}${admissionId ? `/ADM-${admissionId}` : '/GERAL'}`;

      const stored = await putBucketObject(file.buffer, {
        folderPath,
        mimeType: file.mimetype,
        originalName: safeFileName,
      });

      const [doc] = await db
        .insert(documentObjects)
        .values({
          clientId: Number(clientId),
          admissionId: admissionId ? Number(admissionId) : null,
          scope: 'client',
          unitFolderPath: cleanUnitFolder,
          isInterlinked: Boolean(cleanUnitFolder),
          folderPath,
          fileName: safeFileName,
          docCategory: docCategory || 'pessoal',
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: stored.sizeBytes,
          sha256Hash: stored.sha256Hash,
          storageUri: stored.storageUri,
          uploadedBy: req.authUser!.name,
          unitId: targetUnitId,
          versionNumber: 1,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_UPLOAD',
        entityType: 'document_object',
        entityId: String(doc.id),
        details: {
          fileName: doc.fileName,
          folderPath,
          sha256Hash: stored.sha256Hash,
          backend: stored.backend,
          deduplicated: stored.deduplicated,
        },
        unitId: targetUnitId,
      });

      const bucketStats = await getBucketRuntimeStats();
      res.json({ document: doc, deduplicated: stored.deduplicated, bucketStats });
    } catch (error) {
      console.error('Upload document error:', error);
      res.status(500).json({ error: 'Erro ao armazenar documento no bucket.' });
    }
  });

  // Link an existing client bucket document to a specific admission dossier without duplicating the binary in bucket
  app.post('/api/admissions/:id/link-document', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.id);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });
      const { documentId } = (req.body || {}) as { documentId?: number };
      const parsedDocId = parsePositiveIntId(documentId);
      if (!parsedDocId) return res.status(400).json({ error: 'documentId obrigatório.' });

      const [admRows, docRows] = await Promise.all([
        db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1),
        db.select().from(documentObjects).where(eq(documentObjects.id, parsedDocId)).limit(1),
      ]);
      const adm = admRows[0];
      const srcDoc = docRows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!srcDoc || srcDoc.deletedAt) return res.status(404).json({ error: 'Documento de origem não encontrado.' });
      if (!isUnitPermitted(req, adm.unitId) || !isUnitPermitted(req, srcDoc.unitId)) {
        return res.status(403).json({ error: 'Unidade da ficha ou do documento não autorizada.' });
      }

      if (srcDoc.admissionId === admissionId) {
        return res.json({ document: srcDoc, linked: false });
      }

      if (srcDoc.admissionId === null) {
        const [updated] = await db
          .update(documentObjects)
          .set({ admissionId, folderPath: `bucketdainvicta/U${adm.unitId}/C${srcDoc.clientId}/ADM-${admissionId}` })
          .where(eq(documentObjects.id, srcDoc.id))
          .returning();
        return res.json({ document: updated, linked: true });
      }

      const [linkedCopy] = await db
        .insert(documentObjects)
        .values({
          clientId: srcDoc.clientId,
          admissionId,
          folderPath: `bucketdainvicta/U${adm.unitId}/C${srcDoc.clientId}/ADM-${admissionId}`,
          fileName: srcDoc.fileName,
          docCategory: srcDoc.docCategory,
          mimeType: srcDoc.mimeType,
          sizeBytes: srcDoc.sizeBytes,
          sha256Hash: srcDoc.sha256Hash,
          storageUri: srcDoc.storageUri,
          uploadedBy: req.authUser!.name,
          unitId: adm.unitId,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_LINKED_TO_ADMISSION',
        entityType: 'document_object',
        entityId: String(linkedCopy.id),
        details: { sourceDocId: srcDoc.id, admissionId, sha256Hash: srcDoc.sha256Hash },
        unitId: adm.unitId,
      });

      res.json({ document: linkedCopy, linked: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao vincular documento à ficha.') });
    }
  });

  app.get('/api/bucket/status', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const [stats, totals] = await Promise.all([
        getBucketRuntimeStats(),
        db.select({ total: count() }).from(documentObjects).where(isNull(documentObjects.deletedAt)),
      ]);
      res.json({ ...stats, activeMetadataCount: Number(totals[0]?.total || 0) });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao consultar status do bucket.') });
    }
  });

  app.post('/api/bucket/provision-cloud', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { bucketName } = (req.body || {}) as { bucketName?: string };
      const result = await tryProvisionCloudBucket(bucketName);
      const stats = await getBucketRuntimeStats();
      res.status(result.ok ? 200 : 403).json({ ...result, stats });
    } catch (error) {
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(error, 'Erro ao provisionar bucket.') });
    }
  });

  app.get('/api/bucket/objects/:sha256', requireAuth, async (req: AuthRequest, res) => {
    try {
      const cleanHash = String(req.params.sha256 || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
      if (cleanHash.length !== 64) return res.status(400).json({ error: 'SHA-256 inválido.' });

      const [matchingDocs, matchingArchives, matchingCallLogs, matchingMsgs] = await Promise.all([
        db.select().from(documentObjects).where(eq(documentObjects.sha256Hash, cleanHash)),
        db.select().from(communicationArchives).where(eq(communicationArchives.sha256Hash, cleanHash)),
        db.select().from(whatsappCallLogs).where(eq(whatsappCallLogs.recordingSha256, cleanHash)),
        db.select().from(whatsappMessages).where(eq(whatsappMessages.mediaSha256, cleanHash)),
      ]);

      const isAdmin = req.authUser!.role === 'admin';
      const allowedUnits = req.authUser!.allowedUnitIds || [];
      const activeDocs = matchingDocs.filter((d) => !d.deletedAt);

      let allowedMsg: (typeof matchingMsgs)[number] | undefined;
      if (matchingMsgs.length > 0) {
        if (isAdmin) {
          allowedMsg = matchingMsgs[0];
        } else {
          const threadIds = Array.from(new Set(matchingMsgs.map((m) => m.threadId)));
          const threads = threadIds.length > 0
            ? await db.select({ id: whatsappThreads.id, unitId: whatsappThreads.unitId }).from(whatsappThreads).where(inArray(whatsappThreads.id, threadIds))
            : [];
          const allowedThreadIds = new Set(threads.filter((t) => allowedUnits.includes(t.unitId)).map((t) => t.id));
          allowedMsg = matchingMsgs.find((m) => allowedThreadIds.has(m.threadId));
        }
      }

      const allowedDoc = activeDocs.find((d) => isAdmin || allowedUnits.includes(d.unitId));
      const allowedArchive = matchingArchives.find((a) => isAdmin || allowedUnits.includes(a.unitId));
      const allowedCall = matchingCallLogs.find((c) => isAdmin || allowedUnits.includes(c.unitId));

      const hasAnyRecord =
        activeDocs.length > 0 || matchingArchives.length > 0 || matchingCallLogs.length > 0 || matchingMsgs.length > 0;
      const hasAnyAllowed = Boolean(allowedDoc || allowedArchive || allowedCall || allowedMsg);

      if (!isAdmin && hasAnyRecord && !hasAnyAllowed) {
        return res.status(403).json({ error: 'ACL negada: objeto pertencente a outra unidade.' });
      }
      if (!isAdmin && !hasAnyRecord) {
        return res.status(404).json({ error: 'Objeto não localizado no bucket.' });
      }

      const storageUri =
        allowedDoc?.storageUri ||
        allowedArchive?.storageUri ||
        allowedCall?.recordingStorageUri ||
        allowedMsg?.mediaStorageUri ||
        null;

      const etag = `"${cleanHash}"`;
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      const buf = await getBucketObjectBuffer(cleanHash, storageUri);
      if (!buf) return res.status(404).json({ error: 'Objeto não localizado no bucket.' });

      const mime =
        allowedDoc?.mimeType ||
        allowedArchive?.mimeType ||
        allowedCall?.recordingMimeType ||
        allowedMsg?.attachmentMimeType ||
        String(req.query.mime || 'application/octet-stream');
      const fileName = sanitizeFileName(
        allowedDoc?.fileName ||
          allowedArchive?.fileName ||
          allowedCall?.recordingFileName ||
          allowedMsg?.attachmentName ||
          String(req.query.name || `${cleanHash}.bin`)
      );
      const disposition = req.query.preview === '1' && canPreviewInline(mime) ? 'inline' : 'attachment';

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);
      return res.send(buf);
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao ler objeto do bucket.') });
    }
  });

  app.patch('/api/documents/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: unidade do anexo não autorizada.' });
      }
      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: doc.scope === 'unit' ? 'unit_browser' : 'direct',
      });
      if (!eff.view || !eff.edit) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'edit/rename', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: seu perfil não pode alterar este arquivo.' });
      }

      const body = (req.body || {}) as {
        fileName?: string;
        docCategory?: string;
        unitFolderPath?: string;
      };
      const nextFileName = body.fileName ? sanitizeFileName(body.fileName) : doc.fileName;
      const nextCategory = body.docCategory !== undefined ? String(body.docCategory).trim() || doc.docCategory : doc.docCategory;
      const nextUnitFolder =
        body.unitFolderPath !== undefined ? normalizeFolderPath(body.unitFolderPath) : doc.unitFolderPath;

      const [updated] = await db
        .update(documentObjects)
        .set({
          fileName: nextFileName,
          docCategory: nextCategory,
          unitFolderPath: nextUnitFolder,
        })
        .where(eq(documentObjects.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_RENAMED',
        entityType: 'document_object',
        entityId: String(id),
        details: {
          previousFileName: doc.fileName,
          newFileName: updated.fileName,
          unitFolderPath: updated.unitFolderPath,
        },
        unitId: doc.unitId,
      });

      res.json({ ok: true, document: { ...updated, effectivePermissions: eff } });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao alterar documento.') });
    }
  });

  app.post('/api/documents/:id/replace', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado para substituição.' });

      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: unidade do anexo não autorizada.' });
      }

      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: doc.scope === 'unit' ? 'unit_browser' : 'direct',
      });
      if (!eff.view || !eff.edit) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'edit/replace', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: seu perfil não pode substituir este arquivo.' });
      }

      const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
      if (validationErr) return res.status(400).json({ error: validationErr });

      const safeFileName = sanitizeFileName(file.originalname);
      const stored = await putBucketObject(file.buffer, {
        folderPath: doc.folderPath,
        mimeType: file.mimetype,
        originalName: safeFileName,
      });

      const [updated] = await db
        .update(documentObjects)
        .set({
          fileName: safeFileName,
          mimeType: file.mimetype || doc.mimeType,
          sizeBytes: stored.sizeBytes,
          previousSha256: doc.sha256Hash,
          sha256Hash: stored.sha256Hash,
          storageUri: stored.storageUri,
          versionNumber: (doc.versionNumber || 1) + 1,
          uploadedBy: req.authUser!.name,
          lastSyncedAt: new Date(),
        })
        .where(eq(documentObjects.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_REPLACED',
        entityType: 'document_object',
        entityId: String(id),
        details: {
          previousFileName: doc.fileName,
          newFileName: updated.fileName,
          previousSha256: doc.sha256Hash,
          newSha256: stored.sha256Hash,
          versionNumber: updated.versionNumber,
        },
        unitId: doc.unitId,
      });

      res.json({ ok: true, document: { ...updated, effectivePermissions: eff } });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao substituir arquivo.') });
    }
  });

  app.delete('/api/documents/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: unidade do anexo não autorizada.' });
      }
      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: doc.scope === 'unit' ? 'unit_browser' : 'direct',
      });
      if (!eff.view || !eff.delete) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'delete/trash', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: você não possui direito de Excluir este arquivo.' });
      }
      const [updated] = await db
        .update(documentObjects)
        .set({ deletedAt: new Date(), deletedBy: req.authUser!.name })
        .where(eq(documentObjects.id, id))
        .returning();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_TRASHED',
        entityType: 'document_object',
        entityId: String(id),
        details: { fileName: doc.fileName },
        unitId: doc.unitId,
      });
      res.json({ document: updated });
    } catch (error) {
      console.error('Trash doc error:', error);
      res.status(500).json({ error: 'Erro ao mover documento para a lixeira.' });
    }
  });

  app.delete('/api/documents/:id/purge', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: unidade do anexo não autorizada.' });
      }
      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: doc.scope === 'unit' ? 'unit_browser' : 'direct',
      });
      if (!eff.view || !eff.delete) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'delete/purge', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: você não possui direito de Excluir definitivamente.' });
      }

      await db.delete(documentObjects).where(eq(documentObjects.id, id));
      const remainingSameHash = await db
        .select({ id: documentObjects.id })
        .from(documentObjects)
        .where(eq(documentObjects.sha256Hash, doc.sha256Hash))
        .limit(1);
      if (remainingSameHash.length === 0) {
        await deletePhysicalBucketObjectIfUnreferenced(doc.sha256Hash, doc.storageUri);
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_PURGED',
        entityType: 'document_object',
        entityId: String(id),
        details: { fileName: doc.fileName, sha256Hash: doc.sha256Hash },
        unitId: doc.unitId,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir definitivamente.') });
    }
  });

  app.post('/api/documents/:id/restore', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: unidade do anexo não autorizada.' });
      }
      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: doc.scope === 'unit' ? 'unit_browser' : 'direct',
      });
      if (!eff.view || (!eff.edit && !eff.delete)) {
        return res.status(403).json({ error: 'Permissão negada para restaurar este documento.' });
      }
      const [updated] = await db
        .update(documentObjects)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(documentObjects.id, id))
        .returning();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DOCUMENT_RESTORED',
        entityType: 'document_object',
        entityId: String(id),
        details: { fileName: doc.fileName },
        unitId: doc.unitId,
      });
      res.json({ document: updated });
    } catch (error) {
      console.error('Restore doc error:', error);
      res.status(500).json({ error: 'Erro ao restaurar documento.' });
    }
  });

  app.get('/api/documents/:id/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de documento inválido.' });
      const rows = await db.select().from(documentObjects).where(eq(documentObjects.id, id)).limit(1);
      const doc = rows[0];
      if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Documento não encontrado ou na lixeira.' });
      if (!isUnitPermitted(req, doc.unitId)) {
        return res.status(403).json({ error: 'ACL negada: sem concessão para acessar este anexo.' });
      }

      const isPreview = req.query.preview === '1';
      const isPrintMode = req.query.mode === 'print';
      const accessContext =
        req.query.context === 'unit_browser'
          ? 'unit_browser'
          : req.query.context === 'client_dossier'
          ? 'client_dossier'
          : doc.scope === 'unit'
          ? 'unit_browser'
          : 'direct';

      const rules = await loadFolderRulesForUser(doc.unitId);
      const eff = evaluateDocumentAccess({
        authUser: req.authUser!,
        doc,
        folderRules: rules,
        context: accessContext,
      });

      if (!eff.view) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'view', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: seu perfil não pode visualizar este documento.' });
      }

      if (isPrintMode && !eff.print) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'print', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({ error: 'Permissão negada: impressão desabilitada para este arquivo.' });
      }

      if (!isPreview && !isPrintMode && !eff.download) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'document_object',
          entityId: String(id),
          details: { actionRequested: 'download', fileName: doc.fileName },
          unitId: doc.unitId,
        });
        return res.status(403).json({
          error: 'Permissão negada: download bloqueado. Utilize o leitor interno protegido.',
        });
      }

      const etag = `"${doc.sha256Hash}"`;
      if (req.headers['if-none-match'] === etag && !isPrintMode) {
        return res.status(304).end();
      }

      const buf = await getBucketObjectBuffer(doc.sha256Hash, doc.storageUri);
      const safeName = sanitizeFileName(doc.fileName);
      const disposition =
        isPrintMode || (isPreview && canPreviewInline(doc.mimeType)) ? 'inline' : 'attachment';

      if (isPrintMode) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_PRINT',
          entityType: 'document_object',
          entityId: String(id),
          details: { fileName: doc.fileName, unitFolderPath: doc.unitFolderPath },
          unitId: doc.unitId,
        });
      } else if (!isPreview) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_DOWNLOAD',
          entityType: 'document_object',
          entityId: String(id),
          details: { fileName: doc.fileName, unitFolderPath: doc.unitFolderPath },
          unitId: doc.unitId,
        });
      }

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Document-Print-Allowed', eff.print ? '1' : '0');
      res.setHeader('X-Document-Download-Allowed', eff.download ? '1' : '0');

      if (buf) {
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
        return res.send(buf);
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${safeName}.txt"`);
      res.send(`FinancePro Bucket Object (${doc.storageUri})\nPasta: ${doc.folderPath}\nArquivo: ${doc.fileName}\nSHA-256: ${doc.sha256Hash}\nCategoria: ${doc.docCategory}\nEnviado por: ${doc.uploadedBy}`);
    } catch (error) {
      console.error('Download doc error:', error);
      res.status(500).json({ error: 'Erro ao baixar documento do bucket.' });
    }
  });

  // Audit routes registered via registerAuditRoutes(app, { broadcast })

  // ---------------------------------------------------------------------------
  // 4. JURÍDICO (ESCAVADOR WEBHOOK/FALLBACK, IVI TRADUÇÃO & SLAs)
  // ---------------------------------------------------------------------------
  app.get('/api/legal', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const [procs, movs, allClients, allUsers, allCases, allReceivables] = await Promise.all([
        db.select().from(legalProcesses).orderBy(desc(legalProcesses.lastMovementAt)),
        db.select().from(legalMovements).orderBy(desc(legalMovements.createdAt)),
        db.select().from(clients),
        db.select({ id: users.id, name: users.name, role: users.role }).from(users),
        db.select().from(collectionCases).orderBy(desc(collectionCases.updatedAt)),
        db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER')),
      ]);
      const allowedUnits = getAllowedUnitIds(req);
      const unitAllowed = (uId: number | null | undefined) =>
        allowedUnits === null || (typeof uId === 'number' && allowedUnits.includes(uId));
      const permittedProcs = procs.filter((p) => unitAllowed(p.unitId));
      const permittedProcIds = new Set(permittedProcs.map((p) => p.id));
      res.json({
        processes: permittedProcs,
        movements: allowedUnits === null ? movs : movs.filter((m) => permittedProcIds.has(m.processId)),
        clients: allClients.filter((c) => unitAllowed(c.unitId)),
        lawyers: allUsers,
        collectionCases: allCases.filter((c) => unitAllowed(c.unitId)),
        financialTitles: allReceivables.filter((t) => unitAllowed(t.unitId)),
      });
    } catch (error) {
      console.error('Legal get error:', error);
      res.status(500).json({ error: 'Erro ao carregar setor jurídico.' });
    }
  });

  app.post('/api/legal/escavador-sync', requireAuth, requireModule('legal'), async (req: AuthRequest, res) => {
    try {
      const { processId, dispatchText, source, isSeized } = req.body as {
        processId: number;
        dispatchText: string;
        source?: string;
        isSeized?: boolean;
      };
      const parsedProcId = parsePositiveIntId(processId);
      if (!parsedProcId) return res.status(400).json({ error: 'ID do processo inválido.' });
      const [targetProc] = await db
        .select()
        .from(legalProcesses)
        .where(eq(legalProcesses.id, parsedProcId))
        .limit(1);
      if (!targetProc) {
        return res.status(404).json({ error: 'Processo jurídico não encontrado.' });
      }
      if (!isUnitPermitted(req, targetProc.unitId)) {
        return res.status(403).json({ error: 'Unidade do processo não autorizada.' });
      }
      const [procClient] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, targetProc.clientId))
        .limit(1);

      if (
        !targetProc.escavadorMonitored ||
        targetProc.status === 'suspenso' ||
        targetProc.status === 'cancelado' ||
        procClient?.status === 'suspenso' ||
        procClient?.status === 'cancelado'
      ) {
        return res.status(409).json({
          error:
            'Cliente suspenso ou contrato cancelado: a Ivi retirou automaticamente o CPF/CNPJ da pesquisa do Escavador. Retorne o cliente ao status normal para reativar a varredura.',
        });
      }

      const tr = await iviTranslateLegalDispatch(dispatchText);
      const [movement] = await db
        .insert(legalMovements)
        .values({
          processId: parsedProcId,
          source: source || 'escavador_webhook',
          originalDispatch: dispatchText,
          iviTranslationPtBr: tr.text,
          lawyerId: req.authUser!.id,
        })
        .returning();

      const [proc] = await db
        .update(legalProcesses)
        .set({
          hasUnreadMovement: true,
          lastMovementAt: new Date(),
          status: isSeized ? 'apreendido' : 'alerta_movimentacao',
          vehicleSeized: Boolean(isSeized),
        })
        .where(eq(legalProcesses.id, parsedProcId))
        .returning();

      broadcast('legal:update', { processId: parsedProcId, processNumber: proc?.processNumber });
      await dispatchIviSectorNotification(
        {
          targetSector: 'juridico',
          targetUnitId: targetProc.unitId,
          relatedEntityType: 'legal_process',
          relatedEntityId: parsedProcId,
          senderName: 'Ivi IA · Escavador',
          subject: `${isSeized ? '[URGENTE BUSCA/APREENSÃO] ' : ''}Nova movimentação Escavador · ${proc?.processNumber || ''}`,
          body: `Cliente ${procClient?.fullName || `#${targetProc.clientId}`}: ${tr.text.slice(0, 220)}`,
        },
        db,
        broadcast
      );
      res.json({ movement, process: proc, providerUsed: tr.provider });
    } catch (error) {
      console.error('Escavador sync error:', error);
      res.status(500).json({ error: 'Erro ao processar atualização Escavador.' });
    }
  });

  app.post('/api/legal/movements/:id/open', requireAuth, requireModule('legal'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de movimentação inválido.' });
      const rows = await db.select().from(legalMovements).where(eq(legalMovements.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Movimentação não encontrada.' });
      const [proc] = await db.select({ unitId: legalProcesses.unitId }).from(legalProcesses).where(eq(legalProcesses.id, rows[0].processId)).limit(1);
      if (proc && !isUnitPermitted(req, proc.unitId)) return res.status(403).json({ error: 'Unidade do processo não autorizada.' });
      if (!rows[0].openedAt) {
        const [updated] = await db.update(legalMovements).set({ openedAt: new Date() }).where(eq(legalMovements.id, id)).returning();
        return res.json({ movement: updated });
      }
      res.json({ movement: rows[0] });
    } catch (error) {
      console.error('Legal open error:', error);
      res.status(500).json({ error: 'Erro ao registrar abertura.' });
    }
  });

  app.post('/api/legal/movements/:id/read-complete', requireAuth, requireModule('legal'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de movimentação inválido.' });
      const [existing] = await db.select().from(legalMovements).where(eq(legalMovements.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Movimentação não encontrada.' });
      const [proc] = await db.select({ unitId: legalProcesses.unitId }).from(legalProcesses).where(eq(legalProcesses.id, existing.processId)).limit(1);
      if (proc && !isUnitPermitted(req, proc.unitId)) return res.status(403).json({ error: 'Unidade do processo não autorizada.' });
      const [updated] = await db
        .update(legalMovements)
        .set({ readCompletedAt: new Date(), lawyerId: req.authUser!.id })
        .where(eq(legalMovements.id, id))
        .returning();
      if (updated) {
        await db.update(legalProcesses).set({ hasUnreadMovement: false }).where(eq(legalProcesses.id, updated.processId));
      }
      res.json({ movement: updated });
    } catch (error) {
      console.error('Legal read-complete error:', error);
      res.status(500).json({ error: 'Erro ao confirmar leitura.' });
    }
  });

  app.post('/api/legal/movements/:id/client-contact', requireAuth, requireModule('legal'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de movimentação inválido.' });
      const [existing] = await db.select().from(legalMovements).where(eq(legalMovements.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Movimentação não encontrada.' });
      const [proc] = await db.select({ unitId: legalProcesses.unitId }).from(legalProcesses).where(eq(legalProcesses.id, existing.processId)).limit(1);
      if (proc && !isUnitPermitted(req, proc.unitId)) return res.status(403).json({ error: 'Unidade do processo não autorizada.' });
      const { contactChannel, contactSummary, emailSent } = req.body as {
        contactChannel: string;
        contactSummary: string;
        emailSent: boolean;
      };
      const [updated] = await db
        .update(legalMovements)
        .set({
          clientContactedAt: new Date(),
          contactChannel,
          contactSummary,
          emailSent: Boolean(emailSent),
          lawyerId: req.authUser!.id,
        })
        .where(eq(legalMovements.id, id))
        .returning();
      res.json({ movement: updated });
    } catch (error) {
      console.error('Legal contact error:', error);
      res.status(500).json({ error: 'Erro ao registrar contato ao cliente.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. NEGOCIAÇÕES BANCÁRIAS (MÓDULO COMPLETO + IVI IA + WHATSAPP DUPLO + KANBAN)
  // ---------------------------------------------------------------------------
  registerNegotiationsRoutes(app, {
    broadcast,
    resolveUazapiCredentials,
    mirrorCommunicationToProspection,
  });

  // ---------------------------------------------------------------------------
  // 6. FINANCEIRO (BOLETOS, VARREDURA 07H, FOLHA DE ROSTO & RÉGUA IVI)
  // ---------------------------------------------------------------------------
  app.get('/api/finance', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const [titles, cats, allClients, allAdmissions, settingsRows] = await Promise.all([
        allowedUnits === null
          ? db.select().from(financialTitles).orderBy(desc(financialTitles.dueDate))
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(financialTitles).where(inArray(financialTitles.unitId, allowedUnits)).orderBy(desc(financialTitles.dueDate)),
        db.select().from(paymentCategories),
        allowedUnits === null
          ? db.select().from(clients)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(clients).where(inArray(clients.unitId, allowedUnits)),
        allowedUnits === null
          ? db.select().from(admissions)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(admissions).where(inArray(admissions.unitId, allowedUnits)),
        db.select().from(systemSettings),
      ]);
      res.json({
        titles,
        categories: cats,
        clients: allClients,
        admissions: allAdmissions,
        settings: Object.fromEntries(settingsRows.map((s) => [s.key, s.value])),
      });
    } catch (error) {
      console.error('Finance get error:', error);
      res.status(500).json({ error: 'Erro ao carregar módulo financeiro.' });
    }
  });

  app.post('/api/finance/ivi-07h-scan', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const allowedUnits = getAllowedUnitIds(req);
      const [allTitles, allAdmissions, allClients] = await Promise.all([
        allowedUnits === null
          ? db.select().from(financialTitles)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(financialTitles).where(inArray(financialTitles.unitId, allowedUnits)),
        allowedUnits === null
          ? db.select().from(admissions)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(admissions).where(inArray(admissions.unitId, allowedUnits)),
        allowedUnits === null
          ? db.select().from(clients)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(clients).where(inArray(clients.unitId, allowedUnits)),
      ]);

      // Identify admissions where the 2 initial installments are paid and remaining installments aren't generated yet
      const readyForCoverSheet = allAdmissions
        .filter((adm) => {
          const admTitles = allTitles.filter((t) => t.admissionId === adm.id);
          const paidInitials = admTitles.filter((t) => t.isInitialFee && String(t.status).toLowerCase() === 'pago');
          const remaining = admTitles.filter((t) => !t.isInitialFee && String(t.status).toLowerCase() !== 'cancelado');
          return paidInitials.length >= 2 && remaining.length === 0 && adm.installmentsCount > 2;
        })
        .map((adm) => {
          const client = allClients.find((c) => c.id === adm.clientId);
          return {
            admissionId: adm.id,
            protocolCode: adm.protocolCode,
            clientName: client?.fullName || 'Cliente',
            bankName: adm.bankName,
            remainingInstallments: adm.installmentsCount - 2,
            installmentAmountCents: adm.initialInstallmentCents,
          };
        });

      if (readyForCoverSheet.length > 0) {
        await dispatchIviSectorNotification(
          {
            targetSector: 'financeiro',
            targetUnitId: req.activeUnitId || null,
            relatedEntityType: 'finance_scan',
            relatedEntityId: String(Date.now()),
            senderName: 'Ivi IA · Conciliação 07h',
            subject: `Varredura 07h: ${readyForCoverSheet.length} dossiê(s) pronto(s) para folha de rosto`,
            body: `Identificados ${readyForCoverSheet.length} contrato(s) com as 2 parcelas iniciais quitadas aguardando geração das demais parcelas em Administração Financeira.`,
          },
          db,
          broadcast
        );
      }

      res.json({
        scannedAt: new Date().toISOString(),
        paidTitlesTotal: allTitles.filter((t) => String(t.status).toLowerCase() === 'pago').length,
        readyForCoverSheet,
      });
    } catch (error) {
      console.error('Ivi 07h scan error:', error);
      res.status(500).json({ error: 'Erro na varredura Ivi 07:00h.' });
    }
  });

  app.post('/api/finance/generate-remaining/:admissionId', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const admissionId = parsePositiveIntId(req.params.admissionId);
      if (!admissionId) return res.status(400).json({ error: 'ID de admissão inválido.' });

      const { firstDueDate, customAmountCents } = (req.body || {}) as { firstDueDate?: string; customAmountCents?: number };
      let start: Date;
      if (firstDueDate !== undefined && firstDueDate !== null && String(firstDueDate).trim() !== '') {
        const parsed = parseSafeDate(firstDueDate);
        if (!parsed) return res.status(400).json({ error: 'Data do primeiro vencimento inválida.' });
        start = parsed;
      } else {
        start = new Date(Date.now() + 30 * 86400000);
      }

      if (customAmountCents !== undefined && customAmountCents !== null) {
        const amtNum = parseFiniteNumber(customAmountCents);
        if (amtNum === null || amtNum <= 0) {
          return res.status(400).json({ error: 'Valor da parcela inválido.' });
        }
      }

      const rows = await db.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
      const adm = rows[0];
      if (!adm) return res.status(404).json({ error: 'Admissão não encontrada.' });
      if (!isUnitPermitted(req, adm.unitId)) {
        return res.status(403).json({ error: 'Unidade da admissão não autorizada.' });
      }

      const existingRemaining = await db
        .select({ id: financialTitles.id, status: financialTitles.status })
        .from(financialTitles)
        .where(and(eq(financialTitles.admissionId, adm.id), eq(financialTitles.isInitialFee, false)));
      if (existingRemaining.some((t) => String(t.status).toLowerCase() !== 'cancelado')) {
        return res.status(409).json({ error: 'As parcelas restantes desta admissão já foram geradas.' });
      }

      const [cat] = await db.select().from(paymentCategories).limit(1);
      const resolvedAmount = Math.round(Number(customAmountCents || adm.initialInstallmentCents || 50000));
      const created = await db.transaction(async (tx) => {
        const out = [];
        for (let i = 3; i <= adm.installmentsCount; i++) {
          const dueDate = new Date(start.getTime() + (i - 3) * 30 * 86400000);
          const [title] = await tx
            .insert(financialTitles)
            .values({
              titleCode: `TIT-${new Date().getFullYear()}-${adm.id}0${i}-${Math.floor(100 + Math.random() * 899)}`,
              clientId: adm.clientId,
              admissionId: adm.id,
              unitId: adm.unitId,
              categoryId: cat?.id || null,
              installmentNumber: i,
              totalInstallments: adm.installmentsCount,
              isInitialFee: false,
              amountCents: resolvedAmount,
              originalValueCents: resolvedAmount,
              currentBalanceCents: resolvedAmount,
              dueDate,
              status: 'aberto',
              boletoProvider: 'santander',
              coverSheetApproved: true,
              barcode: `03399.63290 64000.00${adm.id} 00100.${i}01014 8 ${Math.floor(10000000000000 + Math.random() * 89999999999999)}`,
              ourNumber: `${adm.id}000${i}`,
            })
            .returning();
          out.push(title);
        }
        return out;
      });

      if (created.length > 0) {
        await dispatchIviSectorNotification(
          {
            targetSector: 'cobranca',
            targetUnitId: adm.unitId,
            relatedEntityType: 'admission',
            relatedEntityId: adm.id,
            senderName: 'Ivi IA · Faturamento',
            subject: `Novas parcelas liberadas para carteira · ${adm.protocolCode}`,
            body: `${created.length} parcela(s) restante(s) foram geradas para o contrato ${adm.contractNumber || adm.protocolCode} e disponibilizadas para acompanhamento de Cobrança.`,
          },
          db,
          broadcast
        );
      }

      res.json({ generatedCount: created.length, titles: created });
    } catch (error) {
      console.error('Generate remaining installments error:', error);
      res.status(500).json({ error: 'Erro ao gerar demais parcelas.' });
    }
  });

  app.post('/api/finance/run-regua', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { titleId } = (req.body || {}) as { titleId?: number };
      const allowedUnits = getAllowedUnitIds(req);
      let allTitles;
      if (titleId !== undefined && titleId !== null && String(titleId).trim() !== '') {
        const parsedTitleId = parsePositiveIntId(titleId);
        if (!parsedTitleId) return res.status(400).json({ error: 'ID de título inválido.' });
        allTitles = await db.select().from(financialTitles).where(eq(financialTitles.id, parsedTitleId));
        if (allTitles[0] && !isUnitPermitted(req, allTitles[0].unitId)) {
          return res.status(403).json({ error: 'Sem permissão para operar título desta unidade.' });
        }
      } else {
        allTitles =
          allowedUnits === null
            ? await db.select().from(financialTitles)
            : allowedUnits.length === 0
            ? []
            : await db.select().from(financialTitles).where(inArray(financialTitles.unitId, allowedUnits));
      }
      const target = allTitles.find((t) => {
        const st = String(t.status || '').toLowerCase();
        return st === 'aberto' || st === 'vencido';
      });
      if (!target) return res.status(404).json({ error: 'Nenhum título elegível para régua.' });

      const [client] = await db.select().from(clients).where(eq(clients.id, target.clientId)).limit(1);
      const daysDiff = Math.round((new Date(target.dueDate).getTime() - Date.now()) / 86400000);
      const draft = await iviDraftCollectionMessage({
        clientName: client?.fullName || 'Cliente',
        amountFormatted: `R$ ${(target.amountCents / 100).toFixed(2)}`,
        daysOffset: daysDiff < 0 ? Math.abs(daysDiff) : -daysDiff,
        processSummary: `Contrato vinculado à parcela ${target.installmentNumber}/${target.totalInstallments} (${target.titleCode}).`,
      });

      const stageTag = daysDiff < 0 ? '+7d' : daysDiff <= 5 ? '-5d' : '-15d';
      await db
        .update(financialTitles)
        .set({ reguaStageSent: [...(target.reguaStageSent || []), stageTag] })
        .where(eq(financialTitles.id, target.id));

      res.json({ titleCode: target.titleCode, clientName: client?.fullName, message: draft.text, provider: draft.provider, stageTag });
    } catch (error) {
      console.error('Run regua error:', error);
      res.status(500).json({ error: 'Erro ao executar régua de cobrança Ivi.' });
    }
  });

  // PRD FR-10: Batch settlement for multiple financial titles (idempotent + transactional + unit-scoped)
  app.post('/api/finance/batch-settle', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const titleIds = parsePositiveIntArray(req.body?.titleIds, 500);
      if (titleIds.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um título válido para baixa em lote.' });
      }

      const targets = await db.select().from(financialTitles).where(inArray(financialTitles.id, titleIds));
      if (targets.length === 0) {
        return res.status(404).json({ error: 'Nenhum título encontrado para baixa.' });
      }
      if (targets.some((t) => !isUnitPermitted(req, t.unitId))) {
        return res.status(403).json({ error: 'Um ou mais títulos pertencem a uma unidade não autorizada.' });
      }

      const eligibleIds = targets
        .filter((t) => {
          const st = String(t.status || '').toLowerCase();
          return st !== 'pago' && st !== 'cancelado' && st !== 'agrupado';
        })
        .map((t) => t.id);

      if (eligibleIds.length === 0) {
        return res.json({ settledCount: 0, alreadySettledCount: targets.length });
      }

      const updated = await db.transaction(async (tx) => {
        const settledRows = await tx
          .update(financialTitles)
          .set({ status: 'pago', currentBalanceCents: 0, paidAt: new Date(), collectorId: req.authUser!.id, updatedAt: new Date() })
          .where(inArray(financialTitles.id, eligibleIds))
          .returning();

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'FINANCE_BATCH_SETTLE',
          entityType: 'financial_title',
          entityId: eligibleIds.join(','),
          details: { count: settledRows.length },
          unitId: req.activeUnitId,
        });

        const activeAccounts = await tx.select().from(bankAccounts).where(eq(bankAccounts.active, true));
        if (settledRows.length > 0 && activeAccounts.length > 0) {
          const balanceCache = new Map<number, number>(activeAccounts.map((a) => [a.id, a.currentBalanceCents]));
          for (const titleRow of settledRows) {
            const targetAcc =
              (titleRow.bankAccountId ? activeAccounts.find((a) => a.id === titleRow.bankAccountId) : undefined) ||
              activeAccounts.find((a) => a.unitId === titleRow.unitId) ||
              activeAccounts[0];
            if (!targetAcc) continue;

            const settleAmt = titleRow.currentBalanceCents > 0 ? titleRow.currentBalanceCents : titleRow.amountCents;
            const [createdMov] = await tx
              .insert(bankMovements)
              .values({
                bankAccountId: targetAcc.id,
                movementType: 'CREDITO',
                amountCents: settleAmt,
                description: `Baixa Título ${titleRow.titleCode}`,
                documentNumber: titleRow.titleCode,
                movementDate: new Date(),
                origin: 'BAIXA_RECEBER',
                status: 'PENDENTE',
                reconciled: false,
                titleId: titleRow.id,
                titleSource: 'RECEBER',
                unitId: titleRow.unitId,
              })
              .returning();
            balanceCache.set(targetAcc.id, (balanceCache.get(targetAcc.id) ?? 0) + settleAmt);
            await tx.insert(auditLogs).values({
              userId: req.authUser!.id,
              userName: req.authUser!.name,
              action: 'CREATE_BANK_MOVEMENT',
              entityType: 'bank_movement',
              entityId: String(createdMov.id),
              details: {
                changes: [
                  { field: 'Origem', from: '', to: 'BAIXA_RECEBER' },
                  { field: 'Descrição', from: '', to: createdMov.description },
                  { field: 'Valor', from: '', to: String(createdMov.amountCents) },
                ],
              },
              unitId: req.activeUnitId,
            });
          }

          for (const acc of activeAccounts) {
            const nextBal = balanceCache.get(acc.id);
            if (nextBal !== undefined && nextBal !== acc.currentBalanceCents) {
              await tx.update(bankAccounts).set({ currentBalanceCents: nextBal }).where(eq(bankAccounts.id, acc.id));
            }
          }
        }
        return settledRows;
      });

      broadcast('collection:payment', { operator: req.authUser!.name, points: updated.length * 10 });
      res.json({ settledCount: updated.length });
    } catch (error) {
      console.error('Batch settle error:', error);
      res.status(500).json({ error: 'Erro na baixa em lote.' });
    }
  });

  // ---------------------------------------------------------------------------
  // FINANCEIRO > CADASTROS ROUTES (Fornecedores, Tipo Documento, Portador, Plano de Contas)
  // ---------------------------------------------------------------------------

  // 1. Fornecedores (clients with natureza = 'F')
  app.get('/api/finance/suppliers', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const list =
        allowedUnits === null
          ? await db.select().from(clients).where(eq(clients.natureza, 'F')).orderBy(desc(clients.id))
          : allowedUnits.length === 0
          ? []
          : await db
              .select()
              .from(clients)
              .where(and(eq(clients.natureza, 'F'), inArray(clients.unitId, allowedUnits)))
              .orderBy(desc(clients.id));
      res.json({ suppliers: list });
    } catch (error) {
      console.error('Get suppliers error:', error);
      res.status(500).json({ error: 'Erro ao carregar fornecedores.' });
    }
  });

  app.post('/api/finance/suppliers', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { fullName, cpfCnpj, personNature, phone, email, address, addressNumber, complement, neighborhood, city, state, zipCode, notes, unitId } = req.body as any;
      if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: 'Nome / Razão Social é obrigatório.' });
      if (!cpfCnpj || !String(cpfCnpj).trim()) return res.status(400).json({ error: 'CPF/CNPJ é obrigatório.' });

      const targetUnitId = unitId !== undefined && unitId !== null ? parsePositiveIntId(unitId) : req.activeUnitId || 1;
      if (!targetUnitId || !isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade inválida ou não autorizada para cadastrar fornecedor.' });
      }

      const [created] = await db.insert(clients).values({
        fullName: String(fullName).trim(),
        cpfCnpj: String(cpfCnpj).trim(),
        personNature: personNature || 'PJ',
        natureza: 'F',
        phone: phone || '',
        email: email || '',
        address: address || '',
        addressNumber: addressNumber || '',
        complement: complement || '',
        neighborhood: neighborhood || '',
        city: city || '',
        state: state || '',
        zipCode: zipCode || '',
        notes: notes || '',
        unitId: targetUnitId,
      }).returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_SUPPLIER',
        entityType: 'supplier',
        entityId: String(created.id),
        details: { name: created.fullName },
        unitId: req.activeUnitId,
      });

      res.json({ supplier: created });
    } catch (error) {
      console.error('Create supplier error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar fornecedor.') });
    }
  });

  app.put('/api/finance/suppliers/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de fornecedor inválido.' });

      const [existing] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.natureza, 'F'))).limit(1);
      if (!existing) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar fornecedor desta unidade.' });
      }

      const { fullName, cpfCnpj, personNature, phone, email, address, addressNumber, complement, neighborhood, city, state, zipCode, notes } = req.body as any;
      if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: 'Nome / Razão Social é obrigatório.' });

      const [updated] = await db.update(clients).set({
        fullName: String(fullName).trim(),
        cpfCnpj: cpfCnpj ? String(cpfCnpj).trim() : existing.cpfCnpj,
        personNature: personNature || 'PJ',
        natureza: 'F',
        phone: phone || '',
        email: email || '',
        address: address || '',
        addressNumber: addressNumber || '',
        complement: complement || '',
        neighborhood: neighborhood || '',
        city: city || '',
        state: state || '',
        zipCode: zipCode || '',
        notes: notes || '',
      }).where(and(eq(clients.id, id), eq(clients.natureza, 'F'))).returning();

      if (!updated) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_SUPPLIER',
        entityType: 'supplier',
        entityId: String(updated.id),
        details: { name: updated.fullName },
        unitId: req.activeUnitId,
      });

      res.json({ supplier: updated });
    } catch (error) {
      console.error('Update supplier error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar fornecedor.') });
    }
  });

  app.delete('/api/finance/suppliers/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de fornecedor inválido.' });

      const [existing] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.natureza, 'F'))).limit(1);
      if (!existing) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir fornecedor desta unidade.' });
      }

      const titlesCount = await db.select({ v: count() }).from(financialTitles).where(eq(financialTitles.clientId, id));
      if (Number(titlesCount[0]?.v || 0) > 0) {
        return res.status(400).json({ error: `Exclusão bloqueada: existem ${titlesCount[0].v} título(s) financeiro(s) vinculados a este fornecedor.` });
      }

      const [deleted] = await db.delete(clients).where(and(eq(clients.id, id), eq(clients.natureza, 'F'))).returning();
      if (!deleted) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_SUPPLIER',
        entityType: 'supplier',
        entityId: String(id),
        details: { name: deleted.fullName },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Delete supplier error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir fornecedor.') });
    }
  });

  // 2. Tipos de Documento (/api/finance/document-types)
  app.get('/api/finance/document-types', requireAuth, requireModule('finance'), async (_req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const list = await db.select().from(documentTypes).orderBy(desc(documentTypes.id));
      res.json({ documentTypes: list });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao carregar tipos de documento.' });
    }
  });

  app.post('/api/finance/document-types', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { description, category, isFiscal, requiresNumber, active } = req.body as any;
      if (!description || !String(description).trim()) return res.status(400).json({ error: 'Descrição é obrigatória.' });

      const [created] = await db.insert(documentTypes).values({
        description: String(description).trim(),
        category: category || 'ambos',
        isFiscal: Boolean(isFiscal),
        requiresNumber: Boolean(requiresNumber),
        active: active !== false,
      }).returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_DOCUMENT_TYPE',
        entityType: 'document_type',
        entityId: String(created.id),
        details: { description: created.description },
        unitId: req.activeUnitId,
      });

      res.json({ documentType: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar tipo de documento.') });
    }
  });

  app.put('/api/finance/document-types/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { description, category, isFiscal, requiresNumber, active } = req.body as any;
      if (!description || !String(description).trim()) return res.status(400).json({ error: 'Descrição é obrigatória.' });

      const [updated] = await db.update(documentTypes).set({
        description: String(description).trim(),
        category: category || 'ambos',
        isFiscal: Boolean(isFiscal),
        requiresNumber: Boolean(requiresNumber),
        active: active !== false,
      }).where(eq(documentTypes.id, id)).returning();

      if (!updated) return res.status(404).json({ error: 'Tipo de documento não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_DOCUMENT_TYPE',
        entityType: 'document_type',
        entityId: String(id),
        details: { description: updated.description },
        unitId: req.activeUnitId,
      });

      res.json({ documentType: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar tipo de documento.') });
    }
  });

  app.delete('/api/finance/document-types/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const [deleted] = await db.delete(documentTypes).where(eq(documentTypes.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: 'Tipo de documento não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_DOCUMENT_TYPE',
        entityType: 'document_type',
        entityId: String(id),
        details: { description: deleted.description },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir tipo de documento.') });
    }
  });

  // 3. Portadores (/api/finance/bearers)
  app.get('/api/finance/bearers', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const all = await db.select().from(bearers).orderBy(desc(bearers.id));
      const list =
        allowedUnits === null
          ? all
          : all.filter((b) => !b.unitId || allowedUnits.includes(b.unitId));
      res.json({ bearers: list });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao carregar portadores.' });
    }
  });

  app.post('/api/finance/bearers', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { code, name, type, associatedBankAccountId, active } = req.body as any;
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome do portador é obrigatório.' });
      const assocAccId = associatedBankAccountId ? parsePositiveIntId(associatedBankAccountId) : null;
      if (associatedBankAccountId && !assocAccId) {
        return res.status(400).json({ error: 'Conta bancária associada inválida.' });
      }

      const [created] = await db.insert(bearers).values({
        code: code ? String(code).trim() : '',
        name: String(name).trim(),
        type: type || 'banco',
        associatedBankAccountId: assocAccId,
        active: active !== false,
        unitId: req.activeUnitId,
      }).returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_BEARER',
        entityType: 'bearer',
        entityId: String(created.id),
        details: { name: created.name },
        unitId: req.activeUnitId,
      });

      res.json({ bearer: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar portador.') });
    }
  });

  app.put('/api/finance/bearers/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de portador inválido.' });
      const [existing] = await db.select().from(bearers).where(eq(bearers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Portador não encontrado.' });
      if (existing.unitId && !isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar portador desta unidade.' });
      }

      const { code, name, type, associatedBankAccountId, active } = req.body as any;
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome do portador é obrigatório.' });
      const assocAccId = associatedBankAccountId ? parsePositiveIntId(associatedBankAccountId) : null;
      if (associatedBankAccountId && !assocAccId) {
        return res.status(400).json({ error: 'Conta bancária associada inválida.' });
      }

      const [updated] = await db.update(bearers).set({
        code: code ? String(code).trim() : '',
        name: String(name).trim(),
        type: type || 'banco',
        associatedBankAccountId: assocAccId,
        active: active !== false,
      }).where(eq(bearers.id, id)).returning();

      if (!updated) return res.status(404).json({ error: 'Portador não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_BEARER',
        entityType: 'bearer',
        entityId: String(id),
        details: { name: updated.name },
        unitId: req.activeUnitId,
      });

      res.json({ bearer: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar portador.') });
    }
  });

  app.delete('/api/finance/bearers/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de portador inválido.' });
      const [existing] = await db.select().from(bearers).where(eq(bearers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Portador não encontrado.' });
      if (existing.unitId && !isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir portador desta unidade.' });
      }

      const [deleted] = await db.delete(bearers).where(eq(bearers.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: 'Portador não encontrado.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_BEARER',
        entityType: 'bearer',
        entityId: String(id),
        details: { name: deleted.name },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir portador.') });
    }
  });

  // 4. Plano de Contas (/api/finance/chart-of-accounts)
  app.get('/api/finance/chart-of-accounts', requireAuth, requireModule('finance'), async (_req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const list = await db.select().from(chartOfAccounts).orderBy(chartOfAccounts.code);
      res.json({ chartOfAccounts: list });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao carregar plano de contas.' });
    }
  });

  app.post('/api/finance/chart-of-accounts', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { code, name, type, parentId, isAnalytic, active } = req.body as any;
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'Código e Nome são obrigatórios.' });
      }
      const parsedParent = parentId ? parsePositiveIntId(parentId) : null;
      if (parentId && !parsedParent) {
        return res.status(400).json({ error: 'Conta pai inválida.' });
      }

      const [created] = await db.insert(chartOfAccounts).values({
        code: String(code).trim(),
        name: String(name).trim(),
        type: type || 'despesa',
        parentId: parsedParent,
        isAnalytic: isAnalytic !== false,
        active: active !== false,
      }).returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_CHART_OF_ACCOUNTS',
        entityType: 'chart_of_accounts',
        entityId: String(created.id),
        details: { code: created.code, name: created.name },
        unitId: req.activeUnitId,
      });

      res.json({ account: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar conta no plano.') });
    }
  });

  app.put('/api/finance/chart-of-accounts/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { code, name, type, parentId, isAnalytic, active } = req.body as any;
      if (!code || !String(code).trim() || !name || !String(name).trim()) {
        return res.status(400).json({ error: 'Código e Nome são obrigatórios.' });
      }
      const parsedParent = parentId ? parsePositiveIntId(parentId) : null;
      if (parentId && !parsedParent) {
        return res.status(400).json({ error: 'Conta pai inválida.' });
      }
      if (parsedParent === id) {
        return res.status(400).json({ error: 'Uma conta não pode ser pai dela mesma.' });
      }

      const [updated] = await db.update(chartOfAccounts).set({
        code: String(code).trim(),
        name: String(name).trim(),
        type: type || 'despesa',
        parentId: parsedParent,
        isAnalytic: isAnalytic !== false,
        active: active !== false,
      }).where(eq(chartOfAccounts.id, id)).returning();

      if (!updated) return res.status(404).json({ error: 'Conta não encontrada.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_CHART_OF_ACCOUNTS',
        entityType: 'chart_of_accounts',
        entityId: String(id),
        details: { code: updated.code, name: updated.name },
        unitId: req.activeUnitId,
      });

      res.json({ account: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar conta no plano.') });
    }
  });

  app.delete('/api/finance/chart-of-accounts/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const children = await db.select({ v: count() }).from(chartOfAccounts).where(eq(chartOfAccounts.parentId, id));
      if (Number(children[0]?.v || 0) > 0) {
        return res.status(400).json({ error: 'Exclusão bloqueada: esta conta possui subcontas vinculadas.' });
      }

      const [deleted] = await db.delete(chartOfAccounts).where(eq(chartOfAccounts.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: 'Conta não encontrada.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_CHART_OF_ACCOUNTS',
        entityType: 'chart_of_accounts',
        entityId: String(id),
        details: { code: deleted.code, name: deleted.name },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir conta.') });
    }
  });

  // 5. Conta Corrente / Bancos (/api/finance/bank-accounts & /api/finance/bank-movements)
  app.get('/api/finance/bank-accounts', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const [list, apiConfigs] = await Promise.all([
        allowedUnits === null
          ? db.select().from(bankAccounts).orderBy(bankAccounts.bankName)
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db.select().from(bankAccounts).where(inArray(bankAccounts.unitId, allowedUnits)).orderBy(bankAccounts.bankName),
        db.select().from(bankAccountApiConfigs),
      ]);
      const cfgMap = new Map(apiConfigs.map((c) => [c.bankAccountId, c]));
      const enriched = list.map((acc) => {
        const cfg = cfgMap.get(acc.id);
        return {
          ...acc,
          santanderSummary: cfg
            ? {
                configured: true,
                environment: cfg.environment,
                executionMode: cfg.executionMode,
                boletoEnabled: cfg.boletoEnabled,
                pixEnabled: cfg.pixEnabled,
                hybridBoletoPixEnabled: cfg.hybridBoletoPixEnabled,
                covenantCode: cfg.covenantCode,
                workspaceId: cfg.workspaceId,
                pixKey: cfg.pixKey,
                hasClientId: Boolean(cfg.clientId || process.env.SANTANDER_CLIENT_ID),
                hasClientSecret: Boolean(cfg.clientSecretEncrypted || process.env.SANTANDER_CLIENT_SECRET),
                hasCertificate: Boolean(cfg.pfxBase64Encrypted || (cfg.certPemEncrypted && cfg.keyPemEncrypted)),
                lastTestOk: cfg.lastTestOk,
                lastTestedAt: cfg.lastTestedAt ? new Date(cfg.lastTestedAt).toISOString() : null,
              }
            : null,
        };
      });
      res.json({ bankAccounts: enriched });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao carregar contas bancárias.' });
    }
  });

  app.post('/api/finance/bank-accounts', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const {
        bankId,
        febrabanCode,
        bankName,
        agency,
        agencyDigit,
        accountNumber,
        accountDigit,
        accountType,
        beneficiaryDocument,
        beneficiaryName,
        apiProvider,
        apiIntegrationEnabled,
        isDefaultBoletoAccount,
        isDefaultPixAccount,
        initialBalanceCents,
        unitId,
        active,
      } = req.body as any;

      let resolvedBankName = bankName ? String(bankName).trim() : '';
      let resolvedFebraban = febrabanCode ? String(febrabanCode).trim() : '';
      const parsedBankId = bankId ? parsePositiveIntId(bankId) : null;
      if (parsedBankId) {
        const [linkedBank] = await db.select().from(banks).where(eq(banks.id, parsedBankId)).limit(1);
        if (linkedBank) {
          if (!resolvedBankName) resolvedBankName = linkedBank.name;
          if (!resolvedFebraban) resolvedFebraban = linkedBank.febrabanCode || linkedBank.code || '';
        }
      }

      if (!resolvedBankName) {
        return res.status(400).json({ error: 'Nome do banco é obrigatório.' });
      }
      const parsedBal = initialBalanceCents !== undefined && initialBalanceCents !== null ? parseFiniteNumber(initialBalanceCents) : 0;
      if (parsedBal === null) {
        return res.status(400).json({ error: 'Saldo inicial inválido.' });
      }
      const targetUnitId = unitId !== undefined && unitId !== null ? parsePositiveIntId(unitId) : req.activeUnitId;
      if (!targetUnitId || !isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade inválida ou não autorizada.' });
      }

      const normalizedProvider = apiProvider === 'santander' ? 'santander' : 'none';
      const defaultBoleto = Boolean(isDefaultBoletoAccount);
      const defaultPix = Boolean(isDefaultPixAccount);

      if (defaultBoleto) {
        await db.update(bankAccounts).set({ isDefaultBoletoAccount: false }).where(eq(bankAccounts.unitId, targetUnitId));
      }
      if (defaultPix) {
        await db.update(bankAccounts).set({ isDefaultPixAccount: false }).where(eq(bankAccounts.unitId, targetUnitId));
      }

      const initialBal = Math.round(parsedBal);
      const [created] = await db.insert(bankAccounts).values({
        bankId: parsedBankId,
        febrabanCode: resolvedFebraban,
        bankName: resolvedBankName,
        agency: agency ? String(agency).trim() : '',
        agencyDigit: agencyDigit ? String(agencyDigit).trim() : '',
        accountNumber: accountNumber ? String(accountNumber).trim() : '',
        accountDigit: accountDigit ? String(accountDigit).trim() : '',
        accountType: accountType || 'corrente',
        beneficiaryDocument: beneficiaryDocument ? String(beneficiaryDocument).trim() : '',
        beneficiaryName: beneficiaryName ? String(beneficiaryName).trim() : '',
        apiProvider: normalizedProvider,
        apiIntegrationEnabled: normalizedProvider === 'santander' ? apiIntegrationEnabled !== false : false,
        isDefaultBoletoAccount: defaultBoleto,
        isDefaultPixAccount: defaultPix,
        initialBalanceCents: initialBal,
        currentBalanceCents: initialBal,
        unitId: targetUnitId,
        active: active !== false,
      }).returning();

      if (normalizedProvider === 'santander') {
        await db
          .insert(bankAccountApiConfigs)
          .values({
            bankAccountId: created.id,
            provider: 'santander',
            environment: 'sandbox',
            executionMode: 'homologation_offline',
            pixKey: beneficiaryDocument ? String(beneficiaryDocument).replace(/\D/g, '') : '',
            pixKeyType: 'CNPJ',
            updatedBy: req.authUser!.name,
          })
          .onConflictDoNothing();
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_BANK_ACCOUNT',
        entityType: 'bank_account',
        entityId: String(created.id),
        details: {
          bankName: created.bankName,
          accountNumber: created.accountNumber,
          apiProvider: created.apiProvider,
          bankId: created.bankId,
        },
        unitId: req.activeUnitId,
      });

      res.json({ bankAccount: created });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao cadastrar conta bancária.') });
    }
  });

  app.put('/api/finance/bank-accounts/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });
      const [existing] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar conta bancária desta unidade.' });
      }

      const {
        bankId,
        febrabanCode,
        bankName,
        agency,
        agencyDigit,
        accountNumber,
        accountDigit,
        accountType,
        beneficiaryDocument,
        beneficiaryName,
        apiProvider,
        apiIntegrationEnabled,
        isDefaultBoletoAccount,
        isDefaultPixAccount,
        active,
      } = req.body as any;

      let resolvedBankName = bankName ? String(bankName).trim() : '';
      let resolvedFebraban =
        febrabanCode !== undefined ? String(febrabanCode).trim() : existing.febrabanCode;
      const parsedBankId =
        bankId !== undefined ? (bankId ? parsePositiveIntId(bankId) : null) : existing.bankId;
      if (parsedBankId) {
        const [linkedBank] = await db.select().from(banks).where(eq(banks.id, parsedBankId)).limit(1);
        if (linkedBank) {
          if (!resolvedBankName) resolvedBankName = linkedBank.name;
          if (febrabanCode === undefined || !resolvedFebraban) {
            resolvedFebraban = linkedBank.febrabanCode || linkedBank.code || resolvedFebraban;
          }
        }
      }

      if (!resolvedBankName) {
        return res.status(400).json({ error: 'Nome do banco é obrigatório.' });
      }

      const normalizedProvider =
        apiProvider !== undefined
          ? apiProvider === 'santander'
            ? 'santander'
            : 'none'
          : existing.apiProvider;
      const nextDefaultBoleto =
        isDefaultBoletoAccount !== undefined ? Boolean(isDefaultBoletoAccount) : existing.isDefaultBoletoAccount;
      const nextDefaultPix =
        isDefaultPixAccount !== undefined ? Boolean(isDefaultPixAccount) : existing.isDefaultPixAccount;

      if (nextDefaultBoleto) {
        if (existing.unitId) {
          await db.update(bankAccounts).set({ isDefaultBoletoAccount: false }).where(eq(bankAccounts.unitId, existing.unitId));
        } else {
          await db.update(bankAccounts).set({ isDefaultBoletoAccount: false });
        }
      }
      if (nextDefaultPix) {
        if (existing.unitId) {
          await db.update(bankAccounts).set({ isDefaultPixAccount: false }).where(eq(bankAccounts.unitId, existing.unitId));
        } else {
          await db.update(bankAccounts).set({ isDefaultPixAccount: false });
        }
      }

      const [updated] = await db.update(bankAccounts).set({
        bankId: parsedBankId,
        febrabanCode: resolvedFebraban,
        bankName: resolvedBankName,
        agency: agency !== undefined ? String(agency).trim() : existing.agency,
        agencyDigit: agencyDigit !== undefined ? String(agencyDigit).trim() : existing.agencyDigit,
        accountNumber: accountNumber !== undefined ? String(accountNumber).trim() : existing.accountNumber,
        accountDigit: accountDigit !== undefined ? String(accountDigit).trim() : existing.accountDigit,
        accountType: accountType || existing.accountType || 'corrente',
        beneficiaryDocument:
          beneficiaryDocument !== undefined ? String(beneficiaryDocument).trim() : existing.beneficiaryDocument,
        beneficiaryName:
          beneficiaryName !== undefined ? String(beneficiaryName).trim() : existing.beneficiaryName,
        apiProvider: normalizedProvider,
        apiIntegrationEnabled:
          normalizedProvider === 'santander'
            ? apiIntegrationEnabled !== undefined
              ? Boolean(apiIntegrationEnabled)
              : true
            : false,
        isDefaultBoletoAccount: nextDefaultBoleto,
        isDefaultPixAccount: nextDefaultPix,
        active: active !== false,
      }).where(eq(bankAccounts.id, id)).returning();

      if (!updated) return res.status(404).json({ error: 'Conta bancária não encontrada.' });

      if (normalizedProvider === 'santander') {
        await db
          .insert(bankAccountApiConfigs)
          .values({
            bankAccountId: updated.id,
            provider: 'santander',
            environment: 'sandbox',
            executionMode: 'homologation_offline',
            pixKey: updated.beneficiaryDocument ? updated.beneficiaryDocument.replace(/\D/g, '') : '',
            pixKeyType: 'CNPJ',
            updatedBy: req.authUser!.name,
          })
          .onConflictDoNothing();
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_BANK_ACCOUNT',
        entityType: 'bank_account',
        entityId: String(id),
        details: {
          bankName: updated.bankName,
          apiProvider: updated.apiProvider,
          bankId: updated.bankId,
        },
        unitId: req.activeUnitId,
      });

      res.json({ bankAccount: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar conta bancária.') });
    }
  });

  app.delete('/api/finance/bank-accounts/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de conta bancária inválido.' });
      const [existing] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir conta bancária desta unidade.' });
      }

      const moves = await db.select({ v: count() }).from(bankMovements).where(eq(bankMovements.bankAccountId, id));
      if (Number(moves[0]?.v || 0) > 0) {
        return res.status(400).json({ error: 'Exclusão bloqueada: esta conta possui movimentações financeiras registradas.' });
      }

      const [deleted] = await db.delete(bankAccounts).where(eq(bankAccounts.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: 'Conta bancária não encontrada.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_BANK_ACCOUNT',
        entityType: 'bank_account',
        entityId: String(id),
        details: { bankName: deleted.bankName },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir conta bancária.') });
    }
  });

  const normalizeMovType = (raw: string | undefined): 'CREDITO' | 'DEBITO' => {
    const up = String(raw || '').trim().toUpperCase();
    if (up === 'CREDITO' || up === 'ENTRADA' || up === 'C') return 'CREDITO';
    return 'DEBITO';
  };

  app.get('/api/finance/bank-movements', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const limitParam = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
      const rows =
        allowedUnits === null
          ? await db.select().from(bankMovements).orderBy(asc(bankMovements.movementDate), asc(bankMovements.id)).limit(limitParam)
          : allowedUnits.length === 0
          ? []
          : await db
              .select()
              .from(bankMovements)
              .where(inArray(bankMovements.unitId, allowedUnits))
              .orderBy(asc(bankMovements.movementDate), asc(bankMovements.id))
              .limit(limitParam);
      const normalized = rows.map((r) => ({
        ...r,
        movementType: normalizeMovType(r.movementType),
        status: String(r.status || 'PENDENTE').toUpperCase() === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE',
        origin: r.origin || 'MANUAL',
      }));
      res.json({ bankMovements: normalized });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao carregar movimentações bancárias.' });
    }
  });

  app.post('/api/finance/bank-movements', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const {
        bankAccountId,
        movementDate,
        movementType,
        amountCents,
        description,
        documentNumber,
        categoryId,
        categoryName,
        origin,
        status,
        reconciled,
        reconciliationDate,
        compensationDate,
        documentTypeId,
        bearerId,
        departmentId,
        unitId,
      } = req.body as any;

      const parsedAccId = parsePositiveIntId(bankAccountId);
      const amtNum = parseFiniteNumber(amountCents);
      const amt = amtNum !== null ? Math.round(amtNum) : 0;
      if (!parsedAccId || !movementType || amt <= 0 || !description || !String(description).trim()) {
        return res.status(400).json({ error: 'Conta válida, data, tipo, valor positivo e descrição são obrigatórios.' });
      }

      let safeDate = new Date();
      if (movementDate !== undefined && movementDate !== null && String(movementDate).trim() !== '') {
        const parsed = parseSafeDate(`${String(movementDate).slice(0, 10)}T12:00:00`);
        if (!parsed) return res.status(400).json({ error: 'Data da movimentação inválida.' });
        safeDate = parsed;
      }

      const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, parsedAccId));
      if (!acc) return res.status(404).json({ error: 'Conta bancária não encontrada.' });
      if (!isUnitPermitted(req, acc.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para lançar na conta bancária desta unidade.' });
      }

      const targetUnitId = unitId ? parsePositiveIntId(unitId) : acc.unitId || req.activeUnitId;
      if (!targetUnitId || !isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Unidade inválida ou não autorizada.' });
      }

      let resolvedCatName = String(categoryName || '').trim();
      const parsedCatId = categoryId ? parsePositiveIntId(categoryId) : null;
      if (parsedCatId && !resolvedCatName) {
        const [cat] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, parsedCatId));
        if (cat) resolvedCatName = `${cat.code} - ${cat.name}`;
      }

      const normType = normalizeMovType(movementType);
      const normStatus = String(status || 'PENDENTE').toUpperCase() === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE';
      const normOrigin = String(origin || 'MANUAL').toUpperCase();

      const { mov, newBalance } = await db.transaction(async (tx) => {
        const [freshAcc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, acc.id)).limit(1);
        if (!freshAcc) throw new Error('Conta bancária não encontrada.');

        const [createdMov] = await tx.insert(bankMovements).values({
          bankAccountId: freshAcc.id,
          movementType: normType,
          amountCents: amt,
          description: String(description).trim(),
          documentNumber: String(documentNumber || '').trim(),
          movementDate: safeDate,
          categoryId: parsedCatId,
          categoryName: resolvedCatName,
          origin: normOrigin,
          status: normStatus,
          reconciled: Boolean(reconciled),
          reconciliationDate: String(reconciliationDate || '').trim(),
          compensationDate: String(compensationDate || '').trim(),
          documentTypeId: documentTypeId ? parsePositiveIntId(documentTypeId) : null,
          bearerId: bearerId ? parsePositiveIntId(bearerId) : null,
          departmentId: departmentId ? parsePositiveIntId(departmentId) : null,
          unitId: targetUnitId,
        }).returning();

        const balanceDelta = normType === 'CREDITO' ? amt : -amt;
        const computedBalance = freshAcc.currentBalanceCents + balanceDelta;
        await tx.update(bankAccounts).set({ currentBalanceCents: computedBalance }).where(eq(bankAccounts.id, freshAcc.id));

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'CREATE_BANK_MOVEMENT',
          entityType: 'bank_movement',
          entityId: String(createdMov.id),
          details: {
            changes: [
              { field: 'Conta', from: '', to: freshAcc.bankName },
              { field: 'Tipo', from: '', to: normType },
              { field: 'Valor (centavos)', from: '', to: String(amt) },
              { field: 'Descrição', from: '', to: createdMov.description },
              { field: 'Origem', from: '', to: normOrigin },
              { field: 'Status', from: '', to: normStatus },
            ],
          },
          unitId: req.activeUnitId,
        });

        return { mov: createdMov, newBalance: computedBalance };
      });

      res.json({ movement: mov, newBalance });
    } catch (error) {
      console.error('Create bank movement error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao registrar movimentação bancária.') });
    }
  });

  app.post('/api/finance/bank-movements/transfer', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const {
        sourceAccountId,
        destinationAccountId,
        movementDate,
        amountCents,
        description,
        categoryId,
        status,
      } = req.body as any;

      const srcId = parsePositiveIntId(sourceAccountId);
      const dstId = parsePositiveIntId(destinationAccountId);
      const amtNum = parseFiniteNumber(amountCents);
      const amt = amtNum !== null ? Math.round(amtNum) : 0;

      if (!srcId || !dstId || srcId === dstId) {
        return res.status(400).json({ error: 'Selecione contas de origem e destino válidas e distintas.' });
      }
      if (amt <= 0 || !description || !String(description).trim()) {
        return res.status(400).json({ error: 'Data, valor positivo e descrição são obrigatórios.' });
      }

      let safeDate = new Date();
      if (movementDate !== undefined && movementDate !== null && String(movementDate).trim() !== '') {
        const parsed = parseSafeDate(`${String(movementDate).slice(0, 10)}T12:00:00`);
        if (!parsed) return res.status(400).json({ error: 'Data da transferência inválida.' });
        safeDate = parsed;
      }

      const [srcAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, srcId));
      const [dstAcc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, dstId));
      if (!srcAcc || !dstAcc) {
        return res.status(404).json({ error: 'Conta de origem ou destino não encontrada.' });
      }
      if (!isUnitPermitted(req, srcAcc.unitId) || !isUnitPermitted(req, dstAcc.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para transferir entre contas desta unidade.' });
      }

      let resolvedCatName = '';
      const parsedCatId = categoryId ? parsePositiveIntId(categoryId) : null;
      if (parsedCatId) {
        const [cat] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, parsedCatId));
        if (cat) resolvedCatName = `${cat.code} - ${cat.name}`;
      }

      const transferId = crypto.randomUUID();
      const normStatus = String(status || 'PENDENTE').toUpperCase() === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE';
      const descText = String(description).trim();

      const { debitMov, creditMov } = await db.transaction(async (tx) => {
        const [freshSrc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, srcAcc.id));
        const [freshDst] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, dstAcc.id));
        if (!freshSrc || !freshDst) throw new Error('Conta bancária não encontrada.');

        const [dMov] = await tx.insert(bankMovements).values({
          bankAccountId: freshSrc.id,
          movementType: 'DEBITO',
          amountCents: amt,
          description: `${descText} (Para ${freshDst.bankName})`,
          documentNumber: '',
          movementDate: safeDate,
          categoryId: parsedCatId,
          categoryName: resolvedCatName,
          origin: 'TRANSFERENCIA',
          status: normStatus,
          reconciled: false,
          transferId,
          unitId: freshSrc.unitId || req.activeUnitId,
        }).returning();

        const [cMov] = await tx.insert(bankMovements).values({
          bankAccountId: freshDst.id,
          movementType: 'CREDITO',
          amountCents: amt,
          description: `${descText} (De ${freshSrc.bankName})`,
          documentNumber: '',
          movementDate: safeDate,
          categoryId: parsedCatId,
          categoryName: resolvedCatName,
          origin: 'TRANSFERENCIA',
          status: normStatus,
          reconciled: false,
          transferId,
          unitId: freshDst.unitId || req.activeUnitId,
        }).returning();

        await tx.update(bankAccounts).set({ currentBalanceCents: freshSrc.currentBalanceCents - amt }).where(eq(bankAccounts.id, freshSrc.id));
        await tx.update(bankAccounts).set({ currentBalanceCents: freshDst.currentBalanceCents + amt }).where(eq(bankAccounts.id, freshDst.id));

        await tx.insert(auditLogs).values([
          {
            userId: req.authUser!.id,
            userName: req.authUser!.name,
            action: 'TRANSFER_OUT',
            entityType: 'bank_movement',
            entityId: String(dMov.id),
            details: {
              transferId,
              changes: [
                { field: 'Conta Origem', from: '', to: freshSrc.bankName },
                { field: 'Conta Destino', from: '', to: freshDst.bankName },
                { field: 'Valor (centavos)', from: '', to: String(amt) },
              ],
            },
            unitId: req.activeUnitId,
          },
          {
            userId: req.authUser!.id,
            userName: req.authUser!.name,
            action: 'TRANSFER_IN',
            entityType: 'bank_movement',
            entityId: String(cMov.id),
            details: {
              transferId,
              changes: [
                { field: 'Conta Origem', from: '', to: freshSrc.bankName },
                { field: 'Conta Destino', from: '', to: freshDst.bankName },
                { field: 'Valor (centavos)', from: '', to: String(amt) },
              ],
            },
            unitId: req.activeUnitId,
          },
          {
            userId: req.authUser!.id,
            userName: req.authUser!.name,
            action: 'CREATE_TRANSFER',
            entityType: 'bank_transfer',
            entityId: transferId,
            details: { sourceAccountId: freshSrc.id, destinationAccountId: freshDst.id, amountCents: amt, description: descText },
            unitId: req.activeUnitId,
          },
        ]);

        return { debitMov: dMov, creditMov: cMov };
      });

      res.json({ debitMovement: debitMov, creditMovement: creditMov, transferId });
    } catch (error) {
      console.error('Bank transfer error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao executar transferência entre contas.') });
    }
  });

  app.post('/api/finance/bank-movements/reconcile', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const { reconciled, reconciliationDate, compensationDate } = req.body as {
        movementIds: number[];
        reconciled: boolean;
        reconciliationDate?: string;
        compensationDate?: string;
      };
      const movementIds = parsePositiveIntArray(req.body?.movementIds, 500);
      if (movementIds.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um movimento válido para conciliação.' });
      }

      const targets = await db.select().from(bankMovements).where(inArray(bankMovements.id, movementIds));
      if (targets.some((t) => !isUnitPermitted(req, t.unitId))) {
        return res.status(403).json({ error: 'Um ou mais movimentos pertencem a uma unidade não autorizada.' });
      }

      const isRec = Boolean(reconciled);
      const recDate = isRec ? (String(reconciliationDate || '').trim() || new Date().toISOString().slice(0, 10)) : '';
      const compDate = isRec ? String(compensationDate || '').trim() : '';

      const updatedRows = await db.transaction(async (tx) => {
        const rows = await tx
          .update(bankMovements)
          .set({
            reconciled: isRec,
            status: isRec ? 'CONCILIADO' : 'PENDENTE',
            reconciliationDate: recDate,
            compensationDate: compDate,
          })
          .where(inArray(bankMovements.id, movementIds))
          .returning();

        for (const row of rows) {
          await tx.insert(auditLogs).values({
            userId: req.authUser!.id,
            userName: req.authUser!.name,
            action: isRec ? 'RECONCILE_BANK_MOVEMENT' : 'UNRECONCILE_BANK_MOVEMENT',
            entityType: 'bank_movement',
            entityId: String(row.id),
            details: {
              changes: [
                { field: 'Conciliado', from: isRec ? 'Não' : 'Sim', to: isRec ? 'Sim' : 'Não' },
                { field: 'Status', from: isRec ? 'PENDENTE' : 'CONCILIADO', to: row.status },
                ...(recDate ? [{ field: 'Data Conciliação', from: '', to: recDate }] : []),
                ...(compDate ? [{ field: 'Data Compensação', from: '', to: compDate }] : []),
              ],
            },
            unitId: req.activeUnitId,
          });
        }
        return rows;
      });

      res.json({ updatedCount: updatedRows.length, movements: updatedRows });
    } catch (error) {
      console.error('Reconcile movements error:', error);
      res.status(500).json({ error: 'Erro ao atualizar conciliação dos movimentos.' });
    }
  });

  app.put('/api/finance/bank-movements/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de movimento inválido.' });
      const [existing] = await db.select().from(bankMovements).where(eq(bankMovements.id, id));
      if (!existing) return res.status(404).json({ error: 'Movimento não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar movimento desta unidade.' });
      }

      const body = req.body as any;
      const isReconciliationOnly =
        body.bankAccountId === undefined &&
        body.amountCents === undefined &&
        body.description === undefined &&
        body.movementDate === undefined &&
        body.movementType === undefined &&
        (body.reconciled !== undefined || body.status !== undefined);

      if (existing.titleId && existing.titleSource && !isReconciliationOnly) {
        return res.status(400).json({
          error: 'Lançamento vinculado a título financeiro. Cancele a baixa no título original para alterar.',
        });
      }

      const nextAccountId = body.bankAccountId !== undefined ? parsePositiveIntId(body.bankAccountId) : existing.bankAccountId;
      if (!nextAccountId) return res.status(400).json({ error: 'Conta bancária inválida.' });

      const nextType = body.movementType !== undefined ? normalizeMovType(body.movementType) : normalizeMovType(existing.movementType);
      const parsedAmt = body.amountCents !== undefined ? parseFiniteNumber(body.amountCents) : existing.amountCents;
      const nextAmt = parsedAmt !== null ? Math.round(parsedAmt) : 0;
      if (nextAmt <= 0) return res.status(400).json({ error: 'O valor deve ser maior que zero.' });

      const nextDesc = body.description !== undefined ? String(body.description).trim() : existing.description;
      if (!nextDesc) return res.status(400).json({ error: 'A descrição é obrigatória.' });

      const nextDoc = body.documentNumber !== undefined ? String(body.documentNumber).trim() : existing.documentNumber;
      const nextOrigin = body.origin !== undefined ? String(body.origin).toUpperCase() : existing.origin;
      const nextStatus =
        body.status !== undefined
          ? String(body.status).toUpperCase() === 'CONCILIADO'
            ? 'CONCILIADO'
            : 'PENDENTE'
          : existing.status;
      const nextReconciled = body.reconciled !== undefined ? Boolean(body.reconciled) : existing.reconciled;
      const nextRecDate =
        body.reconciliationDate !== undefined ? String(body.reconciliationDate || '') : existing.reconciliationDate;
      const nextCompDate =
        body.compensationDate !== undefined ? String(body.compensationDate || '') : existing.compensationDate;

      let nextCatId = existing.categoryId;
      let nextCatName = existing.categoryName;
      if (body.categoryId !== undefined) {
        nextCatId = body.categoryId ? parsePositiveIntId(body.categoryId) : null;
        if (nextCatId) {
          const [cat] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, nextCatId));
          nextCatName = cat ? `${cat.code} - ${cat.name}` : String(body.categoryName || '');
        } else {
          nextCatName = '';
        }
      }

      let nextDate = existing.movementDate;
      if (body.movementDate !== undefined && body.movementDate !== null && String(body.movementDate).trim() !== '') {
        const d = parseSafeDate(`${String(body.movementDate).slice(0, 10)}T12:00:00`);
        if (!d) return res.status(400).json({ error: 'Data da movimentação inválida.' });
        nextDate = d;
      }

      const oldType = normalizeMovType(existing.movementType);
      const oldDelta = oldType === 'CREDITO' ? existing.amountCents : -existing.amountCents;
      const newDelta = nextType === 'CREDITO' ? nextAmt : -nextAmt;

      const updated = await db.transaction(async (tx) => {
        if (nextAccountId === existing.bankAccountId) {
          const diff = newDelta - oldDelta;
          if (diff !== 0) {
            const [acc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, existing.bankAccountId));
            if (acc) {
              await tx.update(bankAccounts).set({ currentBalanceCents: acc.currentBalanceCents + diff }).where(eq(bankAccounts.id, acc.id));
            }
          }
        } else {
          const [oldAcc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, existing.bankAccountId));
          const [newAcc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, nextAccountId));
          if (!newAcc) throw Object.assign(new Error('Conta bancária de destino não encontrada.'), { status: 404 });
          if (!isUnitPermitted(req, newAcc.unitId)) {
            throw Object.assign(new Error('Conta bancária de destino não autorizada para esta unidade.'), { status: 403 });
          }
          if (oldAcc) {
            await tx.update(bankAccounts).set({ currentBalanceCents: oldAcc.currentBalanceCents - oldDelta }).where(eq(bankAccounts.id, oldAcc.id));
          }
          await tx.update(bankAccounts).set({ currentBalanceCents: newAcc.currentBalanceCents + newDelta }).where(eq(bankAccounts.id, newAcc.id));
        }

        const [saved] = await tx
          .update(bankMovements)
          .set({
            bankAccountId: nextAccountId,
            movementType: nextType,
            amountCents: nextAmt,
            description: nextDesc,
            documentNumber: nextDoc,
            movementDate: nextDate,
            categoryId: nextCatId,
            categoryName: nextCatName,
            origin: nextOrigin,
            status: nextStatus,
            reconciled: nextReconciled,
            reconciliationDate: nextRecDate,
            compensationDate: nextCompDate,
          })
          .where(eq(bankMovements.id, id))
          .returning();

        const changes: Array<{ field: string; from: string; to: string }> = [];
        if (existing.description !== saved.description) changes.push({ field: 'Descrição', from: existing.description, to: saved.description });
        if (existing.amountCents !== saved.amountCents) changes.push({ field: 'Valor (centavos)', from: String(existing.amountCents), to: String(saved.amountCents) });
        if (oldType !== saved.movementType) changes.push({ field: 'Tipo', from: oldType, to: saved.movementType });
        if (existing.documentNumber !== saved.documentNumber) changes.push({ field: 'Documento', from: existing.documentNumber, to: saved.documentNumber });
        if (existing.categoryName !== saved.categoryName) changes.push({ field: 'Categoria', from: existing.categoryName, to: saved.categoryName });
        if (existing.origin !== saved.origin) changes.push({ field: 'Origem', from: existing.origin, to: saved.origin });
        if (existing.status !== saved.status) changes.push({ field: 'Status', from: existing.status, to: saved.status });
        if (existing.reconciled !== saved.reconciled) changes.push({ field: 'Conciliado', from: existing.reconciled ? 'Sim' : 'Não', to: saved.reconciled ? 'Sim' : 'Não' });
        const oldDateStr = new Date(existing.movementDate).toISOString().slice(0, 10);
        const newDateStr = new Date(saved.movementDate).toISOString().slice(0, 10);
        if (oldDateStr !== newDateStr) changes.push({ field: 'Data', from: oldDateStr, to: newDateStr });

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'UPDATE_BANK_MOVEMENT',
          entityType: 'bank_movement',
          entityId: String(id),
          details: { changes },
          unitId: req.activeUnitId,
        });

        return saved;
      });

      res.json({ movement: updated });
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof (error as any).status === 'number' ? (error as any).status : 500;
      console.error('Update bank movement error:', error);
      res.status(status).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar lançamento bancário.') });
    }
  });

  app.delete('/api/finance/bank-movements/:id', requireAuth, requireModule('finance'), async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de movimento inválido.' });
      const [existing] = await db.select().from(bankMovements).where(eq(bankMovements.id, id));
      if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para excluir lançamento desta unidade.' });
      }

      if (existing.titleId && existing.titleSource) {
        return res.status(400).json({
          error: 'Lançamento vinculado a título financeiro. Cancele a baixa no título original para excluir.',
        });
      }

      await db.transaction(async (tx) => {
        const [acc] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, existing.bankAccountId));
        if (acc) {
          const normType = normalizeMovType(existing.movementType);
          const delta = normType === 'CREDITO' ? existing.amountCents : -existing.amountCents;
          await tx.update(bankAccounts).set({ currentBalanceCents: acc.currentBalanceCents - delta }).where(eq(bankAccounts.id, acc.id));
        }

        await tx.delete(bankMovements).where(eq(bankMovements.id, id));

        await tx.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DELETE_BANK_MOVEMENT',
          entityType: 'bank_movement',
          entityId: String(id),
          details: {
            changes: [
              { field: 'Descrição', from: existing.description, to: '(Excluído)' },
              { field: 'Valor (centavos)', from: String(existing.amountCents), to: '0' },
            ],
          },
          unitId: req.activeUnitId,
        });
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Delete bank movement error:', error);
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Não foi possível excluir o lançamento.') });
    }
  });



  // ---------------------------------------------------------------------------
  // 7. COBRANÇA (COORDENAÇÃO & OPERACIONAL) E GAMIFICAÇÃO
  // ---------------------------------------------------------------------------
  registerCollectionRoutes(app, { broadcast });
  registerCollectionTasksRoutes(app, { broadcast });

  // Fixed & Full Workspace WhatsApp APIs
  app.get('/api/whatsapp/threads', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const allowedUnits = getAllowedUnitIds(req);
      const [threads, rawInstances, rawChannels] = await Promise.all([
        allowedUnits === null
          ? db.select().from(whatsappThreads).orderBy(desc(whatsappThreads.updatedAt))
          : allowedUnits.length === 0
          ? Promise.resolve([])
          : db
              .select()
              .from(whatsappThreads)
              .where(inArray(whatsappThreads.unitId, allowedUnits))
              .orderBy(desc(whatsappThreads.updatedAt)),
        listSanitizedUazapiInstances(),
        db
          .select({
            id: gotalkChannels.id,
            name: gotalkChannels.name,
            phoneNumber: gotalkChannels.phoneNumber,
            unitId: gotalkChannels.unitId,
            isPrimary: gotalkChannels.isPrimary,
            isActive: gotalkChannels.isActive,
          })
          .from(gotalkChannels)
          .orderBy(gotalkChannels.id),
      ]);
      const threadIds = threads.map((t) => t.id);
      const msgs =
        allowedUnits === null
          ? await db.select().from(whatsappMessages).orderBy(whatsappMessages.createdAt)
          : threadIds.length === 0
          ? []
          : await db
              .select()
              .from(whatsappMessages)
              .where(inArray(whatsappMessages.threadId, threadIds))
              .orderBy(whatsappMessages.createdAt);

      const userGroupId = req.authUser?.groupId ?? null;
      const isAdminUser = req.authUser?.role === 'admin';
      const instances = rawInstances.filter((inst) => {
        if (!inst.active) return false;
        if (allowedUnits !== null && !allowedUnits.includes(inst.unitId)) return false;
        if (!isAdminUser && userGroupId && Array.isArray(inst.allowedGroupIds) && inst.allowedGroupIds.length > 0) {
          return inst.allowedGroupIds.includes(userGroupId);
        }
        return true;
      });
      const channels = rawChannels.filter(
        (ch) => ch.isActive && (allowedUnits === null || !ch.unitId || allowedUnits.includes(ch.unitId))
      );

      res.json({
        threads,
        messages: msgs,
        instances,
        channels,
        gotalkStatus: getGotalkStatus(),
        uazapiRuntime: getUazapiGlobalRuntimeState(),
      });
    } catch (error) {
      console.error('WhatsApp threads error:', error);
      res.status(500).json({ error: 'Erro ao carregar WhatsApp.' });
    }
  });

  app.post('/api/whatsapp/threads', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const { contactPhone, contactName, provider, unitId, clientId, uazapiInstanceId, channelDbId } = (req.body || {}) as {
        contactPhone?: string;
        contactName?: string;
        provider?: 'gotalk' | 'uazapi';
        unitId?: number;
        clientId?: number | null;
        uazapiInstanceId?: string | null;
        channelDbId?: number | null;
      };
      const normalized = normalizePhone(contactPhone);
      if (!normalized || normalized.length < 8) {
        return res.status(400).json({ error: 'Informe um telefone/WhatsApp válido com DDD (mínimo 8 dígitos).' });
      }
      const chosenProvider: 'gotalk' | 'uazapi' = provider === 'uazapi' ? 'uazapi' : 'gotalk';
      const targetUnitId = parsePositiveIntId(unitId) || req.activeUnitId || 1;
      if (!isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Sem permissão para criar conversa nesta unidade.' });
      }

      let resolvedClientId = parsePositiveIntId(clientId) || null;
      let resolvedName = String(contactName || '').trim();
      if (resolvedClientId) {
        const clRows = await db.select().from(clients).where(eq(clients.id, resolvedClientId)).limit(1);
        if (!clRows[0] || !isUnitPermitted(req, clRows[0].unitId)) {
          resolvedClientId = null;
        } else if (!resolvedName) {
          resolvedName = clRows[0].fullName;
        }
      } else {
        const unitClients = await db
          .select({ id: clients.id, fullName: clients.fullName, phone: clients.phone, whatsapp: clients.whatsapp })
          .from(clients)
          .where(eq(clients.unitId, targetUnitId));
        const matched = unitClients.find(
          (c) => phonesMatchBR(c.whatsapp, normalized) || phonesMatchBR(c.phone, normalized)
        );
        if (matched) {
          resolvedClientId = matched.id;
          if (!resolvedName) resolvedName = matched.fullName;
        }
      }

      const existingUnitThreads = await db
        .select()
        .from(whatsappThreads)
        .where(eq(whatsappThreads.unitId, targetUnitId));
      const existing = existingUnitThreads.find(
        (t) =>
          t.provider === chosenProvider &&
          (phonesMatchBR(t.contactPhone, normalized) || (resolvedClientId !== null && t.clientId === resolvedClientId))
      );

      let resolvedUazapiInstanceId = uazapiInstanceId?.trim() || null;
      if (chosenProvider === 'uazapi' && !resolvedUazapiInstanceId) {
        const creds = await resolveUazapiCredentials({
          unitId: targetUnitId,
          groupId: req.authUser?.groupId ?? null,
        });
        resolvedUazapiInstanceId = creds?.instanceId || null;
      }

      let resolvedChannelDbId = parsePositiveIntId(channelDbId) || null;
      if (chosenProvider === 'gotalk' && !resolvedChannelDbId) {
        const activeChs = await db.select().from(gotalkChannels).where(eq(gotalkChannels.isActive, true));
        const unitCh = activeChs.find((c) => c.unitId === targetUnitId) || activeChs.find((c) => c.isPrimary) || activeChs[0];
        resolvedChannelDbId = unitCh?.id ?? null;
      }

      if (existing) {
        const [updated] = await db
          .update(whatsappThreads)
          .set({
            clientId: existing.clientId ?? resolvedClientId,
            contactName: resolvedName || existing.contactName,
            uazapiInstanceId: chosenProvider === 'uazapi' ? resolvedUazapiInstanceId ?? existing.uazapiInstanceId : existing.uazapiInstanceId,
            channelDbId: chosenProvider === 'gotalk' ? resolvedChannelDbId ?? existing.channelDbId : existing.channelDbId,
            updatedAt: new Date(),
          })
          .where(eq(whatsappThreads.id, existing.id))
          .returning();
        return res.json({ thread: updated, created: false });
      }

      const [created] = await db
        .insert(whatsappThreads)
        .values({
          clientId: resolvedClientId,
          unitId: targetUnitId,
          contactName: resolvedName || normalized,
          contactPhone: normalized,
          provider: chosenProvider,
          uazapiInstanceId: chosenProvider === 'uazapi' ? resolvedUazapiInstanceId : null,
          channelDbId: chosenProvider === 'gotalk' ? resolvedChannelDbId : null,
          operatorName: req.authUser!.name,
          assignedOperatorId: req.authUser!.id,
          lastMessagePreview: `Conversa iniciada via ${chosenProvider.toUpperCase()}`,
          unreadCount: 0,
          updatedAt: new Date(),
        })
        .returning();

      broadcast('whatsapp:thread_created', created);
      res.status(201).json({ thread: created, created: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao iniciar conversa WhatsApp.') });
    }
  });

  app.patch('/api/whatsapp/threads/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const threadId = parsePositiveIntId(req.params.id);
      if (!threadId) return res.status(400).json({ error: 'ID de conversa inválido.' });
      const [thread] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, threadId)).limit(1);
      if (!thread) return res.status(404).json({ error: 'Conversa WhatsApp não encontrada.' });
      if (!isUnitPermitted(req, thread.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para alterar conversa desta unidade.' });
      }

      const { provider, uazapiInstanceId, channelDbId, contactName } = (req.body || {}) as {
        provider?: 'gotalk' | 'uazapi';
        uazapiInstanceId?: string | null;
        channelDbId?: number | null;
        contactName?: string;
      };

      const nextProvider: 'gotalk' | 'uazapi' =
        provider === 'uazapi' || provider === 'gotalk'
          ? provider
          : thread.provider === 'uazapi'
          ? 'uazapi'
          : 'gotalk';

      let nextInstanceId = thread.uazapiInstanceId;
      if (uazapiInstanceId !== undefined) {
        if (uazapiInstanceId) {
          const instRows = await db
            .select()
            .from(unitWhatsappCredentials)
            .where(eq(unitWhatsappCredentials.uazapiInstanceId, uazapiInstanceId))
            .limit(1);
          if (!instRows[0]) return res.status(404).json({ error: 'Instância UaZapi não encontrada.' });
          nextInstanceId = instRows[0].uazapiInstanceId;
        } else {
          nextInstanceId = null;
        }
      } else if (nextProvider === 'uazapi' && !nextInstanceId) {
        const creds = await resolveUazapiCredentials({
          unitId: thread.unitId,
          groupId: req.authUser?.groupId ?? null,
        });
        nextInstanceId = creds?.instanceId || null;
      }

      let nextChannelDbId = thread.channelDbId;
      if (channelDbId !== undefined) {
        if (channelDbId) {
          const chId = parsePositiveIntId(channelDbId);
          if (!chId) return res.status(400).json({ error: 'ID de canal GoTalk inválido.' });
          const chRows = await db.select().from(gotalkChannels).where(eq(gotalkChannels.id, chId)).limit(1);
          if (!chRows[0]) return res.status(404).json({ error: 'Canal GoTalk não encontrado.' });
          nextChannelDbId = chRows[0].id;
        } else {
          nextChannelDbId = null;
        }
      } else if (nextProvider === 'gotalk' && !nextChannelDbId) {
        const chRows = await db.select().from(gotalkChannels).where(eq(gotalkChannels.isActive, true));
        const unitCh = chRows.find((c) => c.unitId === thread.unitId) || chRows.find((c) => c.isPrimary) || chRows[0];
        nextChannelDbId = unitCh?.id ?? null;
      }

      const [updated] = await db
        .update(whatsappThreads)
        .set({
          provider: nextProvider,
          uazapiInstanceId: nextInstanceId,
          channelDbId: nextChannelDbId,
          ...(contactName?.trim() ? { contactName: contactName.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(whatsappThreads.id, threadId))
        .returning();

      broadcast('whatsapp:thread_updated', updated);
      res.json({ ok: true, thread: updated });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao atualizar conversa WhatsApp.') });
    }
  });

  app.post('/api/whatsapp/threads/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const threadId = parsePositiveIntId(req.params.id);
      if (!threadId) return res.status(400).json({ error: 'ID de conversa inválido.' });
      const [thread] = await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, threadId)).limit(1);
      if (!thread) return res.status(404).json({ error: 'Conversa WhatsApp não encontrada.' });
      if (!isUnitPermitted(req, thread.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar conversa desta unidade.' });
      }
      if ((thread.unreadCount || 0) !== 0) {
        await db.update(whatsappThreads).set({ unreadCount: 0 }).where(eq(whatsappThreads.id, threadId));
        broadcast('whatsapp:read', { threadId });
      }
      res.json({ ok: true, threadId, unreadCount: 0 });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao confirmar leitura da conversa.') });
    }
  });

  app.post('/api/whatsapp/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const { unitId, instanceId } = (req.body || {}) as { unitId?: number; instanceId?: string };
      const allowedUnits = getAllowedUnitIds(req);
      const requestedUnitId = parsePositiveIntId(unitId);
      if (requestedUnitId && allowedUnits !== null && !allowedUnits.includes(requestedUnitId)) {
        return res.status(403).json({ error: 'Sem permissão para sincronizar esta unidade.' });
      }

      const allInstRows = await db.select().from(unitWhatsappCredentials).orderBy(unitWhatsappCredentials.id);
      const scopedInstRows = allInstRows.filter((r) => {
        if (!r.active) return false;
        if (instanceId && r.uazapiInstanceId !== instanceId) return false;
        if (requestedUnitId && r.unitId !== requestedUnitId) return false;
        if (allowedUnits !== null && !allowedUnits.includes(r.unitId)) return false;
        return true;
      });

      const [allThreads, allClients, firstUnit] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp, unitId: clients.unitId }).from(clients),
        db.select().from(units).orderBy(units.id).limit(1),
      ]);

      let instancesChecked = 0;
      let connectedCount = 0;
      let threadsSynced = 0;
      let messagesSynced = 0;

      for (const row of scopedInstRows) {
        const plainToken = decryptUazapiToken(row.uazapiTokenEncrypted);
        if (!plainToken) continue;
        instancesChecked++;
        const creds: UazapiCredentials = {
          unitId: row.unitId,
          instanceId: row.uazapiInstanceId,
          label: row.label,
          serverUrl: row.uazapiServerUrl || getDefaultUazapiServerUrl(),
          token: plainToken,
        };

        const liveStatus = await getUazapiInstanceStatus(creds);
        if (liveStatus.ok) {
          await db
            .update(unitWhatsappCredentials)
            .set({
              isConnected: liveStatus.connected,
              connectedPhone: liveStatus.connectedPhone || row.connectedPhone,
              profileName: liveStatus.profileName || row.profileName,
              updatedAt: new Date(),
            })
            .where(eq(unitWhatsappCredentials.id, row.id));
        }
        if (!liveStatus.ok || !liveStatus.connected) continue;
        connectedCount++;

        const chats = await findUazapiChats(creds, 12, 0).catch(() => []);
        for (const ch of chats) {
          const matchedClient = allClients.find(
            (c) => phonesMatchBR(c.whatsapp, ch.phone) || phonesMatchBR(c.phone, ch.phone)
          );
          let thread =
            allThreads.find(
              (t) =>
                t.provider === 'uazapi' &&
                t.uazapiInstanceId === creds.instanceId &&
                phonesMatchBR(t.contactPhone, ch.phone)
            ) ||
            allThreads.find(
              (t) =>
                t.provider === 'uazapi' &&
                !t.uazapiInstanceId &&
                phonesMatchBR(t.contactPhone, ch.phone)
            );
          if (!thread) {
            const [created] = await db
              .insert(whatsappThreads)
              .values({
                unitId: creds.unitId || matchedClient?.unitId || firstUnit[0]?.id || 1,
                clientId: matchedClient?.id ?? null,
                contactName: ch.name || ch.phone,
                contactPhone: normalizePhone(ch.phone) || ch.phone,
                provider: 'uazapi',
                uazapiInstanceId: creds.instanceId || null,
                unreadCount: ch.unreadCount,
                lastMessagePreview: ch.lastMessagePreview || 'Conversa sincronizada UaZapi',
                updatedAt: new Date(),
              })
              .returning();
            thread = created;
            allThreads.push(created);
          } else {
            await db
              .update(whatsappThreads)
              .set({
                uazapiInstanceId: creds.instanceId || thread.uazapiInstanceId,
                lastMessagePreview: ch.lastMessagePreview || thread.lastMessagePreview,
                updatedAt: new Date(),
              })
              .where(eq(whatsappThreads.id, thread.id));
          }
          threadsSynced++;

          const msgs = await findUazapiMessages(creds, ch.chatId, 12).catch(() => []);
          for (const m of msgs) {
            if (!m.body) continue;
            const dup = await db
              .select({ id: whatsappMessages.id })
              .from(whatsappMessages)
              .where(eq(whatsappMessages.externalMessageId, m.id))
              .limit(1);
            if (dup[0]) continue;
            await db.insert(whatsappMessages).values({
              threadId: thread.id,
              externalMessageId: m.id,
              direction: m.fromMe ? 'outbound' : 'inbound',
              contentType: m.type,
              body: m.body,
              ackStatus: m.fromMe ? 2 : null,
              deliveryProvider: 'uazapi',
              deliveryStatus: m.fromMe ? 'sent' : 'received',
              senderName: m.fromMe ? 'Consultor UaZapi' : m.senderName || ch.name || ch.phone,
              createdAt: new Date(m.timestampMs),
            });
            messagesSynced++;
          }
        }
      }

      let gotalkSynced: { channelsSynced: number; operatorsSynced: number; templatesSynced: number } | null = null;
      let gotalkError: string | null = null;
      if (isGotalkConfigured()) {
        try {
          await authenticateGotalk();
          gotalkSynced = await syncGotalkResources();
        } catch (err) {
          gotalkError = err instanceof Error ? err.message : 'Erro ao sincronizar GoTalk';
        }
      }

      broadcast('whatsapp:synced', { threadsSynced, messagesSynced });
      res.json({
        ok: true,
        uazapi: { instancesChecked, connectedCount, threadsSynced, messagesSynced },
        gotalk: {
          configured: isGotalkConfigured(),
          synced: gotalkSynced,
          error: gotalkError,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(error, 'Erro ao sincronizar WhatsApp.') });
    }
  });

  app.post('/api/whatsapp/threads/:id/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const threadId = parsePositiveIntId(req.params.id);
      if (!threadId) return res.status(400).json({ error: 'ID de conversa inválido.' });
      const { body, contentType, direction } = req.body as {
        body: string;
        contentType?: string;
        direction?: string;
      };
      if (!body || !String(body).trim()) {
        return res.status(400).json({ error: 'O texto da mensagem é obrigatório.' });
      }
      const existingThreads = await db
        .select()
        .from(whatsappThreads)
        .where(eq(whatsappThreads.id, threadId))
        .limit(1);
      const thread = existingThreads[0];
      if (!thread) return res.status(404).json({ error: 'Conversa WhatsApp não encontrada.' });
      if (!isUnitPermitted(req, thread.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para operar conversa desta unidade.' });
      }

      let iviTranscript: string | null = null;
      if (contentType === 'audio') {
        const resT = await iviTranscribeAudioNote(body);
        iviTranscript = resT.transcript;
      }

      let gotalkDelivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;
      let uazapiDelivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;
      if ((direction || 'outbound') === 'outbound' && thread.provider === 'gotalk') {
        let resolvedChannelId: string | null = null;
        if (thread.channelDbId) {
          const chRows = await db
            .select({ channelId: gotalkChannels.channelId })
            .from(gotalkChannels)
            .where(eq(gotalkChannels.id, thread.channelDbId))
            .limit(1);
          resolvedChannelId = chRows[0]?.channelId ?? null;
        }
        gotalkDelivery = await sendGotalkMessage(thread.contactPhone, body, {
          attendanceId: thread.gotalkAttendanceId,
          contactName: thread.contactName,
          contactId: thread.gotalkContactId,
          channelId: resolvedChannelId,
          type: contentType || 'text',
        });
      } else if ((direction || 'outbound') === 'outbound' && thread.provider === 'uazapi') {
        const creds = await resolveUazapiCredentials({
          instanceId: thread.uazapiInstanceId,
          unitId: thread.unitId,
          groupId: req.authUser?.groupId ?? null,
        });
        uazapiDelivery = await sendUazapiText(creds, thread.contactPhone, body);
      }

      const activeDelivery = gotalkDelivery || uazapiDelivery;
      const resolvedDirection = direction || 'outbound';
      const deliveryStatus =
        resolvedDirection === 'inbound'
          ? 'received'
          : activeDelivery?.dispatched
          ? 'sent'
          : activeDelivery?.provider?.includes('error')
          ? 'failed'
          : 'queued';

      const [msg] = await db
        .insert(whatsappMessages)
        .values({
          threadId,
          externalMessageId: activeDelivery?.externalMessageId || null,
          direction: resolvedDirection,
          contentType: contentType || 'text',
          body,
          iviAudioTranscript: iviTranscript,
          ackStatus: resolvedDirection === 'outbound' && activeDelivery?.dispatched ? 1 : null,
          deliveryProvider: activeDelivery?.provider || thread.provider,
          deliveryStatus,
          deliveryDetail: activeDelivery?.detail || null,
          operatorName: resolvedDirection === 'outbound' ? req.authUser!.name : null,
          senderName: resolvedDirection === 'inbound' ? 'Cliente' : req.authUser!.name,
        })
        .returning();

      await db
        .update(whatsappThreads)
        .set({ lastMessagePreview: body.slice(0, 70), updatedAt: new Date(), unreadCount: 0 })
        .where(eq(whatsappThreads.id, threadId));

      await mirrorCommunicationToProspection({
        unitId: thread.unitId,
        phone: thread.contactPhone,
        contactName: thread.contactName,
        channel: thread.provider === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_gotalk',
        provider: thread.provider === 'uazapi' ? 'uazapi' : 'gotalk',
        threadId: thread.id,
        direction: resolvedDirection === 'inbound' ? 'inbound' : 'outbound',
        contentType: contentType === 'audio' ? 'audio' : 'text',
        body,
        audioTranscript: iviTranscript,
        authorName: req.authUser!.name,
        externalMessageId: activeDelivery?.externalMessageId || `local-${msg.id}`,
        triggerIviAutoSummarize: contentType === 'audio' || direction === 'inbound',
      });

      broadcast('whatsapp:message', msg);
      res.json({ message: msg, gotalkDelivery, uazapiDelivery, delivery: activeDelivery });
    } catch (error) {
      console.error('WhatsApp send error:', error);
      res.status(500).json({ error: 'Erro ao enviar mensagem WhatsApp.' });
    }
  });

  app.post('/api/whatsapp/threads/:id/send-file', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const threadId = parsePositiveIntId(req.params.id);
      if (!threadId) return res.status(400).json({ error: 'ID de conversa inválido.' });
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Arquivo obrigatório (campo multipart "file").' });
      }
      const existingThreads = await db
        .select()
        .from(whatsappThreads)
        .where(eq(whatsappThreads.id, threadId))
        .limit(1);
      const thread = existingThreads[0];
      if (!thread) return res.status(404).json({ error: 'Conversa WhatsApp não encontrada.' });
      if (!isUnitPermitted(req, thread.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para enviar arquivos nesta conversa.' });
      }

      const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
      if (validationErr) return res.status(400).json({ error: validationErr });
      const safeFileName = sanitizeFileName(file.originalname);

      const contentType = file.mimetype.startsWith('image/')
        ? 'image'
        : file.mimetype.startsWith('audio/')
        ? 'audio'
        : 'document';

      // Store attachment in encrypted bucketdainvicta (never inside PostgreSQL)
      const folderPath = `bucketdainvicta/U${thread.unitId}/WHATSAPP/T${thread.id}`;
      const bucketStored = await putBucketObject(file.buffer, {
        folderPath,
        mimeType: file.mimetype,
        originalName: safeFileName,
      });

      const dataUri = `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
      let iviTranscript: string | null = null;
      if (contentType === 'audio') {
        const trans = await iviTranscribeAudioNote(dataUri, file.mimetype || 'audio/webm');
        iviTranscript = trans.transcript;
      }

      let linkedDocId: number | null = null;
      if (thread.clientId) {
        const [doc] = await db
          .insert(documentObjects)
          .values({
            clientId: thread.clientId,
            admissionId: null,
            folderPath: `bucketdainvicta/U${thread.unitId}/C${thread.clientId}/WHATSAPP`,
            fileName: safeFileName,
            docCategory: contentType === 'audio' ? 'audio_whatsapp' : 'comprovante',
            mimeType: file.mimetype || 'application/octet-stream',
            sizeBytes: bucketStored.sizeBytes,
            sha256Hash: bucketStored.sha256Hash,
            storageUri: bucketStored.storageUri,
            uploadedBy: req.authUser!.name,
            unitId: thread.unitId,
          })
          .returning();
        linkedDocId = doc.id;
      }

      const attachmentUrl = linkedDocId
        ? `/api/documents/${linkedDocId}/download`
        : `/api/bucket/objects/${bucketStored.sha256Hash}?name=${encodeURIComponent(safeFileName)}&mime=${encodeURIComponent(file.mimetype || 'application/octet-stream')}`;

      let gotalkDelivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;
      let uazapiDelivery: { dispatched: boolean; provider: string; externalMessageId?: string | null; detail?: string } | null = null;
      if (thread.provider === 'gotalk') {
        gotalkDelivery = await sendGotalkFile({
          phone: thread.contactPhone,
          fileBuffer: file.buffer,
          fileName: safeFileName,
          mimeType: file.mimetype,
          caption: caption || undefined,
        });
      } else if (thread.provider === 'uazapi') {
        const creds = await resolveUazapiCredentials({
          instanceId: thread.uazapiInstanceId,
          unitId: thread.unitId,
          groupId: req.authUser?.groupId ?? null,
        });
        uazapiDelivery = await sendUazapiMedia(creds, {
          phone: thread.contactPhone,
          type: contentType,
          file: dataUri,
          caption: caption || undefined,
          fileName: safeFileName,
          mimeType: file.mimetype,
        });
      }

      const activeDelivery = gotalkDelivery || uazapiDelivery;
      const deliveryStatus = activeDelivery?.dispatched
        ? 'sent'
        : activeDelivery?.provider?.includes('error')
        ? 'failed'
        : 'queued';
      const [msg] = await db
        .insert(whatsappMessages)
        .values({
          threadId,
          externalMessageId: activeDelivery?.externalMessageId || null,
          direction: 'outbound',
          contentType,
          body: caption || safeFileName,
          attachmentUrl,
          attachmentName: safeFileName,
          attachmentMimeType: file.mimetype,
          mediaSha256: bucketStored.sha256Hash,
          mediaStorageUri: bucketStored.storageUri,
          iviAudioTranscript: iviTranscript,
          ackStatus: activeDelivery?.dispatched ? 1 : null,
          deliveryProvider: activeDelivery?.provider || thread.provider,
          deliveryStatus,
          deliveryDetail: activeDelivery?.detail || null,
          operatorName: req.authUser!.name,
          senderName: req.authUser!.name,
        })
        .returning();

      await db.insert(communicationArchives).values({
        unitId: thread.unitId,
        threadId: thread.id,
        provider: thread.provider === 'uazapi' ? 'uazapi' : 'gotalk',
        archiveType: contentType === 'audio' ? 'audio_message' : 'conversation_snapshot',
        contactName: thread.contactName,
        contactPhone: thread.contactPhone,
        fileName: safeFileName,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: bucketStored.sizeBytes,
        sha256Hash: bucketStored.sha256Hash,
        storageUri: bucketStored.storageUri,
        transcriptText: iviTranscript || caption || safeFileName,
        createdByName: req.authUser!.name,
      });

      await db
        .update(whatsappThreads)
        .set({ lastMessagePreview: (caption || safeFileName).slice(0, 70), updatedAt: new Date(), unreadCount: 0 })
        .where(eq(whatsappThreads.id, threadId));

      await mirrorCommunicationToProspection({
        unitId: thread.unitId,
        phone: thread.contactPhone,
        contactName: thread.contactName,
        channel: thread.provider === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_gotalk',
        provider: thread.provider === 'uazapi' ? 'uazapi' : 'gotalk',
        threadId: thread.id,
        direction: 'outbound',
        contentType,
        body: caption || `[Arquivo enviado]: ${safeFileName}`,
        audioTranscript: iviTranscript,
        authorName: req.authUser!.name,
        externalMessageId: activeDelivery?.externalMessageId || `file-${msg.id}`,
        mediaSha256: bucketStored.sha256Hash,
        mediaStorageUri: bucketStored.storageUri,
        mediaMimeType: file.mimetype,
        mediaFileName: safeFileName,
        triggerIviAutoSummarize: contentType === 'audio',
      });

      broadcast('whatsapp:message', msg);
      res.json({ message: msg, gotalkDelivery, uazapiDelivery, delivery: activeDelivery });
    } catch (error) {
      console.error('WhatsApp send-file error:', error);
      res.status(500).json({ error: 'Erro ao enviar arquivo via WhatsApp/GoTalk.' });
    }
  });

  app.post('/api/whatsapp/messages/:id/transcribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de mensagem inválido.' });
      const rows = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, id)).limit(1);
      const msg = rows[0];
      if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });

      const threadRows = await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, msg.threadId)).limit(1);
      const th = threadRows[0];
      if (th && !isUnitPermitted(req, th.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para acessar mensagem desta unidade.' });
      }

      let audioInput = msg.body;
      let mimeType = msg.attachmentMimeType || 'audio/webm';
      if (msg.mediaSha256) {
        const buf = await getBucketObjectBuffer(msg.mediaSha256, msg.mediaStorageUri || null);
        if (buf) {
          audioInput = `data:${mimeType};base64,${buf.toString('base64')}`;
        }
      }

      const resT = await iviTranscribeAudioNote(audioInput, mimeType);
      const [updated] = await db
        .update(whatsappMessages)
        .set({ iviAudioTranscript: resT.transcript })
        .where(eq(whatsappMessages.id, id))
        .returning();

      if (th) {
        await mirrorCommunicationToProspection({
          unitId: th.unitId,
          phone: th.contactPhone,
          contactName: th.contactName,
          channel: th.provider === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_gotalk',
          provider: th.provider === 'uazapi' ? 'uazapi' : 'gotalk',
          threadId: th.id,
          direction: msg.direction === 'outbound' ? 'outbound' : 'inbound',
          contentType: 'audio',
          body: msg.body,
          audioTranscript: resT.transcript,
          authorName: req.authUser!.name,
          externalMessageId: msg.externalMessageId || `wa-msg-trans-${msg.id}`,
          mediaSha256: msg.mediaSha256,
          mediaStorageUri: msg.mediaStorageUri,
          mediaMimeType: msg.attachmentMimeType,
          mediaFileName: msg.attachmentName,
          triggerIviAutoSummarize: true,
        });
      }

      res.json({ message: updated, provider: resT.provider });
    } catch (error) {
      console.error('Transcribe error:', error);
      res.status(500).json({ error: 'Erro ao transcrever áudio com Ivi.' });
    }
  });

  // Helper: sync channels, operators and HSM templates from GoTalk API (keeps channelId server-side)
  async function syncGotalkResources() {
    const discoveredChannels = await fetchGotalkAllChannels();
    let channelsSynced = 0;
    let primaryChannelDbId: number | null = null;
    let primaryTechnicalId: string | null = null;

    for (const ch of discoveredChannels) {
      const existing = await db
        .select()
        .from(gotalkChannels)
        .where(eq(gotalkChannels.channelId, ch.channelId))
        .limit(1);

      let rowId: number;
      if (existing[0]) {
        await db
          .update(gotalkChannels)
          .set({
            name: ch.name || existing[0].name,
            phoneNumber: ch.phone || existing[0].phoneNumber,
            isPrimary: ch.isPrimary,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(gotalkChannels.id, existing[0].id));
        rowId = existing[0].id;
      } else {
        const [inserted] = await db
          .insert(gotalkChannels)
          .values({
            name: ch.name,
            phoneNumber: ch.phone,
            channelId: ch.channelId,
            isPrimary: ch.isPrimary,
            isActive: true,
          })
          .returning();
        rowId = inserted.id;
      }
      if (ch.isPrimary) {
        primaryChannelDbId = rowId;
        primaryTechnicalId = ch.channelId;
      }
      channelsSynced++;
    }

    const allUsers = await db.select({ id: users.id, email: users.email, whatsappPhone: users.whatsappPhone }).from(users);
    let operatorsSynced = 0;
    let templatesSynced = 0;

    if (primaryTechnicalId) {
      const ops = await fetchGotalkOperators(primaryTechnicalId);
      for (const op of ops) {
        const matchedUser = allUsers.find(
          (u) =>
            (op.email && u.email.toLowerCase() === op.email.toLowerCase()) ||
            (op.phone && u.whatsappPhone && phonesMatchBR(op.phone, u.whatsappPhone))
        );
        const existingOp = await db
          .select()
          .from(gotalkOperators)
          .where(eq(gotalkOperators.gotalkOperatorId, op.gotalkOperatorId))
          .limit(1);

        if (existingOp[0]) {
          await db
            .update(gotalkOperators)
            .set({
              name: op.name || existingOp[0].name,
              email: op.email || existingOp[0].email,
              phone: op.phone || existingOp[0].phone,
              active: op.active,
              collaboratorId: existingOp[0].collaboratorId ?? matchedUser?.id ?? null,
              updatedAt: new Date(),
            })
            .where(eq(gotalkOperators.id, existingOp[0].id));
        } else {
          await db.insert(gotalkOperators).values({
            gotalkOperatorId: op.gotalkOperatorId,
            name: op.name,
            email: op.email,
            phone: op.phone,
            active: op.active,
            collaboratorId: matchedUser?.id ?? null,
          });
        }
        operatorsSynced++;
      }

      for (const ch of discoveredChannels) {
        const chRow = await db
          .select({ id: gotalkChannels.id })
          .from(gotalkChannels)
          .where(eq(gotalkChannels.channelId, ch.channelId))
          .limit(1);
        const chDbId = chRow[0]?.id ?? primaryChannelDbId;
        const tplList = await fetchGotalkHsmTemplates(ch.channelId);

        for (const tpl of tplList) {
          const existingTpl = await db
            .select()
            .from(gotalkHsmTemplates)
            .where(eq(gotalkHsmTemplates.templateName, tpl.templateName))
            .limit(1);

          if (existingTpl[0]) {
            await db
              .update(gotalkHsmTemplates)
              .set({
                gotalkTemplateId: tpl.gotalkTemplateId,
                category: tpl.category,
                language: tpl.language,
                status: tpl.status,
                bodyText: tpl.bodyText,
                headerText: tpl.headerText,
                footerText: tpl.footerText,
                channelDbId: existingTpl[0].channelDbId ?? chDbId,
                syncedAt: new Date(),
              })
              .where(eq(gotalkHsmTemplates.id, existingTpl[0].id));
          } else {
            await db.insert(gotalkHsmTemplates).values({
              templateName: tpl.templateName,
              gotalkTemplateId: tpl.gotalkTemplateId,
              category: tpl.category,
              language: tpl.language,
              status: tpl.status,
              bodyText: tpl.bodyText,
              headerText: tpl.headerText,
              footerText: tpl.footerText,
              channelDbId: chDbId,
            });
          }
          templatesSynced++;
        }
      }
    }

    return { channelsSynced, operatorsSynced, templatesSynced };
  }

  // GoTalk Official Auth, Sync, Templates & Webhook Integration
  app.get('/api/integrations/gotalk/status', requireAuth, async (_req: AuthRequest, res) => {
    const [chCount, opCount, tplCount] = await Promise.all([
      db.select({ value: count() }).from(gotalkChannels),
      db.select({ value: count() }).from(gotalkOperators),
      db.select({ value: count() }).from(gotalkHsmTemplates),
    ]);
    res.json({
      ...getGotalkStatus(),
      channelsCount: Number(chCount[0]?.value || 0),
      operatorsCount: Number(opCount[0]?.value || 0),
      templatesCount: Number(tplCount[0]?.value || 0),
    });
  });

  app.get('/api/integrations/gotalk/resources', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const [channels, operators, templates] = await Promise.all([
        // Regra de segurança GoTalk: NUNCA expor channelId técnico ao frontend
        db
          .select({
            id: gotalkChannels.id,
            name: gotalkChannels.name,
            phoneNumber: gotalkChannels.phoneNumber,
            unitId: gotalkChannels.unitId,
            isPrimary: gotalkChannels.isPrimary,
            isActive: gotalkChannels.isActive,
          })
          .from(gotalkChannels)
          .orderBy(gotalkChannels.id),
        db
          .select({
            id: gotalkOperators.id,
            gotalkOperatorId: gotalkOperators.gotalkOperatorId,
            name: gotalkOperators.name,
            email: gotalkOperators.email,
            phone: gotalkOperators.phone,
            active: gotalkOperators.active,
            collaboratorId: gotalkOperators.collaboratorId,
          })
          .from(gotalkOperators)
          .orderBy(gotalkOperators.id),
        db.select().from(gotalkHsmTemplates).orderBy(gotalkHsmTemplates.templateName),
      ]);
      res.json({ channels, operators, templates });
    } catch (error) {
      console.error('GoTalk resources error:', error);
      res.status(500).json({ error: 'Erro ao carregar recursos GoTalk.' });
    }
  });

  app.post('/api/integrations/gotalk/test', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      await authenticateGotalk();
      const synced = await syncGotalkResources().catch(() => ({
        channelsSynced: 0,
        operatorsSynced: 0,
        templatesSynced: 0,
      }));
      const status = getGotalkStatus();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'GOTALK_AUTH_TEST',
        entityType: 'integration',
        entityId: 'gotalk',
        details: { ok: true, ...synced },
        unitId: req.activeUnitId,
      });
      res.json({ ok: true, synced, status });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erro desconhecido ao autenticar na GoTalk.';
      const status = getGotalkStatus();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'GOTALK_AUTH_TEST_FAILED',
        entityType: 'integration',
        entityId: 'gotalk',
        details: { ok: false, error: errMsg },
        unitId: req.activeUnitId,
      });
      res.status(status.configured ? 502 : 400).json({ ok: false, error: errMsg, status });
    }
  });

  app.get('/api/integrations/gotalk/postman-parity', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const results = await runGotalkPostmanParityProbe();
      res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao validar endpoints GoTalk.' });
    }
  });

  app.post('/api/integrations/gotalk/sync', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      await authenticateGotalk();
      const synced = await syncGotalkResources();
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'GOTALK_SYNC_RESOURCES',
        entityType: 'integration',
        entityId: 'gotalk',
        details: synced,
        unitId: req.activeUnitId,
      });
      res.json({ ok: true, synced, status: getGotalkStatus() });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Erro ao sincronizar recursos GoTalk.';
      res.status(400).json({ ok: false, error: errMsg, status: getGotalkStatus() });
    }
  });

  app.post('/api/integrations/gotalk/send-template', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { threadId, templateName, variables, channelDbId } = req.body as {
        threadId: number;
        templateName: string;
        variables?: Record<string, string>;
        channelDbId?: number;
      };
      if (!threadId || !templateName) {
        return res.status(400).json({ error: 'threadId e templateName são obrigatórios.' });
      }
      const threads = await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, threadId)).limit(1);
      const thread = threads[0];
      if (!thread) return res.status(404).json({ error: 'Conversa não encontrada.' });
      if (!isUnitPermitted(req, thread.unitId)) {
        return res.status(403).json({ error: 'Sem permissão para disparar template nesta unidade.' });
      }

      const tpls = await db
        .select()
        .from(gotalkHsmTemplates)
        .where(eq(gotalkHsmTemplates.templateName, templateName))
        .limit(1);
      const tpl = tpls[0];
      if (!tpl) return res.status(404).json({ error: 'Template HSM não encontrado.' });

      let resolvedChannelId: string | null = null;
      const targetChDbId = channelDbId || tpl.channelDbId || thread.channelDbId;
      if (targetChDbId) {
        const ch = await db
          .select({ channelId: gotalkChannels.channelId })
          .from(gotalkChannels)
          .where(eq(gotalkChannels.id, targetChDbId))
          .limit(1);
        resolvedChannelId = ch[0]?.channelId ?? null;
      }

      const renderedBody = (tpl.bodyText || tpl.templateName).replace(/\{\{(\d+)\}\}/g, (_, n) =>
        variables?.[n] ? variables[n] : `{{${n}}}`
      );

      let gotalkDelivery = await sendGotalkActiveNotification({
        phone: thread.contactPhone,
        contactName: thread.contactName,
        templateId: tpl.gotalkTemplateId || tpl.templateName,
        text: renderedBody,
        variables: variables || {},
        channelId: resolvedChannelId,
      });
      if (!gotalkDelivery.dispatched && gotalkDelivery.provider === 'gotalk_api_error') {
        const fallbackDelivery = await sendGotalkTemplateByName({
          phone: thread.contactPhone,
          templateName: tpl.templateName,
          tag: { clientName: thread.contactName, ...(variables || {}) },
        });
        if (fallbackDelivery.dispatched) gotalkDelivery = fallbackDelivery;
      }

      const deliveryStatus = gotalkDelivery.dispatched
        ? 'sent'
        : gotalkDelivery.provider?.includes('error')
        ? 'failed'
        : 'queued';

      const [msg] = await db
        .insert(whatsappMessages)
        .values({
          threadId: thread.id,
          externalMessageId: gotalkDelivery.externalMessageId || null,
          direction: 'outbound',
          contentType: 'text',
          body: `[Template HSM: ${tpl.templateName}]\n${renderedBody}`,
          attachmentName: tpl.templateName,
          ackStatus: gotalkDelivery.dispatched ? 1 : null,
          deliveryProvider: gotalkDelivery.provider,
          deliveryStatus,
          deliveryDetail: gotalkDelivery.detail || null,
          operatorName: req.authUser!.name,
          senderName: req.authUser!.name,
        })
        .returning();

      await db
        .update(whatsappThreads)
        .set({ lastMessagePreview: renderedBody.slice(0, 70), updatedAt: new Date(), unreadCount: 0 })
        .where(eq(whatsappThreads.id, thread.id));

      broadcast('whatsapp:message', msg);
      res.json({ message: msg, gotalkDelivery });
    } catch (error) {
      console.error('Send HSM template error:', error);
      res.status(500).json({ error: 'Erro ao disparar template HSM GoTalk.' });
    }
  });

  // Webhook Oficial GoTalk (suporta /api/integrations/gotalk/webhook e alias /api/gotalk/webhook)
  const handleGotalkWebhook = async (req: express.Request, res: express.Response) => {
    const webhookSecret = getGotalkWebhookSecret();
    if (webhookSecret) {
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
      const tokenHeader =
        (req.headers['x-gotalk-token'] as string | undefined) ||
        (req.headers['x-webhook-token'] as string | undefined) ||
        (req.headers['x-gotalk-webhook-secret'] as string | undefined) ||
        (req.headers['x-webhook-secret'] as string | undefined) ||
        (req.headers['x-hub-signature'] as string | undefined) ||
        bearerToken ||
        (req.query.token as string | undefined) ||
        null;
      if (!timingSafeEqualStr(tokenHeader, webhookSecret)) {
        return res.status(401).json({ error: 'Token webhook GoTalk inválido.' });
      }
    }

    markGotalkWebhookReceived();

    try {
      await ensureInitialSeed();
      const payload = (req.body || {}) as Record<string, unknown>;
      const eventRaw = String(payload.event || payload.type || '').toLowerCase();

      // 1. ACK Update (1=SERVER/sent, 2=DEVICE/delivered, 3=READ/PLAYED)
      const isExplicitAck = eventRaw === 'ack' || eventRaw === 'messageack' || eventRaw === 'message.ack';
      const isImplicitAck = payload.ack !== undefined && !payload.message && !(payload.data as Record<string, unknown>)?.message && !payload.body;
      if (isExplicitAck || isImplicitAck) {
        const ackData = ((payload.data as Record<string, unknown>) || payload) as Record<string, unknown>;
        const extMsgId = String(ackData.messageId || ackData.id || ackData._id || '').trim();
        const ackVal = parseAckValue(ackData.ack ?? ackData.status);
        if (extMsgId && ackVal !== null) {
          const updated = await db
            .update(whatsappMessages)
            .set({ ackStatus: ackVal })
            .where(eq(whatsappMessages.externalMessageId, extMsgId))
            .returning();
          if (updated[0]) {
            broadcast('whatsapp:ack', { messageId: updated[0].id, ackStatus: ackVal });
          }
        }
        return res.status(200).json({ ok: true, event: 'ack' });
      }

      // 2. Message Revoke / Delete (Imutabilidade: preserva no CRM e marca deletedInOrigin=true)
      const isRevokeEvent =
        eventRaw === 'messagerevoked' ||
        eventRaw === 'message_revoked' ||
        eventRaw === 'messagerevoke' ||
        eventRaw === 'messagedeleted' ||
        eventRaw === 'message_deleted' ||
        eventRaw === 'messagedelete' ||
        eventRaw === 'revoked' ||
        eventRaw === 'deleted';
      if (isRevokeEvent) {
        const revokedObj = ((payload.message || (payload.data as Record<string, unknown>)?.message || payload.data || payload) as Record<string, unknown>);
        const revokedId = String(revokedObj?._id || revokedObj?.id || payload.messageId || payload.id || '').trim();
        if (revokedId) {
          await db
            .update(whatsappMessages)
            .set({ deletedInOrigin: true })
            .where(eq(whatsappMessages.externalMessageId, revokedId));
          broadcast('whatsapp:revoked', { externalMessageId: revokedId });
        }
        return res.status(200).json({ ok: true, event: 'revoked_preserved' });
      }

      // 3. Operator Event (create / update / delete)
      const isOperatorEvent =
        eventRaw.includes('operator') ||
        eventRaw === 'newuser' ||
        eventRaw === 'usercreated' ||
        eventRaw === 'userupdated' ||
        eventRaw === 'userdeleted' ||
        eventRaw === 'agentcreated' ||
        eventRaw === 'agentupdated' ||
        eventRaw === 'agentdeleted';
      if (isOperatorEvent) {
        const rawOp = ((payload.operator || payload.user || payload.agent || (payload.data as Record<string, unknown>)?.operator || payload.data) as Record<string, unknown>);
        const opId = String(rawOp?._id || rawOp?.id || '').trim();
        if (opId) {
          const active = !(rawOp.deleted === true || eventRaw.includes('delet') || eventRaw.includes('remov')) && rawOp.active !== false;
          const existing = await db.select().from(gotalkOperators).where(eq(gotalkOperators.gotalkOperatorId, opId)).limit(1);
          if (existing[0]) {
            await db
              .update(gotalkOperators)
              .set({
                name: (rawOp.name || rawOp.nome || existing[0].name) as string | null,
                email: (rawOp.email || existing[0].email) as string | null,
                phone: normalizePhone((rawOp.phone || rawOp.telefone || existing[0].phone) as string | null) || null,
                active,
                updatedAt: new Date(),
              })
              .where(eq(gotalkOperators.id, existing[0].id));
          } else {
            await db.insert(gotalkOperators).values({
              gotalkOperatorId: opId,
              name: (rawOp.name || rawOp.nome || null) as string | null,
              email: (rawOp.email || null) as string | null,
              phone: normalizePhone((rawOp.phone || rawOp.telefone || null) as string | null) || null,
              active,
            });
          }
        }
        return res.status(200).json({ ok: true, event: 'operator' });
      }

      // Resolve channelDbId from technical payload.channelId (strictly server-side)
      const whChannelId = String(payload.channelId || payload.channel_id || '').trim();
      let resolvedChannelDbId: number | null = null;
      if (whChannelId) {
        const ch = await db.select().from(gotalkChannels).where(eq(gotalkChannels.channelId, whChannelId)).limit(1);
        resolvedChannelDbId = ch[0]?.id ?? null;
      }

      // 4. Attendance Events
      const isAttendanceEvent =
        eventRaw === 'newattendance' ||
        eventRaw === 'openattendance' ||
        eventRaw === 'closeattendance' ||
        eventRaw === 'finishattendance' ||
        eventRaw === 'attendanceupdate' ||
        eventRaw === 'attendancefinished' ||
        eventRaw === 'attendance' ||
        eventRaw === 'transferattendance' ||
        eventRaw === 'attendancetransferred';
      if (isAttendanceEvent) {
        const rawAt = ((payload.attendance || (payload.data as Record<string, unknown>)?.attendance || payload.data || payload) as Record<string, unknown>);
        const atId = String(rawAt._id || rawAt.id || '').trim();
        const atPhone = String(rawAt.clientNumber || rawAt.phone || rawAt.clientPhone || '').trim();
        const deptName = String(rawAt.departmentName || rawAt.department || '').trim() || null;
        const opName = String(rawAt.operatorName || rawAt.operator || '').trim() || null;
        if (atPhone) {
          const threads = await db.select().from(whatsappThreads);
          const matched = threads.find((t) => phonesMatchBR(t.contactPhone, atPhone));
          if (matched) {
            await db
              .update(whatsappThreads)
              .set({
                gotalkAttendanceId: atId || matched.gotalkAttendanceId,
                department: deptName ?? matched.department,
                operatorName: opName ?? matched.operatorName,
                channelDbId: resolvedChannelDbId ?? matched.channelDbId,
                updatedAt: new Date(),
              })
              .where(eq(whatsappThreads.id, matched.id));
          }
        }
        return res.status(200).json({ ok: true, event: 'attendance' });
      }

      // 4B. Call Log Event (GoTalk voice/video call)
      if (eventRaw === 'call' || eventRaw === 'call_log' || eventRaw === 'call.ended' || eventRaw === 'callended') {
        const callObj = ((payload.call || payload.data || payload) as Record<string, unknown>);
        const callPhone = String(callObj.phone || callObj.from || callObj.to || callObj.clientNumber || '').trim();
        const callExtId = String(callObj.callId || callObj.id || callObj._id || `gt-wh-${Date.now()}`).trim();
        const recUrl = String(callObj.recordingUrl || callObj.audioUrl || callObj.url || '').trim();
        const durSec = Number(callObj.duration || callObj.durationSeconds || 0);
        const contactNameCall = String(callObj.contactName || callObj.name || callPhone || 'Contato GoTalk').trim();
        if (normalizePhone(callPhone)) {
          const allThreads = await db.select().from(whatsappThreads);
          const matchedThread = allThreads.find((t) => phonesMatchBR(t.contactPhone, callPhone));
          const resolvedUnit = matchedThread?.unitId || Number(payload.unitId) || 1;
          let recSha = '';
          let recUri = '';
          let recMime = '';
          let recName = '';
          let audioTrans = '';
          if (recUrl) {
            const downloaded = await downloadMediaToBucket(recUrl, {
              folderPath: `bucketdainvicta/U${resolvedUnit}/CALLS/GOTALK`,
              fileName: `gotalk-call-${callExtId}.ogg`,
              fallbackMime: 'audio/ogg',
            });
            if (downloaded) {
              recSha = downloaded.sha256Hash;
              recUri = downloaded.storageUri;
              recMime = downloaded.mimeType;
              recName = `gotalk-call-${callExtId}`;
              const tRes = await iviTranscribeAudioNote(downloaded.dataUri, downloaded.mimeType);
              audioTrans = tRes.transcript;
            }
          }
          const [cLog] = await db
            .insert(whatsappCallLogs)
            .values({
              unitId: resolvedUnit,
              threadId: matchedThread?.id ?? null,
              callId: callExtId,
              direction: callObj.direction === 'outbound' || callObj.fromMe === true ? 'outbound' : 'inbound',
              fromNumber: String(callObj.from || callPhone),
              toNumber: String(callObj.to || callPhone),
              callType: callObj.isVideo ? 'video' : 'voice',
              status: 'ended',
              durationSeconds: durSec,
              provider: 'gotalk',
              recordingSha256: recSha,
              recordingStorageUri: recUri,
              recordingMimeType: recMime,
              recordingFileName: recName,
              audioTranscript: audioTrans,
              initiatedByName: String(callObj.operatorName || 'GoTalk'),
              endedAt: new Date(),
            })
            .returning();
          const mirroredLead = await mirrorCommunicationToProspection({
            unitId: resolvedUnit,
            phone: callPhone,
            contactName: contactNameCall,
            channel: 'whatsapp_gotalk',
            provider: 'gotalk',
            threadId: matchedThread?.id ?? null,
            direction: callObj.fromMe === true ? 'outbound' : 'inbound',
            contentType: recSha ? 'audio' : 'call',
            body: recSha ? `[Gravação de Ligação GoTalk]` : `[Ligação GoTalk] Duração: ${durSec}s`,
            audioTranscript: audioTrans || null,
            callId: callExtId,
            mediaSha256: recSha || null,
            mediaStorageUri: recUri || null,
            mediaMimeType: recMime || null,
            mediaFileName: recName || null,
            externalMessageId: callExtId,
            triggerIviAutoSummarize: Boolean(audioTrans),
          });
          if (mirroredLead) {
            await db.update(whatsappCallLogs).set({ leadId: mirroredLead.id }).where(eq(whatsappCallLogs.id, cLog.id));
            if (recSha) {
              await db.insert(communicationArchives).values({
                unitId: resolvedUnit,
                leadId: mirroredLead.id,
                threadId: matchedThread?.id ?? null,
                callLogId: cLog.id,
                provider: 'gotalk',
                archiveType: 'call_recording',
                contactName: contactNameCall,
                contactPhone: callPhone,
                fileName: recName,
                mimeType: recMime,
                sizeBytes: 0,
                sha256Hash: recSha,
                storageUri: recUri,
                transcriptText: audioTrans,
                createdByName: 'Webhook GoTalk',
              });
            }
          }
        }
        return res.status(200).json({ ok: true, event: 'call' });
      }

      // 5. New Message (GoTalk official payload OR flat test payload)
      const dataObj = (payload.data && typeof payload.data === 'object' ? payload.data : null) as Record<string, unknown> | null;
      const rawMsg = ((payload.message && typeof payload.message === 'object'
        ? payload.message
        : dataObj?.message && typeof dataObj.message === 'object'
        ? dataObj.message
        : dataObj && (dataObj._id || dataObj.id)
        ? dataObj
        : payload) as Record<string, unknown>);
      const rawContact = ((payload.contact || dataObj?.contact || null) as Record<string, unknown> | null);

      const extMsgId = String(rawMsg._id || rawMsg.id || '').trim() || null;
      if (extMsgId) {
        const dup = await db
          .select({ id: whatsappMessages.id })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.externalMessageId, extMsgId))
          .limit(1);
        if (dup[0]) {
          return res.status(200).json({ ok: true, deduplicated: true, messageId: dup[0].id });
        }
      }

      const rawPhone = String(
        rawContact?.number ||
          rawContact?.phone ||
          rawMsg.clientNumber ||
          payload.clientNumber ||
          payload.phone ||
          payload.from ||
          payload.number ||
          rawMsg.phoneNumber ||
          rawMsg.to ||
          ''
      ).trim();

      const textBody = String(rawMsg.body || rawMsg.text || rawMsg.caption || payload.message || payload.text || '').trim();
      const contactName = String(
        rawContact?.name ||
          rawContact?.pushname ||
          payload.contactName ||
          payload.name ||
          payload.pushName ||
          rawPhone ||
          'Contato GoTalk'
      ).trim();

      const waType = String(rawMsg.type || payload.contentType || 'chat').toLowerCase();
      const contentType =
        waType === 'audio' || waType === 'ptt'
          ? 'audio'
          : waType === 'image'
          ? 'image'
          : waType === 'document'
          ? 'document'
          : 'text';

      const fromMe = rawMsg.fromMe === true || rawMsg.direction === 'OUT' || payload.direction === 'outbound';
      const direction = fromMe ? 'outbound' : 'inbound';
      const attachmentUrl = (rawMsg.mediaUrl || rawMsg.url || null) as string | null;
      const attachmentName = (rawMsg.fileName || null) as string | null;
      const attachmentMimeType = (rawMsg.mimetype || null) as string | null;
      const ackStatus = fromMe ? parseAckValue(rawMsg.ack ?? rawMsg.status) ?? 1 : null;
      const gotalkContactId = String(payload.contactId || rawContact?._id || rawMsg.contactId || '').trim() || null;
      const gotalkAttendanceId =
        String(
          payload.attendanceId ||
            (payload.attendance as Record<string, unknown>)?._id ||
            (payload.attendance as Record<string, unknown>)?.id ||
            rawMsg.attendanceId ||
            ''
        ).trim() || null;
      const operatorName = String(rawMsg.operatorName || rawMsg.operator || '').trim() || null;
      const department =
        String(
          (payload.attendance as Record<string, unknown>)?.departmentName ||
            (payload.attendance as Record<string, unknown>)?.department ||
            payload.departmentName ||
            payload.department ||
            ''
        ).trim() || null;

      if (!normalizePhone(rawPhone) || (!textBody && !attachmentUrl)) {
        return res.status(400).json({ error: 'Payload GoTalk inválido: telefone e conteúdo são obrigatórios.' });
      }

      const [allThreads, allClients] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp, unitId: clients.unitId }).from(clients),
      ]);

      const matchedClient = allClients.find(
        (c) => phonesMatchBR(c.whatsapp, rawPhone) || phonesMatchBR(c.phone, rawPhone)
      );

      let thread = allThreads.find((t) => phonesMatchBR(t.contactPhone, rawPhone) && t.provider === 'gotalk');
      const preview = (textBody || attachmentName || `[${contentType.toUpperCase()}]`).slice(0, 70);

      if (!thread) {
        const firstUnit = await db.select().from(units).orderBy(units.id).limit(1);
        const resolvedUnitId = matchedClient?.unitId || Number(payload.unitId) || firstUnit[0]?.id || 1;
        const [created] = await db
          .insert(whatsappThreads)
          .values({
            unitId: resolvedUnitId,
            clientId: matchedClient?.id ?? null,
            contactName,
            contactPhone: normalizePhone(rawPhone) || rawPhone,
            provider: 'gotalk',
            gotalkContactId,
            gotalkAttendanceId,
            channelDbId: resolvedChannelDbId,
            operatorName,
            department,
            lastMessagePreview: preview,
            unreadCount: direction === 'inbound' ? 1 : 0,
            updatedAt: new Date(),
          })
          .returning();
        thread = created;
      } else {
        await db
          .update(whatsappThreads)
          .set({
            clientId: thread.clientId ?? matchedClient?.id ?? null,
            gotalkContactId: gotalkContactId ?? thread.gotalkContactId,
            gotalkAttendanceId: gotalkAttendanceId ?? thread.gotalkAttendanceId,
            channelDbId: resolvedChannelDbId ?? thread.channelDbId,
            operatorName: operatorName ?? thread.operatorName,
            department: department ?? thread.department,
            lastMessagePreview: preview,
            unreadCount: direction === 'inbound' ? (thread.unreadCount || 0) + 1 : thread.unreadCount,
            updatedAt: new Date(),
          })
          .where(eq(whatsappThreads.id, thread.id));
      }

      // Download and encrypt media/audio inside bucketdainvicta before external link expires
      let downloadedMedia: Awaited<ReturnType<typeof downloadMediaToBucket>> = null;
      if (attachmentUrl) {
        downloadedMedia = await downloadMediaToBucket(attachmentUrl, {
          folderPath: `bucketdainvicta/U${thread.unitId}/WHATSAPP/T${thread.id}`,
          fileName: attachmentName || `gotalk-${contentType}-${Date.now()}.${contentType === 'audio' ? 'ogg' : 'bin'}`,
          fallbackMime: attachmentMimeType || (contentType === 'audio' ? 'audio/ogg' : 'application/octet-stream'),
        });
      }

      let iviTranscript: string | null = null;
      if (contentType === 'audio') {
        const resT = await iviTranscribeAudioNote(
          downloadedMedia?.dataUri || textBody || attachmentName || 'Áudio recebido via GoTalk',
          downloadedMedia?.mimeType || attachmentMimeType || 'audio/ogg'
        );
        iviTranscript = resT.transcript;
      }

      const [msg] = await db
        .insert(whatsappMessages)
        .values({
          threadId: thread.id,
          externalMessageId: extMsgId,
          direction,
          contentType,
          body: textBody || attachmentName || '[Mídia recebida]',
          attachmentUrl: downloadedMedia
            ? `/api/bucket/objects/${downloadedMedia.sha256Hash}?name=${encodeURIComponent(attachmentName || 'midia-gotalk')}&mime=${encodeURIComponent(downloadedMedia.mimeType)}&preview=1`
            : attachmentUrl,
          attachmentName,
          attachmentMimeType: downloadedMedia?.mimeType || attachmentMimeType,
          mediaSha256: downloadedMedia?.sha256Hash || null,
          mediaStorageUri: downloadedMedia?.storageUri || null,
          iviAudioTranscript: iviTranscript,
          ackStatus,
          operatorName,
          department,
          senderName: direction === 'inbound' ? contactName : operatorName || 'Consultor GoTalk',
        })
        .returning();

      const mirroredLead = await mirrorCommunicationToProspection({
        unitId: thread.unitId,
        phone: rawPhone,
        contactName,
        channel: 'whatsapp_gotalk',
        provider: 'gotalk',
        threadId: thread.id,
        direction,
        contentType,
        body: textBody || attachmentName || '[Mídia GoTalk]',
        audioTranscript: iviTranscript,
        authorName: direction === 'inbound' ? contactName : operatorName || 'Consultor GoTalk',
        externalMessageId: extMsgId || `gt-msg-${msg.id}`,
        mediaSha256: downloadedMedia?.sha256Hash || null,
        mediaStorageUri: downloadedMedia?.storageUri || null,
        mediaMimeType: downloadedMedia?.mimeType || attachmentMimeType,
        mediaFileName: attachmentName,
        triggerIviAutoSummarize: direction === 'inbound' || contentType === 'audio',
      });

      if (downloadedMedia) {
        await db.insert(communicationArchives).values({
          unitId: thread.unitId,
          leadId: mirroredLead?.id ?? null,
          threadId: thread.id,
          provider: 'gotalk',
          archiveType: contentType === 'audio' ? 'audio_message' : 'conversation_snapshot',
          contactName,
          contactPhone: normalizePhone(rawPhone) || rawPhone,
          fileName: attachmentName || `gotalk-${contentType}-${msg.id}`,
          mimeType: downloadedMedia.mimeType,
          sizeBytes: downloadedMedia.sizeBytes,
          sha256Hash: downloadedMedia.sha256Hash,
          storageUri: downloadedMedia.storageUri,
          transcriptText: iviTranscript || textBody || '',
          createdByName: 'Webhook GoTalk',
        });
      }

      broadcast('whatsapp:message', msg);
      return res.json({ ok: true, received: true, threadId: thread.id, messageId: msg.id });
    } catch (error) {
      console.error('GoTalk webhook error:', error);
      return res.status(500).json({ error: 'Erro ao processar webhook GoTalk.' });
    }
  };

  app.post('/api/integrations/gotalk/webhook', handleGotalkWebhook);
  app.post('/api/gotalk/webhook', handleGotalkWebhook);

  app.post('/api/integrations/gotalk/test-webhook', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const port = process.env.PORT || 3000;
      const localUrl = `http://127.0.0.1:${port}/api/integrations/gotalk/webhook`;
      const webhookSecret = getGotalkWebhookSecret();
      const testExtId = `selftest_${Date.now()}`;
      const testPhone = '5581999990099';

      // 1. Verificar se chamadas sem token são bloqueadas quando GOTALK_WEBHOOK_SECRET está ativo
      let unauthorizedBlocked: boolean | null = null;
      if (webhookSecret) {
        const unauthResp = await fetch(localUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'message', phone: testPhone, message: 'unauthorized-probe' }),
        });
        unauthorizedBlocked = unauthResp.status === 401;
      }

      // 2. Testar ingestão autenticada de mensagem, ACK=3 e revogação imutável
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (webhookSecret) headers['x-gotalk-token'] = webhookSecret;

      const msgResp = await fetch(localUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event: 'message',
          message: { _id: testExtId, fromMe: true, type: 'chat', body: '[SelfTest] Verificação webhook GoTalk' },
          contact: { _id: `st_c_${Date.now()}`, name: 'SelfTest Webhook GoTalk', number: testPhone },
        }),
      });
      const msgJson = (await msgResp.json().catch(() => ({}))) as { ok?: boolean; threadId?: number; messageId?: number; error?: string };
      if (!msgResp.ok || !msgJson.ok) {
        return res.status(502).json({ ok: false, error: msgJson.error || `HTTP ${msgResp.status}` });
      }

      const ackResp = await fetch(localUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: 'ack', messageId: testExtId, ack: 3 }),
      });

      const revResp = await fetch(localUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: 'messagerevoked', messageId: testExtId }),
      });

      // Verificar estado gravado no PostgreSQL e remover dados sintéticos de teste
      const savedRows = await db
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.externalMessageId, testExtId))
        .limit(1);
      const verifiedAck = savedRows[0]?.ackStatus === 3;
      const verifiedRevoke = savedRows[0]?.deletedInOrigin === true;

      if (msgJson.messageId) {
        await db.delete(whatsappMessages).where(eq(whatsappMessages.id, msgJson.messageId));
      }
      if (msgJson.threadId) {
        const remaining = await db
          .select({ value: count() })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.threadId, msgJson.threadId));
        if (Number(remaining[0]?.value || 0) === 0) {
          await db.delete(whatsappThreads).where(eq(whatsappThreads.id, msgJson.threadId));
        }
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'GOTALK_WEBHOOK_SELF_TEST',
        entityType: 'integration',
        entityId: 'gotalk_webhook',
        details: {
          ok: true,
          unauthorizedBlocked,
          ackOk: ackResp.ok && verifiedAck,
          revokeOk: revResp.ok && verifiedRevoke,
        },
        unitId: req.activeUnitId,
      });

      res.json({
        ok: true,
        checks: {
          secretProtection: webhookSecret ? (unauthorizedBlocked ? 'Ativa (401 sem token)' : 'Falha na proteção') : 'Sem secret configurado',
          messageIngestion: msgResp.ok,
          ackUpdate: ackResp.ok && verifiedAck,
          immutableRevoke: revResp.ok && verifiedRevoke,
        },
        status: getGotalkStatus(),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro no autoteste do webhook.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7B. UaZapi V2 Official API, Multi-Instance Encryption, QR Connect & Webhook
  // ---------------------------------------------------------------------------
  async function resolveUazapiCredentials(opts?: {
    instanceId?: string | null;
    unitId?: number | null;
    groupId?: number | null;
    moduleId?: string | null;
  }): Promise<(UazapiCredentials & { dbId?: number }) | null> {
    const allRows = await db.select().from(unitWhatsappCredentials).orderBy(unitWhatsappCredentials.id);
    if (allRows.length > 0) {
      const activeRows = allRows.filter((r) => r.active !== false);
      const poolRows = activeRows.length > 0 ? activeRows : allRows;

      const matchesGroup = (r: (typeof allRows)[number]) =>
        !opts?.groupId ||
        !Array.isArray(r.allowedGroupIds) ||
        r.allowedGroupIds.length === 0 ||
        r.allowedGroupIds.includes(opts.groupId);

      const matchesModule = (r: (typeof allRows)[number]) =>
        !opts?.moduleId ||
        !Array.isArray(r.allowedModules) ||
        r.allowedModules.length === 0 ||
        r.allowedModules.includes(opts.moduleId);

      const matched =
        (opts?.instanceId && allRows.find((r) => r.uazapiInstanceId === opts.instanceId)) ||
        (opts?.groupId &&
          opts?.unitId &&
          poolRows.find(
            (r) =>
              r.isConnected &&
              r.unitId === opts.unitId &&
              Array.isArray(r.allowedGroupIds) &&
              r.allowedGroupIds.includes(opts.groupId!) &&
              matchesModule(r)
          )) ||
        (opts?.groupId &&
          poolRows.find(
            (r) =>
              r.isConnected &&
              Array.isArray(r.allowedGroupIds) &&
              r.allowedGroupIds.includes(opts.groupId!) &&
              matchesModule(r)
          )) ||
        (opts?.unitId &&
          poolRows.find(
            (r) => r.unitId === opts.unitId && r.isDefaultForUnit && r.isConnected && matchesGroup(r)
          )) ||
        (opts?.unitId && poolRows.find((r) => r.unitId === opts.unitId && r.isConnected && matchesGroup(r))) ||
        (opts?.unitId && poolRows.find((r) => r.unitId === opts.unitId && r.isDefaultForUnit)) ||
        (opts?.unitId && poolRows.find((r) => r.unitId === opts.unitId)) ||
        poolRows.find((r) => r.isConnected && matchesGroup(r)) ||
        poolRows.find((r) => r.isConnected) ||
        poolRows[0];

      if (matched) {
        const token = decryptUazapiToken(matched.uazapiTokenEncrypted);
        if (token) {
          return {
            dbId: matched.id,
            unitId: matched.unitId,
            instanceId: matched.uazapiInstanceId,
            label: matched.label,
            serverUrl: matched.uazapiServerUrl || getDefaultUazapiServerUrl(),
            token,
          };
        }
      }
    }
    return getEnvUazapiCredentials();
  }

  async function listSanitizedUazapiInstances() {
    const rows = await db.select().from(unitWhatsappCredentials).orderBy(unitWhatsappCredentials.id);
    return rows.map((r) => ({
      id: r.id,
      unitId: r.unitId,
      label: r.label,
      uazapiInstanceId: r.uazapiInstanceId,
      uazapiServerUrl: r.uazapiServerUrl,
      hasToken: Boolean(r.uazapiTokenEncrypted),
      defaultPhone: r.defaultPhone || '',
      connectedPhone: r.connectedPhone,
      profileName: r.profileName,
      isConnected: r.isConnected,
      allowedGroupIds: r.allowedGroupIds || [],
      allowedModules: r.allowedModules || ['prospection', 'admission', 'collection'],
      assignedCollaboratorId: r.assignedCollaboratorId ?? null,
      isDefaultForUnit: Boolean(r.isDefaultForUnit),
      active: r.active !== false,
      webhookUrl: r.webhookUrl,
      webhookRegisteredAt: r.webhookRegisteredAt,
      webhookLastError: r.webhookLastError,
      updatedAt: r.updatedAt,
    }));
  }

  function resolvePublicBaseUrl(req: express.Request): string {
    const envPublic = process.env.APP_PUBLIC_URL?.trim() || process.env.APP_URL?.trim();
    if (envPublic && !envPublic.includes('MY_APP_URL')) {
      return envPublic.replace(/\/$/, '');
    }
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    return `${proto}://${host}`;
  }

  app.get('/api/integrations/uazapi/status', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const [instances, runtime] = await Promise.all([
        listSanitizedUazapiInstances(),
        Promise.resolve(getUazapiGlobalRuntimeState()),
      ]);
      res.json({
        configured: runtime.envConfigured || instances.length > 0,
        serverUrl: instances[0]?.uazapiServerUrl || runtime.defaultServerUrl,
        instancesCount: instances.length,
        instances,
        ...runtime,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar status UaZapi.' });
    }
  });

  function normalizeStrMatch(val: string): string {
    return val
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  async function upsertDiscoveredUazapiInstances(params: {
    serverUrl: string;
    discovered: Array<{
      id: string;
      name: string;
      token: string;
      connected: boolean;
      profileName: string | null;
      ownerPhone: string | null;
    }>;
    fallbackUnitId: number;
  }) {
    const allUnits = await db.select().from(units).orderBy(units.id);
    const savedList = [];
    for (const item of params.discovered) {
      const instNorm = normalizeStrMatch(item.name);
      const matchedUnit =
        allUnits.find((u) => {
          const uName = normalizeStrMatch(u.name);
          const uCity = normalizeStrMatch(u.city || '');
          return (
            (uCity && instNorm.includes(uCity)) ||
            (uName && instNorm.includes(uName)) ||
            (instNorm.includes('central') && u.id === allUnits[0]?.id)
          );
        }) || allUnits.find((u) => u.id === params.fallbackUnitId) || allUnits[0];

      const resolvedUnitId = matchedUnit?.id || params.fallbackUnitId || 1;
      const encrypted = encryptUazapiToken(item.token);

      const existing = await db
        .select()
        .from(unitWhatsappCredentials)
        .where(eq(unitWhatsappCredentials.uazapiInstanceId, item.id))
        .limit(1);

      let saved;
      if (existing[0]) {
        const [updated] = await db
          .update(unitWhatsappCredentials)
          .set({
            unitId: resolvedUnitId,
            label: item.name || existing[0].label,
            uazapiServerUrl: params.serverUrl,
            uazapiTokenEncrypted: encrypted,
            connectedPhone: item.ownerPhone ?? existing[0].connectedPhone,
            profileName: item.profileName ?? existing[0].profileName,
            isConnected: item.connected,
            updatedAt: new Date(),
          })
          .where(eq(unitWhatsappCredentials.id, existing[0].id))
          .returning();
        saved = updated;
      } else {
        const [inserted] = await db
          .insert(unitWhatsappCredentials)
          .values({
            unitId: resolvedUnitId,
            label: item.name || item.id,
            uazapiInstanceId: item.id,
            uazapiServerUrl: params.serverUrl,
            uazapiTokenEncrypted: encrypted,
            connectedPhone: item.ownerPhone,
            profileName: item.profileName,
            isConnected: item.connected,
          })
          .returning();
        saved = inserted;
      }
      savedList.push({
        id: saved.id,
        unitId: saved.unitId,
        label: saved.label,
        uazapiInstanceId: saved.uazapiInstanceId,
        uazapiServerUrl: saved.uazapiServerUrl,
        hasToken: true,
        connectedPhone: saved.connectedPhone,
        profileName: saved.profileName,
        isConnected: saved.isConnected,
      });
    }
    return savedList;
  }

  app.post('/api/integrations/uazapi/instances', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { unitId, label, serverUrl, token, instanceId } = req.body as {
        unitId?: number;
        label?: string;
        serverUrl?: string;
        token?: string;
        instanceId?: string;
      };
      if (!token?.trim()) {
        return res.status(400).json({ error: 'Token da instância ou AdminToken UaZapi é obrigatório.' });
      }
      const resolvedServerUrl = (serverUrl || getDefaultUazapiServerUrl()).trim().replace(/\/$/, '');
      const firstUnit = await db.select().from(units).orderBy(units.id).limit(1);
      const resolvedUnitId = unitId || req.activeUnitId || firstUnit[0]?.id || 1;
      const tempCreds: UazapiCredentials = { serverUrl: resolvedServerUrl, token: token.trim() };
      const liveStatus = await getUazapiInstanceStatus(tempCreds);

      if (!liveStatus.ok) {
        // Fallback: check if supplied token is a server admintoken (GET /instance/all)
        const adminDiscovery = await fetchUazapiInstancesWithAdminToken(resolvedServerUrl, token.trim());
        if (adminDiscovery.ok && adminDiscovery.instances.length > 0) {
          const savedList = await upsertDiscoveredUazapiInstances({
            serverUrl: resolvedServerUrl,
            discovered: adminDiscovery.instances,
            fallbackUnitId: resolvedUnitId,
          });

          await db.insert(auditLogs).values({
            userId: req.authUser!.id,
            userName: req.authUser!.name,
            action: 'UAZAPI_ADMIN_DISCOVERY_SAVED',
            entityType: 'integration',
            entityId: 'uazapi_admin',
            details: {
              discoveredCount: savedList.length,
              connectedCount: savedList.filter((i) => i.isConnected).length,
              serverUrl: resolvedServerUrl,
            },
            unitId: req.activeUnitId,
          });

          return res.json({
            ok: true,
            mode: 'admin_discovery',
            discoveredCount: savedList.length,
            connectedCount: savedList.filter((i) => i.isConnected).length,
            instances: savedList,
          });
        }

        return res.status(400).json({
          ok: false,
          error: liveStatus.error || `Falha ao validar token UaZapi (HTTP ${liveStatus.httpStatus}).`,
        });
      }

      const finalInstanceId = (instanceId || liveStatus.instanceId || liveStatus.instanceName || `uaz_${Date.now()}`).trim();
      const [saved] = await upsertDiscoveredUazapiInstances({
        serverUrl: resolvedServerUrl,
        discovered: [
          {
            id: finalInstanceId,
            name: label?.trim() || liveStatus.instanceName || 'Principal',
            token: token.trim(),
            connected: liveStatus.connected,
            profileName: liveStatus.profileName,
            ownerPhone: liveStatus.connectedPhone,
          },
        ],
        fallbackUnitId: resolvedUnitId,
      });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UAZAPI_INSTANCE_SAVED',
        entityType: 'integration',
        entityId: finalInstanceId,
        details: { unitId: resolvedUnitId, connected: liveStatus.connected, serverUrl: resolvedServerUrl },
        unitId: req.activeUnitId,
      });

      res.json({
        ok: true,
        mode: 'single_instance',
        instance: saved,
        liveStatus,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao salvar instância UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/discover', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminToken = getUazapiAdminToken();
      if (!adminToken) {
        return res.status(400).json({
          ok: false,
          error: 'AdminToken UaZapi não configurado (configure na aba WhatsApp UaZapi & Grupos).',
        });
      }
      const serverUrl = getDefaultUazapiServerUrl();
      const discovery = await fetchUazapiInstancesWithAdminToken(serverUrl, adminToken);
      if (!discovery.ok) {
        return res.status(502).json({ ok: false, error: discovery.error || 'Falha ao listar instâncias no UaZapi.' });
      }
      const firstUnit = await db.select().from(units).orderBy(units.id).limit(1);
      const savedList = await upsertDiscoveredUazapiInstances({
        serverUrl,
        discovered: discovery.instances,
        fallbackUnitId: req.activeUnitId || firstUnit[0]?.id || 1,
      });
      res.json({
        ok: true,
        discoveredCount: savedList.length,
        connectedCount: savedList.filter((i) => i.isConnected).length,
        instances: savedList,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao descobrir instâncias UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/test', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { instanceId } = (req.body || {}) as { instanceId?: string };
      const creds = await resolveUazapiCredentials({ instanceId: instanceId || null, unitId: req.activeUnitId });
      if (!creds) {
        return res.status(400).json({
          ok: false,
          error: 'UaZapi não configurado: adicione UAZAPI_TOKEN nos Secrets ou provisione a instância.',
        });
      }

      const [liveStatus, webhookCfg] = await Promise.all([
        getUazapiInstanceStatus(creds),
        getUazapiWebhookConfig(creds).catch(() => ({ ok: false, webhooks: null })),
      ]);

      if (creds.dbId && liveStatus.ok) {
        await db
          .update(unitWhatsappCredentials)
          .set({
            isConnected: liveStatus.connected,
            connectedPhone: liveStatus.connectedPhone,
            profileName: liveStatus.profileName,
            updatedAt: new Date(),
          })
          .where(eq(unitWhatsappCredentials.id, creds.dbId));
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: liveStatus.ok ? 'UAZAPI_STATUS_TEST_OK' : 'UAZAPI_STATUS_TEST_FAILED',
        entityType: 'integration',
        entityId: creds.instanceId || 'uazapi',
        details: { ok: liveStatus.ok, connected: liveStatus.connected, httpStatus: liveStatus.httpStatus },
        unitId: req.activeUnitId,
      });

      if (!liveStatus.ok) {
        return res.status(liveStatus.httpStatus === 401 ? 401 : 502).json({
          ok: false,
          error: liveStatus.error || 'Falha ao consultar /instance/status no UaZapi.',
          liveStatus,
        });
      }

      const instances = await listSanitizedUazapiInstances();
      res.json({
        ok: true,
        liveStatus,
        webhookConfig: webhookCfg,
        instances,
        runtime: getUazapiGlobalRuntimeState(),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao testar UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/connect', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { instanceId, phone } = (req.body || {}) as { instanceId?: string; phone?: string };
      const creds = await resolveUazapiCredentials({ instanceId: instanceId || null, unitId: req.activeUnitId });
      if (!creds) {
        return res.status(400).json({ ok: false, error: 'Credenciais UaZapi não configuradas.' });
      }
      const result = await connectUazapiInstance(creds, phone);
      if (creds.dbId && result.ok) {
        await db
          .update(unitWhatsappCredentials)
          .set({
            isConnected: result.connected,
            connectedPhone: result.connectedPhone,
            profileName: result.profileName,
            updatedAt: new Date(),
          })
          .where(eq(unitWhatsappCredentials.id, creds.dbId));
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao conectar instância UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/disconnect', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { instanceId } = (req.body || {}) as { instanceId?: string };
      const creds = await resolveUazapiCredentials({ instanceId: instanceId || null, unitId: req.activeUnitId });
      if (!creds) return res.status(400).json({ ok: false, error: 'Credenciais UaZapi não configuradas.' });
      const result = await disconnectUazapiInstance(creds);
      if (creds.dbId && result.ok) {
        await db
          .update(unitWhatsappCredentials)
          .set({ isConnected: false, updatedAt: new Date() })
          .where(eq(unitWhatsappCredentials.id, creds.dbId));
      }
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao desconectar UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/register-webhook', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { instanceId } = (req.body || {}) as { instanceId?: string };
      const creds = await resolveUazapiCredentials({ instanceId: instanceId || null, unitId: req.activeUnitId });
      if (!creds) return res.status(400).json({ ok: false, error: 'Credenciais UaZapi não configuradas.' });

      const baseUrl = resolvePublicBaseUrl(req);
      const hookSecret = getUazapiWebhookSecret() || creds.token;
      const webhookUrl = `${baseUrl}/api/integrations/uazapi/webhook?token=${encodeURIComponent(hookSecret)}`;
      const reg = await registerUazapiWebhook(creds, webhookUrl);

      if (creds.dbId) {
        await db
          .update(unitWhatsappCredentials)
          .set({
            webhookUrl: `${baseUrl}/api/integrations/uazapi/webhook`,
            webhookRegisteredAt: reg.ok ? new Date() : undefined,
            webhookLastError: reg.ok ? null : reg.detail || `HTTP ${reg.status}`,
            updatedAt: new Date(),
          })
          .where(eq(unitWhatsappCredentials.id, creds.dbId));
      }

      res.status(reg.ok ? 200 : 502).json({
        ok: reg.ok,
        webhookUrlDisplay: `${baseUrl}/api/integrations/uazapi/webhook`,
        detail: reg.detail,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao registrar webhook UaZapi.' });
    }
  });

  app.post('/api/integrations/uazapi/sync-chats', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { instanceId } = (req.body || {}) as { instanceId?: string };
      const creds = await resolveUazapiCredentials({ instanceId: instanceId || null, unitId: req.activeUnitId });
      if (!creds) return res.status(400).json({ ok: false, error: 'Credenciais UaZapi não configuradas.' });

      const chats = await findUazapiChats(creds, 15, 0);
      const [allThreads, allClients, firstUnit] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp, unitId: clients.unitId }).from(clients),
        db.select().from(units).orderBy(units.id).limit(1),
      ]);

      let threadsSynced = 0;
      let messagesSynced = 0;

      for (const ch of chats) {
        const matchedClient = allClients.find(
          (c) => phonesMatchBR(c.whatsapp, ch.phone) || phonesMatchBR(c.phone, ch.phone)
        );
        let thread =
          allThreads.find(
            (t) =>
              t.provider === 'uazapi' &&
              t.uazapiInstanceId === creds.instanceId &&
              phonesMatchBR(t.contactPhone, ch.phone)
          ) ||
          allThreads.find(
            (t) =>
              t.provider === 'uazapi' &&
              !t.uazapiInstanceId &&
              phonesMatchBR(t.contactPhone, ch.phone)
          );
        if (!thread) {
          const [created] = await db
            .insert(whatsappThreads)
            .values({
              unitId: creds.unitId || matchedClient?.unitId || firstUnit[0]?.id || 1,
              clientId: matchedClient?.id ?? null,
              contactName: ch.name || ch.phone,
              contactPhone: normalizePhone(ch.phone) || ch.phone,
              provider: 'uazapi',
              uazapiInstanceId: creds.instanceId || null,
              unreadCount: ch.unreadCount,
              lastMessagePreview: ch.lastMessagePreview || 'Conversa sincronizada UaZapi',
              updatedAt: new Date(),
            })
            .returning();
          thread = created;
          allThreads.push(created);
        } else {
          await db
            .update(whatsappThreads)
            .set({
              uazapiInstanceId: creds.instanceId || thread.uazapiInstanceId,
              lastMessagePreview: ch.lastMessagePreview || thread.lastMessagePreview,
              updatedAt: new Date(),
            })
            .where(eq(whatsappThreads.id, thread.id));
        }
        threadsSynced++;

        const msgs = await findUazapiMessages(creds, ch.chatId, 15);
        for (const m of msgs) {
          if (!m.body) continue;
          const dup = await db
            .select({ id: whatsappMessages.id })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.externalMessageId, m.id))
            .limit(1);
          if (dup[0]) continue;
          await db.insert(whatsappMessages).values({
            threadId: thread.id,
            externalMessageId: m.id,
            direction: m.fromMe ? 'outbound' : 'inbound',
            contentType: m.type,
            body: m.body,
            ackStatus: m.fromMe ? 2 : null,
            senderName: m.fromMe ? 'Consultor UaZapi' : m.senderName || ch.name || ch.phone,
            createdAt: new Date(m.timestampMs),
          });
          await mirrorCommunicationToProspection({
            unitId: thread.unitId,
            phone: thread.contactPhone,
            contactName: thread.contactName,
            channel: 'whatsapp_uazapi',
            provider: 'uazapi',
            threadId: thread.id,
            direction: m.fromMe ? 'outbound' : 'inbound',
            contentType: m.type === 'audio' ? 'audio' : m.type === 'image' ? 'image' : m.type === 'document' ? 'document' : 'text',
            body: m.body,
            authorName: m.fromMe ? 'Consultor UaZapi' : m.senderName || thread.contactName,
            externalMessageId: m.id,
            timestamp: new Date(m.timestampMs),
            triggerIviAutoSummarize: false,
          });
          messagesSynced++;
        }
      }

      res.json({ ok: true, chatsFound: chats.length, threadsSynced, messagesSynced });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro ao sincronizar chats UaZapi.' });
    }
  });

  // Webhook Oficial UaZapi V2 (suporta /api/integrations/uazapi/webhook e /api/uazapi/webhook/:p1?/:p2?)
  const handleUazapiWebhook = async (req: express.Request, res: express.Response) => {
    try {
      await ensureInitialSeed();
      const body = (req.body || {}) as Record<string, unknown>;
      const instanceCandidate =
        String(
          body.instanceId ||
            body.instance ||
            body.instanceName ||
            (body.data as Record<string, unknown> | undefined)?.instance ||
            ''
        ).trim() || null;

      const creds = await resolveUazapiCredentials({ instanceId: instanceCandidate });
      const envSecret = getUazapiWebhookSecret();
      const expectedTokens = [envSecret, creds?.token].filter((v): v is string => Boolean(v));

      if (expectedTokens.length > 0) {
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
        const providedToken =
          (typeof req.query.token === 'string' ? req.query.token.trim() : undefined) ||
          (req.headers['x-webhook-token'] as string | undefined) ||
          (req.headers['x-uazapi-token'] as string | undefined) ||
          (req.headers['token'] as string | undefined) ||
          bearerToken ||
          null;
        const authorized = expectedTokens.some((expected) => timingSafeEqualStr(providedToken, expected));
        if (!authorized) {
          return res.status(401).json({ error: 'Token webhook UaZapi inválido.' });
        }
      }

      markUazapiWebhookReceived();

      const eventType = String(body.EventType || body.event || body.type || req.params.p1 || 'messages').toLowerCase();
      const rawData = body.message || body.data || body;

      // 1. Connection update
      if (eventType === 'connection') {
        const st = (body.status || rawData || {}) as Record<string, unknown>;
        const connected = st.connected === true || st.loggedIn === true || String(body.state || '').toLowerCase() === 'open';
        if (creds?.dbId) {
          await db
            .update(unitWhatsappCredentials)
            .set({ isConnected: connected, updatedAt: new Date() })
            .where(eq(unitWhatsappCredentials.id, creds.dbId));
        }
        return res.status(200).json({ ok: true, event: 'connection', connected });
      }

      // 2. Delivery / Read ACK / Revoke update (messages_update / status)
      if (eventType === 'messages_update' || eventType === 'status' || eventType === 'message_status' || eventType === 'messages.update') {
        const items = Array.isArray(rawData) ? rawData : [rawData];
        for (const item of items as Array<Record<string, unknown>>) {
          const extId = String(
            item.messageid || item.id || (item.key as Record<string, unknown> | undefined)?.id || ''
          ).trim();
          if (!extId) continue;

          const statusStr = String(item.status || item.type || item.state || '').toUpperCase();
          if (statusStr.includes('REVOKE') || statusStr.includes('DELETE') || item.deleted === true) {
            await db
              .update(whatsappMessages)
              .set({ deletedInOrigin: true })
              .where(eq(whatsappMessages.externalMessageId, extId));
            broadcast('whatsapp:revoked', { externalMessageId: extId });
            continue;
          }

          const ackVal = parseAckValue(item.ack ?? item.status ?? statusStr);
          if (ackVal !== null) {
            const updated = await db
              .update(whatsappMessages)
              .set({ ackStatus: ackVal })
              .where(eq(whatsappMessages.externalMessageId, extId))
              .returning();
            if (updated[0]) {
              broadcast('whatsapp:ack', { messageId: updated[0].id, ackStatus: ackVal });
            }
          }
        }
        return res.status(200).json({ ok: true, event: 'messages_update' });
      }

      // 2B. Incoming / Status Call Event (UaZapi calls)
      if (eventType === 'call' || eventType === 'calls' || eventType === 'call.upsert') {
        const callItems = Array.isArray(rawData) ? rawData : [rawData];
        for (const cItem of callItems as Array<Record<string, unknown>>) {
          const chatId = String(cItem.chatid || cItem.from || cItem.to || '').trim();
          const phoneDigits = (chatId ? chatId.split('@')[0] : String(cItem.phone || cItem.number || '')).replace(/\D/g, '');
          if (!normalizePhone(phoneDigits)) continue;
          const callIdStr = String(cItem.callId || cItem.id || `uaz-wh-${Date.now()}`).trim();
          const callStatus = String(cItem.status || 'ended').toLowerCase();
          const isVideo = cItem.isVideo === true;
          const recUrl = String(cItem.recordingUrl || cItem.fileURL || cItem.audioUrl || '').trim();
          const durSec = Number(cItem.duration || cItem.durationSeconds || 0);
          const contactNameCall = String(cItem.senderName || cItem.pushName || phoneDigits).trim();
          const resolvedUnit = creds?.unitId || 1;
          const allThreads = await db.select().from(whatsappThreads);
          const matchedThread = allThreads.find((t) => phonesMatchBR(t.contactPhone, phoneDigits) && t.provider === 'uazapi');

          let recSha = '';
          let recUri = '';
          let recMime = '';
          let recName = '';
          let audioTrans = '';
          if (recUrl) {
            const downloaded = await downloadMediaToBucket(recUrl, {
              folderPath: `bucketdainvicta/U${resolvedUnit}/CALLS/UAZAPI`,
              fileName: `uazapi-call-${callIdStr}.ogg`,
              fallbackMime: 'audio/ogg',
            });
            if (downloaded) {
              recSha = downloaded.sha256Hash;
              recUri = downloaded.storageUri;
              recMime = downloaded.mimeType;
              recName = `uazapi-call-${callIdStr}.ogg`;
              const tRes = await iviTranscribeAudioNote(downloaded.dataUri, downloaded.mimeType);
              audioTrans = tRes.transcript;
            }
          }

          const [cLog] = await db
            .insert(whatsappCallLogs)
            .values({
              unitId: resolvedUnit,
              threadId: matchedThread?.id ?? null,
              callId: callIdStr,
              direction: cItem.fromMe === true ? 'outbound' : 'inbound',
              fromNumber: String(cItem.from || phoneDigits),
              toNumber: String(cItem.to || phoneDigits),
              callType: isVideo ? 'video' : 'voice',
              status: callStatus || 'ended',
              durationSeconds: durSec,
              provider: 'uazapi',
              recordingSha256: recSha,
              recordingStorageUri: recUri,
              recordingMimeType: recMime,
              recordingFileName: recName,
              audioTranscript: audioTrans,
              initiatedByName: cItem.fromMe === true ? 'Operador UaZapi' : contactNameCall,
              endedAt: new Date(),
            })
            .returning();

          const mirroredLead = await mirrorCommunicationToProspection({
            unitId: resolvedUnit,
            phone: phoneDigits,
            contactName: contactNameCall,
            channel: 'whatsapp_uazapi',
            provider: 'uazapi',
            threadId: matchedThread?.id ?? null,
            direction: cItem.fromMe === true ? 'outbound' : 'inbound',
            contentType: recSha ? 'audio' : 'call',
            body: recSha
              ? `[Gravação de Ligação UaZapi]`
              : `[Ligação UaZapi (${callStatus})] ${durSec ? `Duração: ${durSec}s` : 'Registrada na timeline'}`,
            audioTranscript: audioTrans || null,
            callId: callIdStr,
            mediaSha256: recSha || null,
            mediaStorageUri: recUri || null,
            mediaMimeType: recMime || null,
            mediaFileName: recName || null,
            externalMessageId: `call-${callIdStr}`,
            triggerIviAutoSummarize: Boolean(audioTrans),
          });
          if (mirroredLead) {
            await db.update(whatsappCallLogs).set({ leadId: mirroredLead.id }).where(eq(whatsappCallLogs.id, cLog.id));
          }
        }
        return res.status(200).json({ ok: true, event: 'call' });
      }

      // 3. Incoming / Outgoing Messages (messages / message / messages.upsert)
      const items = Array.isArray(rawData) ? rawData : [rawData];
      let firstThreadId: number | null = null;
      let firstMessageId: number | null = null;

      const [allThreads, allClients, firstUnit] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp, unitId: clients.unitId }).from(clients),
        db.select().from(units).orderBy(units.id).limit(1),
      ]);

      for (const m of items as Array<Record<string, unknown>>) {
        const chatId = String(m.chatid || m.jid || (m.key as Record<string, unknown> | undefined)?.remoteJid || '').trim();
        if (chatId.endsWith('@g.us') || m.isGroup === true) continue;

        const extMsgId = String(
          m.messageid || m.id || (m.key as Record<string, unknown> | undefined)?.id || ''
        ).trim() || null;

        if (extMsgId) {
          const dup = await db
            .select({ id: whatsappMessages.id })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.externalMessageId, extMsgId))
            .limit(1);
          if (dup[0]) {
            if (!firstMessageId) firstMessageId = dup[0].id;
            continue;
          }
        }

        const rawPhone = String(
          chatId ? chatId.split('@')[0] : m.phone || m.sender || m.from || body.phone || ''
        ).replace(/\D/g, '');
        const textBody = String(m.text || m.body || m.caption || m.content || '').trim();
        const attachmentUrl = (m.fileURL || m.url || m.mediaUrl || null) as string | null;
        if (!normalizePhone(rawPhone) || (!textBody && !attachmentUrl)) continue;

        const mt = String(m.messageType || m.type || '').toLowerCase();
        const contentType =
          mt.includes('audio') || mt.includes('ptt')
            ? 'audio'
            : mt.includes('image')
            ? 'image'
            : mt.includes('document')
            ? 'document'
            : 'text';
        const fromMe = m.fromMe === true || (m.key as Record<string, unknown> | undefined)?.fromMe === true;
        const direction = fromMe ? 'outbound' : 'inbound';
        const contactName = String(m.senderName || m.pushName || body.pushName || rawPhone).trim();
        const fileName = String(m.fileName || `uazapi-${contentType}-${Date.now()}`);
        const mimeTypeRaw = (m.mimeType || m.mimetype || null) as string | null;
        const preview = (textBody || fileName || `[${contentType.toUpperCase()}]`).slice(0, 70);

        const matchedClient = allClients.find(
          (c) => phonesMatchBR(c.whatsapp, rawPhone) || phonesMatchBR(c.phone, rawPhone)
        );
        const targetInstId = creds?.instanceId || instanceCandidate;
        let thread =
          (targetInstId &&
            allThreads.find(
              (t) =>
                t.provider === 'uazapi' &&
                t.uazapiInstanceId === targetInstId &&
                phonesMatchBR(t.contactPhone, rawPhone)
            )) ||
          allThreads.find((t) => phonesMatchBR(t.contactPhone, rawPhone) && t.provider === 'uazapi');

        if (!thread) {
          const [created] = await db
            .insert(whatsappThreads)
            .values({
              unitId: creds?.unitId || matchedClient?.unitId || firstUnit[0]?.id || 1,
              clientId: matchedClient?.id ?? null,
              contactName,
              contactPhone: normalizePhone(rawPhone) || rawPhone,
              provider: 'uazapi',
              uazapiInstanceId: creds?.instanceId || instanceCandidate,
              lastMessagePreview: preview,
              unreadCount: direction === 'inbound' ? 1 : 0,
              updatedAt: new Date(),
            })
            .returning();
          thread = created;
          allThreads.push(created);
        } else {
          await db
            .update(whatsappThreads)
            .set({
              uazapiInstanceId: creds?.instanceId || instanceCandidate || thread.uazapiInstanceId,
              clientId: thread.clientId ?? matchedClient?.id ?? null,
              lastMessagePreview: preview,
              unreadCount: direction === 'inbound' ? (thread.unreadCount || 0) + 1 : thread.unreadCount,
              updatedAt: new Date(),
            })
            .where(eq(whatsappThreads.id, thread.id));
        }

        let downloadedMedia: Awaited<ReturnType<typeof downloadMediaToBucket>> = null;
        if (attachmentUrl) {
          downloadedMedia = await downloadMediaToBucket(attachmentUrl, {
            folderPath: `bucketdainvicta/U${thread.unitId}/WHATSAPP/T${thread.id}`,
            fileName: `${fileName}${fileName.includes('.') ? '' : contentType === 'audio' ? '.ogg' : '.bin'}`,
            fallbackMime: mimeTypeRaw || (contentType === 'audio' ? 'audio/ogg' : 'application/octet-stream'),
          });
        }

        let iviTranscript: string | null = null;
        if (contentType === 'audio') {
          const resT = await iviTranscribeAudioNote(
            downloadedMedia?.dataUri || textBody || fileName || 'Áudio recebido via UaZapi',
            downloadedMedia?.mimeType || mimeTypeRaw || 'audio/ogg'
          );
          iviTranscript = resT.transcript;
        }

        const [msg] = await db
          .insert(whatsappMessages)
          .values({
            threadId: thread.id,
            externalMessageId: extMsgId,
            direction,
            contentType,
            body: textBody || fileName || '[Mídia UaZapi]',
            attachmentUrl: downloadedMedia
              ? `/api/bucket/objects/${downloadedMedia.sha256Hash}?name=${encodeURIComponent(fileName)}&mime=${encodeURIComponent(downloadedMedia.mimeType)}&preview=1`
              : attachmentUrl,
            attachmentName: fileName,
            attachmentMimeType: downloadedMedia?.mimeType || mimeTypeRaw,
            mediaSha256: downloadedMedia?.sha256Hash || null,
            mediaStorageUri: downloadedMedia?.storageUri || null,
            iviAudioTranscript: iviTranscript,
            ackStatus: fromMe ? parseAckValue(m.ack ?? m.status) ?? 1 : null,
            senderName: direction === 'inbound' ? contactName : 'Consultor UaZapi',
          })
          .returning();

        const mirroredLead = await mirrorCommunicationToProspection({
          unitId: thread.unitId,
          phone: rawPhone,
          contactName,
          channel: 'whatsapp_uazapi',
          provider: 'uazapi',
          threadId: thread.id,
          direction,
          contentType,
          body: textBody || fileName || '[Mídia UaZapi]',
          audioTranscript: iviTranscript,
          authorName: direction === 'inbound' ? contactName : 'Consultor UaZapi',
          externalMessageId: extMsgId || `uaz-msg-${msg.id}`,
          mediaSha256: downloadedMedia?.sha256Hash || null,
          mediaStorageUri: downloadedMedia?.storageUri || null,
          mediaMimeType: downloadedMedia?.mimeType || mimeTypeRaw,
          mediaFileName: fileName,
          triggerIviAutoSummarize: direction === 'inbound' || contentType === 'audio',
        });

        if (downloadedMedia) {
          await db.insert(communicationArchives).values({
            unitId: thread.unitId,
            leadId: mirroredLead?.id ?? null,
            threadId: thread.id,
            provider: 'uazapi',
            archiveType: contentType === 'audio' ? 'audio_message' : 'conversation_snapshot',
            contactName,
            contactPhone: normalizePhone(rawPhone) || rawPhone,
            fileName,
            mimeType: downloadedMedia.mimeType,
            sizeBytes: downloadedMedia.sizeBytes,
            sha256Hash: downloadedMedia.sha256Hash,
            storageUri: downloadedMedia.storageUri,
            transcriptText: iviTranscript || textBody || '',
            createdByName: 'Webhook UaZapi',
          });
        }

        if (!firstThreadId) firstThreadId = thread.id;
        if (!firstMessageId) firstMessageId = msg.id;
        broadcast('whatsapp:message', msg);
      }

      if (!firstMessageId) {
        return res.status(400).json({ error: 'Payload UaZapi inválido: telefone e conteúdo são obrigatórios.' });
      }
      return res.json({ ok: true, received: true, threadId: firstThreadId, messageId: firstMessageId });
    } catch (error) {
      console.error('UaZapi webhook error:', error);
      return res.status(500).json({ error: 'Erro ao processar webhook UaZapi.' });
    }
  };

  app.post('/api/integrations/uazapi/webhook', handleUazapiWebhook);
  app.post('/api/uazapi/webhook', handleUazapiWebhook);
  app.post('/api/uazapi/webhook/:p1', handleUazapiWebhook);
  app.post('/api/uazapi/webhook/:p1/:p2', handleUazapiWebhook);

  app.post('/api/integrations/uazapi/test-webhook', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const port = process.env.PORT || 3000;
      const localUrl = `http://127.0.0.1:${port}/api/integrations/uazapi/webhook`;
      const creds = await resolveUazapiCredentials({ unitId: req.activeUnitId });
      const activeSecret = getUazapiWebhookSecret() || creds?.token || null;
      const testExtId = `uaz_selftest_${Date.now()}`;
      const testPhone = '5581999990088';

      let unauthorizedBlocked: boolean | null = null;
      if (activeSecret) {
        const unauthResp = await fetch(localUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'messages', data: { chatid: `${testPhone}@s.whatsapp.net`, text: 'probe' } }),
        });
        unauthorizedBlocked = unauthResp.status === 401;
      }

      const authedUrl = activeSecret ? `${localUrl}?token=${encodeURIComponent(activeSecret)}` : localUrl;
      const msgResp = await fetch(authedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'messages',
          instance: creds?.instanceId || 'default',
          data: {
            messageid: testExtId,
            chatid: `${testPhone}@s.whatsapp.net`,
            fromMe: true,
            text: '[SelfTest] Verificação webhook UaZapi V2',
            messageType: 'conversation',
            senderName: 'SelfTest UaZapi',
          },
        }),
      });
      const msgJson = (await msgResp.json().catch(() => ({}))) as { ok?: boolean; threadId?: number; messageId?: number; error?: string };
      if (!msgResp.ok || !msgJson.ok) {
        return res.status(502).json({ ok: false, error: msgJson.error || `HTTP ${msgResp.status}` });
      }

      const ackResp = await fetch(authedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'messages_update', data: { messageid: testExtId, ack: 3 } }),
      });

      const revResp = await fetch(authedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'messages_update', data: { messageid: testExtId, status: 'REVOKED' } }),
      });

      const savedRows = await db
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.externalMessageId, testExtId))
        .limit(1);
      const verifiedAck = savedRows[0]?.ackStatus === 3;
      const verifiedRevoke = savedRows[0]?.deletedInOrigin === true;

      if (msgJson.messageId) {
        await db.delete(whatsappMessages).where(eq(whatsappMessages.id, msgJson.messageId));
      }
      if (msgJson.threadId) {
        const remaining = await db
          .select({ value: count() })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.threadId, msgJson.threadId));
        if (Number(remaining[0]?.value || 0) === 0) {
          await db.delete(whatsappThreads).where(eq(whatsappThreads.id, msgJson.threadId));
        }
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UAZAPI_WEBHOOK_SELF_TEST',
        entityType: 'integration',
        entityId: 'uazapi_webhook',
        details: { ok: true, unauthorizedBlocked, ackOk: ackResp.ok && verifiedAck, revokeOk: revResp.ok && verifiedRevoke },
        unitId: req.activeUnitId,
      });

      res.json({
        ok: true,
        checks: {
          secretProtection: activeSecret ? (unauthorizedBlocked ? 'Ativa (401 sem token)' : 'Falha na proteção') : 'Sem token ativo',
          messageIngestion: msgResp.ok,
          ackUpdate: ackResp.ok && verifiedAck,
          immutableRevoke: revResp.ok && verifiedRevoke,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Erro no autoteste UaZapi.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7C. LIGAÇÕES DE VOZ/VÍDEO VIA UAZAPI (HISTÓRICO, DISCAGEM E ENCERRAMENTO)
  // ---------------------------------------------------------------------------
  app.get('/api/whatsapp/uazapi/calls', requireAuth, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId ? Number(req.query.clientId) : null;
      const phoneQuery = typeof req.query.phone === 'string' ? req.query.phone : '';
      const threadIdQuery = req.query.threadId ? Number(req.query.threadId) : null;

      let targetPhones: string[] = [];
      let threadIds: number[] = [];

      if (clientId && Number.isFinite(clientId)) {
        const [clientRows, clientThreadRows] = await Promise.all([
          db.select().from(clients).where(eq(clients.id, clientId)).limit(1),
          db.select().from(whatsappThreads).where(eq(whatsappThreads.clientId, clientId)),
        ]);
        const cl = clientRows[0];
        if (cl?.whatsapp) targetPhones.push(cl.whatsapp);
        if (cl?.phone) targetPhones.push(cl.phone);
        for (const th of clientThreadRows) {
          threadIds.push(th.id);
          if (th.contactPhone) targetPhones.push(th.contactPhone);
        }
      }
      if (phoneQuery) targetPhones.push(phoneQuery);
      if (threadIdQuery && Number.isFinite(threadIdQuery)) threadIds.push(threadIdQuery);

      const tailDigits = Array.from(
        new Set(
          targetPhones
            .map((p) => p.replace(/\D/g, '').slice(-8))
            .filter((d) => d.length >= 8)
        )
      );
      const threadIdSet = new Set(threadIds);

      const [allLogs, instances] = await Promise.all([
        db.select().from(whatsappCallLogs).orderBy(desc(whatsappCallLogs.createdAt)).limit(200),
        listSanitizedUazapiInstances(),
      ]);

      const filteredLogs = allLogs.filter((l) => {
        if (l.threadId && threadIdSet.has(l.threadId)) return true;
        const toTail = String(l.toNumber || '').replace(/\D/g, '').slice(-8);
        return toTail.length >= 8 && tailDigits.includes(toTail);
      });

      res.json({
        calls: filteredLogs.slice(0, 30),
        instances: instances.filter((i) => i.active !== false),
        envConfigured: Boolean(process.env.UAZAPI_TOKEN?.trim()),
      });
    } catch (error) {
      console.error('Load Uazapi calls error:', error);
      res.status(500).json({ error: 'Erro ao carregar histórico de ligações via Uazapi.' });
    }
  });

  app.post('/api/whatsapp/uazapi/calls/start', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        clientId?: number | null;
        threadId?: number | null;
        phone?: string;
        isVideo?: boolean;
        instanceId?: string | null;
      };

      const clientRow = body.clientId
        ? (await db.select().from(clients).where(eq(clients.id, Number(body.clientId))).limit(1))[0]
        : undefined;
      const threadRow = body.threadId
        ? (await db.select().from(whatsappThreads).where(eq(whatsappThreads.id, Number(body.threadId))).limit(1))[0]
        : undefined;

      const rawPhone = String(
        body.phone || threadRow?.contactPhone || clientRow?.whatsapp || clientRow?.phone || ''
      ).trim();
      const normalizedNumber = toGotalkPhone(rawPhone);
      if (!normalizedNumber || normalizedNumber.length < 10) {
        return res.status(400).json({
          ok: false,
          error: 'Informe um telefone válido com DDD para realizar a ligação via Uazapi.',
        });
      }

      const unitId = threadRow?.unitId || clientRow?.unitId || req.activeUnitId || 1;
      const creds = await resolveUazapiCredentials({
        instanceId: body.instanceId || threadRow?.uazapiInstanceId || null,
        unitId,
        groupId: req.authUser?.groupId ?? null,
        moduleId: 'collection',
      });

      const isVideo = Boolean(body.isVideo);
      const callResult = await makeUazapiCall(creds, normalizedNumber, isVideo);

      const [callLog] = await db
        .insert(whatsappCallLogs)
        .values({
          unitId,
          threadId: threadRow?.id ?? null,
          callId: callResult.callId || '',
          direction: 'outbound',
          fromNumber: creds?.label || creds?.instanceId || '',
          toNumber: normalizedNumber,
          callType: isVideo ? 'video' : 'voice',
          status: callResult.dispatched ? 'initiated' : 'failed',
          provider: 'uazapi',
          errorDetail: callResult.dispatched ? '' : callResult.detail,
          initiatedByName: req.authUser!.name,
        })
        .returning();

      if (callResult.dispatched && threadRow) {
        const [callMsg] = await db
          .insert(whatsappMessages)
          .values({
            threadId: threadRow.id,
            externalMessageId: callResult.callId || `uaz-call-${callLog.id}`,
            direction: 'outbound',
            contentType: 'text',
            body: `📞 Ligação ${isVideo ? 'de vídeo' : 'de voz'} via Uazapi iniciada por ${req.authUser!.name} para ${normalizedNumber}.`,
            ackStatus: 1,
            operatorName: req.authUser!.name,
            senderName: req.authUser!.name,
          })
          .returning();

        await db
          .update(whatsappThreads)
          .set({
            lastMessagePreview: `📞 Ligação via Uazapi (${normalizedNumber})`,
            updatedAt: new Date(),
          })
          .where(eq(whatsappThreads.id, threadRow.id));

        broadcast('whatsapp:message', callMsg);
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: callResult.dispatched ? 'UAZAPI_CALL_INITIATED' : 'UAZAPI_CALL_FAILED',
        entityType: clientRow ? 'client' : 'whatsapp_call',
        entityId: String(clientRow?.id || callLog.id),
        details: {
          clientId: clientRow?.id ?? null,
          threadId: threadRow?.id ?? null,
          toNumber: normalizedNumber,
          callType: isVideo ? 'video' : 'voice',
          instanceId: creds?.instanceId || null,
          callId: callResult.callId,
          dispatched: callResult.dispatched,
          detail: callResult.detail,
        },
        unitId,
      });

      if (!callResult.dispatched) {
        return res.status(400).json({
          ok: false,
          error: callResult.detail,
          call: callLog,
          result: callResult,
        });
      }

      return res.json({
        ok: true,
        call: callLog,
        result: callResult,
      });
    } catch (error) {
      console.error('Start Uazapi call error:', error);
      res.status(500).json({ ok: false, error: 'Erro ao iniciar ligação via Uazapi.' });
    }
  });

  app.post('/api/whatsapp/uazapi/calls/:id/terminate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const logId = parsePositiveIntId(req.params.id);
      if (!logId) return res.status(400).json({ ok: false, error: 'ID de ligação inválido.' });
      const rows = await db
        .select()
        .from(whatsappCallLogs)
        .where(eq(whatsappCallLogs.id, logId))
        .limit(1);
      const callRow = rows[0];
      if (!callRow) {
        return res.status(404).json({ ok: false, error: 'Registro de ligação não encontrado.' });
      }
      if (!isUnitPermitted(req, callRow.unitId)) {
        return res.status(403).json({ ok: false, error: 'Sem permissão para encerrar ligação desta unidade.' });
      }

      const creds = await resolveUazapiCredentials({
        unitId: callRow.unitId,
        groupId: req.authUser?.groupId ?? null,
        moduleId: 'collection',
      });

      const terminateResult = callRow.callId
        ? await terminateUazapiCall(creds, callRow.callId)
        : { ok: true, detail: 'Ligação encerrada localmente.' };

      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - new Date(callRow.createdAt).getTime()) / 1000)
      );

      const [updated] = await db
        .update(whatsappCallLogs)
        .set({
          status: 'ended',
          durationSeconds,
          endedAt: new Date(),
        })
        .where(eq(whatsappCallLogs.id, callRow.id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UAZAPI_CALL_TERMINATED',
        entityType: 'whatsapp_call',
        entityId: String(callRow.id),
        details: {
          callId: callRow.callId,
          toNumber: callRow.toNumber,
          durationSeconds,
          remoteTerminateOk: terminateResult.ok,
        },
        unitId: callRow.unitId,
      });

      res.json({ ok: true, call: updated, terminateResult });
    } catch (error) {
      console.error('Terminate Uazapi call error:', error);
      res.status(500).json({ ok: false, error: 'Erro ao encerrar ligação via Uazapi.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. CONFIGURAÇÕES, RBAC, IMPORTAÇÃO, QUADRO DE HORÁRIOS & CONSOLE SQL ADMIN
  // ---------------------------------------------------------------------------
  app.get('/api/config', requireAuth, requireModule('config'), async (req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      const isAdmin = req.authUser!.role === 'admin';
      const allowedUnits = getAllowedUnitIds(req);
      const [allUnits, allGroups, allUsers, schedules, fields, categories, settings, logs, channels, operators, templates] = await Promise.all([
        db.select().from(units).orderBy(units.id),
        db.select().from(userGroups).orderBy(userGroups.id),
        db.select({ id: users.id, uid: users.uid, email: users.email, name: users.name, role: users.role, groupId: users.groupId, defaultUnitId: users.defaultUnitId, allowedUnitIds: users.allowedUnitIds, documentPermissionOverrides: users.documentPermissionOverrides, active: users.active, whatsappPhone: users.whatsappPhone, points: users.points }).from(users),
        db.select().from(workSchedules).orderBy(workSchedules.id),
        db.select().from(customFields).orderBy(customFields.id),
        db.select().from(paymentCategories).orderBy(paymentCategories.id),
        db.select().from(systemSettings),
        db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40),
        db.select({ id: gotalkChannels.id, name: gotalkChannels.name, phoneNumber: gotalkChannels.phoneNumber, unitId: gotalkChannels.unitId, notes: gotalkChannels.notes, isPrimary: gotalkChannels.isPrimary, isActive: gotalkChannels.isActive }).from(gotalkChannels).orderBy(gotalkChannels.id),
        db.select().from(gotalkOperators).orderBy(gotalkOperators.id),
        db.select().from(gotalkHsmTemplates).orderBy(gotalkHsmTemplates.templateName),
      ]);
      const iviConfig = await getIviChainConfig();
      const gotalkConfig = {
        ...getGotalkStatus(),
        channelsCount: channels.length,
        operatorsCount: operators.length,
        templatesCount: templates.length,
      };
      const uazapiInstances = isAdmin ? await listSanitizedUazapiInstances() : [];
      const uazapiRuntime = getUazapiGlobalRuntimeState();
      const uazapiConfig = {
        configured: uazapiRuntime.envConfigured || uazapiInstances.length > 0,
        serverUrl: isAdmin ? uazapiInstances[0]?.uazapiServerUrl || uazapiRuntime.defaultServerUrl : '',
        instancesCount: uazapiInstances.length,
        instances: uazapiInstances,
        ...uazapiRuntime,
      };
      const safeSettings = Object.fromEntries(
        settings
          .filter((s) => !/(secret|token|password|api_?key|private|credential)/i.test(s.key))
          .map((s) => [s.key, s.value])
      );
      res.json({
        units: allowedUnits === null ? allUnits : allUnits.filter((u) => allowedUnits.includes(u.id)),
        groups: allGroups,
        users: isAdmin
          ? allUsers
          : allUsers.map((u) => ({
              ...u,
              whatsappPhone: u.id === req.authUser!.id ? u.whatsappPhone : '',
            })),
        schedules: isAdmin ? schedules : schedules.filter((s) => s.unitId === null || (allowedUnits && allowedUnits.includes(s.unitId))),
        customFields: fields,
        paymentCategories: categories,
        settings: safeSettings,
        iviConfig,
        gotalkConfig,
        gotalkResources: isAdmin ? { channels, operators, templates } : { channels: [], operators: [], templates: [] },
        uazapiConfig,
        auditLogs: isAdmin ? logs : logs.filter((l) => l.unitId === null || (allowedUnits && allowedUnits.includes(l.unitId))),
      });
    } catch (error) {
      console.error('Config get error:', error);
      res.status(500).json({ error: 'Erro ao carregar configurações.' });
    }
  });

  app.post('/api/config/units', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id: rawId, minAdmissionCostCents, phone, address, active } = req.body as {
        id: number;
        minAdmissionCostCents: number;
        phone?: string;
        address?: string;
        active?: boolean;
      };
      const id = parsePositiveIntId(rawId);
      if (!id) return res.status(400).json({ error: 'ID de unidade inválido.' });
      const costNum = parseFiniteNumber(minAdmissionCostCents);
      if (costNum === null || costNum < 0) {
        return res.status(400).json({ error: 'Custo mínimo de admissão inválido.' });
      }
      const [updated] = await db
        .update(units)
        .set({ minAdmissionCostCents: Math.round(costNum), ...(phone !== undefined ? { phone } : {}), ...(address !== undefined ? { address } : {}), ...(active !== undefined ? { active } : {}) })
        .where(eq(units.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Unidade não encontrada.' });
      res.json({ unit: updated });
    } catch (error) {
      console.error('Update unit error:', error);
      res.status(500).json({ error: 'Erro ao atualizar unidade.' });
    }
  });

  app.post('/api/config/schedules', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { targetType, targetId, targetLabel, startTime, endTime, allowedDays } = req.body as {
        targetType: string;
        targetId: number;
        targetLabel: string;
        startTime: string;
        endTime: string;
        allowedDays: number[];
      };
      const [schedule] = await db
        .insert(workSchedules)
        .values({ targetType, targetId, targetLabel, startTime, endTime, allowedDays })
        .returning();
      res.json({ schedule });
    } catch (error) {
      console.error('Create schedule error:', error);
      res.status(500).json({ error: 'Erro ao salvar quadro de horários.' });
    }
  });

  app.post('/api/config/custom-fields', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { module, fieldKey, label, fieldType } = req.body as {
        module: string;
        fieldKey: string;
        label: string;
        fieldType: string;
      };
      const [field] = await db.insert(customFields).values({ module, fieldKey, label, fieldType }).returning();
      res.json({ field });
    } catch (error) {
      console.error('Create custom field error:', error);
      res.status(500).json({ error: 'Erro ao criar campo customizado.' });
    }
  });

  app.post('/api/config/payment-categories', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, providerCode } = req.body as { name: string; providerCode?: string };
      const [cat] = await db.insert(paymentCategories).values({ name, providerCode: providerCode || 'custom' }).returning();
      res.json({ category: cat });
    } catch (error) {
      console.error('Create payment category error:', error);
      res.status(500).json({ error: 'Erro ao criar categoria de pagamento.' });
    }
  });

  app.post('/api/config/settings', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { key, value } = req.body as { key: string; value: Record<string, unknown> };
      const [row] = await db
        .insert(systemSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } })
        .returning();
      res.json({ setting: row });
    } catch (error) {
      console.error('Update setting error:', error);
      res.status(500).json({ error: 'Erro ao atualizar configuração.' });
    }
  });

  app.post('/api/config/groups/:id/permissions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de grupo inválido.' });
      const { modulePermissions, fieldPermissions } = req.body as {
        modulePermissions: Record<string, boolean>;
        fieldPermissions: Record<string, Record<string, 'edit' | 'read' | 'hidden'>>;
      };
      const [updated] = await db
        .update(userGroups)
        .set({ modulePermissions, fieldPermissions })
        .where(eq(userGroups.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Grupo não encontrado.' });
      res.json({ group: updated });
    } catch (error) {
      console.error('Update group permissions error:', error);
      res.status(500).json({ error: 'Erro ao salvar permissões.' });
    }
  });

  app.post('/api/config/users/:id/revoke-sessions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de usuário inválido.' });
      const [updated] = await db
        .update(users)
        .set({ sessionVersion: sql`${users.sessionVersion} + 1`, lockedUntil: null, failedLoginAttempts: 0 })
        .where(eq(users.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Usuário não encontrado.' });
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'REVOKE_USER_SESSIONS',
        entityType: 'user',
        entityId: String(id),
        details: { targetEmail: updated.email },
      });
      res.json({ ok: true, sessionVersion: updated.sessionVersion });
    } catch (error) {
      console.error('Revoke session error:', error);
      res.status(500).json({ error: 'Erro ao revogar sessões.' });
    }
  });

  // PRD FR-15 / AC-03: Dry-run preview checking duplicates & disambiguating unit names before import
  app.post('/api/import/preview', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { rows } = req.body as {
        rows: Array<{ fullName: string; cpfCnpj: string; phone?: string; email?: string; city?: string; state?: string; unitName?: string }>;
      };
      if (!Array.isArray(rows)) return res.status(400).json({ error: 'Payload inválido.' });
      const [existingClients, allUnits] = await Promise.all([db.select().from(clients), db.select().from(units)]);
      const existingCpfs = new Set(existingClients.map((c) => c.cpfCnpj.replace(/\D/g, '')));

      const evaluated = rows.map((r, idx) => {
        const cleanCpf = (r.cpfCnpj || '').replace(/\D/g, '');
        const issues: string[] = [];
        if (!r.fullName?.trim()) issues.push('Nome obrigatório ausente');
        if (cleanCpf.length < 11) issues.push('CPF/CNPJ inválido');
        if (existingCpfs.has(cleanCpf)) issues.push('CPF/CNPJ já cadastrado no banco (será ignorado/preservado)');

        let resolvedUnitId = req.activeUnitId || 1;
        if (r.unitName?.trim()) {
          const matches = allUnits.filter((u) => u.name.toLowerCase() === r.unitName!.trim().toLowerCase());
          if (matches.length === 1) resolvedUnitId = matches[0].id;
          else if (matches.length === 0) issues.push(`Unidade "${r.unitName}" não localizada (desambiguação necessária)`);
          else issues.push(`Unidade "${r.unitName}" ambígua`);
        }

        return {
          rowNumber: idx + 1,
          ...r,
          resolvedUnitId,
          valid: issues.length === 0,
          issues,
        };
      });

      res.json({
        total: evaluated.length,
        validCount: evaluated.filter((e) => e.valid).length,
        conflictCount: evaluated.filter((e) => !e.valid).length,
        rows: evaluated,
      });
    } catch (error) {
      console.error('Import preview error:', error);
      res.status(500).json({ error: 'Erro na pré-validação.' });
    }
  });

  // Bulk CSV/JSON Import
  app.post('/api/import', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { rows } = req.body as { rows: Array<{ fullName: string; cpfCnpj: string; phone?: string; email?: string; city?: string; state?: string; unitId?: number }> };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'Nenhum registro enviado para importação.' });
      }
      let imported = 0;
      for (const r of rows.slice(0, 100)) {
        if (!r.fullName || !r.cpfCnpj) continue;
        await db
          .insert(clients)
          .values({
            fullName: r.fullName,
            cpfCnpj: r.cpfCnpj,
            phone: r.phone || '',
            email: r.email || '',
            city: r.city || '',
            state: r.state || '',
            unitId: r.unitId || req.activeUnitId || 1,
          })
          .onConflictDoNothing({ target: clients.cpfCnpj });
        imported++;
      }
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DATA_IMPORT',
        entityType: 'clients',
        entityId: String(imported),
        details: { importedRows: imported },
        unitId: req.activeUnitId,
      });
      res.json({ imported });
    } catch (error) {
      console.error('Import error:', error);
      res.status(500).json({ error: 'Erro na importação em lote.' });
    }
  });

  // PRD FR-18 / AC-05: Admin scoped operational export (compatible with Excel, NOT full DB dump)
  app.get('/api/export', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const table = String(req.query.table || 'clients');
      const unitId = req.activeUnitId || 1;
      let headers: string[] = [];
      let lines: string[][] = [];

      if (table === 'clients') {
        const rows = await db.select().from(clients).where(eq(clients.unitId, unitId));
        headers = ['ID', 'Nome Completo', 'CPF/CNPJ', 'Telefone', 'E-mail', 'Cidade', 'UF', 'Status'];
        lines = rows.map((r) => [String(r.id), r.fullName, r.cpfCnpj, r.phone, r.email, r.city, r.state, r.status]);
      } else if (table === 'admissions') {
        const rows = await db.select().from(admissions).where(eq(admissions.unitId, unitId));
        headers = ['ID', 'Protocolo', 'ID Cliente', 'Segmento', 'Banco', 'Contrato', 'Valor Divida (R$)', 'Status'];
        lines = rows.map((r) => [String(r.id), r.protocolCode, String(r.clientId), r.debtType, r.bankName, r.contractNumber, (r.debtAmountCents / 100).toFixed(2), r.status]);
      } else if (table === 'financial_titles') {
        const rows = await db.select().from(financialTitles).where(eq(financialTitles.unitId, unitId));
        headers = ['ID', 'Codigo Titulo', 'ID Cliente', 'Parcela', 'Valor (R$)', 'Vencimento', 'Status'];
        lines = rows.map((r) => [String(r.id), r.titleCode, String(r.clientId), `${r.installmentNumber}/${r.totalInstallments}`, (r.amountCents / 100).toFixed(2), new Date(r.dueDate).toISOString().slice(0, 10), r.status]);
      } else if (table === 'legal_processes') {
        const rows = await db.select().from(legalProcesses).where(eq(legalProcesses.unitId, unitId));
        headers = ['ID', 'Numero Processo', 'ID Cliente', 'Vara/Tribunal', 'Tipo Acao', 'Busca e Apreensao', 'Status'];
        lines = rows.map((r) => [String(r.id), r.processNumber, String(r.clientId), r.courtName, r.actionType, r.hasSearchSeizure ? 'SIM' : 'NAO', r.status]);
      } else {
        return res.status(400).json({ error: 'Tabela fora da whitelist de exportação.' });
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'PARTIAL_EXCEL_CSV_EXPORT',
        entityType: table,
        entityId: String(lines.length),
        details: { unitId, scope: 'unit_scoped_partial_export' },
        unitId,
      });

      const csv = [headers, ...lines]
        .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(';'))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="financepro_${table}_U${unitId}.csv"`);
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Erro na exportação administrativa.' });
    }
  });

  // Admin-only Interactive PostgreSQL Console
  app.post('/api/admin/sql', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { queryText } = req.body as { queryText: string };
      const clean = (queryText || '').trim();
      if (!clean) return res.status(400).json({ error: 'Informe uma instrução SQL.' });
      if (/\b(DROP|TRUNCATE|ALTER\s+DATABASE|GRANT|REVOKE)\b/i.test(clean)) {
        return res.status(400).json({ error: 'Comandos DDL destrutivos bloqueados no console interativo.' });
      }
      const start = Date.now();
      const result = await pool.query(clean);
      const durationMs = Date.now() - start;

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'ADMIN_SQL_CONSOLE',
        entityType: 'postgresql',
        entityId: 'query',
        details: { sqlPreview: clean.slice(0, 120), rowCount: result.rowCount },
      });

      res.json({
        columns: result.fields.map((f) => f.name),
        rows: result.rows.slice(0, 200),
        rowCount: result.rowCount,
        durationMs,
      });
    } catch (error) {
      res.status(400).json({ error: sanitizeErrorMessage(error, 'Erro ao executar instrução SQL.') });
    }
  });

  // Direct Ivi Copilot Route
  app.post('/api/ivi/ask', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { prompt, context } = req.body as { prompt: string; context?: string };
      const result = await runIviOrchestrator(
        `Você é Ivi, assistente operacional do FinancePro Assessoria. Contexto atual: ${context || 'geral'}. Responda em PT-BR com precisão executiva.`,
        prompt
      );
      res.json(result);
    } catch (error) {
      console.error('Ivi ask error:', error);
      res.status(500).json({ error: 'Erro ao consultar Ivi.' });
    }
  });

  registerInternalMessagingRoutes(app, { broadcast });
  registerCadastrosRoutes(app, broadcast);
  registerConfigRoutes(app, { broadcast });
  registerAppointmentsRoutes(app, { broadcast, resolveUazapiCredentials });
  registerFinancialRoutes(app, { broadcast });
  registerAuditRoutes(app, { broadcast });
  registerManagerialRoutes(app);
  registerFormsRoutes(app, { broadcast });
  registerReportsRoutes(app, { broadcast });
  registerCompanyLegalRoutes(app, { broadcast });
  registerDataHubRoutes(app, { broadcast });
  registerMigrationRoutes(app, { broadcast });
  registerUnitFilesRoutes(app, { broadcast, uploadSingleFile: upload.single('file') });
  registerBackupRoutes(app, broadcast);
  registerTrainingDocsRoutes(app);
  registerSantanderRoutes(app, broadcast);
  startBackupScheduler(broadcast, ensureSqlHostProxySocket);

  // Garante resposta JSON em qualquer rota /api inexistente ou erro de middleware (nunca HTML <!doctype>)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota de API não encontrada.' });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      if (res.headersSent) return next(err);
      const errObj = typeof err === 'object' && err !== null ? (err as { status?: number; code?: string }) : {};
      if (errObj.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'O arquivo enviado excede o limite máximo suportado de 500 MB.',
        });
      }
      const status = typeof errObj.status === 'number' ? errObj.status : 500;
      const message = sanitizeErrorMessage(err, 'Erro interno no servidor API.');
      console.error(`API Error [${req.method} ${req.path}]:`, err);
      return res.status(status).json({ error: message });
    }
    return next(err);
  });

  // Non-blocking seed & FEBRABAN catalog sync on startup
  ensureCommonCadastrosSeed()
    .then(() => Promise.all([syncFebrabanBanksFromBrasilApi(), ensureSystemModuleDocsSeed()]))
    .catch(() => {});

  // Vite dev middleware or static dist serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server, path: '/vite-hmr' },
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 300_000;

  server.listen(3000, '0.0.0.0', () => {
    console.log('FinancePro Assessoria server running on http://0.0.0.0:3000');
  });
}

startServer();
