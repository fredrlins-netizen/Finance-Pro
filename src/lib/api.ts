let memoryToken: string | null = null;
let memoryUnitId: number = 1;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export function setActiveUnitHeader(unitId: number) {
  memoryUnitId = unitId;
}

export function getActiveUnitHeader(): number {
  return memoryUnitId;
}

export async function parseJsonResponse<T = unknown>(
  res: Response,
  fallbackError = 'Erro na requisição'
): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (trimmed.startsWith('<')) {
    throw new Error(
      `O servidor retornou HTML inesperado (HTTP ${res.status}). Recarregue a página ou tente novamente.`
    );
  }

  let parsed: unknown = null;
  if (trimmed) {
    if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error('Resposta inválida do servidor (formato JSON esperado).');
      }
    } else if (!res.ok) {
      throw new Error(trimmed.slice(0, 240) || fallbackError);
    }
  }

  if (!res.ok) {
    const errObj = (parsed && typeof parsed === 'object' ? parsed : {}) as { error?: string; detail?: string };
    throw new Error(errObj.error || errObj.detail || `${fallbackError} (HTTP ${res.status})`);
  }

  return (parsed ?? {}) as T;
}

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  headers.set('x-unit-id', String(memoryUnitId));
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();

  if (!res.ok) {
    let errMsg = `Erro HTTP ${res.status}`;
    let errCode = '';
    if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
      try {
        const data = JSON.parse(rawText) as { error?: string; code?: string };
        if (data?.error) errMsg = data.error;
        if (data?.code) errCode = data.code;
      } catch {
        // ignore json parse error
      }
    } else if (rawText.trim().startsWith('<')) {
      errMsg = `O servidor retornou HTML inesperado (HTTP ${res.status}). Tente novamente em alguns instantes.`;
    }
    if (
      typeof window !== 'undefined' &&
      !url.includes('/api/auth/login') &&
      !url.includes('/api/auth/forgot-password') &&
      (errCode === 'SCHEDULE_BLOCKED' || errCode === 'USER_SUSPENDED' || errCode === 'USER_INACTIVE')
    ) {
      window.dispatchEvent(
        new CustomEvent('fp:auth-blocked', { detail: { code: errCode, message: errMsg } })
      );
    }
    throw new Error(errMsg);
  }

  if (!rawText.trim()) {
    return {} as T;
  }
  if (rawText.trim().startsWith('<')) {
    throw new Error('A requisição não retornou JSON válido (resposta HTML recebida do proxy/servidor). Recarregue ou tente novamente.');
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Resposta inválida do servidor (formato JSON esperado).');
  }
}

export function formatBRL(cents: number | string | null | undefined): string {
  const num = Number(cents || 0) / 100;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDateBR(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTimeBR(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
