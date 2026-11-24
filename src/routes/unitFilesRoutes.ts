import type { Express, RequestHandler } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  clients,
  documentObjects,
  folderPermissionRules,
  units,
} from '../db/schema.ts';
import { AuthRequest, getAllowedUnitIds, isUnitPermitted, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';
import {
  putBucketObject,
  sanitizeFileName,
  validateUploadFile,
} from '../services/bucketStorage.ts';
import {
  buildUserPermissionSummary,
  evaluateDocumentAccess,
  evaluateScopePermissions,
  folderMatchesPrefix,
  loadFolderRulesForUser,
  normalizeFolderPath,
} from '../services/documentAccessService.ts';
import { generateIntegrativeCode, inferDocCategoryFromPath } from '../services/integrativeVaultService.ts';

interface UnitFilesDeps {
  broadcast?: (event: string, payload: unknown) => void;
  uploadSingleFile: RequestHandler;
}

const VALID_TRISTATES = new Set(['inherit', 'allow', 'deny']);
function normalizeTriState(raw: unknown): 'inherit' | 'allow' | 'deny' {
  const s = String(raw || 'inherit').trim().toLowerCase();
  return VALID_TRISTATES.has(s) ? (s as 'inherit' | 'allow' | 'deny') : 'inherit';
}

const DEFAULT_UNIT_BASE_FOLDERS = [
  'ADMINISTRAÇÃO',
  'COMERCIAL',
  'MODELOS DE CONTRATOS',
  'PC GERAL',
];

function sanitizeSegment(raw: string | null | undefined, fallback: string): string {
  const cleaned = String(raw || '')
    .replace(/[\\/]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

export interface FolderTreeNode {
  path: string;
  name: string;
  parentPath: string;
  depth: number;
  unitId: number;
  unitCode: string;
  nodeKind: 'unit' | 'branch_clients' | 'client' | 'admission' | 'branch_unit' | 'unit_folder';
  rawFolderPrefix: string;
  clientId?: number | null;
  admissionId?: number | null;
  directCount: number;
  recursiveCount: number;
  unitFilesCount: number;
  clientDocsCount: number;
  interlinkedCount: number;
  totalSizeBytes: number;
}

function resolveDocTreePlacement(params: {
  doc: {
    id: number;
    unitId: number;
    scope: string;
    clientId: number | null;
    admissionId: number | null;
    unitFolderPath: string;
    relativeSubpath: string;
    folderPath: string;
    isInterlinked: boolean;
  };
  clientMap: Map<number, { id: number; fullName: string; cpfCnpj: string }>;
  admMap: Map<number, { id: number; protocolCode: string; contractNumber: string; integrativeCode: string | null }>;
}): {
  branch: 'unit' | 'clients' | 'interlinked';
  segments: Array<{ key: string; label: string; kind: FolderTreeNode['nodeKind']; rawPrefix?: string; clientId?: number | null; admissionId?: number | null }>;
  rawFolderPrefix: string;
  treeNodePath: string;
} {
  const { doc, clientMap, admMap } = params;
  const uidPrefix = `U${doc.unitId}`;
  const cleanUnitFolder = normalizeFolderPath(doc.unitFolderPath || '');
  const isUnitOnly = doc.scope === 'unit' || !doc.clientId;
  const isInterlinked = !isUnitOnly && Boolean(doc.isInterlinked);

  if (isUnitOnly || isInterlinked) {
    const branch: 'unit' | 'interlinked' = isInterlinked ? 'interlinked' : 'unit';
    const baseParts = cleanUnitFolder ? cleanUnitFolder.split('/').filter(Boolean) : ['Raiz da Unidade'];
    const segments: Array<{ key: string; label: string; kind: FolderTreeNode['nodeKind']; rawPrefix?: string }> = [
      { key: `${uidPrefix}/UNIDADE`, label: 'Pastas da Unidade', kind: 'branch_unit', rawPrefix: '' },
    ];
    let rawAcc = '';
    for (const part of baseParts) {
      rawAcc = rawAcc ? `${rawAcc}/${part}` : part;
      segments.push({
        key: `${uidPrefix}/UNIDADE/${rawAcc}`,
        label: part,
        kind: 'unit_folder',
        rawPrefix: cleanUnitFolder ? rawAcc : '',
      });
    }
    return {
      branch,
      segments,
      rawFolderPrefix: cleanUnitFolder,
      treeNodePath: segments[segments.length - 1].key,
    };
  }

  // Documento associado diretamente a Cliente / Admissão
  const cli = doc.clientId ? clientMap.get(doc.clientId) : undefined;
  const adm = doc.admissionId ? admMap.get(doc.admissionId) : undefined;
  const clientLabel = cli
    ? `${sanitizeSegment(cli.fullName, `Cliente #${cli.id}`)} (#${cli.id})`
    : `Cliente #${doc.clientId}`;

  const segments: Array<{
    key: string;
    label: string;
    kind: FolderTreeNode['nodeKind'];
    rawPrefix?: string;
    clientId?: number | null;
    admissionId?: number | null;
  }> = [
    { key: `${uidPrefix}/CLIENTES`, label: 'Clientes', kind: 'branch_clients', rawPrefix: '' },
    {
      key: `${uidPrefix}/CLIENTES/C${doc.clientId}`,
      label: clientLabel,
      kind: 'client',
      rawPrefix: cleanUnitFolder,
      clientId: doc.clientId,
    },
  ];

  if (doc.admissionId) {
    const admLabel = adm
      ? adm.contractNumber
        ? `Contrato ${sanitizeSegment(adm.contractNumber, String(adm.id))}`
        : adm.protocolCode || `Admissão #${adm.id}`
      : `Admissão #${doc.admissionId}`;
    segments.push({
      key: `${uidPrefix}/CLIENTES/C${doc.clientId}/ADM-${doc.admissionId}`,
      label: admLabel,
      kind: 'admission',
      rawPrefix: cleanUnitFolder,
      clientId: doc.clientId,
      admissionId: doc.admissionId,
    });
  } else {
    segments.push({
      key: `${uidPrefix}/CLIENTES/C${doc.clientId}/ACERVO`,
      label: 'Acervo do Cliente',
      kind: 'admission',
      rawPrefix: cleanUnitFolder,
      clientId: doc.clientId,
      admissionId: null,
    });
  }

  // Preserva subpastas internas dentro do dossiê (relativeSubpath)
  const relClean = normalizeFolderPath(doc.relativeSubpath || '');
  if (relClean && relClean.includes('/')) {
    const subParts = relClean.split('/').slice(0, -1).filter(Boolean);
    let subAcc = '';
    for (const sp of subParts) {
      subAcc = subAcc ? `${subAcc}/${sp}` : sp;
      segments.push({
        key: `${segments[segments.length - 1].key}/${sp}`,
        label: sp,
        kind: 'unit_folder',
        rawPrefix: cleanUnitFolder,
        clientId: doc.clientId,
        admissionId: doc.admissionId,
      });
    }
  }

  return {
    branch: 'clients',
    segments,
    rawFolderPrefix: cleanUnitFolder,
    treeNodePath: segments[segments.length - 1].key,
  };
}

export function registerUnitFilesRoutes(app: Express, deps: UnitFilesDeps) {
  // ---------------------------------------------------------------------------
  // 1. ÁRVORE DE PASTAS POR UNIDADE (Unidades -> Clientes & Pastas da Unidade)
  // ---------------------------------------------------------------------------
  app.get('/api/unit-files/tree', requireAuth, async (req: AuthRequest, res) => {
    try {
      const unitParam = String(req.query.unitId ?? 'all').trim().toLowerCase();
      const requestedUnitId =
        unitParam === 'all' || unitParam === '0' || unitParam === '' ? null : parsePositiveIntId(unitParam);
      const allowedUnits = getAllowedUnitIds(req);
      const [allUnits, allRules, candidateDocs, allClients, allAdms] = await Promise.all([
        db.select().from(units).orderBy(units.id),
        loadFolderRulesForUser(),
        db
          .select({
            id: documentObjects.id,
            unitId: documentObjects.unitId,
            scope: documentObjects.scope,
            clientId: documentObjects.clientId,
            admissionId: documentObjects.admissionId,
            unitFolderPath: documentObjects.unitFolderPath,
            relativeSubpath: documentObjects.relativeSubpath,
            folderPath: documentObjects.folderPath,
            isInterlinked: documentObjects.isInterlinked,
            sizeBytes: documentObjects.sizeBytes,
          })
          .from(documentObjects)
          .where(isNull(documentObjects.deletedAt)),
        db.select({ id: clients.id, fullName: clients.fullName, cpfCnpj: clients.cpfCnpj }).from(clients),
        db
          .select({
            id: admissions.id,
            protocolCode: admissions.protocolCode,
            contractNumber: admissions.contractNumber,
            integrativeCode: admissions.integrativeCode,
          })
          .from(admissions),
      ]);

      const permittedUnits =
        allowedUnits === null ? allUnits : allUnits.filter((u) => allowedUnits.includes(u.id));

      if (permittedUnits.length === 0) {
        return res.json({
          units: [],
          activeUnitId: 0,
          summary: {
            canBrowseUnitFiles: false,
            unitFiles: { view: false, print: false, download: false, edit: false, delete: false },
            clientDocs: { view: false, print: false, download: false, edit: false, delete: false },
          },
          folders: [],
          totals: { files: 0, unitFiles: 0, clientDocs: 0, interlinked: 0, totalSizeBytes: 0 },
        });
      }

      const selectedUnit = requestedUnitId ? permittedUnits.find((u) => u.id === requestedUnitId) || null : null;
      const targetUnits = selectedUnit ? [selectedUnit] : permittedUnits;
      const targetUnitIdSet = new Set(targetUnits.map((u) => u.id));
      const summaryUnit = selectedUnit || permittedUnits.find((u) => u.id === req.activeUnitId) || permittedUnits[0];
      const summary = buildUserPermissionSummary(req.authUser!, summaryUnit.id, allRules);

      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const admMap = new Map(allAdms.map((a) => [a.id, a]));

      const unitDocs = candidateDocs.filter((d) => {
        if (!targetUnitIdSet.has(d.unitId)) return false;
        const eff = evaluateDocumentAccess({
          authUser: req.authUser!,
          doc: d,
          folderRules: allRules,
          context: 'unit_browser',
        });
        return eff.view;
      });

      const nodeMap = new Map<string, FolderTreeNode>();
      const upsertNode = (node: Omit<FolderTreeNode, 'directCount' | 'recursiveCount' | 'unitFilesCount' | 'clientDocsCount' | 'interlinkedCount' | 'totalSizeBytes'>) => {
        if (!nodeMap.has(node.path)) {
          nodeMap.set(node.path, {
            ...node,
            directCount: 0,
            recursiveCount: 0,
            unitFilesCount: 0,
            clientDocsCount: 0,
            interlinkedCount: 0,
            totalSizeBytes: 0,
          });
        }
        return nodeMap.get(node.path)!;
      };

      // 1. Garante estrutura base por Unidade: Unidade -> Clientes & Pastas da Unidade (ADMINISTRAÇÃO, COMERCIAL, MODELOS DE CONTRATOS, PC GERAL)
      for (const u of targetUnits) {
        const uKey = `U${u.id}`;
        const uLabel = `${u.code} · ${u.name}`;
        upsertNode({
          path: uKey,
          name: uLabel,
          parentPath: '',
          depth: 0,
          unitId: u.id,
          unitCode: u.code,
          nodeKind: 'unit',
          rawFolderPrefix: '',
        });

        const unitPermSummary = buildUserPermissionSummary(req.authUser!, u.id, allRules);
        if (unitPermSummary.clientDocs.view || req.authUser!.role === 'admin') {
          upsertNode({
            path: `${uKey}/CLIENTES`,
            name: 'Clientes & Admissões',
            parentPath: uKey,
            depth: 1,
            unitId: u.id,
            unitCode: u.code,
            nodeKind: 'branch_clients',
            rawFolderPrefix: '',
          });
        }

        const unitBranchKey = `${uKey}/UNIDADE`;
        let unitBranchCreated = false;
        const ensureUnitBranch = () => {
          if (!unitBranchCreated) {
            upsertNode({
              path: unitBranchKey,
              name: 'Pastas da Unidade',
              parentPath: uKey,
              depth: 1,
              unitId: u.id,
              unitCode: u.code,
              nodeKind: 'branch_unit',
              rawFolderPrefix: '',
            });
            unitBranchCreated = true;
          }
        };

        const ensureUnitSubfolderChain = (folderPrefixRaw: string) => {
          const clean = normalizeFolderPath(folderPrefixRaw);
          if (!clean) return;
          ensureUnitBranch();
          const parts = clean.split('/').filter(Boolean);
          let accRaw = '';
          let parentKey = unitBranchKey;
          for (let i = 0; i < parts.length; i++) {
            accRaw = accRaw ? `${accRaw}/${parts[i]}` : parts[i];
            const nodeKey = `${unitBranchKey}/${accRaw}`;
            upsertNode({
              path: nodeKey,
              name: parts[i],
              parentPath: parentKey,
              depth: 2 + i,
              unitId: u.id,
              unitCode: u.code,
              nodeKind: 'unit_folder',
              rawFolderPrefix: accRaw,
            });
            parentKey = nodeKey;
          }
        };

        for (const baseFolder of DEFAULT_UNIT_BASE_FOLDERS) {
          const p = evaluateScopePermissions({
            authUser: req.authUser!,
            unitId: u.id,
            scopeKey: 'unitFiles',
            folderPath: baseFolder,
            folderRules: allRules,
          });
          if (p.view) ensureUnitSubfolderChain(baseFolder);
        }

        // Inclui pastas com regras explícitas onde o usuário tem permissão de visualizar (mesmo que vazias)
        for (const rule of allRules) {
          if (rule.unitId === u.id && rule.folderPrefix && (rule.scope === 'unit' || rule.scope === 'all')) {
            const p = evaluateScopePermissions({
              authUser: req.authUser!,
              unitId: u.id,
              scopeKey: 'unitFiles',
              folderPath: rule.folderPrefix,
              folderRules: allRules,
            });
            if (p.view) ensureUnitSubfolderChain(rule.folderPrefix);
          }
        }
      }

      let totalUnitFiles = 0;
      let totalClientDocs = 0;
      let totalInterlinked = 0;
      let totalSizeBytes = 0;

      const unitMap = new Map(targetUnits.map((u) => [u.id, u]));

      for (const d of unitDocs) {
        const u = unitMap.get(d.unitId);
        if (!u) continue;
        const placement = resolveDocTreePlacement({ doc: d, clientMap, admMap });
        if (placement.branch === 'interlinked') totalInterlinked++;
        else if (placement.branch === 'unit') totalUnitFiles++;
        else totalClientDocs++;
        totalSizeBytes += Number(d.sizeBytes || 0);

        const uKey = `U${u.id}`;
        const chain: FolderTreeNode[] = [];
        const uNode = upsertNode({
          path: uKey,
          name: `${u.code} · ${u.name}`,
          parentPath: '',
          depth: 0,
          unitId: u.id,
          unitCode: u.code,
          nodeKind: 'unit',
          rawFolderPrefix: '',
        });
        chain.push(uNode);

        let parentPath = uKey;
        for (let i = 0; i < placement.segments.length; i++) {
          const seg = placement.segments[i];
          const n = upsertNode({
            path: seg.key,
            name: seg.label,
            parentPath,
            depth: 1 + i,
            unitId: u.id,
            unitCode: u.code,
            nodeKind: seg.kind,
            rawFolderPrefix: seg.rawPrefix || '',
            clientId: seg.clientId ?? null,
            admissionId: seg.admissionId ?? null,
          });
          chain.push(n);
          parentPath = seg.key;
        }

        for (let i = 0; i < chain.length; i++) {
          const node = chain[i];
          node.recursiveCount += 1;
          node.totalSizeBytes += Number(d.sizeBytes || 0);
          if (i === chain.length - 1) node.directCount += 1;
          if (placement.branch === 'interlinked') node.interlinkedCount += 1;
          else if (placement.branch === 'unit') node.unitFilesCount += 1;
          else node.clientDocsCount += 1;
        }
      }

      const kindOrder: Record<FolderTreeNode['nodeKind'], number> = {
        unit: 0,
        branch_clients: 1,
        client: 2,
        admission: 3,
        branch_unit: 4,
        unit_folder: 5,
      };
      const folders = Array.from(nodeMap.values()).sort((a, b) => {
        if (a.unitId !== b.unitId) return a.unitId - b.unitId;
        if (a.depth !== b.depth && a.parentPath === b.parentPath) return a.depth - b.depth;
        if (a.parentPath === b.parentPath && a.nodeKind !== b.nodeKind) {
          return kindOrder[a.nodeKind] - kindOrder[b.nodeKind];
        }
        return a.path.localeCompare(b.path, 'pt-BR');
      });

      res.json({
        units: permittedUnits.map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
          city: u.city,
          state: u.state,
          summary: buildUserPermissionSummary(req.authUser!, u.id, allRules),
        })),
        activeUnitId: selectedUnit ? selectedUnit.id : 0,
        summary,
        folders,
        totals: {
          files: unitDocs.length,
          unitFiles: totalUnitFiles,
          clientDocs: totalClientDocs,
          interlinked: totalInterlinked,
          totalSizeBytes,
        },
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao carregar árvore de arquivos da unidade.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. LISTAGEM FILTRADA DE ARQUIVOS DA UNIDADE, CLIENTES & INTERLIGADOS
  // ---------------------------------------------------------------------------
  app.get('/api/unit-files/list', requireAuth, async (req: AuthRequest, res) => {
    try {
      const unitParam = String(req.query.unitId ?? 'all').trim().toLowerCase();
      const requestedUnitId =
        unitParam === 'all' || unitParam === '0' || unitParam === '' ? null : parsePositiveIntId(unitParam);
      if (requestedUnitId && !isUnitPermitted(req, requestedUnitId)) {
        return res.status(403).json({ error: 'Sem permissão de acesso à unidade solicitada.' });
      }

      const nodePath = String(req.query.nodePath || '').trim();
      const folderPrefix = normalizeFolderPath(String(req.query.folderPrefix || ''));
      const includeSubfolders = String(req.query.includeSubfolders ?? 'true') !== 'false';
      const scopeFilter = String(req.query.scopeFilter || 'all'); // 'all' | 'unit' | 'client' | 'interlinked'
      const searchQ = String(req.query.search || '').trim().toLowerCase();
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(200, Math.max(10, Number(req.query.limit || 60)));

      const allowedUnits = getAllowedUnitIds(req);
      const [allUnits, allRules, docs, allClients, allAdms] = await Promise.all([
        db.select().from(units).orderBy(units.id),
        loadFolderRulesForUser(requestedUnitId),
        requestedUnitId
          ? db
              .select()
              .from(documentObjects)
              .where(and(eq(documentObjects.unitId, requestedUnitId), isNull(documentObjects.deletedAt)))
              .orderBy(desc(documentObjects.id))
          : db
              .select()
              .from(documentObjects)
              .where(isNull(documentObjects.deletedAt))
              .orderBy(desc(documentObjects.id)),
        db.select({ id: clients.id, fullName: clients.fullName, cpfCnpj: clients.cpfCnpj }).from(clients),
        db
          .select({
            id: admissions.id,
            protocolCode: admissions.protocolCode,
            contractNumber: admissions.contractNumber,
            integrativeCode: admissions.integrativeCode,
          })
          .from(admissions),
      ]);

      const permittedUnits =
        allowedUnits === null ? allUnits : allUnits.filter((u) => allowedUnits.includes(u.id));
      const permittedUnitIds = new Set(permittedUnits.map((u) => u.id));
      const unitMap = new Map(permittedUnits.map((u) => [u.id, u]));
      const clientMap = new Map(allClients.map((c) => [c.id, c]));
      const admMap = new Map(allAdms.map((a) => [a.id, a]));

      const permUnitId = requestedUnitId || permittedUnits[0]?.id || req.activeUnitId || 1;
      const folderPermissions = evaluateScopePermissions({
        authUser: req.authUser!,
        unitId: permUnitId,
        scopeKey: 'unitFiles',
        folderPath: folderPrefix,
        folderRules: allRules,
      });

      const items = docs
        .filter((d) => {
          if (!permittedUnitIds.has(d.unitId)) return false;

          const placement = resolveDocTreePlacement({ doc: d, clientMap, admMap });

          if (nodePath) {
            if (includeSubfolders) {
              if (placement.treeNodePath !== nodePath && !placement.treeNodePath.startsWith(`${nodePath}/`)) {
                return false;
              }
            } else if (placement.treeNodePath !== nodePath) {
              return false;
            }
          } else if (folderPrefix) {
            const docFolder = normalizeFolderPath(d.unitFolderPath || '');
            if (includeSubfolders) {
              if (!folderMatchesPrefix(docFolder, folderPrefix)) return false;
            } else if (docFolder.toLowerCase() !== folderPrefix.toLowerCase()) {
              return false;
            }
          }

          if (scopeFilter === 'unit' && placement.branch !== 'unit') return false;
          if (scopeFilter === 'client' && placement.branch !== 'clients') return false;
          if (scopeFilter === 'interlinked' && placement.branch !== 'interlinked') return false;

          const eff = evaluateDocumentAccess({
            authUser: req.authUser!,
            doc: d,
            folderRules: allRules,
            context: 'unit_browser',
          });
          if (!eff.view) return false;

          if (searchQ) {
            const u = unitMap.get(d.unitId);
            const cli = d.clientId ? clientMap.get(d.clientId) : null;
            const adm = d.admissionId ? admMap.get(d.admissionId) : null;
            const hay = [
              d.fileName,
              d.unitFolderPath,
              d.folderPath,
              d.relativeSubpath,
              placement.treeNodePath,
              d.integrativeCode || '',
              d.docCategory,
              u?.code || '',
              u?.name || '',
              cli?.fullName || '',
              cli?.cpfCnpj || '',
              adm?.contractNumber || '',
              adm?.protocolCode || '',
            ]
              .join(' ')
              .toLowerCase();
            if (!hay.includes(searchQ)) return false;
          }
          return true;
        })
        .map((d) => {
          const u = unitMap.get(d.unitId);
          const cli = d.clientId ? clientMap.get(d.clientId) : null;
          const adm = d.admissionId ? admMap.get(d.admissionId) : null;
          const placement = resolveDocTreePlacement({ doc: d, clientMap, admMap });
          const effectivePermissions = evaluateDocumentAccess({
            authUser: req.authUser!,
            doc: d,
            folderRules: allRules,
            context: 'unit_browser',
          });
          return {
            ...d,
            unitCode: u?.code || `U${d.unitId}`,
            unitName: u?.name || `Unidade ${d.unitId}`,
            treeNodePath: placement.treeNodePath,
            treeBranch: placement.branch,
            unitFolderPath: normalizeFolderPath(d.unitFolderPath || ''),
            isInterlinked: placement.branch === 'interlinked',
            clientName: cli?.fullName || null,
            clientCpfCnpj: cli?.cpfCnpj || null,
            contractNumber: adm?.contractNumber || null,
            protocolCode: adm?.protocolCode || null,
            admissionIntegrativeCode: adm?.integrativeCode || null,
            effectivePermissions,
          };
        });

      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const pagedItems = items.slice((page - 1) * limit, page * limit);

      res.json({
        unit: requestedUnitId ? unitMap.get(requestedUnitId) || null : null,
        nodePath,
        folderPrefix,
        folderPermissions,
        total,
        page,
        limit,
        totalPages,
        items: pagedItems,
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao listar arquivos da unidade.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. UPLOAD DIRETO PARA PASTA DA UNIDADE (Respeitando Permissão Alterar)
  // ---------------------------------------------------------------------------
  app.post('/api/unit-files/upload', requireAuth, deps.uploadSingleFile, async (req: AuthRequest, res) => {
    try {
      const unitId = parsePositiveIntId((req.body || {}).unitId) || req.activeUnitId || 1;
      if (!isUnitPermitted(req, unitId)) {
        return res.status(403).json({ error: 'Sem permissão para a unidade informada.' });
      }
      const cleanFolder = normalizeFolderPath((req.body || {}).unitFolderPath || 'ADMINISTRAÇÃO');
      if (!cleanFolder) {
        return res.status(400).json({ error: 'Informe a pasta da unidade para envio do arquivo.' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const rules = await loadFolderRulesForUser(unitId);
      const perms = evaluateScopePermissions({
        authUser: req.authUser!,
        unitId,
        scopeKey: 'unitFiles',
        folderPath: cleanFolder,
        folderRules: rules,
      });

      if (!perms.view || !perms.edit) {
        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'DOCUMENT_ACCESS_DENIED',
          entityType: 'unit_folder',
          entityId: cleanFolder,
          details: { actionRequested: 'edit/upload', unitId, folderPath: cleanFolder },
          unitId,
        });
        return res.status(403).json({
          error: `Permissão negada: você não possui direito de Alterar/Enviar arquivos na pasta "${cleanFolder}".`,
        });
      }

      const validationErr = validateUploadFile(file.originalname, file.mimetype, file.size);
      if (validationErr) return res.status(400).json({ error: validationErr });

      const safeFileName = sanitizeFileName(file.originalname);
      const bucketFolderPath = `bucketdainvicta/U${unitId}/UNIT/${cleanFolder}`;
      const stored = await putBucketObject(file.buffer, {
        folderPath: bucketFolderPath,
        mimeType: file.mimetype,
        originalName: safeFileName,
      });

      const docCategory =
        String((req.body || {}).docCategory || '').trim() ||
        inferDocCategoryFromPath(cleanFolder, safeFileName);

      const [unitRow] = await db.select().from(units).where(eq(units.id, unitId)).limit(1);

      const [inserted] = await db
        .insert(documentObjects)
        .values({
          clientId: null,
          admissionId: null,
          scope: 'unit',
          unitFolderPath: cleanFolder,
          isInterlinked: false,
          folderPath: bucketFolderPath,
          fileName: safeFileName,
          docCategory,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: stored.sizeBytes,
          sha256Hash: stored.sha256Hash,
          storageUri: stored.storageUri,
          uploadedBy: req.authUser!.name,
          unitId,
          relativeSubpath: `${cleanFolder}/${safeFileName}`,
          legacySourcePath: `upload-web://${cleanFolder}/${safeFileName}`,
          versionNumber: 1,
          lastSyncedAt: new Date(),
        })
        .returning();

      const integrativeCode = generateIntegrativeCode({
        unitCode: unitRow?.code || `U${unitId}`,
        entityType: 'UNID',
        entityId: inserted.id,
        referenceSeed: inserted.sha256Hash,
      });

      const [updatedDoc] = await db
        .update(documentObjects)
        .set({ integrativeCode })
        .where(eq(documentObjects.id, inserted.id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UNIT_FILE_UPLOAD',
        entityType: 'document_object',
        entityId: String(updatedDoc.id),
        details: {
          unitFolderPath: cleanFolder,
          fileName: safeFileName,
          sha256Hash: stored.sha256Hash,
          integrativeCode,
        },
        unitId,
      });

      deps.broadcast?.('vault:unit_file_uploaded', {
        unitId,
        documentId: updatedDoc.id,
        unitFolderPath: cleanFolder,
      });

      res.json({
        ok: true,
        document: {
          ...updatedDoc,
          effectivePermissions: perms,
        },
      });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao enviar arquivo da unidade.') });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. REGRAS GRANULARES DE PERMISSÃO POR PASTA (EXCLUSIVO ADMIN)
  // ---------------------------------------------------------------------------
  app.get('/api/config/folder-permissions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const unitIdFilter = req.query.unitId ? parsePositiveIntId(req.query.unitId) : null;
      const rules = unitIdFilter
        ? await db
            .select()
            .from(folderPermissionRules)
            .where(eq(folderPermissionRules.unitId, unitIdFilter))
            .orderBy(folderPermissionRules.unitId, folderPermissionRules.folderPrefix)
        : await db
            .select()
            .from(folderPermissionRules)
            .orderBy(folderPermissionRules.unitId, folderPermissionRules.folderPrefix);

      res.json({ rules });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao listar regras por pasta.') });
    }
  });

  app.post('/api/config/folder-permissions/save', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        id?: number | null;
        unitId?: number;
        scope?: string;
        folderPrefix?: string;
        targetType?: string;
        targetId?: number;
        canView?: string;
        canPrint?: string;
        canDownload?: string;
        canEdit?: string;
        canDelete?: string;
      };

      const unitId = parsePositiveIntId(body.unitId);
      const targetId = parsePositiveIntId(body.targetId);
      const targetType = body.targetType === 'user' ? 'user' : body.targetType === 'group' ? 'group' : '';
      const scope = body.scope === 'unit' || body.scope === 'client' ? body.scope : 'all';
      const folderPrefix = normalizeFolderPath(body.folderPrefix || '');

      if (!unitId || !targetId || !targetType) {
        return res.status(400).json({ error: 'Unidade, Tipo de Alvo (Grupo/Usuário) e ID do Alvo são obrigatórios.' });
      }

      const payload = {
        unitId,
        scope,
        folderPrefix,
        targetType,
        targetId,
        canView: normalizeTriState(body.canView),
        canPrint: normalizeTriState(body.canPrint),
        canDownload: normalizeTriState(body.canDownload),
        canEdit: normalizeTriState(body.canEdit),
        canDelete: normalizeTriState(body.canDelete),
        updatedAt: new Date(),
      };

      let saved;
      if (body.id) {
        const ruleId = parsePositiveIntId(body.id);
        if (!ruleId) return res.status(400).json({ error: 'ID de regra inválido.' });
        const [updated] = await db
          .update(folderPermissionRules)
          .set(payload)
          .where(eq(folderPermissionRules.id, ruleId))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Regra não encontrada.' });
        saved = updated;
      } else {
        const existing = await db
          .select()
          .from(folderPermissionRules)
          .where(
            and(
              eq(folderPermissionRules.unitId, unitId),
              eq(folderPermissionRules.scope, scope),
              eq(folderPermissionRules.folderPrefix, folderPrefix),
              eq(folderPermissionRules.targetType, targetType),
              eq(folderPermissionRules.targetId, targetId)
            )
          )
          .limit(1);
        if (existing[0]) {
          const [updated] = await db
            .update(folderPermissionRules)
            .set(payload)
            .where(eq(folderPermissionRules.id, existing[0].id))
            .returning();
          saved = updated;
        } else {
          const [created] = await db
            .insert(folderPermissionRules)
            .values({
              ...payload,
              createdBy: req.authUser!.name,
            })
            .returning();
          saved = created;
        }
      }

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'FOLDER_PERMISSION_SAVED',
        entityType: 'folder_permission_rule',
        entityId: String(saved.id),
        details: {
          unitId,
          scope,
          folderPrefix: folderPrefix || '(toda a unidade)',
          targetType,
          targetId,
          canView: saved.canView,
          canPrint: saved.canPrint,
          canDownload: saved.canDownload,
          canEdit: saved.canEdit,
          canDelete: saved.canDelete,
        },
        unitId,
      });

      res.json({ ok: true, rule: saved });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao salvar regra de pasta.') });
    }
  });

  app.delete('/api/config/folder-permissions/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID de regra inválido.' });
      const [deleted] = await db
        .delete(folderPermissionRules)
        .where(eq(folderPermissionRules.id, id))
        .returning();
      if (!deleted) return res.status(404).json({ error: 'Regra não encontrada.' });

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'FOLDER_PERMISSION_DELETED',
        entityType: 'folder_permission_rule',
        entityId: String(id),
        details: { folderPrefix: deleted.folderPrefix, targetType: deleted.targetType, targetId: deleted.targetId },
        unitId: deleted.unitId,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: sanitizeErrorMessage(error, 'Erro ao excluir regra de pasta.') });
    }
  });
}
