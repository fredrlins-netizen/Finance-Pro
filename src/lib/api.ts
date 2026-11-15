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
  if (!res.ok) {
    let errMsg = `Erro HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }
  return (await res.json()) as T;
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
