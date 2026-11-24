import { inArray, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { systemSettings } from '../db/schema.ts';
import {
  getGotalkBaseUrl,
  getGotalkConfigSource,
  getGotalkLoginValue,
  getGotalkPasswordValue,
  getGotalkStatus,
  getGotalkWebhookSecret,
  setGotalkConfigOverride,
} from './gotalk.ts';
import {
  decryptUazapiToken,
  encryptUazapiToken,
  getDefaultUazapiServerUrl,
  getUazapiAdminToken,
  getUazapiGlobalRuntimeState,
  getUazapiWebhookSecret,
  setUazapiGlobalOverride,
} from './uazapi.ts';

export const GOTALK_SETTINGS_KEY = 'gotalk_credentials';
export const UAZAPI_GLOBAL_SETTINGS_KEY = 'uazapi_global_config';

interface GotalkStoredPayload {
  baseUrl?: string;
  login?: string;
  passwordEncrypted?: string | null;
  webhookSecretEncrypted?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

interface UazapiGlobalStoredPayload {
  defaultServerUrl?: string;
  adminTokenEncrypted?: string | null;
  webhookSecretEncrypted?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export async function ensureWhatsappSchemaColumns(): Promise<void> {
  try {
    const check = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'whatsapp_messages'
        AND column_name IN ('delivery_provider', 'delivery_status', 'delivery_detail')
    `);
    const existingCount = Array.isArray((check as { rows?: unknown[] }).rows)
      ? (check as { rows: unknown[] }).rows.length
      : 0;
    if (existingCount >= 3) return;
    await db.execute(sql`
      ALTER TABLE whatsapp_messages
        ADD COLUMN IF NOT EXISTS delivery_provider text,
        ADD COLUMN IF NOT EXISTS delivery_status text,
        ADD COLUMN IF NOT EXISTS delivery_detail text
    `);
  } catch (err) {
    console.warn('[Messaging] Aviso ao garantir colunas de entrega em whatsapp_messages:', err);
  }
}

export async function hydrateMessagingConfigsFromDb(): Promise<void> {
  await ensureWhatsappSchemaColumns();
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(inArray(systemSettings.key, [GOTALK_SETTINGS_KEY, UAZAPI_GLOBAL_SETTINGS_KEY]));

    const gtRow = rows.find((r) => r.key === GOTALK_SETTINGS_KEY);
    if (gtRow?.value) {
      const val = gtRow.value as GotalkStoredPayload;
      setGotalkConfigOverride({
        baseUrl: typeof val.baseUrl === 'string' ? val.baseUrl : null,
        login: typeof val.login === 'string' ? val.login : null,
        password: decryptUazapiToken(val.passwordEncrypted || null),
        webhookSecret: decryptUazapiToken(val.webhookSecretEncrypted || null),
      });
    } else {
      setGotalkConfigOverride(null);
    }

    const uazRow = rows.find((r) => r.key === UAZAPI_GLOBAL_SETTINGS_KEY);
    if (uazRow?.value) {
      const val = uazRow.value as UazapiGlobalStoredPayload;
      setUazapiGlobalOverride({
        serverUrl: typeof val.defaultServerUrl === 'string' ? val.defaultServerUrl : null,
        adminToken: decryptUazapiToken(val.adminTokenEncrypted || null),
        webhookSecret: decryptUazapiToken(val.webhookSecretEncrypted || null),
      });
    } else {
      setUazapiGlobalOverride(null);
    }
  } catch (err) {
    console.warn('[Messaging] Falha ao hidratar configurações persistidas de WhatsApp:', err);
  }
}

export async function getGotalkPersistedCredentialsSummary() {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, GOTALK_SETTINGS_KEY))
    .limit(1);
  const stored = (rows[0]?.value || {}) as GotalkStoredPayload;
  const status = getGotalkStatus();

  return {
    configured: status.configured,
    source: getGotalkConfigSource(),
    baseUrl: stored.baseUrl || getGotalkBaseUrl(),
    login: stored.login || getGotalkLoginValue() || '',
    hasPassword: Boolean(stored.passwordEncrypted || getGotalkPasswordValue()),
    hasWebhookSecret: Boolean(stored.webhookSecretEncrypted || getGotalkWebhookSecret()),
    updatedAt: stored.updatedAt || (rows[0]?.updatedAt ? new Date(rows[0].updatedAt).toISOString() : null),
    updatedBy: stored.updatedBy || null,
    status,
  };
}

export async function saveGotalkPersistedCredentials(params: {
  baseUrl?: string;
  login?: string;
  password?: string;
  webhookSecret?: string;
  clearWebhookSecret?: boolean;
  updatedBy?: string;
}) {
  const existingRows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, GOTALK_SETTINGS_KEY))
    .limit(1);
  const prev = (existingRows[0]?.value || {}) as GotalkStoredPayload;

  const cleanBaseUrl = (params.baseUrl || prev.baseUrl || getGotalkBaseUrl()).trim().replace(/\/$/, '');
  const cleanLogin = (params.login ?? prev.login ?? '').trim();
  const nextPasswordEncrypted =
    params.password && params.password.trim()
      ? encryptUazapiToken(params.password.trim())
      : prev.passwordEncrypted || null;

  const nextWebhookEncrypted = params.clearWebhookSecret
    ? null
    : params.webhookSecret && params.webhookSecret.trim()
    ? encryptUazapiToken(params.webhookSecret.trim())
    : prev.webhookSecretEncrypted || null;

  const payload: GotalkStoredPayload = {
    baseUrl: cleanBaseUrl || 'https://app.gotalk.digital',
    login: cleanLogin,
    passwordEncrypted: nextPasswordEncrypted,
    webhookSecretEncrypted: nextWebhookEncrypted,
    updatedAt: new Date().toISOString(),
    updatedBy: params.updatedBy || 'Administrador',
  };

  if (existingRows[0]) {
    await db
      .update(systemSettings)
      .set({ value: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(systemSettings.key, GOTALK_SETTINGS_KEY));
  } else {
    await db.insert(systemSettings).values({
      key: GOTALK_SETTINGS_KEY,
      value: payload as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    });
  }

  setGotalkConfigOverride({
    baseUrl: payload.baseUrl || null,
    login: payload.login || null,
    password: decryptUazapiToken(payload.passwordEncrypted || null),
    webhookSecret: decryptUazapiToken(payload.webhookSecretEncrypted || null),
  });

  return getGotalkPersistedCredentialsSummary();
}

export async function getUazapiGlobalPersistedSummary() {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, UAZAPI_GLOBAL_SETTINGS_KEY))
    .limit(1);
  const stored = (rows[0]?.value || {}) as UazapiGlobalStoredPayload;
  const runtime = getUazapiGlobalRuntimeState();

  return {
    source: runtime.source,
    defaultServerUrl: stored.defaultServerUrl || getDefaultUazapiServerUrl(),
    hasAdminToken: Boolean(stored.adminTokenEncrypted || getUazapiAdminToken()),
    hasWebhookSecret: Boolean(stored.webhookSecretEncrypted || getUazapiWebhookSecret()),
    envConfigured: runtime.envConfigured,
    adminTokenConfigured: runtime.adminTokenConfigured,
    webhookSecretConfigured: runtime.webhookSecretConfigured,
    encryptionKeyDedicated: runtime.encryptionKeyDedicated,
    updatedAt: stored.updatedAt || (rows[0]?.updatedAt ? new Date(rows[0].updatedAt).toISOString() : null),
    updatedBy: stored.updatedBy || null,
  };
}

export async function saveUazapiGlobalPersistedConfig(params: {
  defaultServerUrl?: string;
  adminToken?: string;
  webhookSecret?: string;
  clearAdminToken?: boolean;
  clearWebhookSecret?: boolean;
  updatedBy?: string;
}) {
  const existingRows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, UAZAPI_GLOBAL_SETTINGS_KEY))
    .limit(1);
  const prev = (existingRows[0]?.value || {}) as UazapiGlobalStoredPayload;

  const cleanServerUrl = (params.defaultServerUrl || prev.defaultServerUrl || getDefaultUazapiServerUrl())
    .trim()
    .replace(/\/$/, '');

  const nextAdminTokenEncrypted = params.clearAdminToken
    ? null
    : params.adminToken && params.adminToken.trim()
    ? encryptUazapiToken(params.adminToken.trim())
    : prev.adminTokenEncrypted || null;

  const nextWebhookEncrypted = params.clearWebhookSecret
    ? null
    : params.webhookSecret && params.webhookSecret.trim()
    ? encryptUazapiToken(params.webhookSecret.trim())
    : prev.webhookSecretEncrypted || null;

  const payload: UazapiGlobalStoredPayload = {
    defaultServerUrl: cleanServerUrl || 'https://centralhub.uazapi.com',
    adminTokenEncrypted: nextAdminTokenEncrypted,
    webhookSecretEncrypted: nextWebhookEncrypted,
    updatedAt: new Date().toISOString(),
    updatedBy: params.updatedBy || 'Administrador',
  };

  if (existingRows[0]) {
    await db
      .update(systemSettings)
      .set({ value: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(systemSettings.key, UAZAPI_GLOBAL_SETTINGS_KEY));
  } else {
    await db.insert(systemSettings).values({
      key: UAZAPI_GLOBAL_SETTINGS_KEY,
      value: payload as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    });
  }

  setUazapiGlobalOverride({
    serverUrl: payload.defaultServerUrl || null,
    adminToken: decryptUazapiToken(payload.adminTokenEncrypted || null),
    webhookSecret: decryptUazapiToken(payload.webhookSecretEncrypted || null),
  });

  return getUazapiGlobalPersistedSummary();
}
