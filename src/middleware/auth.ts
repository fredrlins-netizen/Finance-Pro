import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { userGroups, users, workSchedules } from '../db/schema.ts';
import { getOrCreateUser } from '../db/users.ts';
import { eq } from 'drizzle-orm';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(process.env.SQL_PASSWORD || 'financepro-corp-secret-2026')
    .digest('hex');

export interface CorporateSessionPayload {
  userId: number;
  uid: string;
  email: string;
  role: string;
  sessionVersion: number;
  exp: number;
}

export function signCorporateToken(payload: Omit<CorporateSessionPayload, 'exp'>): string {
  const fullPayload: CorporateSessionPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  };
  const data = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `corp.${data}.${sig}`;
}

export function verifyCorporateToken(token: string): CorporateSessionPayload | null {
  if (!token.startsWith('corp.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, data, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as CorporateSessionPayload;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, original] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(original));
}

const MODULE_KEY_ALIASES: Record<string, string[]> = {
  overview: ['overview', 'inicio'],
  prospection: ['prospection', 'prospeccao'],
  admission: ['admission', 'admissao'],
  audit: ['audit', 'auditoria'],
  legal: ['legal', 'juridico'],
  negotiations: ['negotiations', 'negociacoes'],
  finance: ['finance', 'financeiro'],
  collection: ['collection', 'cobranca'],
  config: ['config', 'administracao'],
};

export function normalizeModulePermissions(
  raw: Record<string, boolean> | null | undefined
): Record<string, boolean> {
  const source = raw || {};
  const normalized: Record<string, boolean> = { ...source };
  for (const [canonical, aliases] of Object.entries(MODULE_KEY_ALIASES)) {
    const matched = aliases.find((k) => k in source);
    if (matched !== undefined) {
      normalized[canonical] = Boolean(source[matched]);
    }
  }
  return normalized;
}

export interface AuthRequest extends Request {
  authUser?: {
    id: number;
    uid: string;
    email: string;
    name: string;
    role: string;
    groupId: number | null;
    defaultUnitId: number | null;
    allowedUnitIds: number[];
    mustChangePassword: boolean;
    points: number;
    modulePermissions: Record<string, boolean>;
  };
  activeUnitId?: number;
}

export async function checkUserScheduleWindow(
  user: { id: number; role: string; groupId: number | null; defaultUnitId: number | null },
  unitId?: number
): Promise<{ allowed: boolean; message?: string }> {
  if (user.role === 'admin') return { allowed: true };
  const schedules = await db.select().from(workSchedules).where(eq(workSchedules.active, true));
  const applicable = schedules.filter(
    (s) =>
      (s.targetType === 'user' && s.targetId === user.id) ||
      (s.targetType === 'group' && user.groupId && s.targetId === user.groupId) ||
      (s.targetType === 'unit' && (unitId || user.defaultUnitId) && s.targetId === (unitId || user.defaultUnitId))
  );
  if (applicable.length === 0) return { allowed: true };

  const rule =
    applicable.find((s) => s.targetType === 'user') ||
    applicable.find((s) => s.targetType === 'group') ||
    applicable[0];

  const now = new Date();
  const brTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = brTime.getDay();
  const allowedDays = Array.isArray(rule.allowedDays) ? rule.allowedDays : [1, 2, 3, 4, 5];
  if (!allowedDays.includes(day)) {
    return { allowed: false, message: `Acesso bloqueado fora dos dias permitidos (${rule.targetLabel}).` };
  }
  const hhmm = `${String(brTime.getHours()).padStart(2, '0')}:${String(brTime.getMinutes()).padStart(2, '0')}`;
  if (hhmm < rule.startTime || hhmm > rule.endTime) {
    return {
      allowed: false,
      message: `Acesso permitido apenas entre ${rule.startTime} e ${rule.endTime} (${rule.targetLabel}). Horário atual: ${hhmm}.`,
    };
  }
  return { allowed: true };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado: token ausente.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    let dbUser;
    let tokenSessionVersion: number | undefined;

    if (token.startsWith('corp.')) {
      const verified = verifyCorporateToken(token);
      if (!verified) {
        return res.status(401).json({ error: 'Sessão corporativa expirada ou inválida.' });
      }
      tokenSessionVersion = verified.sessionVersion;
      const rows = await db.select().from(users).where(eq(users.id, verified.userId)).limit(1);
      dbUser = rows[0];
    } else {
      const decodedToken = await adminAuth.verifyIdToken(token);
      dbUser = await getOrCreateUser(decodedToken.uid, decodedToken.email || '', decodedToken.name);
    }

    if (!dbUser || !dbUser.active) {
      return res.status(403).json({ error: 'Usuário inativo ou não encontrado.' });
    }

    if (tokenSessionVersion !== undefined && dbUser.sessionVersion !== tokenSessionVersion) {
      return res.status(401).json({ error: 'Sessão revogada por alteração de senha ou comando administrativo.' });
    }

    const headerUnit = req.headers['x-unit-id'];
    let activeUnitId = dbUser.defaultUnitId || 1;
    if (headerUnit && !Number.isNaN(Number(headerUnit))) {
      const requestedUnit = Number(headerUnit);
      const allowed = Array.isArray(dbUser.allowedUnitIds) ? dbUser.allowedUnitIds : [];
      if (dbUser.role === 'admin' || allowed.includes(requestedUnit)) {
        activeUnitId = requestedUnit;
      } else {
        return res.status(403).json({ error: 'Unidade não autorizada para este perfil.' });
      }
    }

    const scheduleCheck = await checkUserScheduleWindow(dbUser, activeUnitId);
    if (!scheduleCheck.allowed) {
      return res.status(403).json({ error: scheduleCheck.message });
    }

    let modulePermissions: Record<string, boolean> = {};
    if (dbUser.groupId) {
      const grp = await db.select().from(userGroups).where(eq(userGroups.id, dbUser.groupId)).limit(1);
      modulePermissions = normalizeModulePermissions(grp[0]?.modulePermissions);
    }

    req.authUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      groupId: dbUser.groupId,
      defaultUnitId: dbUser.defaultUnitId,
      allowedUnitIds: Array.isArray(dbUser.allowedUnitIds) ? dbUser.allowedUnitIds : [1],
      mustChangePassword: dbUser.mustChangePassword,
      points: dbUser.points,
      modulePermissions,
    };
    req.activeUnitId = activeUnitId;
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(401).json({ error: 'Token de autenticação inválido.' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.authUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
};

export const requireModule = (moduleId: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ error: 'Não autenticado.' });
    if (req.authUser.role === 'admin') return next();
    const perms = req.authUser.modulePermissions || {};
    if (perms[moduleId] === false) {
      return res.status(403).json({ error: `Acesso ao módulo "${moduleId}" negado para o seu grupo.` });
    }
    next();
  };
};
