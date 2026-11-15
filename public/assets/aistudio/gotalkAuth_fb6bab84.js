/**
 * Gotalk Authentication Service
 * Manages the Gotalk API token with automatic 24-hour renewal.
 */

const GOTALK_BASE_URL = process.env.GOTALK_BASE_URL || 'https://app.gotalk.digital';
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // 23h (refresh 1h before expiry)

let _token = null;
let _channelId = null;
let _tokenExpiresAt = 0;
let _refreshTimer = null;

async function authenticate() {
  const login = process.env.GOTALK_LOGIN;
  const password = process.env.GOTALK_PASSWORD;

  if (!login || !password) {
    throw new Error('[Gotalk] GOTALK_LOGIN e GOTALK_PASSWORD não configurados como secrets.');
  }

  console.log('[Gotalk] Autenticando...');

  let response;
  try {
    response = await fetch(`${GOTALK_BASE_URL}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (fetchErr) {
    const code = fetchErr.cause?.code || '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new Error(`DNS: não foi possível resolver ${GOTALK_BASE_URL} (${code}). Verifique conectividade de rede.`);
    }
    if (code === 'ECONNREFUSED') {
      throw new Error(`Conexão recusada por ${GOTALK_BASE_URL} (ECONNREFUSED).`);
    }
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
      throw new Error(`Timeout (>20s) ao autenticar com ${GOTALK_BASE_URL}.`);
    }
    throw new Error(`Erro de rede: ${fetchErr.message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Credenciais inválidas (HTTP ${response.status}). Verifique GOTALK_LOGIN e GOTALK_PASSWORD.`);
    }
    throw new Error(`[Gotalk] Falha na autenticação: ${response.status} ${text}`);
  }

  const data = await response.json();

  // Gotalk returns token inside the `login` object field
  const token = data?.login?.token || data?.token;
  const channelId = data?.login?.channelId || data?.channelId;

  if (!token) {
    throw new Error('[Gotalk] Token não encontrado na resposta de autenticação.');
  }

  _token = token;
  _channelId = channelId;
  _tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;

  console.log(`[Gotalk] Autenticado com sucesso. ChannelId: ${channelId}`);

  // Schedule next renewal
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    authenticate().catch(err => console.error('[Gotalk] Erro ao renovar token:', err.message));
  }, TOKEN_LIFETIME_MS);

  return { token, channelId };
}

async function getToken() {
  if (!_token || Date.now() >= _tokenExpiresAt) {
    await authenticate();
  }
  return _token;
}

async function getChannelId() {
  if (!_channelId || Date.now() >= _tokenExpiresAt) {
    await authenticate();
  }
  return _channelId;
}

async function getAuthHeaders() {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token,
  };
}

async function gotalkFetch(path, options = {}) {
  const headers = await getAuthHeaders();
  const url = `${GOTALK_BASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  if (response.status === 401) {
    // Token expired — force re-auth and retry once
    _token = null;
    _tokenExpiresAt = 0;
    const retryHeaders = await getAuthHeaders();
    return fetch(url, {
      ...options,
      headers: { ...retryHeaders, ...(options.headers || {}) },
    });
  }

  return response;
}

export { authenticate, getToken, getChannelId, getAuthHeaders, gotalkFetch, GOTALK_BASE_URL };
