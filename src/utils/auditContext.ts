import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestContext {
  userId: number | null;
  userName: string;
  unitId: number | null;
  route: string;
  method: string;
  dbMutationsCount: number;
  manualAuditLogged: boolean;
}

export const auditContextStorage = new AsyncLocalStorage<AuditRequestContext>();

export function getAuditContext(): AuditRequestContext | undefined {
  return auditContextStorage.getStore();
}

export function setAuditContextUser(user: {
  id?: number | null;
  name?: string | null;
  unitId?: number | null;
}) {
  const ctx = auditContextStorage.getStore();
  if (!ctx) return;
  if (user.id !== undefined) ctx.userId = user.id ?? null;
  if (user.name) ctx.userName = user.name;
  if (user.unitId !== undefined) ctx.unitId = user.unitId ?? null;
}

export function markManualAuditLogged() {
  const ctx = auditContextStorage.getStore();
  if (ctx) {
    ctx.manualAuditLogged = true;
  }
}
