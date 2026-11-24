import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  DocumentActionPermissionSet,
  DocumentPermissionGroupMatrix,
  DocumentPermissionUserOverrides,
  folderPermissionRules,
  PermissionTriState,
} from '../db/schema.ts';
import { AuthRequest } from '../middleware/auth.ts';

export type DocActionKey = 'view' | 'print' | 'download' | 'edit' | 'delete';
export type FolderRuleRow = typeof folderPermissionRules.$inferSelect;

export const FULL_DOC_PERMISSIONS: DocumentActionPermissionSet = {
  view: true,
  print: true,
  download: true,
  edit: true,
  delete: true,
};

export const EMPTY_DOC_PERMISSIONS: DocumentActionPermissionSet = {
  view: false,
  print: false,
  download: false,
  edit: false,
  delete: false,
};

export const DEFAULT_CLIENT_DOC_PERMS: DocumentActionPermissionSet = {
  view: true,
  print: true,
  download: true,
  edit: true,
  delete: false,
};

export const DEFAULT_UNIT_FILE_PERMS: DocumentActionPermissionSet = {
  view: false,
  print: false,
  download: false,
  edit: false,
  delete: false,
};

export function normalizeFolderPath(raw: string | null | undefined): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

export function folderMatchesPrefix(docFolderRaw: string, rulePrefixRaw: string): boolean {
  const prefix = normalizeFolderPath(rulePrefixRaw).toLowerCase();
  if (!prefix) return true; // regra aplicada à unidade inteira
  const docFolder = normalizeFolderPath(docFolderRaw).toLowerCase();
  if (!docFolder) return false;
  return docFolder === prefix || docFolder.startsWith(`${prefix}/`);
}

function applyTriState(current: boolean, tri: string | PermissionTriState | undefined): boolean {
  if (tri === 'allow') return true;
  if (tri === 'deny') return false;
  return current;
}

function clampLogicalDependencies(perms: DocumentActionPermissionSet): DocumentActionPermissionSet {
  if (!perms.view) {
    return { ...EMPTY_DOC_PERMISSIONS };
  }
  return {
    view: true,
    print: Boolean(perms.print),
    download: Boolean(perms.download),
    edit: Boolean(perms.edit),
    delete: Boolean(perms.delete),
  };
}

export function intersectPermissions(
  a: DocumentActionPermissionSet,
  b: DocumentActionPermissionSet
): DocumentActionPermissionSet {
  return clampLogicalDependencies({
    view: a.view && b.view,
    print: a.print && b.print,
    download: a.download && b.download,
    edit: a.edit && b.edit,
    delete: a.delete && b.delete,
  });
}

function resolveBaselineForScope(params: {
  scopeKey: 'unitFiles' | 'clientDocs';
  modulePermissions?: Record<string, boolean>;
  groupDocPerms?: DocumentPermissionGroupMatrix | null;
  userOverrides?: DocumentPermissionUserOverrides | null;
}): DocumentActionPermissionSet {
  const { scopeKey, modulePermissions, groupDocPerms, userOverrides } = params;

  let base: DocumentActionPermissionSet;
  if (scopeKey === 'unitFiles') {
    const grp = groupDocPerms?.unitFiles;
    if (grp) {
      base = { ...grp };
      if (modulePermissions?.unit_files === true && !base.view) {
        base.view = true;
      }
    } else if (modulePermissions?.unit_files === true) {
      base = { view: true, print: true, download: true, edit: false, delete: false };
    } else {
      base = { ...DEFAULT_UNIT_FILE_PERMS };
    }
  } else {
    base = groupDocPerms?.clientDocs ? { ...groupDocPerms.clientDocs } : { ...DEFAULT_CLIENT_DOC_PERMS };
  }

  const ov = userOverrides?.[scopeKey];
  if (ov) {
    base = {
      view: applyTriState(base.view, ov.view),
      print: applyTriState(base.print, ov.print),
      download: applyTriState(base.download, ov.download),
      edit: applyTriState(base.edit, ov.edit),
      delete: applyTriState(base.delete, ov.delete),
    };
  }

  return clampLogicalDependencies(base);
}

export function evaluateScopePermissions(params: {
  authUser: NonNullable<AuthRequest['authUser']>;
  unitId: number;
  scopeKey: 'unitFiles' | 'clientDocs';
  folderPath?: string;
  folderRules: FolderRuleRow[];
}): DocumentActionPermissionSet {
  const { authUser, unitId, scopeKey, folderPath = '', folderRules } = params;

  if (authUser.role === 'admin') {
    return { ...FULL_DOC_PERMISSIONS };
  }
  const allowedUnits = Array.isArray(authUser.allowedUnitIds) ? authUser.allowedUnitIds : [];
  if (!allowedUnits.includes(unitId)) {
    return { ...EMPTY_DOC_PERMISSIONS };
  }

  let current = resolveBaselineForScope({
    scopeKey,
    modulePermissions: authUser.modulePermissions,
    groupDocPerms: authUser.groupDocumentPermissions,
    userOverrides: authUser.documentPermissionOverrides,
  });

  const targetRuleScope = scopeKey === 'unitFiles' ? 'unit' : 'client';
  const matchingRules = folderRules
    .filter((r) => {
      if (r.unitId !== unitId) return false;
      if (r.scope !== 'all' && r.scope !== targetRuleScope) return false;
      const matchesGroup = r.targetType === 'group' && authUser.groupId !== null && r.targetId === authUser.groupId;
      const matchesUser = r.targetType === 'user' && r.targetId === authUser.id;
      if (!matchesGroup && !matchesUser) return false;
      return folderMatchesPrefix(folderPath, r.folderPrefix);
    })
    .sort((a, b) => {
      const lenA = normalizeFolderPath(a.folderPrefix).length;
      const lenB = normalizeFolderPath(b.folderPrefix).length;
      if (lenA !== lenB) return lenA - lenB; // menor prefixo primeiro, mais específico sobrescreve
      const rankA = a.targetType === 'group' ? 0 : 1;
      const rankB = b.targetType === 'group' ? 0 : 1;
      return rankA - rankB; // regra do usuário sobrescreve regra do grupo no mesmo nível
    });

  for (const rule of matchingRules) {
    current = {
      view: applyTriState(current.view, rule.canView),
      print: applyTriState(current.print, rule.canPrint),
      download: applyTriState(current.download, rule.canDownload),
      edit: applyTriState(current.edit, rule.canEdit),
      delete: applyTriState(current.delete, rule.canDelete),
    };
  }

  return clampLogicalDependencies(current);
}

/**
 * Avalia permissões efetivas de um documento específico levando em conta:
 *  - Documentos exclusivos de Unidade (scope === 'unit')
 *  - Documentos de Clientes (scope === 'client')
 *  - Documentos Interligados (subpasta departamental + cliente/admissão) no contexto solicitado
 */
export function evaluateDocumentAccess(params: {
  authUser: NonNullable<AuthRequest['authUser']>;
  doc: {
    unitId: number;
    scope?: string | null;
    clientId?: number | null;
    unitFolderPath?: string | null;
    relativeSubpath?: string | null;
    isInterlinked?: boolean | null;
  };
  folderRules: FolderRuleRow[];
  context?: 'unit_browser' | 'client_dossier' | 'direct';
}): DocumentActionPermissionSet {
  const { authUser, doc, folderRules, context = 'direct' } = params;
  if (authUser.role === 'admin') {
    return { ...FULL_DOC_PERMISSIONS };
  }

  const unitId = Number(doc.unitId || 1);
  const folderPath = normalizeFolderPath(doc.unitFolderPath || doc.relativeSubpath || '');
  const isUnitDoc = doc.scope === 'unit' || !doc.clientId;
  const isInterlinked = Boolean(doc.isInterlinked || (doc.clientId && doc.unitFolderPath));

  if (isUnitDoc) {
    return evaluateScopePermissions({
      authUser,
      unitId,
      scopeKey: 'unitFiles',
      folderPath,
      folderRules,
    });
  }

  const clientPerms = evaluateScopePermissions({
    authUser,
    unitId,
    scopeKey: 'clientDocs',
    folderPath,
    folderRules,
  });

  if (isInterlinked && context === 'unit_browser') {
    const unitPerms = evaluateScopePermissions({
      authUser,
      unitId,
      scopeKey: 'unitFiles',
      folderPath,
      folderRules,
    });
    return intersectPermissions(unitPerms, clientPerms);
  }

  if (isInterlinked && context === 'direct') {
    // Em consulta direta (ex: /api/documents/:id ou /api/vault/i/:code), aceita se usuário tiver permissão de cliente
    // OU de pasta da unidade — porém mantendo os limites efetivos da camada correspondente
    const unitPerms = evaluateScopePermissions({
      authUser,
      unitId,
      scopeKey: 'unitFiles',
      folderPath,
      folderRules,
    });
    return clampLogicalDependencies({
      view: clientPerms.view || unitPerms.view,
      print: (clientPerms.view ? clientPerms.print : true) && (unitPerms.view ? unitPerms.print : true) && (clientPerms.print || unitPerms.print),
      download: (clientPerms.view ? clientPerms.download : true) && (unitPerms.view ? unitPerms.download : true) && (clientPerms.download || unitPerms.download),
      edit: (clientPerms.view ? clientPerms.edit : true) && (unitPerms.view ? unitPerms.edit : true) && (clientPerms.edit || unitPerms.edit),
      delete: (clientPerms.view ? clientPerms.delete : true) && (unitPerms.view ? unitPerms.delete : true) && (clientPerms.delete || unitPerms.delete),
    });
  }

  return clientPerms;
}

export async function loadFolderRulesForUser(unitId?: number | null): Promise<FolderRuleRow[]> {
  if (unitId && Number.isFinite(unitId)) {
    return db.select().from(folderPermissionRules).where(eq(folderPermissionRules.unitId, unitId));
  }
  return db.select().from(folderPermissionRules);
}

export function buildUserPermissionSummary(
  authUser: NonNullable<AuthRequest['authUser']>,
  unitId: number,
  folderRules: FolderRuleRow[]
): {
  canBrowseUnitFiles: boolean;
  unitFiles: DocumentActionPermissionSet;
  clientDocs: DocumentActionPermissionSet;
} {
  if (authUser.role === 'admin') {
    return {
      canBrowseUnitFiles: true,
      unitFiles: { ...FULL_DOC_PERMISSIONS },
      clientDocs: { ...FULL_DOC_PERMISSIONS },
    };
  }
  const unitFiles = evaluateScopePermissions({
    authUser,
    unitId,
    scopeKey: 'unitFiles',
    folderPath: '',
    folderRules,
  });
  const clientDocs = evaluateScopePermissions({
    authUser,
    unitId,
    scopeKey: 'clientDocs',
    folderPath: '',
    folderRules,
  });
  const hasAnyAllowFolderRule = folderRules.some(
    (r) =>
      (r.scope === 'unit' || r.scope === 'all') &&
      r.canView === 'allow' &&
      ((r.targetType === 'group' && r.targetId === authUser.groupId) ||
        (r.targetType === 'user' && r.targetId === authUser.id))
  );
  return {
    canBrowseUnitFiles: unitFiles.view || authUser.modulePermissions?.unit_files === true || hasAnyAllowFolderRule,
    unitFiles,
    clientDocs,
  };
}
