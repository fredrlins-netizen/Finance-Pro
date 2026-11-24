import crypto from 'node:crypto';
import https from 'node:https';
import { URL } from 'node:url';
import QRCode from 'qrcode';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  bankAccountApiConfigs,
  bankAccounts,
  bankMovements,
  chartOfAccounts,
  clients,
  financialTitles,
  santanderEmissionLogs,
  titleSettlements,
  units,
} from '../db/schema.ts';
import { decryptUazapiToken, encryptUazapiToken } from './uazapi.ts';

export const SANTANDER_BOLETO_URLS = {
  sandbox: 'https://trust-sandbox.api.santander.com.br',
  production: 'https://trust-open.api.santander.com.br',
} as const;

export const SANTANDER_PIX_URLS = {
  sandbox: 'https://trust-pix-h.santander.com.br',
  production: 'https://trust-pix.santander.com.br',
} as const;

export type SantanderEnvironment = 'sandbox' | 'production';
export type SantanderExecutionMode = 'live_mtls' | 'homologation_offline';
export type SantanderApiScope = 'boleto' | 'pix';

interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function stripNonDigits(val: string | null | undefined): string {
  return String(val || '').replace(/\D/g, '');
}

function removeAccentsUpper(val: string | null | undefined, maxLen = 40): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 .,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

export function validateSantanderOverrideUrl(rawUrl: string | null | undefined): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL base customizada inválida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('URL base da API Santander deve utilizar HTTPS.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('URL base customizada não pode apontar para endereço privado ou loopback.');
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

export function getBoletoBaseUrl(cfg: { environment: string; boletoBaseUrlOverride?: string | null }): string {
  if (cfg.boletoBaseUrlOverride?.trim()) {
    return validateSantanderOverrideUrl(cfg.boletoBaseUrlOverride);
  }
  return cfg.environment === 'production' ? SANTANDER_BOLETO_URLS.production : SANTANDER_BOLETO_URLS.sandbox;
}

export function getPixBaseUrl(cfg: { environment: string; pixBaseUrlOverride?: string | null }): string {
  if (cfg.pixBaseUrlOverride?.trim()) {
    return validateSantanderOverrideUrl(cfg.pixBaseUrlOverride);
  }
  return cfg.environment === 'production' ? SANTANDER_PIX_URLS.production : SANTANDER_PIX_URLS.sandbox;
}

// =============================================================================
// FEBRABAN 033 (Santander) Barcode / Linha Digitável & BCB EMV Pix CRC16-CCITT
// =============================================================================

function mod10(numStr: string): string {
  let sum = 0;
  let mult = 2;
  for (let i = numStr.length - 1; i >= 0; i--) {
    const prod = Number(numStr[i]) * mult;
    sum += prod > 9 ? Math.floor(prod / 10) + (prod % 10) : prod;
    mult = mult === 2 ? 1 : 2;
  }
  const rem = sum % 10;
  return rem === 0 ? '0' : String(10 - rem);
}

function mod11Barcode(numStr43: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = numStr43.length - 1; i >= 0; i--) {
    sum += Number(numStr43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rem = sum % 11;
  const dv = 11 - rem;
  if (dv === 0 || dv === 10 || dv === 11) return '1';
  return String(dv);
}

function computeDueFactor(dueDate: Date): string {
  const base1997 = Date.UTC(1997, 9, 7);
  const dueUtc = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  let days = Math.floor((dueUtc - base1997) / 86400000);
  // Regra FEBRABAN pós-22/02/2025 (ciclo reiniciado em 1000)
  if (days >= 10000) {
    days = 1000 + ((days - 10000) % 9000);
  }
  if (days < 0) days = 0;
  return String(days).padStart(4, '0').slice(-4);
}

export function buildSantanderFebrabanBarcode(params: {
  covenantCode: string;
  ourNumber: string;
  amountCents: number;
  dueDate: Date;
  walletCode?: string;
}): { barcode: string; digitableLine: string; formattedDigitableLine: string } {
  const bankCode = '033';
  const currency = '9';
  const dueFactor = computeDueFactor(params.dueDate);
  const valueStr = String(Math.max(0, Math.round(params.amountCents))).padStart(10, '0').slice(-10);
  const covenant7 = stripNonDigits(params.covenantCode || '0000000').padStart(7, '0').slice(-7);
  const ourNum13 = stripNonDigits(params.ourNumber || '1').padStart(13, '0').slice(-13);
  const ios = '0';
  const wallet3 = stripNonDigits(params.walletCode || '101').padStart(3, '0').slice(-3);

  // Campo livre Santander (25 posições): 9 + convênio(7) + nossoNumero(13) + IOF(1) + carteira(3)
  const freeField25 = `9${covenant7}${ourNum13}${ios}${wallet3}`;
  const withoutDv43 = `${bankCode}${currency}${dueFactor}${valueStr}${freeField25}`;
  const dvGeneral = mod11Barcode(withoutDv43);
  const barcode44 = `${bankCode}${currency}${dvGeneral}${dueFactor}${valueStr}${freeField25}`;

  // Linha digitável (47 posições)
  const c1Raw = `${bankCode}${currency}${freeField25.slice(0, 5)}`;
  const c1 = `${c1Raw}${mod10(c1Raw)}`;
  const c2Raw = freeField25.slice(5, 15);
  const c2 = `${c2Raw}${mod10(c2Raw)}`;
  const c3Raw = freeField25.slice(15, 25);
  const c3 = `${c3Raw}${mod10(c3Raw)}`;
  const c4 = dvGeneral;
  const c5 = `${dueFactor}${valueStr}`;

  const digitableLine = `${c1}${c2}${c3}${c4}${c5}`;
  const formattedDigitableLine = `${c1.slice(0, 5)}.${c1.slice(5)} ${c2.slice(0, 5)}.${c2.slice(5)} ${c3.slice(0, 5)}.${c3.slice(5)} ${c4} ${c5}`;

  return { barcode: barcode44, digitableLine, formattedDigitableLine };
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

export function buildEmvPixCopiaECola(params: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  txid: string;
  description?: string;
}): string {
  const cleanKey = String(params.pixKey || '90400888000142').trim().slice(0, 77);
  const name = removeAccentsUpper(params.merchantName || 'FINANCEPRO ASSESSORIA', 25) || 'BENEFICIARIO';
  const city = removeAccentsUpper(params.merchantCity || 'RECIFE', 15) || 'SAO PAULO';
  const amountStr = (Math.max(1, params.amountCents) / 100).toFixed(2);
  const cleanTxid = String(params.txid || 'TXID00000000000000000000000')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 25) || '***';

  const maiContent = [tlv('00', 'br.gov.bcb.pix'), tlv('01', cleanKey)];
  if (params.description) {
    maiContent.push(tlv('02', removeAccentsUpper(params.description, 40)));
  }

  const body =
    tlv('00', '01') +
    tlv('01', '12') + // Dynamic/unique charge indicator
    tlv('26', maiContent.join('')) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', amountStr) +
    tlv('58', 'BR') +
    tlv('59', name) +
    tlv('60', city) +
    tlv('62', tlv('05', cleanTxid)) +
    '6304';

  return `${body}${crc16Ccitt(body)}`;
}

export function generatePixTxid(prefix = 'FP'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  const rand = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${cleanPrefix}${rand}`.slice(0, 32); // BCB exige entre 26 e 35 chars alfanuméricos
}

export async function generateQrCodeDataUrl(payload: string): Promise<string> {
  if (!payload) return '';
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

// =============================================================================
// HTTPS mTLS Transport & OAuth 2.0 Token Management
// =============================================================================

interface DecryptedSantanderCredentials {
  clientId: string;
  clientSecret: string;
  certType: 'pfx' | 'pem';
  pfxBuffer: Buffer | null;
  pfxPassword: string;
  certPem: string;
  keyPem: string;
}

function resolveDecryptedCredentials(
  cfg: typeof bankAccountApiConfigs.$inferSelect
): DecryptedSantanderCredentials {
  const clientId = (cfg.clientId || process.env.SANTANDER_CLIENT_ID || '').trim();
  const clientSecret = (
    decryptUazapiToken(cfg.clientSecretEncrypted) ||
    process.env.SANTANDER_CLIENT_SECRET ||
    ''
  ).trim();

  const certType = cfg.certType === 'pem' ? 'pem' : 'pfx';
  const pfxB64 = decryptUazapiToken(cfg.pfxBase64Encrypted) || '';
  const pfxBuffer = pfxB64 ? Buffer.from(pfxB64, 'base64') : null;
  const pfxPassword = decryptUazapiToken(cfg.pfxPasswordEncrypted) || '';
  const certPem = decryptUazapiToken(cfg.certPemEncrypted) || '';
  const keyPem = decryptUazapiToken(cfg.keyPemEncrypted) || '';

  return {
    clientId,
    clientSecret,
    certType,
    pfxBuffer,
    pfxPassword,
    certPem,
    keyPem,
  };
}

function buildMtlsAgent(creds: DecryptedSantanderCredentials): https.Agent {
  if (creds.certType === 'pfx' && creds.pfxBuffer && creds.pfxBuffer.length > 0) {
    return new https.Agent({
      pfx: creds.pfxBuffer,
      passphrase: creds.pfxPassword || undefined,
      rejectUnauthorized: true,
    });
  }
  if (creds.certType === 'pem' && creds.certPem && creds.keyPem) {
    return new https.Agent({
      cert: creds.certPem,
      key: creds.keyPem,
      rejectUnauthorized: true,
    });
  }
  throw new Error(
    'Certificado Digital A1 (.pfx/.p12 ou .pem/.key) não configurado para autenticação mTLS no Santander.'
  );
}

interface HttpCallResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  rawText: string;
  json: Record<string, unknown> | null;
}

function httpsMtlsRequest(params: {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  agent: https.Agent;
  timeoutMs?: number;
}): Promise<HttpCallResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(params.url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: parsed.pathname + parsed.search,
        method: params.method,
        agent: params.agent,
        headers: {
          ...(params.headers || {}),
          ...(params.body ? { 'Content-Length': String(Buffer.byteLength(params.body, 'utf8')) } : {}),
        },
        timeout: params.timeoutMs || 20000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          if (rawText.trim()) {
            try {
              json = JSON.parse(rawText) as Record<string, unknown>;
            } catch {
              json = null;
            }
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            rawText,
            json,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timeout na comunicação mTLS com a API Santander.'));
    });
    req.on('error', (err) => reject(err));
    if (params.body) {
      req.write(params.body);
    }
    req.end();
  });
}

async function getSantanderAccessToken(
  cfg: typeof bankAccountApiConfigs.$inferSelect,
  scope: SantanderApiScope,
  forceRefresh = false
): Promise<{ accessToken: string; expiresIn: number; endpoint: string }> {
  const creds = resolveDecryptedCredentials(cfg);
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Client ID e Client Secret do Portal Santander são obrigatórios para conexão mTLS.');
  }

  const cacheKey = `${cfg.bankAccountId}:${cfg.environment}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > Date.now() + 60_000) {
    return {
      accessToken: cached.accessToken,
      expiresIn: Math.round((cached.expiresAtMs - Date.now()) / 1000),
      endpoint: scope === 'boleto' ? `${getBoletoBaseUrl(cfg)}/auth/oauth/v2/token` : `${getPixBaseUrl(cfg)}/oauth/token`,
    };
  }

  const agent = buildMtlsAgent(creds);
  let endpoint = '';
  let resp: HttpCallResult;

  if (scope === 'boleto') {
    endpoint = `${getBoletoBaseUrl(cfg)}/auth/oauth/v2/token`;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString();
    resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form,
    });
  } else {
    endpoint = `${getPixBaseUrl(cfg)}/oauth/token?grant_type=client_credentials`;
    const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
    }).toString();
    resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'POST',
      agent,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form,
    });
  }

  if (resp.status < 200 || resp.status >= 300 || !resp.json?.access_token) {
    const errDetail =
      String(resp.json?.error_description || resp.json?.message || resp.json?.error || resp.rawText || '')
        .slice(0, 300);
    throw new Error(`Falha OAuth2 Santander (${scope.toUpperCase()} · HTTP ${resp.status}): ${errDetail || 'Token não retornado.'}`);
  }

  const accessToken = String(resp.json.access_token);
  const expiresIn = Math.max(60, Number(resp.json.expires_in || 900));
  tokenCache.set(cacheKey, {
    accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  });

  return { accessToken, expiresIn, endpoint };
}

// =============================================================================
// Config Load / Save / Masking
// =============================================================================

export async function getOrInitSantanderConfigForAccount(bankAccountId: number) {
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
  if (!acc) return null;

  const [cfg] = await db
    .select()
    .from(bankAccountApiConfigs)
    .where(eq(bankAccountApiConfigs.bankAccountId, bankAccountId))
    .limit(1);

  if (cfg) return { account: acc, config: cfg };

  // Return defaults without inserting until user saves or activates
  return {
    account: acc,
    config: {
      id: 0,
      bankAccountId,
      provider: 'santander',
      environment: 'sandbox',
      executionMode: 'homologation_offline',
      clientId: process.env.SANTANDER_CLIENT_ID || '',
      clientSecretEncrypted: null,
      certType: 'pfx',
      pfxBase64Encrypted: null,
      pfxPasswordEncrypted: null,
      certPemEncrypted: null,
      keyPemEncrypted: null,
      certSubject: '',
      certExpiresAt: '',
      boletoEnabled: true,
      boletoBaseUrlOverride: '',
      covenantCode: '',
      workspaceId: '',
      workspaceType: 'BILLING',
      documentKind: 'DUPLICATA_MERCANTIL',
      paymentType: 'REGISTRO',
      walletCode: '101',
      defaultFinePct: '2.00',
      defaultInterestPct: '1.00',
      defaultProtestDays: 0,
      defaultWriteOffDays: 30,
      hybridBoletoPixEnabled: true,
      boletoWebhookUrl: '',
      nsuSequence: 1,
      pixEnabled: true,
      pixBaseUrlOverride: '',
      pixKey: acc.beneficiaryDocument || '',
      pixKeyType: 'CNPJ',
      pixDefaultChargeType: 'cobv',
      pixExpirationSeconds: 3600,
      pixValidityDaysAfterDue: 30,
      pixBeneficiaryCity: 'RECIFE',
      pixWebhookUrl: '',
      lastTestedAt: null,
      lastTestOk: null,
      lastTestMessage: '',
      updatedBy: '',
      updatedAt: new Date(),
      createdAt: new Date(),
    } as typeof bankAccountApiConfigs.$inferSelect,
  };
}

export function sanitizeSantanderConfigForFrontend(cfg: typeof bankAccountApiConfigs.$inferSelect) {
  const hasSecret = Boolean(cfg.clientSecretEncrypted || process.env.SANTANDER_CLIENT_SECRET);
  return {
    bankAccountId: cfg.bankAccountId,
    provider: cfg.provider,
    environment: (cfg.environment === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
    executionMode: (cfg.executionMode === 'live_mtls' ? 'live_mtls' : 'homologation_offline') as
      | 'live_mtls'
      | 'homologation_offline',
    clientId: cfg.clientId || '',
    hasClientSecret: hasSecret,
    certType: (cfg.certType === 'pem' ? 'pem' : 'pfx') as 'pfx' | 'pem',
    hasPfx: Boolean(cfg.pfxBase64Encrypted),
    hasPfxPassword: Boolean(cfg.pfxPasswordEncrypted),
    hasCertPem: Boolean(cfg.certPemEncrypted),
    hasKeyPem: Boolean(cfg.keyPemEncrypted),
    certSubject: cfg.certSubject || '',
    certExpiresAt: cfg.certExpiresAt || '',
    boletoEnabled: Boolean(cfg.boletoEnabled),
    boletoBaseUrlOverride: cfg.boletoBaseUrlOverride || '',
    covenantCode: cfg.covenantCode || '',
    workspaceId: cfg.workspaceId || '',
    workspaceType: cfg.workspaceType || 'BILLING',
    documentKind: cfg.documentKind || 'DUPLICATA_MERCANTIL',
    paymentType: cfg.paymentType || 'REGISTRO',
    walletCode: cfg.walletCode || '101',
    defaultFinePct: cfg.defaultFinePct || '2.00',
    defaultInterestPct: cfg.defaultInterestPct || '1.00',
    defaultProtestDays: Number(cfg.defaultProtestDays || 0),
    defaultWriteOffDays: Number(cfg.defaultWriteOffDays || 30),
    hybridBoletoPixEnabled: Boolean(cfg.hybridBoletoPixEnabled),
    boletoWebhookUrl: cfg.boletoWebhookUrl || '',
    nsuSequence: Number(cfg.nsuSequence || 1),
    pixEnabled: Boolean(cfg.pixEnabled),
    pixBaseUrlOverride: cfg.pixBaseUrlOverride || '',
    pixKey: cfg.pixKey || '',
    pixKeyType: cfg.pixKeyType || 'CNPJ',
    pixDefaultChargeType: cfg.pixDefaultChargeType || 'cobv',
    pixExpirationSeconds: Number(cfg.pixExpirationSeconds || 3600),
    pixValidityDaysAfterDue: Number(cfg.pixValidityDaysAfterDue || 30),
    pixBeneficiaryCity: cfg.pixBeneficiaryCity || 'RECIFE',
    pixWebhookUrl: cfg.pixWebhookUrl || '',
    lastTestedAt: cfg.lastTestedAt ? new Date(cfg.lastTestedAt).toISOString() : null,
    lastTestOk: cfg.lastTestOk ?? null,
    lastTestMessage: cfg.lastTestMessage || '',
    updatedBy: cfg.updatedBy || '',
    updatedAt: cfg.updatedAt ? new Date(cfg.updatedAt).toISOString() : null,
  };
}

export async function saveSantanderConfigForAccount(params: {
  bankAccountId: number;
  updatedBy: string;
  body: Record<string, unknown>;
}) {
  const { bankAccountId, body, updatedBy } = params;
  const existingRows = await db
    .select()
    .from(bankAccountApiConfigs)
    .where(eq(bankAccountApiConfigs.bankAccountId, bankAccountId))
    .limit(1);
  const prev = existingRows[0];

  const environment = body.environment === 'production' ? 'production' : 'sandbox';
  const executionMode = body.executionMode === 'live_mtls' ? 'live_mtls' : 'homologation_offline';
  const certType = body.certType === 'pem' ? 'pem' : 'pfx';

  const boletoUrl = validateSantanderOverrideUrl(body.boletoBaseUrlOverride as string | undefined);
  const pixUrl = validateSantanderOverrideUrl(body.pixBaseUrlOverride as string | undefined);

  const clientSecretRaw = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
  const pfxBase64Raw = typeof body.pfxBase64 === 'string' ? body.pfxBase64.trim() : '';
  const pfxPasswordRaw = typeof body.pfxPassword === 'string' ? body.pfxPassword : '';
  const certPemRaw = typeof body.certPem === 'string' ? body.certPem.trim() : '';
  const keyPemRaw = typeof body.keyPem === 'string' ? body.keyPem.trim() : '';

  const nextSecret = body.clearClientSecret
    ? null
    : clientSecretRaw
    ? encryptUazapiToken(clientSecretRaw)
    : prev?.clientSecretEncrypted ?? null;

  const nextPfx = body.clearCertificate
    ? null
    : pfxBase64Raw
    ? encryptUazapiToken(pfxBase64Raw)
    : prev?.pfxBase64Encrypted ?? null;

  const nextPfxPass = body.clearCertificate
    ? null
    : pfxPasswordRaw
    ? encryptUazapiToken(pfxPasswordRaw)
    : prev?.pfxPasswordEncrypted ?? null;

  const nextCertPem = body.clearCertificate
    ? null
    : certPemRaw
    ? encryptUazapiToken(certPemRaw)
    : prev?.certPemEncrypted ?? null;

  const nextKeyPem = body.clearCertificate
    ? null
    : keyPemRaw
    ? encryptUazapiToken(keyPemRaw)
    : prev?.keyPemEncrypted ?? null;

  const values = {
    bankAccountId,
    provider: 'santander',
    environment,
    executionMode,
    clientId: String(body.clientId ?? prev?.clientId ?? '').trim(),
    clientSecretEncrypted: nextSecret,
    certType,
    pfxBase64Encrypted: nextPfx,
    pfxPasswordEncrypted: nextPfxPass,
    certPemEncrypted: nextCertPem,
    keyPemEncrypted: nextKeyPem,
    certSubject: String(body.certSubject ?? prev?.certSubject ?? '').trim(),
    certExpiresAt: String(body.certExpiresAt ?? prev?.certExpiresAt ?? '').trim(),
    boletoEnabled: body.boletoEnabled !== undefined ? Boolean(body.boletoEnabled) : prev?.boletoEnabled ?? true,
    boletoBaseUrlOverride: boletoUrl,
    covenantCode: stripNonDigits(String(body.covenantCode ?? prev?.covenantCode ?? '')),
    workspaceId: String(body.workspaceId ?? prev?.workspaceId ?? '').trim(),
    workspaceType: String(body.workspaceType ?? prev?.workspaceType ?? 'BILLING').trim() || 'BILLING',
    documentKind: String(body.documentKind ?? prev?.documentKind ?? 'DUPLICATA_MERCANTIL').trim(),
    paymentType: String(body.paymentType ?? prev?.paymentType ?? 'REGISTRO').trim(),
    walletCode: stripNonDigits(String(body.walletCode ?? prev?.walletCode ?? '101')) || '101',
    defaultFinePct: String(body.defaultFinePct ?? prev?.defaultFinePct ?? '2.00').replace(',', '.'),
    defaultInterestPct: String(body.defaultInterestPct ?? prev?.defaultInterestPct ?? '1.00').replace(',', '.'),
    defaultProtestDays: Math.max(0, Math.min(90, Number(body.defaultProtestDays ?? prev?.defaultProtestDays ?? 0) || 0)),
    defaultWriteOffDays: Math.max(1, Math.min(365, Number(body.defaultWriteOffDays ?? prev?.defaultWriteOffDays ?? 30) || 30)),
    hybridBoletoPixEnabled:
      body.hybridBoletoPixEnabled !== undefined ? Boolean(body.hybridBoletoPixEnabled) : prev?.hybridBoletoPixEnabled ?? true,
    boletoWebhookUrl: String(body.boletoWebhookUrl ?? prev?.boletoWebhookUrl ?? '').trim(),
    nsuSequence: Math.max(1, Number(body.nsuSequence ?? prev?.nsuSequence ?? 1) || 1),
    pixEnabled: body.pixEnabled !== undefined ? Boolean(body.pixEnabled) : prev?.pixEnabled ?? true,
    pixBaseUrlOverride: pixUrl,
    pixKey: String(body.pixKey ?? prev?.pixKey ?? '').trim(),
    pixKeyType: String(body.pixKeyType ?? prev?.pixKeyType ?? 'CNPJ').trim(),
    pixDefaultChargeType: body.pixDefaultChargeType === 'cob' ? 'cob' : 'cobv',
    pixExpirationSeconds: Math.max(60, Math.min(2592000, Number(body.pixExpirationSeconds ?? prev?.pixExpirationSeconds ?? 3600) || 3600)),
    pixValidityDaysAfterDue: Math.max(0, Math.min(365, Number(body.pixValidityDaysAfterDue ?? prev?.pixValidityDaysAfterDue ?? 30) || 30)),
    pixBeneficiaryCity: removeAccentsUpper(String(body.pixBeneficiaryCity ?? prev?.pixBeneficiaryCity ?? 'RECIFE'), 15) || 'RECIFE',
    pixWebhookUrl: String(body.pixWebhookUrl ?? prev?.pixWebhookUrl ?? '').trim(),
    updatedBy,
    updatedAt: new Date(),
  };

  let saved: typeof bankAccountApiConfigs.$inferSelect;
  if (prev) {
    const [row] = await db
      .update(bankAccountApiConfigs)
      .set(values)
      .where(eq(bankAccountApiConfigs.id, prev.id))
      .returning();
    saved = row;
  } else {
    const [row] = await db.insert(bankAccountApiConfigs).values(values).returning();
    saved = row;
  }

  // Ensure bankAccount marks apiProvider = 'santander' and integration enabled when requested
  const accountUpdates: Partial<typeof bankAccounts.$inferInsert> = {
    apiProvider: 'santander',
    apiIntegrationEnabled: body.apiIntegrationEnabled !== undefined ? Boolean(body.apiIntegrationEnabled) : true,
  };
  if (body.isDefaultBoletoAccount !== undefined) {
    accountUpdates.isDefaultBoletoAccount = Boolean(body.isDefaultBoletoAccount);
  }
  if (body.isDefaultPixAccount !== undefined) {
    accountUpdates.isDefaultPixAccount = Boolean(body.isDefaultPixAccount);
  }

  if (accountUpdates.isDefaultBoletoAccount || accountUpdates.isDefaultPixAccount) {
    const [currAcc] = await db
      .select({ unitId: bankAccounts.unitId })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);
    if (accountUpdates.isDefaultBoletoAccount) {
      if (currAcc?.unitId) {
        await db.update(bankAccounts).set({ isDefaultBoletoAccount: false }).where(eq(bankAccounts.unitId, currAcc.unitId));
      } else {
        await db.update(bankAccounts).set({ isDefaultBoletoAccount: false });
      }
    }
    if (accountUpdates.isDefaultPixAccount) {
      if (currAcc?.unitId) {
        await db.update(bankAccounts).set({ isDefaultPixAccount: false }).where(eq(bankAccounts.unitId, currAcc.unitId));
      } else {
        await db.update(bankAccounts).set({ isDefaultPixAccount: false });
      }
    }
  }

  await db.update(bankAccounts).set(accountUpdates).where(eq(bankAccounts.id, bankAccountId));

  // Clear cached token when credentials change
  tokenCache.delete(`${bankAccountId}:sandbox:boleto`);
  tokenCache.delete(`${bankAccountId}:sandbox:pix`);
  tokenCache.delete(`${bankAccountId}:production:boleto`);
  tokenCache.delete(`${bankAccountId}:production:pix`);

  return sanitizeSantanderConfigForFrontend(saved);
}

// =============================================================================
// Emission Log Helper
// =============================================================================

async function recordEmissionLog(params: {
  bankAccountId: number;
  titleId?: number | null;
  apiScope: 'oauth' | 'workspace' | 'boleto' | 'pix' | 'webhook';
  operation: string;
  environment: string;
  executionMode: string;
  endpoint: string;
  httpStatus?: number | null;
  ok: boolean;
  externalRef?: string;
  requestSummaryJson?: Record<string, unknown>;
  responseSummaryJson?: Record<string, unknown>;
  errorMessage?: string;
  createdByName?: string;
}) {
  try {
    await db.insert(santanderEmissionLogs).values({
      bankAccountId: params.bankAccountId,
      titleId: params.titleId ?? null,
      apiScope: params.apiScope,
      operation: params.operation,
      environment: params.environment,
      executionMode: params.executionMode,
      endpoint: params.endpoint,
      httpStatus: params.httpStatus ?? null,
      ok: params.ok,
      externalRef: params.externalRef || '',
      requestSummaryJson: params.requestSummaryJson || {},
      responseSummaryJson: params.responseSummaryJson || {},
      errorMessage: params.errorMessage || '',
      createdByName: params.createdByName || 'Sistema',
    });
  } catch (err) {
    console.warn('[Santander] Falha ao gravar log de emissão:', err);
  }
}

// =============================================================================
// Test Connection & Workspace Provisioning
// =============================================================================

export async function testSantanderConnection(params: {
  bankAccountId: number;
  scope: 'all' | 'boleto' | 'pix';
  actorName: string;
}) {
  const loaded = await getOrInitSantanderConfigForAccount(params.bankAccountId);
  if (!loaded) throw new Error('Conta bancária não encontrada.');
  const { account, config } = loaded;

  const isLive = config.executionMode === 'live_mtls';
  const results: Array<{ scope: string; ok: boolean; endpoint: string; message: string }> = [];

  if (!isLive) {
    const issues: string[] = [];
    if (config.boletoEnabled && !config.covenantCode) {
      issues.push('Código do Convênio (covenantCode) ainda não preenchido.');
    }
    if (config.pixEnabled && !config.pixKey) {
      issues.push('Chave PIX do recebedor ainda não preenchida.');
    }
    const ok = issues.length === 0;
    const msg = ok
      ? `Configuração validada em Homologação Local (${config.environment.toUpperCase()}). Pronta para emissão de Boletos v2 e PIX v2.`
      : `Atenção na validação local: ${issues.join(' ')}`;

    results.push({
      scope: params.scope,
      ok,
      endpoint: `${getBoletoBaseUrl(config)} · ${getPixBaseUrl(config)}`,
      message: msg,
    });

    if (config.id > 0) {
      await db
        .update(bankAccountApiConfigs)
        .set({ lastTestedAt: new Date(), lastTestOk: ok, lastTestMessage: msg, updatedAt: new Date() })
        .where(eq(bankAccountApiConfigs.id, config.id));
    }

    await recordEmissionLog({
      bankAccountId: account.id,
      apiScope: 'oauth',
      operation: 'TEST_CONFIG_HOMOLOGATION',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint: 'local://homologation-validator',
      httpStatus: ok ? 200 : 422,
      ok,
      requestSummaryJson: { scope: params.scope, covenantCode: config.covenantCode, pixKeyConfigured: Boolean(config.pixKey) },
      responseSummaryJson: { results },
      errorMessage: ok ? '' : issues.join(' '),
      createdByName: params.actorName,
    });

    return { ok, executionMode: config.executionMode, environment: config.environment, results, message: msg };
  }

  // Live mTLS checks
  const scopesToTest: SantanderApiScope[] =
    params.scope === 'all' ? ['boleto', 'pix'] : [params.scope];

  for (const sc of scopesToTest) {
    try {
      const tok = await getSantanderAccessToken(config, sc, true);
      results.push({
        scope: sc,
        ok: true,
        endpoint: tok.endpoint,
        message: `OAuth2 + mTLS autenticado (${sc.toUpperCase()}) · Token válido por ${tok.expiresIn}s.`,
      });
      await recordEmissionLog({
        bankAccountId: account.id,
        apiScope: 'oauth',
        operation: `TEST_OAUTH_${sc.toUpperCase()}`,
        environment: config.environment,
        executionMode: config.executionMode,
        endpoint: tok.endpoint,
        httpStatus: 200,
        ok: true,
        responseSummaryJson: { expiresIn: tok.expiresIn },
        createdByName: params.actorName,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido na autenticação Santander.';
      results.push({
        scope: sc,
        ok: false,
        endpoint: sc === 'boleto' ? getBoletoBaseUrl(config) : getPixBaseUrl(config),
        message: msg,
      });
      await recordEmissionLog({
        bankAccountId: account.id,
        apiScope: 'oauth',
        operation: `TEST_OAUTH_${sc.toUpperCase()}`,
        environment: config.environment,
        executionMode: config.executionMode,
        endpoint: sc === 'boleto' ? getBoletoBaseUrl(config) : getPixBaseUrl(config),
        httpStatus: 401,
        ok: false,
        errorMessage: msg,
        createdByName: params.actorName,
      });
    }
  }

  const allOk = results.every((r) => r.ok);
  const summaryMsg = results.map((r) => `[${r.scope.toUpperCase()}] ${r.message}`).join(' | ');
  if (config.id > 0) {
    await db
      .update(bankAccountApiConfigs)
      .set({ lastTestedAt: new Date(), lastTestOk: allOk, lastTestMessage: summaryMsg, updatedAt: new Date() })
      .where(eq(bankAccountApiConfigs.id, config.id));
  }

  return { ok: allOk, executionMode: config.executionMode, environment: config.environment, results, message: summaryMsg };
}

export async function createOrSyncSantanderWorkspace(params: {
  bankAccountId: number;
  description?: string;
  actorName: string;
}) {
  const loaded = await getOrInitSantanderConfigForAccount(params.bankAccountId);
  if (!loaded) throw new Error('Conta bancária não encontrada.');
  const { account, config } = loaded;

  if (!config.covenantCode) {
    throw new Error('Informe e salve o Código do Convênio (covenantCode) antes de criar o Workspace.');
  }

  const baseUrl = getBoletoBaseUrl(config);
  const endpoint = `${baseUrl}/collection_bill_management/v2/workspaces`;
  const payload = {
    type: config.workspaceType || 'BILLING',
    description: params.description?.trim() || `Workspace ${account.bankName} · Convênio ${config.covenantCode}`,
    covenants: [{ code: config.covenantCode }],
    ...(config.boletoWebhookUrl
      ? {
          webhookURL: config.boletoWebhookUrl,
          bankSlipBillingWebhookActive: true,
          pixBillingWebhookActive: Boolean(config.hybridBoletoPixEnabled),
        }
      : {}),
  };

  if (config.executionMode === 'homologation_offline') {
    const generatedWorkspaceId = config.workspaceId || crypto.randomUUID();
    if (config.id > 0) {
      await db
        .update(bankAccountApiConfigs)
        .set({ workspaceId: generatedWorkspaceId, updatedAt: new Date() })
        .where(eq(bankAccountApiConfigs.id, config.id));
    }
    await recordEmissionLog({
      bankAccountId: account.id,
      apiScope: 'workspace',
      operation: 'POST_WORKSPACE_HOMOLOGATION',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: 201,
      ok: true,
      externalRef: generatedWorkspaceId,
      requestSummaryJson: payload,
      responseSummaryJson: { id: generatedWorkspaceId, status: 'ACTIVE_HOMOLOGATION' },
      createdByName: params.actorName,
    });
    return { workspaceId: generatedWorkspaceId, mode: config.executionMode, response: { id: generatedWorkspaceId, ...payload } };
  }

  const creds = resolveDecryptedCredentials(config);
  const agent = buildMtlsAgent(creds);
  const { accessToken } = await getSantanderAccessToken(config, 'boleto');

  const resp = await httpsMtlsRequest({
    url: endpoint,
    method: 'POST',
    agent,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Application-Key': creds.clientId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const ok = resp.status >= 200 && resp.status < 300;
  const workspaceId = String(resp.json?.id || config.workspaceId || '');

  await recordEmissionLog({
    bankAccountId: account.id,
    apiScope: 'workspace',
    operation: 'POST_WORKSPACE',
    environment: config.environment,
    executionMode: config.executionMode,
    endpoint,
    httpStatus: resp.status,
    ok,
    externalRef: workspaceId,
    requestSummaryJson: payload,
    responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 400) },
    errorMessage: ok ? '' : `HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`,
    createdByName: params.actorName,
  });

  if (!ok || !workspaceId) {
    throw new Error(`Erro ao criar Workspace Santander (HTTP ${resp.status}): ${resp.rawText.slice(0, 280)}`);
  }

  if (config.id > 0) {
    await db
      .update(bankAccountApiConfigs)
      .set({ workspaceId, updatedAt: new Date() })
      .where(eq(bankAccountApiConfigs.id, config.id));
  }

  return { workspaceId, mode: config.executionMode, response: resp.json };
}

// =============================================================================
// Boleto Issuance (POST bank_slips), Instruction (PATCH), Query (GET)
// =============================================================================

async function resolveTargetAccountForEmission(
  preferredBankAccountId: number | null | undefined,
  requireType: 'boleto' | 'pix',
  titleUnitId?: number | null
) {
  if (preferredBankAccountId) {
    const loaded = await getOrInitSantanderConfigForAccount(preferredBankAccountId);
    if (!loaded) throw new Error('Conta corrente informada não encontrada.');
    return loaded;
  }

  const allAccounts = await db.select().from(bankAccounts).where(eq(bankAccounts.active, true));
  const santanderAccs = allAccounts.filter((a) => a.apiProvider === 'santander');
  const unitAccs = titleUnitId
    ? santanderAccs.filter((a) => a.unitId === titleUnitId || a.unitId === null)
    : santanderAccs;
  const pool = unitAccs.length > 0 ? unitAccs : santanderAccs;

  const preferred =
    pool.find((a) =>
      requireType === 'boleto' ? a.isDefaultBoletoAccount && a.apiIntegrationEnabled : a.isDefaultPixAccount && a.apiIntegrationEnabled
    ) ||
    pool.find((a) => a.apiIntegrationEnabled) ||
    pool[0];

  if (!preferred) {
    throw new Error(
      'Nenhuma Conta Corrente com integração Santander ativa encontrada. Configure em Administração Financeira → Conta Corrente → Cadastro → Contas Correntes.'
    );
  }

  const loaded = await getOrInitSantanderConfigForAccount(preferred.id);
  if (!loaded) throw new Error('Configuração Santander não encontrada.');
  return loaded;
}

async function allocateNextNsuCode(configId: number, currentSeq: number): Promise<string> {
  const nextVal = Math.max(1, currentSeq || 1);
  if (configId > 0) {
    await db
      .update(bankAccountApiConfigs)
      .set({ nsuSequence: nextVal + 1, updatedAt: new Date() })
      .where(eq(bankAccountApiConfigs.id, configId));
  }
  return String(nextVal).padStart(12, '0');
}

export async function emitSantanderBoletoForTitle(params: {
  titleId: number;
  bankAccountId?: number | null;
  includePixQr?: boolean;
  forceNewOurNumber?: boolean;
  actorName: string;
}) {
  const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, params.titleId)).limit(1);
  if (!title) throw new Error('Título financeiro não encontrado.');
  if (String(title.scope).toUpperCase() === 'PAGAR') {
    throw new Error('Emissão de boleto Santander disponível apenas para títulos de Contas a Receber.');
  }

  const [clientRow] = await db.select().from(clients).where(eq(clients.id, title.clientId)).limit(1);
  if (!clientRow) throw new Error('Cliente pagador vinculado ao título não encontrado.');

  const [unitRow] = await db.select().from(units).where(eq(units.id, title.unitId)).limit(1);
  const { account, config } = await resolveTargetAccountForEmission(
    params.bankAccountId ?? title.bankAccountId,
    'boleto',
    title.unitId
  );

  if (!config.boletoEnabled) {
    throw new Error(`Emissão de boletos desabilitada na configuração da conta "${account.bankName}".`);
  }

  const covenantCode = config.covenantCode || '0000001';
  const workspaceId = config.workspaceId || `ws-${account.id}`;
  const nsuCode = await allocateNextNsuCode(config.id, config.nsuSequence);
  const nsuDate = new Date().toISOString().slice(0, 10);
  const envLabel = config.environment === 'production' ? 'PRODUCAO' : 'TESTE';
  const dueDateObj = new Date(title.dueDate);
  const dueDateIso = dueDateObj.toISOString().slice(0, 10);
  const issueDateIso = new Date(title.issueDate || Date.now()).toISOString().slice(0, 10);
  const amountCents = title.currentBalanceCents > 0 ? title.currentBalanceCents : title.amountCents;
  const nominalValue = (amountCents / 100).toFixed(2);

  const payerDigits = stripNonDigits(clientRow.cpfCnpj);
  const payerDocType = payerDigits.length > 11 ? 'CNPJ' : 'CPF';
  const payerZip = stripNonDigits(clientRow.zipCode || '50010000').padStart(8, '0').slice(0, 8);
  const generatedOurNumber = `${String(title.id).padStart(7, '0')}${String(Date.now()).slice(-4)}${String(Number(nsuCode.slice(-2)) % 100).padStart(2, '0')}`.slice(-13);
  const ourNumber = params.forceNewOurNumber
    ? generatedOurNumber
    : stripNonDigits(title.ourNumber) || generatedOurNumber;
  const useHybridPix = params.includePixQr ?? Boolean(config.hybridBoletoPixEnabled);

  const finePct = parseFloat(String(config.defaultFinePct || '0').replace(',', '.')) || 0;
  const interestPct = parseFloat(String(config.defaultInterestPct || '0').replace(',', '.')) || 0;

  const payload: Record<string, unknown> = {
    environment: envLabel,
    nsuCode,
    nsuDate,
    covenantCode,
    bankNumber: ourNumber.slice(-13),
    clientNumber: (title.documentNumber || title.titleCode).slice(0, 15),
    dueDate: dueDateIso,
    issueDate: issueDateIso,
    participantCode: '',
    nominalValue,
    payer: {
      name: removeAccentsUpper(clientRow.fullName, 40) || 'PAGADOR NAO INFORMADO',
      documentType: payerDocType,
      documentNumber: payerDigits.padStart(payerDocType === 'CNPJ' ? 14 : 11, '0'),
      address: removeAccentsUpper([clientRow.address, clientRow.addressNumber].filter(Boolean).join(', ') || 'RUA PRINCIPAL, 100', 40),
      neighborhood: removeAccentsUpper(clientRow.neighborhood || 'CENTRO', 30) || 'CENTRO',
      city: removeAccentsUpper(clientRow.city || unitRow?.city || 'RECIFE', 20) || 'RECIFE',
      state: removeAccentsUpper(clientRow.state || unitRow?.state || 'PE', 2) || 'PE',
      zipCode: `${payerZip.slice(0, 5)}-${payerZip.slice(5, 8)}`,
    },
    documentKind: config.documentKind || 'DUPLICATA_MERCANTIL',
    paymentType: config.paymentType || 'REGISTRO',
    writeOffQuantityDays: String(config.defaultWriteOffDays || 30),
    ...(finePct > 0 ? { finePercentage: finePct.toFixed(2), fineQuantityDays: '1' } : {}),
    ...(interestPct > 0 ? { interestPercentage: interestPct.toFixed(2) } : {}),
    ...(config.defaultProtestDays > 0
      ? { protestType: 'DIAS_CORRIDOS', protestQuantityDays: String(config.defaultProtestDays) }
      : { protestType: 'SEM_PROTESTO' }),
    messages: [
      `Ref.: ${title.documentNumber || title.titleCode}`,
      `Beneficiario: ${account.beneficiaryName || unitRow?.legalName || unitRow?.name || 'FinancePro Assessoria'}`,
    ],
  };

  if (useHybridPix && config.pixKey) {
    payload.key = {
      type: config.pixKeyType || 'CNPJ',
      dictKey: config.pixKey,
    };
  }

  const baseUrl = getBoletoBaseUrl(config);
  const endpoint = `${baseUrl}/collection_bill_management/v2/workspaces/${encodeURIComponent(workspaceId)}/bank_slips`;
  const bankSlipCompositeId = `${nsuCode}.${nsuDate}.${envLabel}.${covenantCode}.${ourNumber.slice(-13)}`;

  let barcode = '';
  let digitableLine = '';
  let qrCodePix = '';
  let santanderStatus = 'ATIVO';
  let rawResp: Record<string, unknown> = {};

  if (config.executionMode === 'homologation_offline') {
    const feb = buildSantanderFebrabanBarcode({
      covenantCode,
      ourNumber,
      amountCents,
      dueDate: dueDateObj,
      walletCode: config.walletCode,
    });
    barcode = feb.barcode;
    digitableLine = feb.formattedDigitableLine;
    if (useHybridPix) {
      const txid = generatePixTxid('SX');
      qrCodePix = buildEmvPixCopiaECola({
        pixKey: config.pixKey || account.beneficiaryDocument || '90400888000142',
        merchantName: account.beneficiaryName || unitRow?.legalName || 'FINANCEPRO',
        merchantCity: config.pixBeneficiaryCity || unitRow?.city || 'RECIFE',
        amountCents,
        txid,
        description: title.documentNumber || title.titleCode,
      });
    }
    santanderStatus = 'SIMULADO_HOMOLOGACAO';
    rawResp = {
      ...payload,
      barcode,
      digitableLine,
      qrCodePix: qrCodePix || undefined,
      bankSlipId: bankSlipCompositeId,
      mode: 'homologation_offline',
    };

    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'boleto',
      operation: 'POST_BANK_SLIP_HOMOLOGATION',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: 201,
      ok: true,
      externalRef: nsuCode,
      requestSummaryJson: { nsuCode, nsuDate, covenantCode, nominalValue, dueDate: dueDateIso, hybridPix: useHybridPix },
      responseSummaryJson: { bankSlipId: bankSlipCompositeId, digitableLine, hasQrCodePix: Boolean(qrCodePix) },
      createdByName: params.actorName,
    });
  } else {
    if (!config.workspaceId) {
      throw new Error('Workspace ID Santander não configurado. Crie ou informe o Workspace na configuração da Conta Corrente.');
    }
    if (!config.covenantCode) {
      throw new Error('Código do Convênio Santander (covenantCode) não configurado.');
    }

    const creds = resolveDecryptedCredentials(config);
    const agent = buildMtlsAgent(creds);
    const { accessToken } = await getSantanderAccessToken(config, 'boleto');

    const resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'POST',
      agent,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Application-Key': creds.clientId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const ok = resp.status >= 200 && resp.status < 300;
    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'boleto',
      operation: 'POST_BANK_SLIP',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: resp.status,
      ok,
      externalRef: nsuCode,
      requestSummaryJson: { nsuCode, nsuDate, covenantCode, nominalValue, dueDate: dueDateIso },
      responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 400) },
      errorMessage: ok ? '' : `HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`,
      createdByName: params.actorName,
    });

    if (!ok || !resp.json) {
      throw new Error(`Santander recusou registro do boleto (HTTP ${resp.status}): ${resp.rawText.slice(0, 320)}`);
    }

    rawResp = resp.json;
    barcode = String(resp.json.barcode || resp.json.barCode || '');
    digitableLine = String(resp.json.digitableLine || '');
    qrCodePix = String(resp.json.qrCodePix || resp.json.qrCode || '');
    santanderStatus = 'ATIVO';
  }

  const [updatedTitle] = await db
    .update(financialTitles)
    .set({
      bankAccountId: account.id,
      boletoProvider: 'santander',
      barcode: barcode || title.barcode,
      digitableLine: digitableLine || barcode,
      ourNumber: ourNumber.slice(-13),
      santanderNsuCode: nsuCode,
      santanderNsuDate: nsuDate,
      santanderWorkspaceId: workspaceId,
      santanderCovenantCode: covenantCode,
      santanderBankSlipId: bankSlipCompositeId,
      santanderStatus,
      ...(qrCodePix
        ? {
            pixCopiaECola: qrCodePix,
            pixChargeType: 'boleto_sx',
            pixStatus: config.executionMode === 'homologation_offline' ? 'SIMULADO_HOMOLOGACAO' : 'ATIVA',
          }
        : {}),
      santanderRawJson: rawResp,
      updatedAt: new Date(),
    })
    .where(eq(financialTitles.id, title.id))
    .returning();

  const qrCodeDataUrl = qrCodePix ? await generateQrCodeDataUrl(qrCodePix) : '';

  return {
    title: updatedTitle,
    account,
    executionMode: config.executionMode,
    environment: config.environment,
    barcode,
    digitableLine,
    ourNumber: ourNumber.slice(-13),
    qrCodePix,
    qrCodeDataUrl,
    santanderBankSlipId: bankSlipCompositeId,
  };
}

// =============================================================================
// PIX QR Code Generation (PUT /api/v2/cob/{txid} & /api/v2/cobv/{txid})
// =============================================================================

export async function emitSantanderPixForTitle(params: {
  titleId: number;
  bankAccountId?: number | null;
  chargeType?: 'cob' | 'cobv';
  expirationSeconds?: number;
  actorName: string;
}) {
  const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, params.titleId)).limit(1);
  if (!title) throw new Error('Título financeiro não encontrado.');
  if (String(title.scope).toUpperCase() === 'PAGAR') {
    throw new Error('Emissão de cobrança PIX disponível apenas para Contas a Receber.');
  }

  const [clientRow] = await db.select().from(clients).where(eq(clients.id, title.clientId)).limit(1);
  if (!clientRow) throw new Error('Cliente pagador vinculado ao título não encontrado.');

  const [unitRow] = await db.select().from(units).where(eq(units.id, title.unitId)).limit(1);
  const { account, config } = await resolveTargetAccountForEmission(
    params.bankAccountId ?? title.bankAccountId,
    'pix',
    title.unitId
  );

  if (!config.pixEnabled) {
    throw new Error(`Emissão de PIX desabilitada na configuração da conta "${account.bankName}".`);
  }
  const pixKey = (config.pixKey || '').trim();
  if (!pixKey && config.executionMode === 'live_mtls') {
    throw new Error('Chave PIX (pixKey) do recebedor não configurada na Conta Corrente.');
  }

  const effectiveChargeType: 'cob' | 'cobv' =
    params.chargeType || (config.pixDefaultChargeType === 'cob' ? 'cob' : 'cobv');

  const txid = generatePixTxid('FP');
  const amountCents = title.currentBalanceCents > 0 ? title.currentBalanceCents : title.amountCents;
  const originalStr = (amountCents / 100).toFixed(2);
  const payerDigits = stripNonDigits(clientRow.cpfCnpj);
  const isCnpj = payerDigits.length > 11;
  const devedor: Record<string, string> = {
    nome: removeAccentsUpper(clientRow.fullName, 100) || 'PAGADOR',
    ...(isCnpj
      ? { cnpj: payerDigits.padStart(14, '0').slice(-14) }
      : { cpf: payerDigits.padStart(11, '0').slice(-11) }),
  };

  let payload: Record<string, unknown>;
  let expiresAt: Date;

  if (effectiveChargeType === 'cob') {
    const expSec = Math.max(60, params.expirationSeconds || config.pixExpirationSeconds || 3600);
    expiresAt = new Date(Date.now() + expSec * 1000);
    payload = {
      calendario: { expiracao: expSec },
      devedor,
      valor: { original: originalStr },
      chave: pixKey || account.beneficiaryDocument || '90400888000142',
      solicitacaoPagador: `Título ${title.documentNumber || title.titleCode} - ${title.description || 'Assessoria'}`.slice(0, 140),
    };
  } else {
    const dueIso = new Date(title.dueDate).toISOString().slice(0, 10);
    const valDays = Math.max(0, config.pixValidityDaysAfterDue ?? 30);
    expiresAt = new Date(new Date(title.dueDate).getTime() + valDays * 86400000);
    const finePct = parseFloat(String(config.defaultFinePct || '0').replace(',', '.')) || 0;
    const interestPct = parseFloat(String(config.defaultInterestPct || '0').replace(',', '.')) || 0;

    payload = {
      calendario: {
        dataVencimento: dueIso,
        validadeAposVencimento: valDays,
      },
      devedor: {
        ...devedor,
        logradouro: removeAccentsUpper([clientRow.address, clientRow.addressNumber].filter(Boolean).join(', ') || 'RUA PRINCIPAL', 100),
        cidade: removeAccentsUpper(clientRow.city || unitRow?.city || 'RECIFE', 50),
        uf: removeAccentsUpper(clientRow.state || unitRow?.state || 'PE', 2),
        cep: stripNonDigits(clientRow.zipCode || '50010000').padStart(8, '0').slice(0, 8),
      },
      valor: {
        original: originalStr,
        ...(finePct > 0 ? { multa: { modalidade: 2, valorPerc: finePct.toFixed(2) } } : {}),
        ...(interestPct > 0 ? { juros: { modalidade: 2, valorPerc: (interestPct / 30).toFixed(2) } } : {}),
      },
      chave: pixKey || account.beneficiaryDocument || '90400888000142',
      solicitacaoPagador: `Título ${title.documentNumber || title.titleCode} - Venc. ${dueIso}`.slice(0, 140),
    };
  }

  const baseUrl = getPixBaseUrl(config);
  const endpoint = `${baseUrl}/api/v2/${effectiveChargeType}/${txid}`;

  let pixCopiaECola = '';
  let pixLocation = '';
  let pixStatus = 'ATIVA';
  let rawResp: Record<string, unknown> = {};

  if (config.executionMode === 'homologation_offline') {
    pixCopiaECola = buildEmvPixCopiaECola({
      pixKey: pixKey || account.beneficiaryDocument || '90400888000142',
      merchantName: account.beneficiaryName || unitRow?.legalName || 'FINANCEPRO ASSESSORIA',
      merchantCity: config.pixBeneficiaryCity || unitRow?.city || 'RECIFE',
      amountCents,
      txid,
      description: title.documentNumber || title.titleCode,
    });
    pixLocation = `pix.santander.com.br/qr/v2/${txid.toLowerCase()}`;
    pixStatus = 'SIMULADO_HOMOLOGACAO';
    rawResp = {
      txid,
      status: pixStatus,
      location: pixLocation,
      pixCopiaECola,
      calendario: payload.calendario,
      valor: payload.valor,
      mode: 'homologation_offline',
    };

    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'pix',
      operation: `PUT_${effectiveChargeType.toUpperCase()}_HOMOLOGATION`,
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: 201,
      ok: true,
      externalRef: txid,
      requestSummaryJson: { txid, chargeType: effectiveChargeType, original: originalStr },
      responseSummaryJson: { txid, pixLocation, pixStatus },
      createdByName: params.actorName,
    });
  } else {
    const creds = resolveDecryptedCredentials(config);
    const agent = buildMtlsAgent(creds);
    const { accessToken } = await getSantanderAccessToken(config, 'pix');

    const resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'PUT',
      agent,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const ok = resp.status >= 200 && resp.status < 300;
    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'pix',
      operation: `PUT_${effectiveChargeType.toUpperCase()}`,
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: resp.status,
      ok,
      externalRef: txid,
      requestSummaryJson: { txid, chargeType: effectiveChargeType, original: originalStr },
      responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 400) },
      errorMessage: ok ? '' : `HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`,
      createdByName: params.actorName,
    });

    if (!ok || !resp.json) {
      throw new Error(`Santander PIX recusou cobrança (HTTP ${resp.status}): ${resp.rawText.slice(0, 320)}`);
    }

    rawResp = resp.json;
    pixCopiaECola = String(resp.json.pixCopiaECola || '');
    pixLocation = String(resp.json.location || (resp.json.loc as { location?: string } | undefined)?.location || '');
    pixStatus = String(resp.json.status || 'ATIVA');
  }

  const [updatedTitle] = await db
    .update(financialTitles)
    .set({
      bankAccountId: account.id,
      boletoProvider: 'santander',
      pixTxid: txid,
      pixCopiaECola,
      pixLocation,
      pixStatus,
      pixChargeType: effectiveChargeType,
      pixExpiresAt: expiresAt,
      santanderRawJson: rawResp,
      updatedAt: new Date(),
    })
    .where(eq(financialTitles.id, title.id))
    .returning();

  const qrCodeDataUrl = await generateQrCodeDataUrl(pixCopiaECola);

  return {
    title: updatedTitle,
    account,
    executionMode: config.executionMode,
    environment: config.environment,
    txid,
    chargeType: effectiveChargeType,
    pixCopiaECola,
    pixLocation,
    pixStatus,
    expiresAt: expiresAt.toISOString(),
    qrCodeDataUrl,
  };
}

// =============================================================================
// Boleto Instruction (PATCH) & Status Query (GET)
// =============================================================================

export async function sendSantanderBoletoInstruction(params: {
  titleId: number;
  operation: 'BAIXAR' | 'PROTESTAR' | 'SUSTAR_PROTESTO' | 'ALTERAR_VENCIMENTO' | 'ALTERAR_VALOR';
  newDueDate?: string;
  newAmountCents?: number;
  actorName: string;
}) {
  const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, params.titleId)).limit(1);
  if (!title) throw new Error('Título financeiro não encontrado.');
  if (!title.santanderNsuCode || !title.santanderNsuDate) {
    throw new Error('Este título ainda não possui um boleto Santander registrado com NSU.');
  }

  const { account, config } = await resolveTargetAccountForEmission(title.bankAccountId, 'boleto', title.unitId);
  const workspaceId = title.santanderWorkspaceId || config.workspaceId || `ws-${account.id}`;
  const baseUrl = getBoletoBaseUrl(config);
  const endpoint = `${baseUrl}/collection_bill_management/v2/workspaces/${encodeURIComponent(workspaceId)}/bank_slips`;

  const patchPayload: Record<string, unknown> = {
    covenantCode: title.santanderCovenantCode || config.covenantCode,
    bankNumber: title.ourNumber,
    operation: params.operation,
    ...(params.operation === 'ALTERAR_VENCIMENTO' && params.newDueDate ? { dueDate: params.newDueDate } : {}),
    ...(params.operation === 'ALTERAR_VALOR' && params.newAmountCents
      ? { nominalValue: (params.newAmountCents / 100).toFixed(2) }
      : {}),
  };

  if (config.executionMode === 'homologation_offline') {
    const nextSantanderStatus =
      params.operation === 'BAIXAR'
        ? 'BAIXADO_HOMOLOGACAO'
        : params.operation === 'PROTESTAR'
        ? 'PROTESTADO_HOMOLOGACAO'
        : title.santanderStatus || 'SIMULADO_HOMOLOGACAO';

    const updateFields: Partial<typeof financialTitles.$inferInsert> = {
      santanderStatus: nextSantanderStatus,
      updatedAt: new Date(),
    };
    if (params.operation === 'ALTERAR_VENCIMENTO' && params.newDueDate) {
      updateFields.dueDate = new Date(`${params.newDueDate}T12:00:00.000Z`);
    }
    if (params.operation === 'ALTERAR_VALOR' && params.newAmountCents && params.newAmountCents > 0) {
      updateFields.amountCents = params.newAmountCents;
      updateFields.currentBalanceCents = params.newAmountCents;
    }

    const [updated] = await db
      .update(financialTitles)
      .set(updateFields)
      .where(eq(financialTitles.id, title.id))
      .returning();

    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'boleto',
      operation: `PATCH_${params.operation}_HOMOLOGATION`,
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: 200,
      ok: true,
      externalRef: title.santanderNsuCode,
      requestSummaryJson: patchPayload,
      responseSummaryJson: { santanderStatus: nextSantanderStatus },
      createdByName: params.actorName,
    });

    return { ok: true, title: updated, status: nextSantanderStatus };
  }

  const creds = resolveDecryptedCredentials(config);
  const agent = buildMtlsAgent(creds);
  const { accessToken } = await getSantanderAccessToken(config, 'boleto');

  const resp = await httpsMtlsRequest({
    url: endpoint,
    method: 'PATCH',
    agent,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Application-Key': creds.clientId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(patchPayload),
  });

  const ok = resp.status >= 200 && resp.status < 300;
  await recordEmissionLog({
    bankAccountId: account.id,
    titleId: title.id,
    apiScope: 'boleto',
    operation: `PATCH_${params.operation}`,
    environment: config.environment,
    executionMode: config.executionMode,
    endpoint,
    httpStatus: resp.status,
    ok,
    externalRef: title.santanderNsuCode,
    requestSummaryJson: patchPayload,
    responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 400) },
    errorMessage: ok ? '' : `HTTP ${resp.status}: ${resp.rawText.slice(0, 300)}`,
    createdByName: params.actorName,
  });

  if (!ok) {
    throw new Error(`Falha na instrução Santander (HTTP ${resp.status}): ${resp.rawText.slice(0, 280)}`);
  }

  const nextStatus = params.operation === 'BAIXAR' ? 'BAIXADO' : title.santanderStatus || 'ATIVO';
  const [updated] = await db
    .update(financialTitles)
    .set({
      santanderStatus: nextStatus,
      ...(params.operation === 'ALTERAR_VENCIMENTO' && params.newDueDate
        ? { dueDate: new Date(`${params.newDueDate}T12:00:00.000Z`) }
        : {}),
      ...(params.operation === 'ALTERAR_VALOR' && params.newAmountCents
        ? { amountCents: params.newAmountCents, currentBalanceCents: params.newAmountCents }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(financialTitles.id, title.id))
    .returning();

  return { ok: true, title: updated, status: nextStatus, response: resp.json };
}

export async function consultSantanderTitleStatus(params: { titleId: number; actorName: string }) {
  const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, params.titleId)).limit(1);
  if (!title) throw new Error('Título financeiro não encontrado.');

  const { account, config } = await resolveTargetAccountForEmission(
    title.bankAccountId,
    title.pixTxid && !title.santanderBankSlipId ? 'pix' : 'boleto',
    title.unitId
  );

  const summary: Record<string, unknown> = {
    executionMode: config.executionMode,
    environment: config.environment,
    boletoStatus: title.santanderStatus || null,
    pixStatus: title.pixStatus || null,
  };

  if (config.executionMode === 'homologation_offline') {
    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: title.pixTxid && !title.santanderBankSlipId ? 'pix' : 'boleto',
      operation: 'GET_STATUS_HOMOLOGATION',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint: 'local://homologation-status',
      httpStatus: 200,
      ok: true,
      externalRef: title.pixTxid || title.santanderNsuCode,
      responseSummaryJson: summary,
      createdByName: params.actorName,
    });
    return { title, summary };
  }

  const creds = resolveDecryptedCredentials(config);
  const agent = buildMtlsAgent(creds);

  if (title.santanderBankSlipId && config.workspaceId) {
    const { accessToken } = await getSantanderAccessToken(config, 'boleto');
    const endpoint = `${getBoletoBaseUrl(config)}/collection_bill_management/v2/workspaces/${encodeURIComponent(config.workspaceId)}/bank_slips/${encodeURIComponent(title.santanderBankSlipId)}`;
    const resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'GET',
      agent,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Application-Key': creds.clientId,
        Accept: 'application/json',
      },
    });
    if (resp.status >= 200 && resp.status < 300 && resp.json) {
      summary.boletoRemote = resp.json;
      const remoteStatus = String(resp.json.status || title.santanderStatus || 'ATIVO');
      await db
        .update(financialTitles)
        .set({ santanderStatus: remoteStatus, updatedAt: new Date() })
        .where(eq(financialTitles.id, title.id));
    }
    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'boleto',
      operation: 'GET_BANK_SLIP',
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      externalRef: title.santanderNsuCode,
      responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 300) },
      createdByName: params.actorName,
    });
  }

  if (title.pixTxid) {
    const chargePath = title.pixChargeType === 'cob' ? 'cob' : 'cobv';
    const { accessToken } = await getSantanderAccessToken(config, 'pix');
    const endpoint = `${getPixBaseUrl(config)}/api/v2/${chargePath}/${encodeURIComponent(title.pixTxid)}`;
    const resp = await httpsMtlsRequest({
      url: endpoint,
      method: 'GET',
      agent,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (resp.status >= 200 && resp.status < 300 && resp.json) {
      summary.pixRemote = resp.json;
      const remotePixStatus = String(resp.json.status || title.pixStatus || 'ATIVA');
      await db
        .update(financialTitles)
        .set({ pixStatus: remotePixStatus, updatedAt: new Date() })
        .where(eq(financialTitles.id, title.id));
    }
    await recordEmissionLog({
      bankAccountId: account.id,
      titleId: title.id,
      apiScope: 'pix',
      operation: `GET_${chargePath.toUpperCase()}`,
      environment: config.environment,
      executionMode: config.executionMode,
      endpoint,
      httpStatus: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      externalRef: title.pixTxid,
      responseSummaryJson: resp.json || { raw: resp.rawText.slice(0, 300) },
      createdByName: params.actorName,
    });
  }

  const [freshTitle] = await db.select().from(financialTitles).where(eq(financialTitles.id, title.id)).limit(1);
  return { title: freshTitle || title, summary };
}

export async function getSantanderLogsForAccount(bankAccountId: number, limit = 40) {
  return db
    .select()
    .from(santanderEmissionLogs)
    .where(eq(santanderEmissionLogs.bankAccountId, bankAccountId))
    .orderBy(desc(santanderEmissionLogs.createdAt))
    .limit(Math.min(100, Math.max(5, limit)));
}

export async function listConfiguredSantanderAccounts() {
  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.active, true), eq(bankAccounts.apiProvider, 'santander')));
  const configs = await db.select().from(bankAccountApiConfigs);
  const cfgMap = new Map(configs.map((c) => [c.bankAccountId, c]));
  return accounts.map((a) => {
    const cfg = cfgMap.get(a.id);
    return {
      ...a,
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
}

// =============================================================================
// Emit / Reissue Boleto (com ou sem alteração de vencimento)
// =============================================================================

export async function emitOrReissueSantanderBoletoForTitle(params: {
  titleId: number;
  bankAccountId?: number | null;
  includePixQr?: boolean;
  alterDueDate?: boolean;
  newDueDate?: string;
  actorName: string;
}) {
  const [title] = await db.select().from(financialTitles).where(eq(financialTitles.id, params.titleId)).limit(1);
  if (!title) throw new Error('Título financeiro não encontrado.');

  if (String(title.scope || 'RECEBER').toUpperCase() === 'PAGAR') {
    throw new Error('Emissão/reemissão de boleto disponível apenas para Contas a Receber.');
  }
  const st = String(title.status || '').toUpperCase();
  if (['PAGO', 'CANCELADO', 'AGRUPADO', 'DEVOLUCAO_VINCULADA'].includes(st)) {
    throw new Error(`Título ${title.documentNumber || title.titleCode} está com status "${st}" e não permite emissão/reemissão.`);
  }
  if (String(title.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') {
    throw new Error(`Título ${title.documentNumber || title.titleCode} não é do tipo Padrão.`);
  }

  const hadBoleto = Boolean(
    (title.barcode || '').trim() ||
      (title.digitableLine || '').trim() ||
      (title.santanderBankSlipId || '').trim()
  );

  if (params.alterDueDate && params.newDueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.newDueDate)) {
      throw new Error('Nova data de vencimento inválida (esperado YYYY-MM-DD).');
    }
    const parsedDue = new Date(`${params.newDueDate}T12:00:00.000Z`);
    if (Number.isNaN(parsedDue.getTime())) {
      throw new Error('Nova data de vencimento inválida.');
    }
    await db
      .update(financialTitles)
      .set({
        dueDate: parsedDue,
        forecastDate: parsedDue,
        updatedAt: new Date(),
      })
      .where(eq(financialTitles.id, title.id));
  }

  // Se já possuía boleto registrado em live mTLS, tenta baixar o slip anterior antes de reemitir um novo
  if (hadBoleto && title.santanderNsuCode && title.santanderNsuDate) {
    try {
      const loaded = await resolveTargetAccountForEmission(
        params.bankAccountId ?? title.bankAccountId,
        'boleto',
        title.unitId
      );
      if (loaded.config.executionMode === 'live_mtls') {
        await sendSantanderBoletoInstruction({
          titleId: title.id,
          operation: 'BAIXAR',
          actorName: params.actorName,
        });
      }
    } catch {
      // Prossegue com a reemissão mesmo se o boleto anterior já estivesse baixado no banco
    }
  }

  const emitted = await emitSantanderBoletoForTitle({
    titleId: title.id,
    bankAccountId: params.bankAccountId,
    includePixQr: params.includePixQr,
    forceNewOurNumber: hadBoleto,
    actorName: params.actorName,
  });

  return {
    ...emitted,
    mode: (hadBoleto ? 'REEMISSAO' : 'EMISSAO') as 'EMISSAO' | 'REEMISSAO',
    dueDateChanged: Boolean(params.alterDueDate && params.newDueDate),
  };
}

// =============================================================================
// Baixa de Títulos em Aberto via API Bancária (Santander)
// =============================================================================

export interface SyncOpenTitleItem {
  titleId: number;
  titleCode: string;
  documentNumber: string;
  description: string;
  clientId: number;
  clientName: string;
  unitId: number;
  dueDate: string;
  paidAt: string | null;
  amountCents: number;
  balanceCents: number;
  settledCents: number;
  daysOverdue: number;
  hasBoleto: boolean;
  hasPix: boolean;
  ourNumber: string;
  digitableLine: string;
  pixTxid: string;
  santanderStatus: string;
  pixStatus: string;
  channel: 'BOLETO' | 'PIX' | 'HOMOLOGACAO' | 'PENDENTE';
  bankReason: string;
  movementId: number | null;
}

function isStatusLiquidated(rawStatus: string | null | undefined): boolean {
  const s = String(rawStatus || '').toUpperCase();
  return (
    s.includes('LIQUID') ||
    s.includes('PAGO') ||
    s.includes('CONCLUIDA') ||
    s.includes('SETTLED') ||
    s.includes('PAID')
  );
}

function isTitleOpenForReceberSync(t: typeof financialTitles.$inferSelect): boolean {
  if (String(t.scope || 'RECEBER').toUpperCase() !== 'RECEBER') return false;
  if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
  if (t.isProtested || t.isProvision) return false;
  const st = String(t.status || '').toUpperCase();
  if (['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA', 'DEVOLUCAO_VINCULADA'].includes(st)) return false;
  const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
  return bal > 0;
}

function normalizeIsoDateParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Formato de data inválido no período (esperado YYYY-MM-DD).');
  }
  return trimmed;
}

export async function getSantanderOpenTitlesPreview(params: {
  bankAccountId?: number | null;
  allowedUnitIds: number[] | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const startDate = normalizeIsoDateParam(params.startDate);
  const endDate = normalizeIsoDateParam(params.endDate);
  if (startDate && endDate && startDate > endDate) {
    throw new Error('A data inicial do período não pode ser maior que a data final.');
  }

  const allAccounts = await db.select().from(bankAccounts).where(eq(bankAccounts.active, true));
  const unitFilteredAccounts =
    params.allowedUnitIds === null
      ? allAccounts
      : allAccounts.filter((a) => a.unitId === null || params.allowedUnitIds!.includes(a.unitId));

  const targetAccount =
    (params.bankAccountId ? unitFilteredAccounts.find((a) => a.id === params.bankAccountId) : null) ||
    unitFilteredAccounts.find((a) => a.apiProvider === 'santander' && a.isDefaultBoletoAccount && a.apiIntegrationEnabled) ||
    unitFilteredAccounts.find((a) => a.apiProvider === 'santander' && a.apiIntegrationEnabled) ||
    unitFilteredAccounts.find((a) => a.apiProvider === 'santander') ||
    unitFilteredAccounts[0] ||
    null;

  if (!targetAccount) {
    return {
      account: null,
      executionMode: 'homologation_offline' as SantanderExecutionMode,
      environment: 'sandbox' as SantanderEnvironment,
      period: { startDate, endDate },
      openCount: 0,
      withChargeCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      readyToSettleCount: 0,
      eligibleTitles: [] as SyncOpenTitleItem[],
    };
  }

  const loaded = await getOrInitSantanderConfigForAccount(targetAccount.id);
  const config = loaded?.config;
  const rawTitles =
    params.allowedUnitIds === null
      ? await db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER'))
      : params.allowedUnitIds.length > 0
      ? await db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.scope, 'RECEBER'), inArray(financialTitles.unitId, params.allowedUnitIds)))
      : [];

  const openTitles = rawTitles.filter((t) => {
    if (!isTitleOpenForReceberSync(t)) return false;
    if (targetAccount.unitId && t.unitId !== targetAccount.unitId) return false;
    if (t.bankAccountId && t.bankAccountId !== targetAccount.id) return false;
    const dueIso = new Date(t.dueDate).toISOString().slice(0, 10);
    if (startDate && dueIso < startDate) return false;
    if (endDate && dueIso > endDate) return false;
    return true;
  });

  const clientIds = Array.from(new Set(openTitles.map((t) => t.clientId)));
  const clientRows =
    clientIds.length > 0 ? await db.select().from(clients).where(inArray(clients.id, clientIds)) : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(todayIso);

  let withChargeCount = 0;
  let overdueCount = 0;
  let dueTodayCount = 0;
  let readyToSettleCount = 0;

  const eligibleTitles: SyncOpenTitleItem[] = openTitles
    .map((t) => {
      const dueIso = new Date(t.dueDate).toISOString().slice(0, 10);
      const daysOverdue =
        dueIso < todayIso ? Math.max(1, Math.floor((todayMs - Date.parse(dueIso)) / 86400000)) : 0;
      const hasBoleto = Boolean(t.santanderBankSlipId || t.barcode || t.digitableLine);
      const hasPix = Boolean(t.pixTxid || t.pixCopiaECola);
      const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;

      if (hasBoleto || hasPix) withChargeCount++;
      if (daysOverdue > 0) overdueCount++;
      if (dueIso === todayIso) dueTodayCount++;
      if (isStatusLiquidated(t.santanderStatus) || isStatusLiquidated(t.pixStatus)) readyToSettleCount++;

      return {
        titleId: t.id,
        titleCode: t.titleCode,
        documentNumber: t.documentNumber || t.titleCode,
        description: t.description || '',
        clientId: t.clientId,
        clientName: clientMap.get(t.clientId)?.fullName || t.clientName || 'Cliente',
        unitId: t.unitId,
        dueDate: new Date(t.dueDate).toISOString(),
        paidAt: t.paidAt ? new Date(t.paidAt).toISOString() : null,
        amountCents: t.amountCents,
        balanceCents: bal,
        settledCents: 0,
        daysOverdue,
        hasBoleto,
        hasPix,
        ourNumber: t.ourNumber || '',
        digitableLine: t.digitableLine || '',
        pixTxid: t.pixTxid || '',
        santanderStatus: t.santanderStatus || '',
        pixStatus: t.pixStatus || '',
        channel: 'PENDENTE' as const,
        bankReason:
          daysOverdue > 0
            ? `Vencido há ${daysOverdue} dia(s)`
            : dueIso === todayIso
            ? 'Vencimento hoje'
            : 'A vencer',
        movementId: null,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    account: targetAccount,
    executionMode: (config?.executionMode === 'live_mtls' ? 'live_mtls' : 'homologation_offline') as SantanderExecutionMode,
    environment: (config?.environment === 'production' ? 'production' : 'sandbox') as SantanderEnvironment,
    period: { startDate, endDate },
    openCount: openTitles.length,
    withChargeCount,
    overdueCount,
    dueTodayCount,
    readyToSettleCount,
    eligibleTitles,
  };
}

export async function syncSantanderOpenTitlesSettlements(params: {
  bankAccountId: number;
  allowedUnitIds: number[] | null;
  simulateLiquidatedTitleIds?: number[];
  startDate?: string | null;
  endDate?: string | null;
  settlementDate?: string;
  actorName: string;
  actorId?: number | null;
}) {
  const startDate = normalizeIsoDateParam(params.startDate);
  const endDate = normalizeIsoDateParam(params.endDate);
  if (startDate && endDate && startDate > endDate) {
    throw new Error('A data inicial do período não pode ser maior que a data final.');
  }

  const loaded = await getOrInitSantanderConfigForAccount(params.bankAccountId);
  if (!loaded) throw new Error('Conta corrente não encontrada.');
  const { account, config } = loaded;

  if (account.apiProvider !== 'santander') {
    throw new Error(`A conta "${account.bankName}" não possui API Santander vinculada.`);
  }
  if (params.allowedUnitIds !== null && account.unitId !== null && !params.allowedUnitIds.includes(account.unitId)) {
    throw new Error('Sem permissão para operar esta conta corrente.');
  }

  const rawTitles =
    params.allowedUnitIds === null
      ? await db.select().from(financialTitles).where(eq(financialTitles.scope, 'RECEBER'))
      : params.allowedUnitIds.length > 0
      ? await db
          .select()
          .from(financialTitles)
          .where(and(eq(financialTitles.scope, 'RECEBER'), inArray(financialTitles.unitId, params.allowedUnitIds)))
      : [];

  const openTitles = rawTitles.filter((t) => {
    if (!isTitleOpenForReceberSync(t)) return false;
    if (account.unitId && t.unitId !== account.unitId) return false;
    if (t.bankAccountId && t.bankAccountId !== account.id) return false;
    const dueIso = new Date(t.dueDate).toISOString().slice(0, 10);
    if (startDate && dueIso < startDate) return false;
    if (endDate && dueIso > endDate) return false;
    return true;
  });

  const clientIds = Array.from(new Set(openTitles.map((t) => t.clientId)));
  const clientRows =
    clientIds.length > 0 ? await db.select().from(clients).where(inArray(clients.id, clientIds)) : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  const isLive = config.executionMode === 'live_mtls';
  const simulateSet = new Set(isLive ? [] : params.simulateLiquidatedTitleIds || []);

  const fallbackSettlementDate =
    params.settlementDate && /^\d{4}-\d{2}-\d{2}$/.test(params.settlementDate)
      ? new Date(`${params.settlementDate}T12:00:00.000Z`)
      : new Date();
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(todayIso);

  const baixados: SyncOpenTitleItem[] = [];
  const vencidos: SyncOpenTitleItem[] = [];
  const esperados: SyncOpenTitleItem[] = [];

  for (const t of openTitles) {
    const dueIso = new Date(t.dueDate).toISOString().slice(0, 10);
    const daysOverdue =
      dueIso < todayIso ? Math.max(1, Math.floor((todayMs - Date.parse(dueIso)) / 86400000)) : 0;
    const hasBoleto = Boolean(t.santanderBankSlipId || t.barcode || t.digitableLine);
    const hasPix = Boolean(t.pixTxid || t.pixCopiaECola);
    const bal = t.currentBalanceCents > 0 ? t.currentBalanceCents : t.amountCents;
    const clientName = clientMap.get(t.clientId)?.fullName || t.clientName || 'Cliente';

    let remoteBoletoStatus = t.santanderStatus || '';
    let remotePixStatus = t.pixStatus || '';
    let isPaidAtBank = false;
    let channel: 'BOLETO' | 'PIX' | 'HOMOLOGACAO' | 'PENDENTE' = 'PENDENTE';
    let settledCents = bal;
    let bankReason = '';
    let effectivePaidDate = fallbackSettlementDate;

    if (isLive && (t.santanderBankSlipId || t.pixTxid)) {
      try {
        const consulted = await consultSantanderTitleStatus({
          titleId: t.id,
          actorName: params.actorName,
        });
        const boletoRemote = consulted.summary.boletoRemote as Record<string, unknown> | undefined;
        const pixRemote = consulted.summary.pixRemote as Record<string, unknown> | undefined;

        if (boletoRemote) {
          remoteBoletoStatus = String(boletoRemote.status || consulted.title.santanderStatus || remoteBoletoStatus);
          if (isStatusLiquidated(remoteBoletoStatus)) {
            isPaidAtBank = true;
            channel = 'BOLETO';
            const rawPaid = Number(boletoRemote.paidValue ?? boletoRemote.nominalValue ?? 0);
            if (Number.isFinite(rawPaid) && rawPaid > 0) {
              settledCents = Math.round(rawPaid * 100);
            }
            const rawPaidDate = boletoRemote.settlementDate ?? boletoRemote.paymentDate;
            if (typeof rawPaidDate === 'string' && !Number.isNaN(Date.parse(rawPaidDate))) {
              effectivePaidDate = new Date(rawPaidDate);
            }
            bankReason = `Liquidado via Boleto Santander (${remoteBoletoStatus})`;
          }
        }

        if (!isPaidAtBank && pixRemote) {
          remotePixStatus = String(pixRemote.status || consulted.title.pixStatus || remotePixStatus);
          const pixArr = Array.isArray(pixRemote.pix)
            ? (pixRemote.pix as Array<{ valor?: string; horario?: string }>)
            : [];
          if (isStatusLiquidated(remotePixStatus) || pixArr.length > 0) {
            isPaidAtBank = true;
            channel = 'PIX';
            const pixVal = Number(pixArr[0]?.valor || 0);
            if (Number.isFinite(pixVal) && pixVal > 0) {
              settledCents = Math.round(pixVal * 100);
            }
            if (typeof pixArr[0]?.horario === 'string' && !Number.isNaN(Date.parse(pixArr[0].horario))) {
              effectivePaidDate = new Date(pixArr[0].horario);
            }
            bankReason = `Liquidado via PIX Santander (${remotePixStatus || 'CONCLUIDA'})`;
          }
        }
      } catch (consultErr) {
        bankReason =
          consultErr instanceof Error
            ? `Falha ao consultar API Santander: ${consultErr.message}`
            : 'Falha ao consultar API Santander';
      }
    } else {
      if (isStatusLiquidated(t.santanderStatus)) {
        isPaidAtBank = true;
        channel = 'BOLETO';
        bankReason = `Boleto com liquidação confirmada (${t.santanderStatus})`;
      } else if (isStatusLiquidated(t.pixStatus)) {
        isPaidAtBank = true;
        channel = 'PIX';
        bankReason = `PIX com liquidação confirmada (${t.pixStatus})`;
      } else if (simulateSet.has(t.id)) {
        isPaidAtBank = true;
        channel = hasPix && !hasBoleto ? 'PIX' : hasBoleto ? 'BOLETO' : 'HOMOLOGACAO';
        remoteBoletoStatus = hasBoleto ? 'LIQUIDADO_HOMOLOGACAO' : remoteBoletoStatus;
        remotePixStatus = hasPix ? 'CONCLUIDA_HOMOLOGACAO' : remotePixStatus;
        bankReason = 'Liquidação confirmada no retorno de homologação Santander';
      }
    }

    const effectivePaidIso = effectivePaidDate.toISOString().slice(0, 10);

    if (isPaidAtBank) {
      const movId = await db.transaction(async (tx) => {
        let resolvedCatName = 'Recebimento API Santander';
        if (t.chartAccountId) {
          const [catRow] = await tx
            .select()
            .from(chartOfAccounts)
            .where(eq(chartOfAccounts.id, t.chartAccountId))
            .limit(1);
          if (catRow) resolvedCatName = `${catRow.code} - ${catRow.name}`;
        }

        const [createdMov] = await tx
          .insert(bankMovements)
          .values({
            bankAccountId: account.id,
            movementType: 'CREDITO',
            amountCents: settledCents,
            description: `Baixa API ${account.bankName} - ${t.documentNumber || t.titleCode} (${clientName})`,
            documentNumber: t.documentNumber || t.titleCode,
            movementDate: effectivePaidDate,
            categoryId: t.chartAccountId ?? null,
            categoryName: resolvedCatName,
            origin: 'BAIXA_RECEBER',
            status: 'CONCILIADO',
            reconciled: true,
            reconciliationDate: effectivePaidIso,
            compensationDate: effectivePaidIso,
            titleId: t.id,
            titleSource: 'RECEBER',
            unitId: t.unitId,
          })
          .returning();

        await tx
          .update(bankAccounts)
          .set({ currentBalanceCents: sql`${bankAccounts.currentBalanceCents} + ${settledCents}` })
          .where(eq(bankAccounts.id, account.id));

        const interestExtra = Math.max(0, settledCents - bal);
        await tx.insert(titleSettlements).values({
          titleId: t.id,
          settlementDate: effectivePaidDate,
          principalCents: Math.min(bal, settledCents),
          interestCents: interestExtra,
          fineCents: 0,
          discountCents: 0,
          amountCents: settledCents,
          origin: 'BAIXA API SANTANDER',
          paymentMethod: channel === 'PIX' ? 'PIX QR Code Santander' : 'Boleto Santander API',
          history: bankReason,
          bankAccountId: account.id,
          movementId: createdMov.id,
          batchUuid: crypto.randomUUID(),
          createdByName: params.actorName,
        });

        await tx
          .update(financialTitles)
          .set({
            currentBalanceCents: 0,
            status: 'pago',
            paidAt: effectivePaidDate,
            bankAccountId: account.id,
            santanderStatus: remoteBoletoStatus || 'LIQUIDADO',
            ...(remotePixStatus ? { pixStatus: remotePixStatus } : {}),
            collectorId: params.actorId ?? t.collectorId,
            updatedAt: new Date(),
          })
          .where(eq(financialTitles.id, t.id));

        await tx.insert(auditLogs).values({
          userId: params.actorId ?? null,
          userName: params.actorName,
          action: 'SETTLE_TITLE_SANTANDER_API',
          entityType: 'CONTAS_RECEBER',
          entityId: String(t.id),
          details: {
            channel,
            settledCents,
            bankAccountId: account.id,
            bankName: account.bankName,
            movementId: createdMov.id,
            bankReason,
            period: { startDate, endDate },
          },
          unitId: t.unitId,
        });

        return createdMov.id;
      });

      baixados.push({
        titleId: t.id,
        titleCode: t.titleCode,
        documentNumber: t.documentNumber || t.titleCode,
        description: t.description || '',
        clientId: t.clientId,
        clientName,
        unitId: t.unitId,
        dueDate: new Date(t.dueDate).toISOString(),
        paidAt: effectivePaidDate.toISOString(),
        amountCents: t.amountCents,
        balanceCents: 0,
        settledCents,
        daysOverdue,
        hasBoleto,
        hasPix,
        ourNumber: t.ourNumber || '',
        digitableLine: t.digitableLine || '',
        pixTxid: t.pixTxid || '',
        santanderStatus: remoteBoletoStatus || 'LIQUIDADO',
        pixStatus: remotePixStatus,
        channel,
        bankReason,
        movementId: movId,
      });
    } else {
      const reasonText =
        bankReason ||
        (daysOverdue > 0
          ? hasBoleto || hasPix
            ? `Sem retorno de pagamento no Santander · Vencido há ${daysOverdue} dia(s)`
            : `Sem boleto/PIX emitido · Vencido há ${daysOverdue} dia(s)`
          : dueIso === todayIso
          ? hasBoleto || hasPix
            ? 'Vencimento hoje — aguardando confirmação de pagamento na API'
            : 'Vencimento hoje — sem cobrança bancária emitida'
          : 'A vencer — sem liquidação antecipada');

      const item: SyncOpenTitleItem = {
        titleId: t.id,
        titleCode: t.titleCode,
        documentNumber: t.documentNumber || t.titleCode,
        description: t.description || '',
        clientId: t.clientId,
        clientName,
        unitId: t.unitId,
        dueDate: new Date(t.dueDate).toISOString(),
        paidAt: null,
        amountCents: t.amountCents,
        balanceCents: bal,
        settledCents: 0,
        daysOverdue,
        hasBoleto,
        hasPix,
        ourNumber: t.ourNumber || '',
        digitableLine: t.digitableLine || '',
        pixTxid: t.pixTxid || '',
        santanderStatus: remoteBoletoStatus,
        pixStatus: remotePixStatus,
        channel: 'PENDENTE',
        bankReason: reasonText,
        movementId: null,
      };

      if (daysOverdue > 0) {
        vencidos.push(item);
        esperados.push(item);
      } else if (dueIso === todayIso) {
        esperados.push(item);
      }
    }
  }

  await recordEmissionLog({
    bankAccountId: account.id,
    apiScope: 'boleto',
    operation: isLive ? 'SYNC_OPEN_TITLES_LIVE' : 'SYNC_OPEN_TITLES_HOMOLOGATION',
    environment: config.environment,
    executionMode: config.executionMode,
    endpoint: `${getBoletoBaseUrl(config)}/collection_bill_management/v2/workspaces`,
    httpStatus: 200,
    ok: true,
    requestSummaryJson: {
      totalOpenChecked: openTitles.length,
      simulatedCount: simulateSet.size,
      startDate,
      endDate,
    },
    responseSummaryJson: {
      baixadosCount: baixados.length,
      vencidosCount: vencidos.length,
      esperadosCount: esperados.length,
    },
    createdByName: params.actorName,
  });

  const sumCents = (arr: SyncOpenTitleItem[], key: 'settledCents' | 'balanceCents') =>
    arr.reduce((acc, it) => acc + (it[key] || 0), 0);

  return {
    syncedAt: new Date().toISOString(),
    bankAccount: account,
    executionMode: config.executionMode,
    environment: config.environment,
    period: { startDate, endDate },
    summary: {
      totalChecked: openTitles.length,
      baixadosCount: baixados.length,
      baixadosTotalCents: sumCents(baixados, 'settledCents'),
      vencidosCount: vencidos.length,
      vencidosTotalCents: sumCents(vencidos, 'balanceCents'),
      esperadosCount: esperados.length,
      esperadosTotalCents: sumCents(esperados, 'balanceCents'),
    },
    baixados,
    vencidos,
    esperados,
  };
}


