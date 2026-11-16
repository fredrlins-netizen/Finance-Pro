import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { userGroups, users, workSchedules } from '../db/schema.ts';
import { getOrCreateUser } from '../db/users.ts';
import { eq } from 'drizzle-orm';
import { setAuditContextUser } from '../utils/auditContext.ts';
import { ensureSecuritySchemaAndAutoAudit } from '../services/autoAudit.ts';

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

export interface ScheduleClosingWarning {
  minutesRemaining: number;
  endTime: string;
  ruleLabel: string;
  message: string;
}

export interface ScheduleWindowCheckResult {
  allowed: boolean;
  adminExempt?: boolean;
  message?: string;
  closingWarning?: ScheduleClosingWarning | null;
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
  if (!salt || !original) return false;
  const hashBuf = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const origBuf = Buffer.from(original);
  if (hashBuf.length !== origBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, origBuf);
}

const MODULE_KEY_ALIASES: Record<string, string[]> = {
  overview: ['overview', 'inicio'],
  prospection: ['prospection', 'prospeccao'],
  admission: ['admission', 'admissao'],
  audit: ['audit', 'auditoria'],
  legal: ['legal', 'juridico'],
  negotiations: ['negotiations', 'negociacoes'],
  internal_messaging: ['internal_messaging', 'mensageria', 'mensagens'],
  finance: ['finance', 'financeiro'],
  collection: ['collection', 'cobranca'],
  forms: ['forms', 'formularios', 'analises'],
  reports: ['reports', 'relatorios', 'relatorios_gerais'],
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
  scheduleWarning?: ScheduleClosingWarning | null;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getSaoPauloClock(refDate = new Date()): { day: number; hhmm: string; nowMinutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(refDate);

  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
  let hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  if (hour === 24) hour = 0;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');

  return {
    day: WEEKDAY_MAP[weekdayPart] ?? 1,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    nowMinutes: hour * 60 + minute,
  };
}

function parseTimeToMinutes(hhmm: string): number {
  const [hRaw, mRaw] = String(hhmm || '00:00').split(':');
  const h = Number(hRaw || 0);
  const m = Number(mRaw || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

export async function checkUserScheduleWindow(
  user: { id: number; role: string; groupId: number | null; defaultUnitId: number | null },
  unitId?: number,
  referenceDate?: Date
): Promise<ScheduleWindowCheckResult> {
  // Somente Administradores podem acessar fora dos horários estabelecidos
  if (user.role === 'admin') {
    return { allowed: true, adminExempt: true, closingWarning: null };
  }

  await ensureSecuritySchemaAndAutoAudit();
  const schedules = await db.select().from(workSchedules).where(eq(workSchedules.active, true));
  const effectiveUnitId = unitId || user.defaultUnitId;

  const applicable = schedules.filter((s) => {
    const ruleUnitId = s.unitId || (s.targetType === 'unit' || s.targetType === 'unit_group' ? s.targetId : null);
    if (s.targetType === 'user') {
      return s.targetId === user.id;
    }
    if (s.targetType === 'group') {
      return Boolean(user.groupId) && (s.groupId || s.targetId) === user.groupId;
    }
    if (s.targetType === 'unit_group') {
      return (
        Boolean(effectiveUnitId) &&
        Boolean(user.groupId) &&
        ruleUnitId === effectiveUnitId &&
        s.groupId === user.groupId
      );
    }
    if (s.targetType === 'unit') {
      if (!effectiveUnitId || ruleUnitId !== effectiveUnitId) return false;
      if (s.groupId && s.groupId !== user.groupId) return false;
      return true;
    }
    return false;
  });

  if (applicable.length === 0) {
    return { allowed: true, closingWarning: null };
  }

  const { day, hhmm, nowMinutes } = getSaoPauloClock(referenceDate);

  const todayRules = applicable.filter((s) => {
    const allowedDays = Array.isArray(s.allowedDays) ? s.allowedDays : [1, 2, 3, 4, 5];
    return allowedDays.includes(day);
  });

  const isRuleOpenNow = (s: typeof applicable[number]): boolean => {
    const allowedDays = Array.isArray(s.allowedDays) ? s.allowedDays : [1, 2, 3, 4, 5];
    if (!allowedDays.includes(day)) return false;
    const startMin = parseTimeToMinutes(s.startTime);
    const endMin = parseTimeToMinutes(s.endTime);
    if (endMin < startMin) return false;
    if (endMin === 1439) {
      return nowMinutes >= startMin && nowMinutes <= endMin;
    }
    return nowMinutes >= startMin && nowMinutes < endMin;
  };

  const openRules = todayRules.filter(isRuleOpenNow);

  if (openRules.length === 0) {
    const windowsSummary = applicable
      .slice(0, 4)
      .map((r) => `${r.targetLabel} (${r.startTime}–${r.endTime})`)
      .join(' | ');
    return {
      allowed: false,
      closingWarning: null,
      message: `Acesso bloqueado fora do quadro de horários: ${windowsSummary}. Horário atual (BRT): ${hhmm}. Apenas administradores têm acesso irrestrito.`,
    };
  }

  // Determinar o fim contínuo de cobertura somando janelas contíguas/sobrepostas para o mesmo dia
  let closingRule = openRules[0];
  let maxEndMin = parseTimeToMinutes(closingRule.endTime);
  for (const r of openRules) {
    const endMin = parseTimeToMinutes(r.endTime);
    if (endMin > maxEndMin) {
      maxEndMin = endMin;
      closingRule = r;
    }
  }

  let extended = true;
  while (extended) {
    extended = false;
    for (const r of todayRules) {
      const sMin = parseTimeToMinutes(r.startTime);
      const eMin = parseTimeToMinutes(r.endTime);
      if (sMin <= maxEndMin && eMin > maxEndMin) {
        maxEndMin = eMin;
        closingRule = r;
        extended = true;
      }
    }
  }

  const minutesRemaining = maxEndMin - nowMinutes;
  let closingWarning: ScheduleClosingWarning | null = null;

  if (minutesRemaining > 0 && minutesRemaining <= 15) {
    const customMsg = String(closingRule.closingWarningMessage || '').trim();
    closingWarning = {
      minutesRemaining,
      endTime: closingRule.endTime,
      ruleLabel: closingRule.targetLabel,
      message:
        customMsg ||
        `Aviso de encerramento: seu quadro de horário (${closingRule.targetLabel}) encerra às ${closingRule.endTime} (em ${minutesRemaining} min). Conclua e salve seus atendimentos antes do bloqueio automático.`,
    };
  }

  return { allowed: true, closingWarning };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado: token ausente.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    await ensureSecuritySchemaAndAutoAudit();

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

    if (!dbUser) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    if (dbUser.suspended) {
      return res.status(403).json({
        error:
          'Acesso suspenso automaticamente após tentativas inválidas. Apenas um Administrador pode autorizar a reabilitação.',
        code: 'USER_SUSPENDED',
        suspendedReason: dbUser.suspendedReason,
      });
    }

    if (!dbUser.active) {
      return res.status(403).json({ error: 'Usuário inativo.', code: 'USER_INACTIVE' });
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

    setAuditContextUser({ id: dbUser.id, name: dbUser.name, unitId: activeUnitId });

    const scheduleCheck = await checkUserScheduleWindow(dbUser, activeUnitId);
    if (!scheduleCheck.allowed) {
      return res.status(403).json({
        error: scheduleCheck.message,
        code: 'SCHEDULE_BLOCKED',
      });
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
    req.scheduleWarning = scheduleCheck.closingWarning || null;
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

export const requireAnyModule = (...moduleIds: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ error: 'Não autenticado.' });
    if (req.authUser.role === 'admin') return next();
    const perms = req.authUser.modulePermissions || {};
    const anyAllowed = moduleIds.some((id) => perms[id] !== false);
    if (!anyAllowed) {
      return res.status(403).json({ error: 'Acesso negado para o seu grupo de permissões.' });
    }
    next();
  };
};

export function getAllowedUnitIds(req: AuthRequest): number[] | null {
  if (!req.authUser) return [];
  if (req.authUser.role === 'admin') return null;
  return Array.isArray(req.authUser.allowedUnitIds) ? req.authUser.allowedUnitIds : [];
}

export function isUnitPermitted(req: AuthRequest, unitId: number | null | undefined): boolean {
  if (!req.authUser) return false;
  if (req.authUser.role === 'admin') return true;
  if (!unitId || !Number.isSafeInteger(unitId)) return false;
  return (req.authUser.allowedUnitIds || []).includes(unitId);
}
