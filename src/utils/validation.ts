export function parsePositiveIntId(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function parsePositiveIntArray(raw: unknown, maxLen = 500): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const item of raw.slice(0, maxLen)) {
    const id = parsePositiveIntId(item);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function parseSafeDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseFiniteNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const msg = String(error.message || '');
  if (
    !msg ||
    /failed query:|invalid input syntax|violates foreign key|violates unique constraint|syntax error at or near|column ".*" does not exist|relation ".*" does not exist/i.test(
      msg
    )
  ) {
    return fallback;
  }
  return msg;
}
