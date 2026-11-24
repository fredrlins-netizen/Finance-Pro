import crypto from 'node:crypto';
import { toGotalkPhone } from './gotalk.ts';

/**
 * UaZapiGO V2 Official API Client (https://docs.uazapi.com/)
 * - Auth header: `token: <INSTANCE_TOKEN>`
 * - Endpoints aligned 100% with openapi-bundled.json (V2):
 *   - GET  /instance/status
 *   - POST /instance/connect
 *   - POST /instance/disconnect
 *   - POST /send/text        { number, text }
 *   - POST /send/media       { number, type, file, text?, docName?, mimetype? }
 *   - POST /chat/find
 *   - POST /message/find
 *   - POST /chat/check
 *   - POST /message/presence
 *   - GET|POST /webhook
 */

export const DEFAULT_UAZAPI_SERVER_URL = (process.env.UAZAPI_SERVER_URL || 'https://centralhub.uazapi.com').replace(/\/$/, '');

let _lastWebhookAt: string | null = null;
let _lastError: string | null = null;
let _lastCheckAt: string | null = null;

interface UazapiGlobalOverride {
  serverUrl: string | null;
  adminToken: string | null;
  webhookSecret: string | null;
}

let _uazapiGlobalOverride: UazapiGlobalOverride = {
  serverUrl: null,
  adminToken: null,
  webhookSecret: null,
};

export function setUazapiGlobalOverride(cfg: Partial<UazapiGlobalOverride> | null): void {
  _uazapiGlobalOverride = {
    serverUrl: cfg?.serverUrl?.trim() ? cfg.serverUrl.trim().replace(/\/$/, '') : null,
    adminToken: cfg?.adminToken?.trim() || null,
    webhookSecret: cfg?.webhookSecret?.trim() || null,
  };
}

export function getDefaultUazapiServerUrl(): string {
  return (_uazapiGlobalOverride.serverUrl || process.env.UAZAPI_SERVER_URL || 'https://centralhub.uazapi.com').replace(/\/$/, '');
}

export function getUazapiAdminToken(): string | null {
  return _uazapiGlobalOverride.adminToken || process.env.UAZAPI_ADMIN_TOKEN?.trim() || null;
}

export function getUazapiWebhookSecret(): string | null {
  return _uazapiGlobalOverride.webhookSecret || process.env.UAZAPI_WEBHOOK_SECRET?.trim() || null;
}

export function markUazapiWebhookReceived(): void {
  _lastWebhookAt = new Date().toISOString();
}

export function setUazapiLastError(err: string | null): void {
  _lastError = err;
}

export function markUazapiChecked(): void {
  _lastCheckAt = new Date().toISOString();
}

export function getUazapiGlobalRuntimeState() {
  const hasDbGlobal = Boolean(_uazapiGlobalOverride.serverUrl || _uazapiGlobalOverride.adminToken || _uazapiGlobalOverride.webhookSecret);
  const hasEnvGlobal = Boolean(process.env.UAZAPI_TOKEN?.trim() || process.env.UAZAPI_ADMIN_TOKEN?.trim());
  return {
    envConfigured: hasEnvGlobal || Boolean(_uazapiGlobalOverride.adminToken),
    adminTokenConfigured: Boolean(getUazapiAdminToken()),
    source: (hasDbGlobal ? 'database' : hasEnvGlobal ? 'env' : 'none') as 'database' | 'env' | 'none',
    defaultServerUrl: getDefaultUazapiServerUrl(),
    encryptionKeyDedicated: Boolean(process.env.ENCRYPTION_KEY?.trim()),
    webhookSecretConfigured: Boolean(getUazapiWebhookSecret()),
    lastWebhookAt: _lastWebhookAt,
    lastCheckAt: _lastCheckAt,
    lastError: _lastError,
  };
}

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption for per-unit tokens in Cloud SQL
// ---------------------------------------------------------------------------
function deriveAesKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SQL_PASSWORD?.trim() ||
    'financepro-uazapi-local-key';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptUazapiToken(plaintext: string): string {
  const key = deriveAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptUazapiToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [ivHex, authTagHex, dataHex] = stored.split(':');
    if (!ivHex || !authTagHex || !dataHex) return null;
    const key = deriveAesKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types & Helpers
// ---------------------------------------------------------------------------
export interface UazapiCredentials {
  unitId?: number;
  instanceId?: string | null;
  label?: string;
  serverUrl: string;
  token: string;
}

export interface UazapiSendResult {
  dispatched: boolean;
  provider: string;
  externalMessageId?: string | null;
  detail?: string;
}

export function getEnvUazapiCredentials(): UazapiCredentials | null {
  const token = process.env.UAZAPI_TOKEN?.trim();
  if (!token) return null;
  return {
    instanceId: process.env.UAZAPI_INSTANCE_ID?.trim() || 'default-env',
    label: 'Instância Padrão (Secrets)',
    serverUrl: getDefaultUazapiServerUrl(),
    token,
  };
}

export async function uazapiFetch(
  creds: Pick<UazapiCredentials, 'serverUrl' | 'token'>,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = (creds.serverUrl || getDefaultUazapiServerUrl()).replace(/\/$/, '');
  const url = `${baseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      token: creds.token,
      ...(options.headers as Record<string, string> | undefined),
    },
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
}

function pickStringId(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function extractJidPhone(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const clean = raw.split(':')[0].split('@')[0].replace(/\D/g, '');
    return clean || null;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.user === 'string') {
      const clean = o.user.split(':')[0].replace(/\D/g, '');
      return clean || null;
    }
  }
  return null;
}

export interface UazapiInstanceStatusParsed {
  ok: boolean;
  httpStatus: number;
  connected: boolean;
  loggedIn: boolean;
  instanceId: string | null;
  instanceName: string | null;
  profileName: string | null;
  connectedPhone: string | null;
  qrCode: string | null;
  pairCode: string | null;
  rawStatusText: string | null;
  error?: string;
}

export function parseUazapiStatusPayload(data: Record<string, unknown>, httpStatus = 200): UazapiInstanceStatusParsed {
  const inst = (data.instance && typeof data.instance === 'object' ? data.instance : {}) as Record<string, unknown>;
  const st = (data.status && typeof data.status === 'object' ? data.status : {}) as Record<string, unknown>;

  const openStates = ['open', 'connected', 'online'];
  const instStatus = String(inst.status || inst.state || data.state || (typeof data.status === 'string' ? data.status : '')).toLowerCase();
  const connected =
    data.connected === true ||
    st.connected === true ||
    st.loggedIn === true ||
    inst.connected === true ||
    openStates.includes(instStatus);

  const loggedIn = st.loggedIn === true || data.loggedIn === true || connected;
  const connectedPhone =
    extractJidPhone(st.jid) ||
    extractJidPhone(data.jid) ||
    extractJidPhone(inst.owner) ||
    extractJidPhone(inst.phoneNumber) ||
    extractJidPhone(inst.phone) ||
    extractJidPhone(data.phone) ||
    null;

  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    httpStatus,
    connected,
    loggedIn,
    instanceId: pickStringId(inst.id, data.instanceId, inst.name, data.instanceName),
    instanceName: pickStringId(inst.name, data.instanceName),
    profileName: pickStringId(inst.profileName, data.profileName),
    connectedPhone,
    qrCode: pickStringId(inst.qrcode, data.qrcode, data.qrBase64, data.code),
    pairCode: pickStringId(inst.paircode, data.paircode, data.pairingCode),
    rawStatusText: instStatus || null,
  };
}

export async function getUazapiInstanceStatus(creds: UazapiCredentials): Promise<UazapiInstanceStatusParsed> {
  try {
    const resp = await uazapiFetch(creds, '/instance/status', { method: 'GET' });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    markUazapiChecked();
    if (!resp.ok) {
      const errMsg = String(data.message || data.error || `HTTP ${resp.status}`);
      setUazapiLastError(errMsg);
      return {
        ok: false,
        httpStatus: resp.status,
        connected: false,
        loggedIn: false,
        instanceId: creds.instanceId || null,
        instanceName: null,
        profileName: null,
        connectedPhone: null,
        qrCode: null,
        pairCode: null,
        rawStatusText: null,
        error: resp.status === 401 ? 'Token UaZapi inválido ou expirado (HTTP 401).' : errMsg,
      };
    }
    setUazapiLastError(null);
    return parseUazapiStatusPayload(data, resp.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de conexão com servidor UaZapi';
    setUazapiLastError(msg);
    return {
      ok: false,
      httpStatus: 0,
      connected: false,
      loggedIn: false,
      instanceId: creds.instanceId || null,
      instanceName: null,
      profileName: null,
      connectedPhone: null,
      qrCode: null,
      pairCode: null,
      rawStatusText: null,
      error: msg,
    };
  }
}

export async function connectUazapiInstance(
  creds: UazapiCredentials,
  phone?: string
): Promise<UazapiInstanceStatusParsed> {
  const body: Record<string, unknown> = {};
  if (phone) body.phone = toGotalkPhone(phone);

  const resp = await uazapiFetch(creds, '/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

  if (resp.status === 404 || resp.status === 409) {
    // Some UaZapi versions return 404/409 on /instance/connect when already connected
    const statusCheck = await getUazapiInstanceStatus(creds);
    if (statusCheck.connected) return statusCheck;
  }

  if (!resp.ok) {
    const errMsg = String(data.message || data.error || `HTTP ${resp.status}`);
    return {
      ...parseUazapiStatusPayload(data, resp.status),
      ok: false,
      error: errMsg,
    };
  }

  return parseUazapiStatusPayload(data, resp.status);
}

export async function disconnectUazapiInstance(creds: UazapiCredentials): Promise<{ ok: boolean; error?: string }> {
  const resp = await uazapiFetch(creds, '/instance/disconnect', { method: 'POST' });
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: false, error: String(data.message || data.error || `HTTP ${resp.status}`) };
  }
  return { ok: true };
}

export async function sendUazapiText(
  creds: UazapiCredentials | null,
  phone: string,
  text: string
): Promise<UazapiSendResult> {
  if (!creds?.token) {
    return {
      dispatched: false,
      provider: 'uazapi_local_queue',
      detail: 'UAZAPI_TOKEN não configurado — mensagem salva na fila local.',
    };
  }
  const number = toGotalkPhone(phone);
  try {
    const resp = await uazapiFetch(creds, '/send/text', {
      method: 'POST',
      body: JSON.stringify({ number, text }),
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const errMsg = String(data.message || data.error || `UaZapi HTTP ${resp.status}`);
      setUazapiLastError(errMsg);
      return {
        dispatched: false,
        provider: 'uazapi_api_error',
        detail: errMsg,
      };
    }
    const keyObj = (data.key && typeof data.key === 'object' ? data.key : null) as Record<string, unknown> | null;
    const idObj = (data.id && typeof data.id === 'object' ? data.id : null) as Record<string, unknown> | null;
    const externalMessageId = pickStringId(keyObj?.id, idObj?.id, data.messageid, data.id);
    setUazapiLastError(null);
    return {
      dispatched: true,
      provider: 'uazapi_v2',
      externalMessageId,
      detail: 'Enviado via UaZapi V2 (/send/text).',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de rede UaZapi';
    setUazapiLastError(msg);
    return {
      dispatched: false,
      provider: 'uazapi_network_error',
      detail: msg,
    };
  }
}

export async function sendUazapiMedia(
  creds: UazapiCredentials | null,
  params: {
    phone: string;
    type: 'image' | 'video' | 'document' | 'audio' | 'ptt' | 'sticker';
    file: string; // URL or base64 data URI
    caption?: string;
    fileName?: string;
    mimeType?: string;
  }
): Promise<UazapiSendResult> {
  if (!creds?.token) {
    return {
      dispatched: false,
      provider: 'uazapi_local_queue',
      detail: 'UAZAPI_TOKEN não configurado — mídia salva localmente.',
    };
  }
  const number = toGotalkPhone(params.phone);
  const body: Record<string, unknown> = {
    number,
    type: params.type,
    file: params.file,
  };
  if (params.caption) body.text = params.caption;
  if (params.fileName) body.docName = params.fileName;
  if (params.mimeType) body.mimetype = params.mimeType;

  try {
    const resp = await uazapiFetch(creds, '/send/media', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const errMsg = String(data.message || data.error || `UaZapi Media HTTP ${resp.status}`);
      return { dispatched: false, provider: 'uazapi_api_error', detail: errMsg };
    }
    const keyObj = (data.key && typeof data.key === 'object' ? data.key : null) as Record<string, unknown> | null;
    const idObj = (data.id && typeof data.id === 'object' ? data.id : null) as Record<string, unknown> | null;
    const externalMessageId = pickStringId(keyObj?.id, idObj?.id, data.messageid, data.id);
    return {
      dispatched: true,
      provider: 'uazapi_v2_media',
      externalMessageId,
      detail: 'Mídia enviada via UaZapi V2 (/send/media).',
    };
  } catch (err) {
    return {
      dispatched: false,
      provider: 'uazapi_network_error',
      detail: err instanceof Error ? err.message : 'Erro ao enviar mídia via UaZapi',
    };
  }
}

export async function findUazapiChats(
  creds: UazapiCredentials,
  limit = 20,
  offset = 0
): Promise<Array<{ chatId: string; name: string; phone: string; unreadCount: number; lastMessagePreview: string }>> {
  const resp = await uazapiFetch(creds, '/chat/find', {
    method: 'POST',
    body: JSON.stringify({ limit, offset, compact: true, sort: '-wa_lastMsgTimestamp' }),
  });
  if (!resp.ok) return [];
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const list = (Array.isArray(data) ? data : data.chats || data.data || []) as Array<Record<string, unknown>>;
  return list
    .map((c) => {
      const chatId = String(c.wa_chatid || c.chatid || c.jid || c.id || '').trim();
      if (!chatId || chatId.endsWith('@g.us') || c.wa_isGroup === true) return null;
      const phone = chatId.split('@')[0].replace(/\D/g, '');
      if (!phone) return null;
      return {
        chatId,
        name: String(c.wa_contactName || c.wa_name || c.name || c.pushName || phone).trim(),
        phone,
        unreadCount: Number(c.wa_unreadCount || c.unreadCount || 0),
        lastMessagePreview: String(c.wa_lastMessageText || c.lastMessageText || c.lastText || '').slice(0, 70),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export async function findUazapiMessages(
  creds: UazapiCredentials,
  chatid: string,
  limit = 30
): Promise<Array<{ id: string; fromMe: boolean; type: string; body: string; timestampMs: number; senderName?: string }>> {
  const resp = await uazapiFetch(creds, '/message/find', {
    method: 'POST',
    body: JSON.stringify({ chatid, limit, offset: 0 }),
  });
  if (!resp.ok) return [];
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const list = (Array.isArray(data) ? data : data.messages || data.data || []) as Array<Record<string, unknown>>;
  return list
    .map((m) => {
      const id = pickStringId(m.messageid, m.id, (m.key as Record<string, unknown> | undefined)?.id);
      if (!id) return null;
      const mt = String(m.messageType || m.type || '').toLowerCase();
      const type = mt.includes('audio') || mt.includes('ptt')
        ? 'audio'
        : mt.includes('image')
        ? 'image'
        : mt.includes('document')
        ? 'document'
        : 'text';
      const ts = Number(m.messageTimestamp || m.timestamp || 0);
      const timestampMs = ts > 0 && ts < 1e12 ? ts * 1000 : ts || Date.now();
      return {
        id,
        fromMe: m.fromMe === true,
        type,
        body: String(m.text || m.body || m.caption || m.content || (type !== 'text' ? `[${type.toUpperCase()}]` : '')).trim(),
        timestampMs,
        senderName: typeof m.senderName === 'string' ? m.senderName : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export async function registerUazapiWebhook(
  creds: UazapiCredentials,
  webhookUrl: string
): Promise<{ ok: boolean; status: number; detail?: string }> {
  const resp = await uazapiFetch(creds, '/webhook', {
    method: 'POST',
    body: JSON.stringify({
      enabled: true,
      url: webhookUrl,
      events: ['messages', 'messages_update', 'connection'],
      excludeMessages: ['wasSentByApi'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    }),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      detail: String(data.message || data.error || `HTTP ${resp.status}`),
    };
  }
  return { ok: true, status: resp.status };
}

export async function getUazapiWebhookConfig(creds: UazapiCredentials): Promise<{ ok: boolean; webhooks: unknown }> {
  const resp = await uazapiFetch(creds, '/webhook', { method: 'GET' });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, webhooks: data };
}

export interface UazapiAdminDiscoveredInstance {
  id: string;
  name: string;
  token: string;
  status: string;
  connected: boolean;
  profileName: string | null;
  ownerPhone: string | null;
}

export async function fetchUazapiInstancesWithAdminToken(
  serverUrl: string,
  adminToken: string
): Promise<{ ok: boolean; httpStatus: number; instances: UazapiAdminDiscoveredInstance[]; error?: string }> {
  const baseUrl = (serverUrl || getDefaultUazapiServerUrl()).replace(/\/$/, '');
  try {
    const resp = await fetch(`${baseUrl}/instance/all`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        admintoken: adminToken.trim(),
      },
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !Array.isArray(data)) {
      const msg =
        data && typeof data === 'object'
          ? String((data as Record<string, unknown>).message || (data as Record<string, unknown>).error || `HTTP ${resp.status}`)
          : `HTTP ${resp.status}`;
      return { ok: false, httpStatus: resp.status, instances: [], error: msg };
    }
    const instances: UazapiAdminDiscoveredInstance[] = data
      .map((item) => {
        const o = (item || {}) as Record<string, unknown>;
        const id = pickStringId(o.id, o.name);
        const token = pickStringId(o.token);
        if (!id || !token) return null;
        const st = String(o.status || '').toLowerCase();
        return {
          id,
          name: pickStringId(o.name) || id,
          token,
          status: st || 'unknown',
          connected: st === 'connected' || st === 'open' || st === 'online',
          profileName: pickStringId(o.profileName),
          ownerPhone: extractJidPhone(o.owner) || extractJidPhone(o.jid) || null,
        };
      })
      .filter((x): x is UazapiAdminDiscoveredInstance => Boolean(x));

    return { ok: true, httpStatus: resp.status, instances };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      instances: [],
      error: err instanceof Error ? err.message : 'Erro ao consultar /instance/all no UaZapi',
    };
  }
}

export interface UazapiCallResult {
  dispatched: boolean;
  callId: string | null;
  status: 'initiated' | 'ringing' | 'ended' | 'failed';
  detail: string;
  fromNumber?: string | null;
}

export async function makeUazapiCall(
  creds: UazapiCredentials | null,
  phone: string,
  isVideo = false
): Promise<UazapiCallResult> {
  if (!creds?.token) {
    return {
      dispatched: false,
      callId: null,
      status: 'failed',
      detail: 'Nenhuma instância UaZapi conectada ou token não configurado para esta unidade.',
    };
  }
  const number = toGotalkPhone(phone);
  if (!number || number.length < 10) {
    return {
      dispatched: false,
      callId: null,
      status: 'failed',
      detail: 'Número de telefone inválido para discagem UaZapi.',
    };
  }
  const to = `${number}@s.whatsapp.net`;
  try {
    const resp = await uazapiFetch(creds, '/calls/offer', {
      method: 'POST',
      body: JSON.stringify({ to, isVideo }),
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const errMsg = String(data.message || data.error || `UaZapi /calls/offer HTTP ${resp.status}`);
      setUazapiLastError(errMsg);
      return {
        dispatched: false,
        callId: null,
        status: 'failed',
        detail: errMsg,
      };
    }
    const callId = pickStringId(
      data.callId,
      data.id,
      (data.call as Record<string, unknown> | undefined)?.id,
      (data.data as Record<string, unknown> | undefined)?.callId
    );
    setUazapiLastError(null);
    return {
      dispatched: true,
      callId: callId || `uaz-call-${Date.now()}`,
      status: 'initiated',
      detail: 'Chamada de voz disparada pela API UaZapi (/calls/offer).',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de comunicação com UaZapi (/calls/offer)';
    setUazapiLastError(msg);
    return {
      dispatched: false,
      callId: null,
      status: 'failed',
      detail: msg,
    };
  }
}

export async function terminateUazapiCall(
  creds: UazapiCredentials | null,
  callId: string
): Promise<{ ok: boolean; detail: string }> {
  if (!creds?.token) {
    return { ok: false, detail: 'Instância UaZapi não configurada.' };
  }
  try {
    const resp = await uazapiFetch(creds, '/calls/terminate', {
      method: 'POST',
      body: JSON.stringify({ callId }),
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      return {
        ok: false,
        detail: String(data.message || data.error || `UaZapi /calls/terminate HTTP ${resp.status}`),
      };
    }
    return { ok: true, detail: 'Chamada encerrada via UaZapi.' };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Erro ao encerrar chamada na UaZapi',
    };
  }
}

