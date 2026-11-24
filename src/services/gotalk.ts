import crypto from 'node:crypto';

/**
 * GoTalk Official Authentication & Full API Client
 * Spec extracted from FinancePro GoTalk Integration Export:
 * - Auth: POST /user/login -> { login: { token, channelId } }
 * - Auto-renewal: 23h timer + automatic 401 retry
 * - Security: channelId is strictly server-side (stripChannelId before frontend responses)
 */

export const GOTALK_BASE_URL = (process.env.GOTALK_BASE_URL || 'https://app.gotalk.digital').replace(/\/$/, '');
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // 23h (refresh 1h before 24h expiry)
const ALLOWED_AUDIO_HOSTS = ['app.gotalk.digital', 'api.gotalk.digital', 'gotalk.digital'];

let _token: string | null = null;
let _channelId: string | number | null = null;
let _tokenExpiresAt = 0;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _lastAuthAt: string | null = null;
let _lastError: string | null = null;
let _lastWebhookAt: string | null = null;

interface GotalkRuntimeConfig {
  login: string | null;
  password: string | null;
  baseUrl: string | null;
  webhookSecret: string | null;
}

let _dbOverride: GotalkRuntimeConfig = {
  login: null,
  password: null,
  baseUrl: null,
  webhookSecret: null,
};

export function setGotalkConfigOverride(cfg: Partial<GotalkRuntimeConfig> | null): void {
  const prevLogin = _dbOverride.login;
  const prevPass = _dbOverride.password;
  const prevBase = _dbOverride.baseUrl;
  _dbOverride = {
    login: cfg?.login?.trim() || null,
    password: cfg?.password?.trim() || null,
    baseUrl: cfg?.baseUrl?.trim() ? cfg.baseUrl.trim().replace(/\/$/, '') : null,
    webhookSecret: cfg?.webhookSecret?.trim() || null,
  };
  if (
    prevLogin !== _dbOverride.login ||
    prevPass !== _dbOverride.password ||
    prevBase !== _dbOverride.baseUrl
  ) {
    _token = null;
    _channelId = null;
    _tokenExpiresAt = 0;
    if (_refreshTimer) {
      clearTimeout(_refreshTimer);
      _refreshTimer = null;
    }
  }
}

export function getGotalkBaseUrl(): string {
  return (_dbOverride.baseUrl || process.env.GOTALK_BASE_URL || 'https://app.gotalk.digital').replace(/\/$/, '');
}

export function getGotalkLoginValue(): string | null {
  return _dbOverride.login || process.env.GOTALK_LOGIN?.trim() || null;
}

export function getGotalkPasswordValue(): string | null {
  return _dbOverride.password || process.env.GOTALK_PASSWORD?.trim() || null;
}

export function getGotalkWebhookSecret(): string | null {
  return _dbOverride.webhookSecret || process.env.GOTALK_WEBHOOK_SECRET?.trim() || null;
}

export function getGotalkConfigSource(): 'database' | 'env' | 'none' {
  if (_dbOverride.login && _dbOverride.password) return 'database';
  if (process.env.GOTALK_LOGIN?.trim() && process.env.GOTALK_PASSWORD?.trim()) return 'env';
  return 'none';
}

export function isGotalkConfigured(): boolean {
  return Boolean(getGotalkLoginValue() && getGotalkPasswordValue());
}

export function isGotalkWebhookSecretConfigured(): boolean {
  return Boolean(getGotalkWebhookSecret());
}

export function markGotalkWebhookReceived(): void {
  _lastWebhookAt = new Date().toISOString();
}

export function getGotalkStatus() {
  return {
    configured: isGotalkConfigured(),
    source: getGotalkConfigSource(),
    login: getGotalkLoginValue(),
    hasPassword: Boolean(getGotalkPasswordValue()),
    webhookSecretConfigured: isGotalkWebhookSecretConfigured(),
    baseUrl: getGotalkBaseUrl(),
    authenticated: Boolean(_token && Date.now() < _tokenExpiresAt),
    hasPrimaryChannel: Boolean(_channelId),
    tokenExpiresAt: _tokenExpiresAt ? new Date(_tokenExpiresAt).toISOString() : null,
    lastAuthAt: _lastAuthAt,
    lastWebhookAt: _lastWebhookAt,
    lastError: _lastError,
  };
}

// ---------------------------------------------------------------------------
// Phone Normalization & BR Canonical Matching Key (from gotalkPoller.js)
// ---------------------------------------------------------------------------
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

export function toGotalkPhone(raw: string | null | undefined): string {
  const norm = normalizePhone(raw);
  if (!norm) return '';
  return norm.startsWith('55') ? norm : `55${norm}`;
}

/**
 * Canonical BR phone key: DDD + 8 digits (strips 55 and optional 9th mobile digit)
 * Prevents cross-DDD collisions while unifying 10-digit & 11-digit numbers.
 */
export function brPhoneKey(raw: string | null | undefined): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3);
  return d;
}

export function phonesMatchBR(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = brPhoneKey(a);
  const kb = brPhoneKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return Boolean(na && nb && na.slice(-10) === nb.slice(-10));
}

// ---------------------------------------------------------------------------
// Security Helpers (from webhook.js & routes/gotalk.js)
// ---------------------------------------------------------------------------
export function timingSafeEqualStr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Recursively strip technical channel_id / channelId before forwarding objects to frontend.
 */
export function stripChannelId<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map((item) => stripChannelId(item)) as unknown as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'channel_id' || k === 'channelId') continue;
      out[k] = stripChannelId(v);
    }
    return out as T;
  }
  return obj;
}

export function isAllowedAudioUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_AUDIO_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function parseAckValue(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return raw >= 1 && raw <= 4 ? Math.min(raw, 3) : null;
  }
  const map: Record<string, number> = {
    SERVER: 1,
    DEVICE: 2,
    READ: 3,
    PLAYED: 3,
    sent: 1,
    delivered: 2,
    read: 3,
    '1': 1,
    '2': 2,
    '3': 3,
  };
  return map[String(raw)] ?? null;
}

// ---------------------------------------------------------------------------
// Authentication & Resilient HTTP Client
// ---------------------------------------------------------------------------
export async function authenticate(): Promise<{ token: string; channelId: string | number | undefined }> {
  const login = getGotalkLoginValue();
  const password = getGotalkPasswordValue();
  const baseUrl = getGotalkBaseUrl();

  if (!login || !password) {
    const errMsg = '[Gotalk] Credenciais GoTalk (login e senha) não configuradas.';
    _lastError = errMsg;
    throw new Error(errMsg);
  }

  console.log('[Gotalk] Autenticando...');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (fetchErr: unknown) {
    const err = fetchErr as { cause?: { code?: string }; name?: string; message?: string };
    const code = err.cause?.code || '';
    let msg = `Erro de rede: ${err.message || 'desconhecido'}`;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      msg = `DNS: não foi possível resolver ${baseUrl} (${code}). Verifique conectividade de rede.`;
    } else if (code === 'ECONNREFUSED') {
      msg = `Conexão recusada por ${baseUrl} (ECONNREFUSED).`;
    } else if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      msg = `Timeout (>20s) ao autenticar com ${baseUrl}.`;
    }
    _lastError = msg;
    throw new Error(msg);
  }

  if (!response.ok) {
    const text = await response.text();
    const msg =
      response.status === 401 || response.status === 403
        ? `Credenciais inválidas (HTTP ${response.status}). Verifique login e senha GoTalk.`
        : `[Gotalk] Falha na autenticação: ${response.status} ${text}`;
    _lastError = msg;
    throw new Error(msg);
  }

  const data = (await response.json()) as {
    token?: string;
    channelId?: string | number;
    login?: { token?: string; channelId?: string | number };
  };

  const token = data?.login?.token || data?.token;
  const channelId = data?.login?.channelId ?? data?.channelId;

  if (!token) {
    const msg = '[Gotalk] Token não encontrado na resposta de autenticação.';
    _lastError = msg;
    throw new Error(msg);
  }

  _token = token;
  _channelId = channelId ?? null;
  _tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
  _lastAuthAt = new Date().toISOString();
  _lastError = null;

  console.log(`[Gotalk] Autenticado com sucesso.`);

  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    authenticate().catch((err) => console.error('[Gotalk] Erro ao renovar token:', err.message));
  }, TOKEN_LIFETIME_MS);

  return { token, channelId };
}

export async function getToken(): Promise<string> {
  if (!_token || Date.now() >= _tokenExpiresAt) {
    await authenticate();
  }
  return _token!;
}

export async function getChannelId(): Promise<string | number | null> {
  if (!_channelId || Date.now() >= _tokenExpiresAt) {
    await authenticate();
  }
  return _channelId;
}

export async function getAuthHeaders(opts?: { isFormData?: boolean; useBearer?: boolean }): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: opts?.useBearer ? `Bearer ${token}` : token,
  };
  if (!opts?.isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export async function gotalkFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = await getAuthHeaders({ isFormData, useBearer: false });
  const url = `${getGotalkBaseUrl()}${path}`;

  let response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
  });

  // Postman collection declares root Bearer auth on several routes and {{token}} header on others.
  // If raw token gets 401/403, try Bearer <token> first before forcing full re-login.
  if (response.status === 401 || response.status === 403) {
    const bearerHeaders = await getAuthHeaders({ isFormData, useBearer: true });
    const bearerResp = await fetch(url, {
      ...options,
      headers: { ...bearerHeaders, ...(options.headers as Record<string, string> | undefined) },
    });
    if (bearerResp.ok || (bearerResp.status !== 401 && bearerResp.status !== 403)) {
      return bearerResp;
    }

    if (response.status === 401) {
      _token = null;
      _tokenExpiresAt = 0;
      const retryHeaders = await getAuthHeaders({ isFormData, useBearer: false });
      response = await fetch(url, {
        ...options,
        headers: { ...retryHeaders, ...(options.headers as Record<string, string> | undefined) },
      });
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Official GoTalk Messaging & Resource APIs
// ---------------------------------------------------------------------------
export interface GotalkSendResult {
  dispatched: boolean;
  provider: string;
  externalMessageId?: string | null;
  detail?: string;
}

export async function sendGotalkMessage(
  phone: string,
  text: string,
  opts?: {
    attendanceId?: string | null;
    contactName?: string | null;
    contactId?: string | null;
    channelId?: string | number | null;
    type?: string;
    url?: string;
    filename?: string;
  }
): Promise<GotalkSendResult> {
  if (!isGotalkConfigured()) {
    return {
      dispatched: false,
      provider: 'gotalk_local_queue',
      detail: 'GOTALK_LOGIN/GOTALK_PASSWORD ainda não configurados — mensagem salva na fila local.',
    };
  }

  try {
    const channelId = opts?.channelId ?? (await getChannelId());
    const phoneForGoTalk = toGotalkPhone(phone);

    // 1. Se existe sessão de atendimento ativa na GoTalk, usa POST /websocket/send-message (Postman: channelId, attendanceId, phone, body)
    if (opts?.attendanceId) {
      const wsPayload: Record<string, unknown> = {
        channelId,
        attendanceId: opts.attendanceId,
        phone: phoneForGoTalk,
        body: text,
      };
      if (opts.url) {
        wsPayload.type = opts.type || 'document';
        wsPayload.url = opts.url;
        if (opts.filename) wsPayload.filename = opts.filename;
      }

      const wsResp = await gotalkFetch('/websocket/send-message', {
        method: 'POST',
        body: JSON.stringify(wsPayload),
        signal: AbortSignal.timeout(15000),
      });
      if (wsResp.ok) {
        const resJson = (await wsResp.json().catch(() => ({}))) as { _id?: string; id?: string; message?: { _id?: string; id?: string } };
        const extId = resJson?.message?._id || resJson?.message?.id || resJson?._id || resJson?.id || null;
        return {
          dispatched: true,
          provider: 'gotalk_websocket',
          externalMessageId: extId,
          detail: 'Enviado na sessão ativa GoTalk (/websocket/send-message).',
        };
      }
    }

    // 2. Rota oficial de envio de texto: POST /message/send_message (Postman: contactNumber, message)
    const textPayload = {
      contactNumber: phoneForGoTalk,
      message: text,
    };

    const resp = await gotalkFetch('/message/send_message', {
      method: 'POST',
      body: JSON.stringify(textPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const resJson = (await resp.json().catch(() => ({}))) as { _id?: string; id?: string; message?: { _id?: string; id?: string } };
      const extId = resJson?.message?._id || resJson?.message?.id || resJson?._id || resJson?.id || null;
      return {
        dispatched: true,
        provider: 'gotalk_live',
        externalMessageId: extId,
        detail: 'Enviado via GoTalk (/message/send_message).',
      };
    }

    // 3. Fallback para notificação ativa caso a conta exija abertura de conversa (/message/send-active-notification)
    const activeResp = await gotalkFetch('/message/send-active-notification', {
      method: 'POST',
      body: JSON.stringify({
        channelId,
        phone: phoneForGoTalk,
        phoneIsFixed: false,
        contactName: opts?.contactName || phoneForGoTalk,
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (activeResp.ok) {
      const resJson = (await activeResp.json().catch(() => ({}))) as { _id?: string; id?: string };
      return {
        dispatched: true,
        provider: 'gotalk_active_notification',
        externalMessageId: resJson?._id || resJson?.id || null,
        detail: 'Enviado via Notificação Ativa GoTalk (/message/send-active-notification).',
      };
    }

    const errBody = await resp.text().catch(() => '');
    return {
      dispatched: false,
      provider: 'gotalk_api_error',
      detail: `GoTalk HTTP ${resp.status}: ${errBody.slice(0, 140)}`,
    };
  } catch (err) {
    return {
      dispatched: false,
      provider: 'gotalk_network_error',
      detail: err instanceof Error ? err.message : 'Erro ao enviar via GoTalk',
    };
  }
}

export async function sendGotalkActiveNotification(params: {
  phone: string;
  contactName?: string;
  templateId?: string;
  text?: string;
  variables?: Record<string, string> | string[];
  operatorId?: string;
  channelId?: string | number | null;
}): Promise<GotalkSendResult> {
  if (!isGotalkConfigured()) {
    return {
      dispatched: false,
      provider: 'gotalk_local_queue',
      detail: 'GOTALK_LOGIN/GOTALK_PASSWORD não configurados — template registrado apenas na fila local.',
    };
  }

  const channelId = params.channelId ?? (await getChannelId());
  const phoneForGoTalk = toGotalkPhone(params.phone);
  let tag: Record<string, string> = {};
  if (params.variables && !Array.isArray(params.variables)) {
    tag = { ...params.variables };
  } else if (Array.isArray(params.variables)) {
    params.variables.forEach((v, idx) => {
      tag[String(idx + 1)] = String(v);
    });
  }
  if (!tag.clientName && params.contactName) tag.clientName = params.contactName;
  if (!tag.clientNumeber) tag.clientNumeber = phoneForGoTalk;

  const payload: Record<string, unknown> = {
    channelId,
    phone: phoneForGoTalk,
    phoneIsFixed: false,
    contactName: params.contactName || phoneForGoTalk,
    tag,
  };
  if (params.templateId) payload.templateId = params.templateId;
  if (params.text) payload.text = params.text;
  if (params.operatorId) payload.operatorId = params.operatorId;

  const resp = await gotalkFetch('/message/send-active-notification', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      dispatched: false,
      provider: 'gotalk_api_error',
      detail: `GoTalk HSM HTTP ${resp.status}: ${errText.slice(0, 160)}`,
    };
  }

  const resJson = (await resp.json().catch(() => ({}))) as { _id?: string; id?: string };
  return {
    dispatched: true,
    provider: 'gotalk_hsm',
    externalMessageId: resJson?._id || resJson?.id || null,
    detail: 'Template HSM enviado via GoTalk (/message/send-active-notification).',
  };
}

/**
 * Postman: Notificação > Enviar template HSM (POST /message/send_template)
 */
export async function sendGotalkTemplateByName(params: {
  phone: string;
  templateName: string;
  tag?: Record<string, string>;
}): Promise<GotalkSendResult> {
  if (!isGotalkConfigured()) {
    return {
      dispatched: false,
      provider: 'gotalk_local_queue',
      detail: 'GOTALK_LOGIN/GOTALK_PASSWORD não configurados — template registrado apenas na fila local.',
    };
  }

  const contactNumber = toGotalkPhone(params.phone);
  const resp = await gotalkFetch('/message/send_template', {
    method: 'POST',
    body: JSON.stringify({
      contactNumber,
      templateName: params.templateName,
      tag: params.tag || {},
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      dispatched: false,
      provider: 'gotalk_api_error',
      detail: `GoTalk send_template HTTP ${resp.status}: ${errText.slice(0, 160)}`,
    };
  }

  const resJson = (await resp.json().catch(() => ({}))) as { _id?: string; id?: string };
  return {
    dispatched: true,
    provider: 'gotalk_template',
    externalMessageId: resJson?._id || resJson?.id || null,
    detail: 'Template HSM enviado via GoTalk (/message/send_template).',
  };
}

/**
 * Postman: Notificação > Enviar arquivo (mídia) (POST /message/send_file/:contactNumber)
 */
export async function sendGotalkFile(params: {
  phone: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  caption?: string;
}): Promise<GotalkSendResult> {
  if (!isGotalkConfigured()) {
    return {
      dispatched: false,
      provider: 'gotalk_local_queue',
      detail: 'GOTALK_LOGIN/GOTALK_PASSWORD não configurados — anexo salvo localmente.',
    };
  }

  const contactNumber = toGotalkPhone(params.phone);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType || 'application/octet-stream' });
  form.append('file', blob, params.fileName || 'arquivo');
  if (params.caption) {
    form.append('caption', params.caption);
  }

  const resp = await gotalkFetch(`/message/send_file/${contactNumber}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      dispatched: false,
      provider: 'gotalk_api_error',
      detail: `GoTalk send_file HTTP ${resp.status}: ${errText.slice(0, 160)}`,
    };
  }

  const resJson = (await resp.json().catch(() => ({}))) as { _id?: string; id?: string; message?: { _id?: string; id?: string } };
  return {
    dispatched: true,
    provider: 'gotalk_media',
    externalMessageId: resJson?.message?._id || resJson?.message?.id || resJson?._id || resJson?.id || null,
    detail: 'Mídia enviada via GoTalk (/message/send_file).',
  };
}

export async function fetchGotalkAllChannels(): Promise<
  Array<{ channelId: string; name: string; phone: string | null; isPrimary: boolean }>
> {
  const primaryId = await getChannelId();
  if (!primaryId) return [];

  const primaryStr = String(primaryId);
  const channelMap = new Map<string, { channelId: string; name: string; phone: string | null; isPrimary: boolean }>();
  channelMap.set(primaryStr, {
    channelId: primaryStr,
    name: 'Canal Principal',
    phone: null,
    isPrimary: true,
  });

  try {
    const res = await gotalkFetch(`/channel/secondary/channelId/${primaryStr}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const raw = (await res.json()) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : ((raw as { channels?: unknown[]; data?: unknown[]; result?: unknown[] })?.channels ||
            (raw as { data?: unknown[] })?.data ||
            (raw as { result?: unknown[] })?.result ||
            []);
      for (const item of list as Array<Record<string, unknown>>) {
        const id = String(item._id || item.id || item.channelId || item.channel_id || '').trim();
        if (!id) continue;
        const name = String(item.name || item.channelName || item.channel_name || '').trim();
        const phone = (item.phone || item.phoneNumber || item.phone_number || item.number || null) as string | null;
        if (channelMap.has(id)) {
          const prev = channelMap.get(id)!;
          channelMap.set(id, {
            ...prev,
            name: name || prev.name,
            phone: phone || prev.phone,
          });
        } else {
          channelMap.set(id, {
            channelId: id,
            name: name || 'Canal Secundário',
            phone,
            isPrimary: false,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Gotalk] Aviso ao buscar canais secundários:', err instanceof Error ? err.message : err);
  }

  return Array.from(channelMap.values());
}

export async function fetchGotalkOperators(channelId: string): Promise<
  Array<{ gotalkOperatorId: string; name: string | null; email: string | null; phone: string | null; active: boolean }>
> {
  const extractOps = (raw: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      for (const key of ['operators', 'users', 'data', 'result', 'content', 'items']) {
        if (Array.isArray(r[key])) return r[key] as Array<Record<string, unknown>>;
      }
    }
    return [];
  };

  let rawOps: Array<Record<string, unknown>> = [];
  try {
    const res = await gotalkFetch(`/operator/channel/${channelId}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      rawOps = extractOps(await res.json());
    }
  } catch {
    // fallback below
  }

  if (rawOps.length === 0) {
    try {
      const res = await gotalkFetch('/operator/page/1', { signal: AbortSignal.timeout(15000) });
      if (res.ok) rawOps = extractOps(await res.json());
    } catch {
      // ignore
    }
  }

  return rawOps
    .map((op) => {
      const gotalkOperatorId = String(op._id || op.id || '').trim();
      if (!gotalkOperatorId) return null;
      return {
        gotalkOperatorId,
        name: (op.name || op.nome || op.nickname || null) as string | null,
        email: (op.email || null) as string | null,
        phone: normalizePhone((op.phone || op.telefone || op.number || null) as string | null) || null,
        active: op.deleted === true ? false : op.active !== false,
      };
    })
    .filter((o): o is NonNullable<typeof o> => Boolean(o));
}

export async function fetchGotalkHsmTemplates(channelId: string): Promise<
  Array<{
    templateName: string;
    gotalkTemplateId: string | null;
    category: string | null;
    language: string | null;
    status: string | null;
    bodyText: string | null;
    headerText: string | null;
    footerText: string | null;
  }>
> {
  try {
    const res = await gotalkFetch(`/message/templates/channelId/${channelId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.templates ||
          (data as Record<string, unknown>)?.data ||
          (data as Record<string, unknown>)?.result ||
          (data as Record<string, unknown>)?.content ||
          []) as Array<Record<string, unknown>>;

    return list
      .map((t) => {
        const templateName = String(t.name || t.templateName || t.template_name || '').trim();
        if (!templateName) return null;
        const components = Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>) : [];
        const bodyComp = components.find((c) => String(c.type || '').toUpperCase() === 'BODY');
        const headerComp = components.find(
          (c) => String(c.type || '').toUpperCase() === 'HEADER' && (!c.format || c.format === 'TEXT')
        );
        const footerComp = components.find((c) => String(c.type || '').toUpperCase() === 'FOOTER');
        return {
          templateName,
          gotalkTemplateId: (t._id || t.id || null) as string | null,
          category: (t.category || null) as string | null,
          language: (t.language || null) as string | null,
          status: (t.status || null) as string | null,
          bodyText: (bodyComp?.text || null) as string | null,
          headerText: (headerComp?.text || null) as string | null,
          footerText: (footerComp?.text || null) as string | null,
        };
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
  } catch {
    return [];
  }
}

export async function fetchGotalkContactsPage(
  channelId: string,
  page = 1
): Promise<Array<{ gotalkContactId: string; name: string; phone: string }>> {
  try {
    const res = await gotalkFetch(`/contact/channel/${channelId}/page/${page}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.contacts || (data as Record<string, unknown>)?.data || []) as Array<
          Record<string, unknown>
        >;
    return list
      .map((c) => {
        const gotalkContactId = String(c._id || c.id || '').trim();
        const phone = normalizePhone(String(c.number || c.phone || c.telefone || ''));
        if (!gotalkContactId || !phone) return null;
        return {
          gotalkContactId,
          name: String(c.name || c.nome || phone).trim(),
          phone,
        };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  } catch {
    return [];
  }
}

export async function transferGotalkAttendance(operatorId: string, attendanceId: string): Promise<boolean> {
  const res = await gotalkFetch('/message/transfer-attendance-operator', {
    method: 'POST',
    body: JSON.stringify({ operatorId, attendanceId }),
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}

export async function finishGotalkAttendance(attendanceId: string, reason: string): Promise<boolean> {
  const res = await gotalkFetch('/attendance/finish-attendance', {
    method: 'POST',
    body: JSON.stringify({ attendanceId, reason }),
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}

export async function fetchGotalkDepartments(channelId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await gotalkFetch(`/department/channel/${channelId}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.departments || (data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.result || []) as Array<Record<string, unknown>>;
    return list
      .map((d) => ({
        id: String(d._id || d.id || '').trim(),
        name: String(d.name || d.nome || '').trim(),
      }))
      .filter((d) => Boolean(d.id && d.name));
  } catch {
    return [];
  }
}

export async function fetchGotalkOnlineOperators(channelId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await gotalkFetch(`/operator/online/${channelId}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.operators || (data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.result || []) as Array<Record<string, unknown>>;
    return list
      .map((o) => ({
        id: String(o._id || o.id || '').trim(),
        name: String(o.name || o.nome || o.nickname || '').trim(),
      }))
      .filter((o) => Boolean(o.id));
  } catch {
    return [];
  }
}

export async function fetchGotalkTags(channelId: string): Promise<Array<{ id: string; name: string; color: string | null }>> {
  try {
    const res = await gotalkFetch(`/channel/tags/${channelId}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.tags || (data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.result || []) as Array<Record<string, unknown>>;
    return list
      .map((t) => ({
        id: String(t._id || t.id || '').trim(),
        name: String(t.name || '').trim(),
        color: (t.color || null) as string | null,
      }))
      .filter((t) => Boolean(t.id && t.name));
  } catch {
    return [];
  }
}

export async function fetchGotalkTabulations(channelId: string): Promise<Array<{ id: string; text: string }>> {
  try {
    const res = await gotalkFetch(`/channel/tabulations/${channelId}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.tabulations || (data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.result || []) as Array<Record<string, unknown>>;
    return list
      .map((tb) => ({
        id: String(tb._id || tb.id || '').trim(),
        text: String(tb.text || tb.name || '').trim(),
      }))
      .filter((tb) => Boolean(tb.id && tb.text));
  } catch {
    return [];
  }
}

export async function runGotalkPostmanParityProbe(): Promise<
  Array<{ endpoint: string; method: string; status: number; ok: boolean; count?: number }>
> {
  const { channelId } = await authenticate();
  const ch = String(channelId || '');
  if (!ch) return [];

  const probes: Array<{ endpoint: string; displayPath: string; method: 'GET' | 'POST'; body?: string }> = [
    { endpoint: `/channel/secondary/channelId/${ch}`, displayPath: '/channel/secondary/channelId/:channelId', method: 'GET' },
    { endpoint: `/operator/channel/${ch}`, displayPath: '/operator/channel/:channelId', method: 'GET' },
    { endpoint: `/operator/online/${ch}`, displayPath: '/operator/online/:channelId', method: 'GET' },
    { endpoint: `/message/templates/channelId/${ch}`, displayPath: '/message/templates/channelId/:channelId', method: 'GET' },
    { endpoint: `/department/channel/${ch}`, displayPath: '/department/channel/:channelId', method: 'GET' },
    { endpoint: `/channel/tags/${ch}`, displayPath: '/channel/tags/:channelId', method: 'GET' },
    { endpoint: `/channel/tabulations/${ch}`, displayPath: '/channel/tabulations/:channelId', method: 'GET' },
    { endpoint: `/contact/channel/${ch}/page/1`, displayPath: '/contact/channel/:channelId/page/1', method: 'GET' },
    {
      endpoint: `/attendance/follow/channelId/${ch}`,
      displayPath: '/attendance/follow/channelId/:channelId',
      method: 'POST',
      body: JSON.stringify({ filters: { type: 'keyword', keyword: '' } }),
    },
  ];

  const results: Array<{ endpoint: string; method: string; status: number; ok: boolean; count?: number }> = [];
  for (const p of probes) {
    try {
      const res = await gotalkFetch(p.endpoint, {
        method: p.method,
        ...(p.body ? { body: p.body } : {}),
        signal: AbortSignal.timeout(12000),
      });
      let itemCount: number | undefined;
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as unknown;
        if (Array.isArray(json)) itemCount = json.length;
        else if (json && typeof json === 'object') {
          const obj = json as Record<string, unknown>;
          for (const k of ['data', 'channels', 'operators', 'templates', 'departments', 'tags', 'tabulations', 'contacts', 'attendances', 'result', 'content', 'items']) {
            if (Array.isArray(obj[k])) {
              itemCount = (obj[k] as unknown[]).length;
              break;
            }
          }
        }
      }
      results.push({ endpoint: p.displayPath, method: p.method, status: res.status, ok: res.ok, count: itemCount });
    } catch {
      results.push({ endpoint: p.displayPath, method: p.method, status: 0, ok: false });
    }
  }
  return results;
}
