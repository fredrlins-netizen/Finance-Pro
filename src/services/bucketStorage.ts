import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VAULT_ROOT = path.resolve(process.cwd(), 'vault_storage');
const OBJECT_BUCKET_DIR = path.join(VAULT_ROOT, 'bucketdainvicta', 'objects');

if (!fs.existsSync(OBJECT_BUCKET_DIR)) {
  fs.mkdirSync(OBJECT_BUCKET_DIR, { recursive: true });
}

const BLOCKED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.tsx',
  '.sh',
  '.bash',
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.php',
  '.vbs',
  '.dll',
  '.so',
  '.msi',
  '.com',
  '.scr',
  '.pif',
  '.jar',
  '.hta',
  '.cpl',
]);

const BLOCKED_MIME_PREFIXES = [
  'text/html',
  'application/javascript',
  'text/javascript',
  'image/svg+xml',
  'application/x-msdownload',
  'application/x-sh',
];

const INLINE_PREVIEW_MIME_PREFIXES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/',
  'text/plain',
];

let r2BucketChecked: { checkedAt: number; available: boolean; bucketName: string; lastError?: string | null } | null = null;

export interface CloudflareR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  publicCacheDomain: string | null;
}

export function getCloudflareR2Config(): CloudflareR2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
  const customEndpoint = process.env.R2_ENDPOINT?.trim().replace(/\/+$/, '') || '';
  if (!accessKeyId || !secretAccessKey || (!accountId && !customEndpoint)) {
    return null;
  }
  const bucketName =
    process.env.R2_BUCKET_NAME?.trim() ||
    process.env.BUCKET_DA_INVICTA?.trim() ||
    'bucketdainvicta';
  const endpoint = customEndpoint || `https://${accountId}.r2.cloudflarestorage.com`;
  const publicCacheDomain = process.env.R2_PUBLIC_CACHE_DOMAIN?.trim().replace(/\/+$/, '') || null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint,
    publicCacheDomain,
  };
}

function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Path(rawPath: string): string {
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return normalized
    .split('/')
    .map((seg, idx) => (idx === 0 ? '' : encodeRfc3986(seg)))
    .join('/');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export function signR2Request(params: {
  method: 'GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE';
  endpoint: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  now?: Date;
}): { url: string; headers: Record<string, string> } {
  const region = params.region || 'auto';
  const service = 's3';
  const now = params.now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const endpointUrl = new URL(params.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const canonicalUri = encodeS3Path(`${basePath}${params.path.startsWith('/') ? params.path : `/${params.path}`}`);

  const queryEntries = Object.entries(params.query || {}).sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = queryEntries
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const payloadBuf = params.body || Buffer.alloc(0);
  const payloadHash = crypto.createHash('sha256').update(payloadBuf).digest('hex');

  const normalizedHeaders: Record<string, string> = {
    host: endpointUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(params.headers || {})) {
    const lk = k.toLowerCase().trim();
    if (lk && lk !== 'authorization') {
      normalizedHeaders[lk] = String(v).trim().replace(/\s+/g, ' ');
    }
  }

  const sortedHeaderKeys = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${normalizedHeaders[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpointUrl.origin}${canonicalUri}${canonicalQueryString ? `?${canonicalQueryString}` : ''}`;
  return {
    url,
    headers: {
      ...normalizedHeaders,
      authorization,
    },
  };
}

/**
 * Generates an AWS Signature Version 4 Presigned URL for Cloudflare R2 S3 API
 * (https://developers.cloudflare.com/r2/api/s3/api/). Expires between 1s and 7 days (604800s).
 */
export function createR2PresignedUrl(params: {
  method: 'GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE';
  endpoint: string;
  bucketName: string;
  objectKey: string;
  query?: Record<string, string>;
  expiresSeconds?: number;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  now?: Date;
}): string {
  const region = params.region || 'auto';
  const service = 's3';
  const now = params.now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const expires = Math.max(1, Math.min(604800, Math.floor(params.expiresSeconds ?? 3600)));

  const endpointUrl = new URL(params.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const pathSuffix = `/${params.bucketName}/${params.objectKey.replace(/^\/+/, '')}`;
  const canonicalUri = encodeS3Path(`${basePath}${pathSuffix}`);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const allQuery: Record<string, string> = {
    ...(params.query || {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${params.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQueryString = Object.entries(allQuery)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalHeaders = `host:${endpointUrl.host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `${endpointUrl.origin}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export async function getActiveR2ConfigForMigration(): Promise<CloudflareR2Config | null> {
  return resolveActiveR2Bucket();
}

function toAsciiS3MetaValue(val: string): string {
  return encodeURIComponent(String(val || '').trim()).slice(0, 1024);
}

export async function initiateR2MultipartUpload(
  cfg: CloudflareR2Config,
  objectKey: string,
  meta: { sha256: string; originalName: string; originalMime: string; logicalFolder: string }
): Promise<string> {
  const pathSuffix = `/${cfg.bucketName}/${objectKey.replace(/^\/+/, '')}`;
  const signed = signR2Request({
    method: 'POST',
    endpoint: cfg.endpoint,
    path: pathSuffix,
    query: { uploads: '' },
    headers: {
      'content-type': String(meta.originalMime || 'application/octet-stream').replace(/[^\x20-\x7E]/g, '') || 'application/octet-stream',
      'x-amz-meta-sha256': String(meta.sha256 || '').replace(/[^a-fA-F0-9]/g, ''),
      'x-amz-meta-original-name': toAsciiS3MetaValue(meta.originalName),
      'x-amz-meta-logical-folder': toAsciiS3MetaValue(meta.logicalFolder),
    },
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  const res = await fetch(signed.url, {
    method: 'POST',
    headers: reqHeaders,
    signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Falha ao iniciar Multipart Upload no R2 (HTTP ${res.status}): ${xml.slice(0, 200)}`);
  }
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!match?.[1]) {
    throw new Error('Resposta Multipart Upload do R2 não retornou UploadId.');
  }
  return match[1];
}

export async function completeR2MultipartUpload(
  cfg: CloudflareR2Config,
  objectKey: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<void> {
  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const bodyXml =
    '<CompleteMultipartUpload>' +
    sortedParts
      .map((p) => {
        const cleanEtag = p.etag.replace(/[<>&]/g, '');
        return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${cleanEtag}</ETag></Part>`;
      })
      .join('') +
    '</CompleteMultipartUpload>';
  const bodyBuf = Buffer.from(bodyXml, 'utf8');
  const pathSuffix = `/${cfg.bucketName}/${objectKey.replace(/^\/+/, '')}`;
  const signed = signR2Request({
    method: 'POST',
    endpoint: cfg.endpoint,
    path: pathSuffix,
    query: { uploadId },
    headers: { 'content-type': 'application/xml' },
    body: bodyBuf,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  const res = await fetch(signed.url, {
    method: 'POST',
    headers: reqHeaders,
    body: new Uint8Array(bodyBuf),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao concluir Multipart Upload no R2 (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }
}

export async function abortR2MultipartUpload(
  cfg: CloudflareR2Config,
  objectKey: string,
  uploadId: string
): Promise<void> {
  const pathSuffix = `/${cfg.bucketName}/${objectKey.replace(/^\/+/, '')}`;
  const signed = signR2Request({
    method: 'DELETE',
    endpoint: cfg.endpoint,
    path: pathSuffix,
    query: { uploadId },
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  await fetch(signed.url, {
    method: 'DELETE',
    headers: reqHeaders,
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

async function fetchR2Signed(
  cfg: CloudflareR2Config,
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE',
  bucketName: string,
  objectKey?: string,
  body?: Buffer,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const pathSuffix = objectKey ? `/${bucketName}/${objectKey.replace(/^\/+/, '')}` : `/${bucketName}`;
  const signed = signR2Request({
    method,
    endpoint: cfg.endpoint,
    path: pathSuffix,
    headers: extraHeaders,
    body,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });

  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') {
      reqHeaders.set(k, v);
    }
  }

  return fetch(signed.url, {
    method,
    headers: reqHeaders,
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
}

async function resolveActiveR2Bucket(forceRefresh = false): Promise<CloudflareR2Config | null> {
  const cfg = getCloudflareR2Config();
  if (!cfg) return null;

  const cacheTtlMs = r2BucketChecked?.available ? 5 * 60 * 1000 : 30 * 1000;
  if (
    !forceRefresh &&
    r2BucketChecked &&
    r2BucketChecked.bucketName === cfg.bucketName &&
    Date.now() - r2BucketChecked.checkedAt < cacheTtlMs
  ) {
    return r2BucketChecked.available ? cfg : null;
  }

  try {
    const res = await fetchR2Signed(cfg, 'HEAD', cfg.bucketName);
    if (res.ok) {
      r2BucketChecked = { checkedAt: Date.now(), available: true, bucketName: cfg.bucketName, lastError: null };
      return cfg;
    }
    const detail = `Cloudflare R2 respondeu HTTP ${res.status} para o bucket "${cfg.bucketName}".`;
    r2BucketChecked = { checkedAt: Date.now(), available: false, bucketName: cfg.bucketName, lastError: detail };
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao conectar na API S3 do Cloudflare R2.';
    r2BucketChecked = { checkedAt: Date.now(), available: false, bucketName: cfg.bucketName, lastError: msg };
    return null;
  }
}

async function r2ObjectExists(cfg: CloudflareR2Config, bucketName: string, objectKey: string): Promise<boolean> {
  const res = await fetchR2Signed(cfg, 'HEAD', bucketName, objectKey);
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`Falha ao consultar objeto no R2 (HTTP ${res.status}).`);
}

async function r2PutEncryptedObject(
  cfg: CloudflareR2Config,
  bucketName: string,
  objectKey: string,
  sealed: Buffer,
  meta: { sha256: string; originalName: string; originalMime: string; logicalFolder: string }
): Promise<void> {
  const res = await fetchR2Signed(cfg, 'PUT', bucketName, objectKey, sealed, {
    'content-type': 'application/octet-stream',
    'x-amz-meta-sha256': String(meta.sha256 || '').replace(/[^a-fA-F0-9]/g, ''),
    'x-amz-meta-original-name': toAsciiS3MetaValue(meta.originalName),
    'x-amz-meta-original-mime': String(meta.originalMime || 'application/octet-stream').replace(/[^\x20-\x7E]/g, '') || 'application/octet-stream',
    'x-amz-meta-logical-folder': toAsciiS3MetaValue(meta.logicalFolder),
    'x-amz-meta-cipher': 'AES-256-GCM',
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Erro no PutObject Cloudflare R2 (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }
}

async function r2GetObjectBuffer(cfg: CloudflareR2Config, bucketName: string, objectKey: string): Promise<Buffer | null> {
  const res = await fetchR2Signed(cfg, 'GET', bucketName, objectKey);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Erro no GetObject Cloudflare R2 (HTTP ${res.status}).`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function r2DeleteObject(cfg: CloudflareR2Config, bucketName: string, objectKey: string): Promise<void> {
  const res = await fetchR2Signed(cfg, 'DELETE', bucketName, objectKey);
  if (!res.ok && res.status !== 404 && res.status !== 204) {
    throw new Error(`Erro no DeleteObject Cloudflare R2 (HTTP ${res.status}).`);
  }
}

function parseR2Uri(storageUri: string, cleanHash: string, defaultBucket: string): { bucketName: string; objectKey: string; encrypted: boolean } {
  const isPlainS3 = storageUri.startsWith('r2-s3://');
  const raw = storageUri.slice(isPlainS3 ? 'r2-s3://'.length : 'r2://'.length);
  const slashIdx = raw.indexOf('/');
  if (slashIdx > 0) {
    return {
      bucketName: raw.slice(0, slashIdx),
      objectKey: raw.slice(slashIdx + 1),
      encrypted: !isPlainS3,
    };
  }
  return {
    bucketName: defaultBucket,
    objectKey: isPlainS3
      ? `bucketdainvicta/objects/${cleanHash.slice(0, 2)}/${cleanHash}.bin`
      : `bucketdainvicta/objects/${cleanHash.slice(0, 2)}/${cleanHash}.enc`,
    encrypted: !isPlainS3,
  };
}

function deriveBucketAesKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY?.trim() ||
    process.env.SQL_PASSWORD?.trim() ||
    'financepro-uazapi-local-key';
  return crypto.createHash('sha256').update(`bucketdainvicta-object-v1:${secret}`).digest();
}

export async function tryProvisionCloudBucket(preferredName?: string): Promise<{
  ok: boolean;
  bucketName: string;
  created: boolean;
  detail: string;
}> {
  const r2Cfg = getCloudflareR2Config();
  if (!r2Cfg) {
    return {
      ok: false,
      bucketName: preferredName || process.env.R2_BUCKET_NAME?.trim() || process.env.BUCKET_DA_INVICTA?.trim() || 'bucketdainvicta',
      created: false,
      detail: 'Credenciais Cloudflare R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) não configuradas.',
    };
  }
  const activeR2 = await resolveActiveR2Bucket(true);
  if (activeR2) {
    return {
      ok: true,
      bucketName: activeR2.bucketName,
      created: false,
      detail: `Cloudflare R2 bucket "${activeR2.bucketName}" ativo e acessível via S3 API privada.`,
    };
  }
  return {
    ok: false,
    bucketName: r2Cfg.bucketName,
    created: false,
    detail: r2BucketChecked?.lastError || 'Cloudflare R2 configurado, mas sem resposta válida no HeadBucket.',
  };
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(String(name || 'arquivo').trim()).replace(/[\r\n\0<>:"/\\|?*]+/g, '_');
  return base.slice(0, 180) || 'arquivo.bin';
}

export function validateUploadFile(fileName: string, mimeType: string, sizeBytes: number): string | null {
  if (!sizeBytes || sizeBytes <= 0) return 'O arquivo enviado está vazio.';
  if (sizeBytes > 25 * 1024 * 1024) return 'O arquivo excede o limite máximo de 25 MB por anexo.';

  const ext = path.extname(fileName || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `Tipo de arquivo não permitido por segurança (${ext}).`;
  }
  const lowerMime = String(mimeType || '').toLowerCase();
  if (BLOCKED_MIME_PREFIXES.some((prefix) => lowerMime.startsWith(prefix))) {
    return `MIME type bloqueado por política de segurança (${lowerMime}).`;
  }
  return null;
}

export function canPreviewInline(mimeType: string): boolean {
  const lower = String(mimeType || '').toLowerCase();
  return INLINE_PREVIEW_MIME_PREFIXES.some((p) => lower.startsWith(p));
}

function getLocalEncryptedPath(sha256: string): string {
  const clean = sha256.replace(/[^a-f0-9]/gi, '').toLowerCase();
  const shardDir = path.join(OBJECT_BUCKET_DIR, clean.slice(0, 2) || '00');
  if (!fs.existsSync(shardDir)) {
    fs.mkdirSync(shardDir, { recursive: true });
  }
  return path.join(shardDir, `${clean}.enc`);
}

function getLegacyPlainPath(sha256: string): string {
  const clean = sha256.replace(/[^a-f0-9]/gi, '').toLowerCase();
  return path.join(VAULT_ROOT, `${clean}.bin`);
}

function encryptBuffer(plain: Buffer): Buffer {
  const key = deriveBucketAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(payload: Buffer): Buffer {
  if (payload.length < 28) {
    throw new Error('Objeto cifrado inválido no bucket.');
  }
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const key = deriveBucketAesKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface BucketPutResult {
  sha256Hash: string;
  storageUri: string;
  backend: 'cloudflare_r2' | 'local_encrypted_bucket';
  deduplicated: boolean;
  sizeBytes: number;
}

export async function putBucketObject(
  buffer: Buffer,
  opts: { folderPath: string; mimeType: string; originalName: string }
): Promise<BucketPutResult> {
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // 1. Cloudflare R2 (Private S3-compatible bucket with AWS SigV4 + AES-256-GCM + SHA-256 CAS)
  const r2Cfg = await resolveActiveR2Bucket();
  if (r2Cfg) {
    try {
      const objectKey = `bucketdainvicta/objects/${sha256Hash.slice(0, 2)}/${sha256Hash}.enc`;
      const exists = await r2ObjectExists(r2Cfg, r2Cfg.bucketName, objectKey);
      if (!exists) {
        const sealed = encryptBuffer(buffer);
        await r2PutEncryptedObject(r2Cfg, r2Cfg.bucketName, objectKey, sealed, {
          sha256: sha256Hash,
          originalName: sanitizeFileName(opts.originalName),
          originalMime: opts.mimeType,
          logicalFolder: opts.folderPath,
        });
      }
      return {
        sha256Hash,
        storageUri: `r2://${r2Cfg.bucketName}/${objectKey}`,
        backend: 'cloudflare_r2',
        deduplicated: exists,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      r2BucketChecked = {
        checkedAt: Date.now(),
        available: false,
        bucketName: r2Cfg.bucketName,
        lastError: err instanceof Error ? err.message : 'Erro ao gravar objeto no Cloudflare R2.',
      };
    }
  }

  // 2. Local High-Performance Sharded & Encrypted Object Bucket (AES-256-GCM + SHA-256 CAS)
  const targetPath = getLocalEncryptedPath(sha256Hash);
  const alreadyExists = fs.existsSync(targetPath);
  if (!alreadyExists) {
    const sealed = encryptBuffer(buffer);
    fs.writeFileSync(targetPath, sealed);
  }

  return {
    sha256Hash,
    storageUri: `bucket://bucketdainvicta/objects/${sha256Hash.slice(0, 2)}/${sha256Hash}`,
    backend: 'local_encrypted_bucket',
    deduplicated: alreadyExists,
    sizeBytes: buffer.length,
  };
}

export async function getBucketObjectBuffer(
  sha256Hash: string,
  storageUri?: string | null
): Promise<Buffer | null> {
  const cleanHash = sha256Hash.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!cleanHash) return null;

  // 1. Try Cloudflare R2 if storageUri starts with r2:// or r2-s3://
  if (storageUri && (storageUri.startsWith('r2://') || storageUri.startsWith('r2-s3://'))) {
    const r2Cfg = getCloudflareR2Config();
    if (r2Cfg) {
      const { bucketName, objectKey, encrypted } = parseR2Uri(storageUri, cleanHash, r2Cfg.bucketName);
      const raw = await r2GetObjectBuffer(r2Cfg, bucketName, objectKey).catch(() => null);
      if (raw) {
        return encrypted ? decryptBuffer(raw) : raw;
      }
    }
  }

  // 2. Try encrypted sharded local object bucket
  const encPath = getLocalEncryptedPath(cleanHash);
  if (fs.existsSync(encPath)) {
    const sealed = fs.readFileSync(encPath);
    return decryptBuffer(sealed);
  }

  // 3. Fallback to legacy unencrypted .bin if migrated from older version
  const legacyPath = getLegacyPlainPath(cleanHash);
  if (fs.existsSync(legacyPath)) {
    return fs.readFileSync(legacyPath);
  }

  return null;
}

export async function deletePhysicalBucketObjectIfUnreferenced(
  sha256Hash: string,
  storageUri?: string | null
): Promise<void> {
  const cleanHash = sha256Hash.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!cleanHash) return;

  if (storageUri && (storageUri.startsWith('r2://') || storageUri.startsWith('r2-s3://'))) {
    const r2Cfg = getCloudflareR2Config();
    if (r2Cfg) {
      const { bucketName, objectKey } = parseR2Uri(storageUri, cleanHash, r2Cfg.bucketName);
      await r2DeleteObject(r2Cfg, bucketName, objectKey).catch(() => {});
    }
  }

  const encPath = getLocalEncryptedPath(cleanHash);
  if (fs.existsSync(encPath)) {
    fs.unlinkSync(encPath);
  }
  const legacyPath = getLegacyPlainPath(cleanHash);
  if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

export async function getBucketRuntimeStats(): Promise<{
  bucketName: string;
  backend: 'cloudflare_r2' | 'local_encrypted_bucket';
  encryption: 'AES-256-GCM';
  deduplication: 'SHA-256 CAS';
  physicalObjectsCount: number;
  physicalBytesUsed: number;
  r2Configured: boolean;
  r2Endpoint: string | null;
  r2CacheDomain: string | null;
  lastError: string | null;
}> {
  const r2Cfg = getCloudflareR2Config();
  const activeR2 = r2Cfg ? await resolveActiveR2Bucket() : null;

  let physicalObjectsCount = 0;
  let physicalBytesUsed = 0;

  if (fs.existsSync(OBJECT_BUCKET_DIR)) {
    const shards = fs.readdirSync(OBJECT_BUCKET_DIR, { withFileTypes: true });
    for (const s of shards) {
      if (!s.isDirectory()) continue;
      const shardPath = path.join(OBJECT_BUCKET_DIR, s.name);
      for (const file of fs.readdirSync(shardPath, { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith('.enc')) {
          physicalObjectsCount++;
          physicalBytesUsed += fs.statSync(path.join(shardPath, file.name)).size;
        }
      }
    }
  }

  if (fs.existsSync(VAULT_ROOT)) {
    for (const f of fs.readdirSync(VAULT_ROOT, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.bin')) {
        physicalObjectsCount++;
        physicalBytesUsed += fs.statSync(path.join(VAULT_ROOT, f.name)).size;
      }
    }
  }

  const backend: 'cloudflare_r2' | 'local_encrypted_bucket' = activeR2
    ? 'cloudflare_r2'
    : 'local_encrypted_bucket';

  return {
    bucketName: activeR2 ? activeR2.bucketName : r2Cfg?.bucketName || 'bucketdainvicta',
    backend,
    encryption: 'AES-256-GCM',
    deduplication: 'SHA-256 CAS',
    physicalObjectsCount,
    physicalBytesUsed,
    r2Configured: Boolean(r2Cfg),
    r2Endpoint: r2Cfg?.endpoint || null,
    r2CacheDomain: r2Cfg?.publicCacheDomain || null,
    lastError: activeR2 ? null : r2BucketChecked?.lastError || null,
  };
}

function unescapeXmlText(val: string): string {
  return String(val || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXmlText(val: string): string {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function listR2ObjectKeysBatch(
  cfg: CloudflareR2Config,
  continuationToken?: string
): Promise<{ keys: string[]; isTruncated: boolean; nextContinuationToken?: string }> {
  const query: Record<string, string> = {
    'list-type': '2',
    'max-keys': '1000',
  };
  if (continuationToken) {
    query['continuation-token'] = continuationToken;
  }
  const signed = signR2Request({
    method: 'GET',
    endpoint: cfg.endpoint,
    path: `/${cfg.bucketName}`,
    query,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  const res = await fetch(signed.url, {
    method: 'GET',
    headers: reqHeaders,
    signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Falha ao listar objetos no Cloudflare R2 (HTTP ${res.status}): ${xml.slice(0, 200)}`);
  }
  const keys: string[] = [];
  const keyMatches = xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g);
  for (const m of keyMatches) {
    if (m[1] !== undefined) keys.push(unescapeXmlText(m[1]));
  }
  const isTruncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
  const nextContinuationToken = nextMatch?.[1] ? unescapeXmlText(nextMatch[1]) : undefined;
  return { keys, isTruncated, nextContinuationToken };
}

async function deleteR2KeysBatch(cfg: CloudflareR2Config, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const bodyXml =
    '<Delete><Quiet>true</Quiet>' +
    keys.map((k) => `<Object><Key>${escapeXmlText(k)}</Key></Object>`).join('') +
    '</Delete>';
  const bodyBuf = Buffer.from(bodyXml, 'utf8');
  const contentMd5 = crypto.createHash('md5').update(bodyBuf).digest('base64');
  const signed = signR2Request({
    method: 'POST',
    endpoint: cfg.endpoint,
    path: `/${cfg.bucketName}`,
    query: { delete: '' },
    headers: {
      'content-type': 'application/xml',
      'content-md5': contentMd5,
    },
    body: bodyBuf,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  const res = await fetch(signed.url, {
    method: 'POST',
    headers: reqHeaders,
    body: new Uint8Array(bodyBuf),
    signal: AbortSignal.timeout(60000),
  });
  if (res.ok) {
    return keys.length;
  }
  // Fallback: delete individually if batch DeleteObjects is rejected
  let deleted = 0;
  for (const key of keys) {
    await r2DeleteObject(cfg, cfg.bucketName, key);
    deleted++;
  }
  return deleted;
}

async function abortAllR2MultipartUploads(cfg: CloudflareR2Config): Promise<number> {
  let aborted = 0;
  const signed = signR2Request({
    method: 'GET',
    endpoint: cfg.endpoint,
    path: `/${cfg.bucketName}`,
    query: { uploads: '' },
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(signed.headers)) {
    if (k !== 'host') reqHeaders.set(k, v);
  }
  const res = await fetch(signed.url, {
    method: 'GET',
    headers: reqHeaders,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res || !res.ok) return 0;
  const xml = await res.text().catch(() => '');
  const uploadMatches = xml.matchAll(/<Upload>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<UploadId>([\s\S]*?)<\/UploadId>[\s\S]*?<\/Upload>/g);
  for (const m of uploadMatches) {
    const key = m[1] ? unescapeXmlText(m[1]) : '';
    const uploadId = m[2] ? unescapeXmlText(m[2]) : '';
    if (key && uploadId) {
      await abortR2MultipartUpload(cfg, key, uploadId);
      aborted++;
    }
  }
  return aborted;
}

export async function purgeAllBucketObjects(): Promise<{
  bucketName: string;
  r2Configured: boolean;
  r2Purged: boolean;
  r2DeletedCount: number;
  r2AbortedUploads: number;
  localDeletedCount: number;
  r2Error: string | null;
}> {
  const r2Cfg = getCloudflareR2Config();
  const bucketName = r2Cfg?.bucketName || 'bucketdainvicta';
  let r2Purged = false;
  let r2DeletedCount = 0;
  let r2AbortedUploads = 0;
  let r2Error: string | null = null;

  if (r2Cfg) {
    try {
      const activeR2 = await resolveActiveR2Bucket(true);
      const targetCfg = activeR2 || r2Cfg;
      let continuationToken: string | undefined = undefined;
      for (let page = 0; page < 500; page++) {
        const listed = await listR2ObjectKeysBatch(targetCfg, continuationToken);
        if (listed.keys.length > 0) {
          r2DeletedCount += await deleteR2KeysBatch(targetCfg, listed.keys);
        }
        if (!listed.isTruncated || !listed.nextContinuationToken) {
          break;
        }
        continuationToken = listed.nextContinuationToken;
      }
      r2AbortedUploads = await abortAllR2MultipartUploads(targetCfg);
      r2Purged = true;
    } catch (err) {
      r2Error = err instanceof Error ? err.message : 'Erro ao limpar objetos do Cloudflare R2.';
    }
  }

  let localDeletedCount = 0;
  if (fs.existsSync(OBJECT_BUCKET_DIR)) {
    const shards = fs.readdirSync(OBJECT_BUCKET_DIR, { withFileTypes: true });
    for (const s of shards) {
      const shardPath = path.join(OBJECT_BUCKET_DIR, s.name);
      if (s.isDirectory()) {
        const inner = fs.readdirSync(shardPath, { withFileTypes: true });
        localDeletedCount += inner.filter((f) => f.isFile()).length;
        fs.rmSync(shardPath, { recursive: true, force: true });
      } else if (s.isFile()) {
        fs.unlinkSync(shardPath);
        localDeletedCount++;
      }
    }
  }
  if (fs.existsSync(VAULT_ROOT)) {
    for (const f of fs.readdirSync(VAULT_ROOT, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.bin')) {
        fs.unlinkSync(path.join(VAULT_ROOT, f.name));
        localDeletedCount++;
      }
    }
  }

  return {
    bucketName,
    r2Configured: Boolean(r2Cfg),
    r2Purged,
    r2DeletedCount,
    r2AbortedUploads,
    localDeletedCount,
    r2Error,
  };
}

