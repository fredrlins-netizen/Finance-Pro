import type { Express } from 'express';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  appointments,
  auditLogs,
  bankContacts,
  banks,
  bankServices,
  clientAssetLinks,
  clients,
  collaborators,
  departments,
  documentObjects,
  febrabanBanks,
  financialTitles,
  legalProcesses,
  measurementUnits,
  modalities,
  products,
  rolesCatalog,
  scheduleBlocks,
  seriesCatalog,
  seriesUnitNumbering,
  systemSettings,
  units,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed } from '../db/seed.ts';
import { AuthRequest, requireAuth } from '../middleware/auth.ts';
import { syncClientLegalAndEscavadorStatus } from '../services/legalSync.ts';

async function logAudit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown>,
  unitId?: number | null
) {
  await db.insert(auditLogs).values({
    userId: req.authUser?.id ?? null,
    userName: req.authUser?.name || 'Sistema',
    action,
    entityType,
    entityId: String(entityId),
    details,
    unitId: unitId ?? req.activeUnitId ?? 1,
  });
}

async function getMaritalStatusesList(): Promise<string[]> {
  const row = await db.select().from(systemSettings).where(eq(systemSettings.key, 'cad_marital_statuses')).limit(1);
  const raw = (row[0]?.value as { options?: unknown } | undefined)?.options;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((v) => String(v)).filter(Boolean);
  }
  return ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União Estável', 'Separado(a)'];
}

export async function syncFebrabanBanksFromBrasilApi(): Promise<{ ok: boolean; count: number; detail?: string }> {
  try {
    const res = await fetch('https://brasilapi.com.br/api/banks/v1', {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return { ok: false, count: 0, detail: `BrasilAPI retornou HTTP ${res.status}` };
    }
    const list = (await res.json()) as Array<{ code?: number | null; name?: string; fullName?: string; ispb?: string }>;
    if (!Array.isArray(list)) {
      return { ok: false, count: 0, detail: 'Formato inesperado da BrasilAPI.' };
    }
    const valid = list
      .filter((b) => b && b.code !== null && b.code !== undefined && (b.name || b.fullName))
      .map((b) => ({
        code: String(b.code).padStart(3, '0'),
        name: String(b.name || b.fullName || '').trim(),
        fullName: String(b.fullName || b.name || '').trim(),
        ispb: String(b.ispb || '').trim(),
      }));

    for (const item of valid) {
      await db
        .insert(febrabanBanks)
        .values({
          code: item.code,
          name: item.name,
          fullName: item.fullName,
          ispb: item.ispb,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: febrabanBanks.code,
          set: {
            name: item.name,
            fullName: item.fullName,
            ispb: item.ispb,
            updatedAt: new Date(),
          },
        });
    }
    return { ok: true, count: valid.length };
  } catch (err) {
    return { ok: false, count: 0, detail: err instanceof Error ? err.message : 'Erro ao consultar BrasilAPI.' };
  }
}

export function registerCadastrosRoutes(
  app: Express,
  broadcast?: (event: string, data: unknown) => void
) {
  // ---------------------------------------------------------------------------
  // BOOTSTRAP CENTRAL (Alimenta Cadastros Comuns & Admissão & Dossiês)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/bootstrap', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const [
        allBanks,
        allServices,
        allContacts,
        allFebraban,
        allModalities,
        allSeries,
        allSeriesNum,
        allCollabs,
        allRoles,
        allDepts,
        maritalStatuses,
      ] = await Promise.all([
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.id)),
        db.select().from(bankContacts).orderBy(asc(bankContacts.id)),
        db.select().from(febrabanBanks).orderBy(asc(febrabanBanks.name)),
        db.select().from(modalities).orderBy(asc(modalities.type), asc(modalities.description)),
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.sigla)),
        db.select().from(seriesUnitNumbering).orderBy(asc(seriesUnitNumbering.id)),
        db.select().from(collaborators).orderBy(asc(collaborators.name)),
        db.select().from(rolesCatalog).orderBy(asc(rolesCatalog.sortOrder), asc(rolesCatalog.name)),
        db.select().from(departments).orderBy(asc(departments.name)),
        getMaritalStatusesList(),
      ]);

      const banksWithChildren = allBanks.map((b) => ({
        ...b,
        services: allServices.filter((s) => s.bankId === b.id),
        contacts: allContacts.filter((c) => c.bankId === b.id),
      }));

      const seriesWithUnits = allSeries.map((s) => ({
        ...s,
        unitNumbering: allSeriesNum.filter((n) => n.seriesId === s.id),
      }));

      res.json({
        banks: banksWithChildren,
        febrabanBanks: allFebraban,
        modalities: allModalities,
        series: seriesWithUnits,
        collaborators: allCollabs,
        roles: allRoles,
        departments: allDepts,
        maritalStatuses,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar Cadastros Comuns.' });
    }
  });

  // ---------------------------------------------------------------------------
  // CONSULTA CEP (ViaCEP Server Proxy)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/cep/:cep', requireAuth, async (req: AuthRequest, res) => {
    try {
      const cleanCep = String(req.params.cep || '').replace(/\D/g, '');
      if (cleanCep.length !== 8) {
        return res.status(400).json({ error: 'CEP inválido. Informe os 8 dígitos.' });
      }
      const resp = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        return res.status(502).json({ error: `ViaCEP respondeu HTTP ${resp.status}.` });
      }
      const data = (await resp.json()) as {
        erro?: boolean;
        cep?: string;
        logradouro?: string;
        complemento?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (data.erro) {
        return res.status(404).json({ error: 'CEP não localizado na base dos Correios (ViaCEP).' });
      }
      res.json({
        zipCode: data.cep || cleanCep,
        address: data.logradouro || '',
        complement: data.complemento || '',
        neighborhood: data.bairro || '',
        city: data.localidade || '',
        state: data.uf || '',
      });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Falha ao consultar ViaCEP.' });
    }
  });

  // ---------------------------------------------------------------------------
  // HISTÓRICO DE AUDITORIA POR ENTIDADE
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/audit/:entityType/:entityId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const entityType = String(req.params.entityType || '').trim();
      const entityId = String(req.params.entityId || '').trim();
      const logs = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(500);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar auditoria.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ESTADOS CIVIS (Modal Gerenciar Estados Civis)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/marital-statuses', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      res.json({ options: await getMaritalStatusesList() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar estados civis.' });
    }
  });

  app.post('/api/cadastros/marital-statuses', requireAuth, async (req: AuthRequest, res) => {
    try {
      const label = String((req.body || {}).label || '').trim();
      if (!label) return res.status(400).json({ error: 'Informe a descrição do estado civil.' });
      const current = await getMaritalStatusesList();
      if (!current.some((x) => x.toLowerCase() === label.toLowerCase())) {
        const next = [...current, label];
        await db
          .insert(systemSettings)
          .values({ key: 'cad_marital_statuses', value: { options: next }, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: { options: next }, updatedAt: new Date() },
          });
        await logAudit(req, 'MARITAL_STATUS_CREATE', 'marital_status', label, { label });
        return res.json({ options: next });
      }
      res.json({ options: current });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar estado civil.' });
    }
  });

  app.delete('/api/cadastros/marital-statuses/:label', requireAuth, async (req: AuthRequest, res) => {
    try {
      const label = decodeURIComponent(String(req.params.label || '')).trim();
      const current = await getMaritalStatusesList();
      const next = current.filter((x) => x.toLowerCase() !== label.toLowerCase());
      await db
        .insert(systemSettings)
        .values({ key: 'cad_marital_statuses', value: { options: next }, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: { options: next }, updatedAt: new Date() },
        });
      await logAudit(req, 'MARITAL_STATUS_DELETE', 'marital_status', label, { label });
      res.json({ options: next });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao remover estado civil.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. CLIENTES (Paginado 50/pág + filtros + bloqueio + verificação de dependências)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/clients', requireAuth, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const q = String(req.query.q || '').trim().toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      const personNature = String(req.query.personNature || '').trim().toUpperCase();
      const status = String(req.query.status || '').trim().toLowerCase();
      const city = String(req.query.city || '').trim().toLowerCase();
      const state = String(req.query.state || '').trim().toUpperCase();
      const cpfFilter = String(req.query.cpfCnpj || '').trim().replace(/\D/g, '');
      const sortKey = String(req.query.sortKey || 'fullName');
      const sortDir = String(req.query.sortDir || 'asc') === 'desc' ? 'desc' : 'asc';

      const [allClients, allDocs, allAdms] = await Promise.all([
        db.select().from(clients).orderBy(desc(clients.id)),
        db
          .select({ id: documentObjects.id, clientId: documentObjects.clientId, deletedAt: documentObjects.deletedAt })
          .from(documentObjects)
          .where(isNull(documentObjects.deletedAt)),
        db
          .select({ id: admissions.id, clientId: admissions.clientId, assetOwnerId: admissions.assetOwnerId })
          .from(admissions),
      ]);

      const filtered = allClients.filter((c) => {
        if (personNature && (c.personNature || 'PF').toUpperCase() !== personNature) return false;
        if (status && (c.status || 'ativo').toLowerCase() !== status) return false;
        if (city && !c.city.toLowerCase().includes(city)) return false;
        if (state && c.state.toUpperCase() !== state) return false;
        if (cpfFilter && !c.cpfCnpj.replace(/\D/g, '').includes(cpfFilter)) return false;
        if (q) {
          const matchText =
            c.fullName.toLowerCase().includes(q) ||
            String(c.id).includes(q) ||
            c.cpfCnpj.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q);
          const matchDigits =
            qDigits.length >= 2 &&
            (c.cpfCnpj.replace(/\D/g, '').includes(qDigits) || c.phone.replace(/\D/g, '').includes(qDigits));
          if (!matchText && !matchDigits) return false;
        }
        return true;
      });

      filtered.sort((a, b) => {
        const valA = String((a as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
        const valB = String((b as Record<string, unknown>)[sortKey] ?? '').toLowerCase();
        const cmp = valA.localeCompare(valB, 'pt-BR');
        return sortDir === 'desc' ? -cmp : cmp;
      });

      const total = filtered.length;
      const offset = (page - 1) * limit;
      const pageItems = filtered.slice(offset, offset + limit).map((c) => ({
        ...c,
        docsCount: allDocs.filter((d) => d.clientId === c.id).length,
        admissionsCount: allAdms.filter((a) => a.clientId === c.id || a.assetOwnerId === c.id).length,
      }));

      res.json({
        data: pageItems,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar clientes.' });
    }
  });

  app.post('/api/cadastros/clients/:id/block', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { status, reason } = (req.body || {}) as { status?: 'suspenso' | 'cancelado'; reason?: string };
      const targetStatus = status === 'cancelado' ? 'cancelado' : 'suspenso';
      if (!reason?.trim()) {
        return res.status(400).json({ error: 'Informe o motivo do bloqueio/suspensão.' });
      }

      const synced = await syncClientLegalAndEscavadorStatus({
        clientId: id,
        targetStatus,
        reason: reason.trim(),
        actorUserId: req.authUser?.id ?? null,
        actorUserName: req.authUser?.name || 'Usuário',
        unitId: req.activeUnitId,
        originLabel: 'Cadastro de Clientes',
        cancelFutureTitles: targetStatus === 'cancelado',
      });
      if (!synced) return res.status(404).json({ error: 'Cliente não encontrado.' });

      await logAudit(req, 'CLIENT_BLOCK', 'client', id, {
        status: targetStatus,
        reason: reason.trim(),
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
      }, synced.client.unitId);

      broadcast?.('legal:update', { clientId: id, status: targetStatus, escavadorMonitored: synced.escavadorMonitored });
      res.json({
        client: synced.client,
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
        escavadorActionSummary: synced.escavadorActionSummary,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao bloquear cliente.' });
    }
  });

  app.post('/api/cadastros/clients/:id/unblock', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (req.authUser!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem desbloquear um cliente restrito.' });
      }
      const id = Number(req.params.id);
      const { reason } = (req.body || {}) as { reason?: string };
      const synced = await syncClientLegalAndEscavadorStatus({
        clientId: id,
        targetStatus: 'ativo',
        reason: reason?.trim() || 'Desbloqueio administrativo · retorno ao status normal',
        actorUserId: req.authUser?.id ?? null,
        actorUserName: req.authUser?.name || 'Administrador',
        unitId: req.activeUnitId,
        originLabel: 'Cadastro de Clientes',
      });
      if (!synced) return res.status(404).json({ error: 'Cliente não encontrado.' });

      await logAudit(req, 'CLIENT_UNBLOCK', 'client', id, {
        restoredStatus: 'ativo',
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
      }, synced.client.unitId);

      broadcast?.('legal:update', { clientId: id, status: 'ativo', escavadorMonitored: synced.escavadorMonitored });
      res.json({
        client: synced.client,
        affectedProcessesCount: synced.affectedProcessesCount,
        escavadorMonitored: synced.escavadorMonitored,
        escavadorActionSummary: synced.escavadorActionSummary,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao desbloquear cliente.' });
    }
  });

  app.delete('/api/cadastros/clients/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      const client = rows[0];
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const [docsCount, admCount, titlesCount, apptsCount, procCount] = await Promise.all([
        db.select({ v: count() }).from(documentObjects).where(and(eq(documentObjects.clientId, id), isNull(documentObjects.deletedAt))),
        db.select({ v: count() }).from(admissions).where(or(eq(admissions.clientId, id), eq(admissions.assetOwnerId, id))),
        db.select({ v: count() }).from(financialTitles).where(eq(financialTitles.clientId, id)),
        db.select({ v: count() }).from(appointments).where(eq(appointments.clientId, id)),
        db.select({ v: count() }).from(legalProcesses).where(eq(legalProcesses.clientId, id)),
      ]);

      const deps: string[] = [];
      if (Number(docsCount[0]?.v || 0) > 0) deps.push(`${docsCount[0].v} documento(s) ativo(s) no bucket`);
      if (Number(admCount[0]?.v || 0) > 0) deps.push(`${admCount[0].v} ficha(s) de admissão`);
      if (Number(titlesCount[0]?.v || 0) > 0) deps.push(`${titlesCount[0].v} título(s) financeiro(s)`);
      if (Number(apptsCount[0]?.v || 0) > 0) deps.push(`${apptsCount[0].v} agendamento(s)`);
      if (Number(procCount[0]?.v || 0) > 0) deps.push(`${procCount[0].v} processo(s) jurídico(s)`);

      if (deps.length > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: este cliente possui vínculos ativos (${deps.join(', ')}).`,
        });
      }

      await db.delete(clientAssetLinks).where(or(eq(clientAssetLinks.titularClientId, id), eq(clientAssetLinks.assetOwnerClientId, id)));
      await db.delete(clients).where(eq(clients.id, id));
      await logAudit(req, 'CLIENT_DELETE', 'client', id, { fullName: client.fullName, cpfCnpj: client.cpfCnpj }, client.unitId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir cliente.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. CARGOS (roles_catalog)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/roles', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const rows = await db.select().from(rolesCatalog).orderBy(asc(rolesCatalog.sortOrder), asc(rolesCatalog.name));
      res.json({ data: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar cargos.' });
    }
  });

  app.post('/api/cadastros/roles', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as { name?: string; participatesInScheduleQueue?: boolean; sortOrder?: number; active?: boolean };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do cargo é obrigatório.' });
      const [created] = await db
        .insert(rolesCatalog)
        .values({
          name: b.name.trim(),
          participatesInScheduleQueue: b.participatesInScheduleQueue !== false,
          sortOrder: Number(b.sortOrder || 0),
          active: b.active !== false,
        })
        .returning();
      await logAudit(req, 'ROLE_CREATE', 'role', created.id, { name: created.name, fila: created.participatesInScheduleQueue });
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar cargo.' });
    }
  });

  app.put('/api/cadastros/roles/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { name?: string; participatesInScheduleQueue?: boolean; sortOrder?: number; active?: boolean };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do cargo é obrigatório.' });
      const [updated] = await db
        .update(rolesCatalog)
        .set({
          name: b.name.trim(),
          participatesInScheduleQueue: b.participatesInScheduleQueue !== false,
          sortOrder: Number(b.sortOrder || 0),
          active: b.active !== false,
        })
        .where(eq(rolesCatalog.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Cargo não encontrado.' });
      // Keep collaborators.jobTitle in sync cleanly
      await db.update(collaborators).set({ jobTitle: updated.name }).where(eq(collaborators.roleId, id));
      await logAudit(req, 'ROLE_UPDATE', 'role', id, { name: updated.name, fila: updated.participatesInScheduleQueue });
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar cargo.' });
    }
  });

  app.delete('/api/cadastros/roles/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(rolesCatalog).where(eq(rolesCatalog.id, id)).limit(1);
      const role = rows[0];
      if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
      const linked = await db
        .select({ v: count() })
        .from(collaborators)
        .where(or(eq(collaborators.roleId, id), ilike(collaborators.jobTitle, role.name)));
      if (Number(linked[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: existem ${linked[0].v} colaborador(es) vinculado(s) a este cargo.`,
        });
      }
      await db.delete(rolesCatalog).where(eq(rolesCatalog.id, id));
      await logAudit(req, 'ROLE_DELETE', 'role', id, { name: role.name });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir cargo.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. DEPARTAMENTOS (Fonte única PostgreSQL: sincroniza Tela + Colaboradores)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/departments', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const rows = await db.select().from(departments).orderBy(asc(departments.name));
      res.json({ data: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar departamentos.' });
    }
  });

  app.post('/api/cadastros/departments', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as { code?: string; name?: string; managerName?: string; status?: string };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do departamento é obrigatório.' });
      const [created] = await db
        .insert(departments)
        .values({
          code: (b.code || '').trim(),
          name: b.name.trim().toUpperCase(),
          managerName: (b.managerName || '').trim(),
          status: b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        })
        .returning();
      await logAudit(req, 'DEPARTMENT_CREATE', 'department', created.id, { code: created.code, name: created.name });
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar departamento.' });
    }
  });

  app.put('/api/cadastros/departments/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { code?: string; name?: string; managerName?: string; status?: string };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do departamento é obrigatório.' });
      const [updated] = await db
        .update(departments)
        .set({
          code: (b.code || '').trim(),
          name: b.name.trim().toUpperCase(),
          managerName: (b.managerName || '').trim(),
          status: b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        })
        .where(eq(departments.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Departamento não encontrado.' });
      await logAudit(req, 'DEPARTMENT_UPDATE', 'department', id, { code: updated.code, name: updated.name, status: updated.status });
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar departamento.' });
    }
  });

  app.delete('/api/cadastros/departments/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
      const dept = rows[0];
      if (!dept) return res.status(404).json({ error: 'Departamento não encontrado.' });
      const linked = await db.select({ v: count() }).from(collaborators).where(eq(collaborators.departmentId, id));
      if (Number(linked[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: existem ${linked[0].v} colaborador(es) lotado(s) neste departamento.`,
        });
      }
      await db.delete(departments).where(eq(departments.id, id));
      await logAudit(req, 'DEPARTMENT_DELETE', 'department', id, { name: dept.name });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir departamento.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. COLABORADORES (Árvore por Unidade -> Cargo + Câmera + CEP)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/collaborators', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const rows = await db.select().from(collaborators).orderBy(asc(collaborators.name));
      res.json({ data: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar colaboradores.' });
    }
  });

  app.post('/api/cadastros/collaborators', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const name = String(b.name || '').trim();
      const unitId = Number(b.unitId || 0);
      if (!name) return res.status(400).json({ error: 'Nome completo é obrigatório.' });
      if (!unitId) return res.status(400).json({ error: 'Unidade é obrigatória.' });

      let roleId = b.roleId ? Number(b.roleId) : null;
      let jobTitle = String(b.jobTitle || '').trim();
      if (roleId) {
        const rRows = await db.select().from(rolesCatalog).where(eq(rolesCatalog.id, roleId)).limit(1);
        if (rRows[0]) jobTitle = rRows[0].name;
      }

      const participatesQueue = b.participatesInScheduleQueue === true;

      const [created] = await db
        .insert(collaborators)
        .values({
          code: String(b.code || '').trim(),
          name,
          active: b.active !== false,
          participatesInScheduleQueue: participatesQueue,
          unitId,
          roleId,
          jobTitle,
          departmentId: b.departmentId ? Number(b.departmentId) : null,
          userId: b.userId ? Number(b.userId) : null,
          email: String(b.email || '').trim(),
          phone: String(b.phone || '').trim(),
          isWhatsapp: Boolean(b.isWhatsapp),
          birthDate: String(b.birthDate || '').trim(),
          maritalStatus: String(b.maritalStatus || '').trim(),
          photoUrl: String(b.photoUrl || ''),
          zipCode: String(b.zipCode || '').trim(),
          address: String(b.address || '').trim(),
          addressNumber: String(b.addressNumber || '').trim(),
          complement: String(b.complement || '').trim(),
          neighborhood: String(b.neighborhood || '').trim(),
          city: String(b.city || '').trim(),
          state: String(b.state || '').trim().toUpperCase(),
          notes: String(b.notes || '').trim(),
        })
        .returning();
      await logAudit(
        req,
        'COLLABORATOR_CREATE',
        'collaborator',
        created.id,
        {
          name: created.name,
          jobTitle: created.jobTitle,
          participatesInScheduleQueue: created.participatesInScheduleQueue,
        },
        unitId
      );
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar colaborador.' });
    }
  });

  app.put('/api/cadastros/collaborators/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as Record<string, unknown>;
      const name = String(b.name || '').trim();
      const unitId = Number(b.unitId || 0);
      if (!name) return res.status(400).json({ error: 'Nome completo é obrigatório.' });
      if (!unitId) return res.status(400).json({ error: 'Unidade é obrigatória.' });

      let roleId = b.roleId ? Number(b.roleId) : null;
      let jobTitle = String(b.jobTitle || '').trim();
      if (roleId) {
        const rRows = await db.select().from(rolesCatalog).where(eq(rolesCatalog.id, roleId)).limit(1);
        if (rRows[0]) jobTitle = rRows[0].name;
      }

      const participatesQueue = b.participatesInScheduleQueue === true;

      const [updated] = await db
        .update(collaborators)
        .set({
          code: String(b.code || '').trim(),
          name,
          active: b.active !== false,
          participatesInScheduleQueue: participatesQueue,
          unitId,
          roleId,
          jobTitle,
          departmentId: b.departmentId ? Number(b.departmentId) : null,
          userId: b.userId ? Number(b.userId) : null,
          email: String(b.email || '').trim(),
          phone: String(b.phone || '').trim(),
          isWhatsapp: Boolean(b.isWhatsapp),
          birthDate: String(b.birthDate || '').trim(),
          maritalStatus: String(b.maritalStatus || '').trim(),
          photoUrl: String(b.photoUrl || ''),
          zipCode: String(b.zipCode || '').trim(),
          address: String(b.address || '').trim(),
          addressNumber: String(b.addressNumber || '').trim(),
          complement: String(b.complement || '').trim(),
          neighborhood: String(b.neighborhood || '').trim(),
          city: String(b.city || '').trim(),
          state: String(b.state || '').trim().toUpperCase(),
          notes: String(b.notes || '').trim(),
        })
        .where(eq(collaborators.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Colaborador não encontrado.' });

      await logAudit(
        req,
        'COLLABORATOR_UPDATE',
        'collaborator',
        id,
        {
          name: updated.name,
          jobTitle: updated.jobTitle,
          active: updated.active,
          participatesInScheduleQueue: updated.participatesInScheduleQueue,
        },
        unitId
      );
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar colaborador.' });
    }
  });

  app.patch('/api/cadastros/collaborators/:id/queue-flag', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { participatesInScheduleQueue?: boolean };
      const flag = b.participatesInScheduleQueue === true;
      const [updated] = await db
        .update(collaborators)
        .set({ participatesInScheduleQueue: flag })
        .where(eq(collaborators.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Colaborador não encontrado.' });

      await logAudit(
        req,
        'COLLABORATOR_QUEUE_FLAG',
        'collaborator',
        id,
        { name: updated.name, participatesInScheduleQueue: flag },
        updated.unitId
      );
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar flag Participa da Fila.' });
    }
  });

  app.delete('/api/cadastros/collaborators/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(collaborators).where(eq(collaborators.id, id)).limit(1);
      const colab = rows[0];
      if (!colab) return res.status(404).json({ error: 'Colaborador não encontrado.' });

      if (colab.userId) {
        const [admCnt, apptCnt, blkCnt] = await Promise.all([
          db.select({ v: count() }).from(admissions).where(eq(admissions.consultantId, colab.userId)),
          db.select({ v: count() }).from(appointments).where(eq(appointments.consultantId, colab.userId)),
          db.select({ v: count() }).from(scheduleBlocks).where(eq(scheduleBlocks.consultantId, colab.userId)),
        ]);
        const deps: string[] = [];
        if (Number(admCnt[0]?.v || 0) > 0) deps.push(`${admCnt[0].v} admissão(ões)`);
        if (Number(apptCnt[0]?.v || 0) > 0) deps.push(`${apptCnt[0].v} agendamento(s)`);
        if (Number(blkCnt[0]?.v || 0) > 0) deps.push(`${blkCnt[0].v} bloqueio(s) de agenda`);
        if (deps.length > 0) {
          return res.status(409).json({
            error: `Exclusão bloqueada: este colaborador possui vínculos operacionais (${deps.join(', ')}). Inative-o em vez de excluir.`,
          });
        }
      }

      await db.delete(collaborators).where(eq(collaborators.id, id));
      await logAudit(req, 'COLLABORATOR_DELETE', 'collaborator', id, { name: colab.name }, colab.unitId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir colaborador.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. BANCOS + FEBRABAN (BrasilAPI) + SUBGRADES (Serviços & Contatos)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/febraban-banks', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      if (req.query.refresh === '1') {
        await syncFebrabanBanksFromBrasilApi();
      }
      const rows = await db.select().from(febrabanBanks).orderBy(asc(febrabanBanks.name));
      res.json({ banks: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar bancos FEBRABAN.' });
    }
  });

  app.get('/api/cadastros/banks', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const [allBanks, allServices, allContacts] = await Promise.all([
        db.select().from(banks).orderBy(asc(banks.name)),
        db.select().from(bankServices).orderBy(asc(bankServices.id)),
        db.select().from(bankContacts).orderBy(asc(bankContacts.id)),
      ]);
      const data = allBanks.map((b) => ({
        ...b,
        services: allServices.filter((s) => s.bankId === b.id),
        contacts: allContacts.filter((c) => c.bankId === b.id),
      }));
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar bancos.' });
    }
  });

  app.post('/api/cadastros/banks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        code?: string;
        name?: string;
        febrabanCode?: string;
        status?: string;
        notes?: string;
        services?: Array<{ name: string; modalityId?: number | null; modalityDescription?: string; negotiationPercent?: string | number; defaultInstallments?: number }>;
        contacts?: Array<{ name: string; sector?: string; phone?: string; mobile?: string; isWhatsapp?: boolean; email?: string }>;
      };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do banco é obrigatório.' });

      const [created] = await db
        .insert(banks)
        .values({
          code: (b.code || '').trim(),
          name: b.name.trim(),
          febrabanCode: (b.febrabanCode || '').trim(),
          status: b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
          notes: (b.notes || '').trim(),
        })
        .returning();

      const srvRows = Array.isArray(b.services) ? b.services.filter((s) => s.name?.trim()) : [];
      if (srvRows.length > 0) {
        const allMods = await db.select().from(modalities);
        await db.insert(bankServices).values(
          srvRows.map((s) => {
            const mod = s.modalityId ? allMods.find((m) => m.id === Number(s.modalityId)) : null;
            return {
              bankId: created.id,
              name: s.name.trim(),
              modalityId: mod?.id || null,
              modalityDescription: mod?.description || s.modalityDescription || '',
              negotiationPercent: String(s.negotiationPercent ?? '45').replace(',', '.'),
              defaultInstallments: Math.max(1, Number(s.defaultInstallments || 12)),
            };
          })
        );
      }

      const ctcRows = Array.isArray(b.contacts) ? b.contacts.filter((c) => c.name?.trim()) : [];
      if (ctcRows.length > 0) {
        await db.insert(bankContacts).values(
          ctcRows.map((c) => ({
            bankId: created.id,
            name: c.name.trim(),
            sector: (c.sector || '').trim(),
            phone: (c.phone || '').trim(),
            mobile: (c.mobile || '').trim(),
            isWhatsapp: Boolean(c.isWhatsapp),
            email: (c.email || '').trim(),
          }))
        );
      }

      const [savedServices, savedContacts] = await Promise.all([
        db.select().from(bankServices).where(eq(bankServices.bankId, created.id)),
        db.select().from(bankContacts).where(eq(bankContacts.bankId, created.id)),
      ]);

      await logAudit(req, 'BANK_CREATE', 'bank', created.id, { name: created.name, febrabanCode: created.febrabanCode, servicesCount: savedServices.length, contactsCount: savedContacts.length });
      res.status(201).json({ data: { ...created, services: savedServices, contacts: savedContacts } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar banco.' });
    }
  });

  app.put('/api/cadastros/banks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as {
        code?: string;
        name?: string;
        febrabanCode?: string;
        status?: string;
        notes?: string;
        services?: Array<{ name: string; modalityId?: number | null; modalityDescription?: string; negotiationPercent?: string | number; defaultInstallments?: number }>;
        contacts?: Array<{ name: string; sector?: string; phone?: string; mobile?: string; isWhatsapp?: boolean; email?: string }>;
      };
      if (!b.name?.trim()) return res.status(400).json({ error: 'Nome do banco é obrigatório.' });

      const [updated] = await db
        .update(banks)
        .set({
          code: (b.code || '').trim(),
          name: b.name.trim(),
          febrabanCode: (b.febrabanCode || '').trim(),
          status: b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
          notes: (b.notes || '').trim(),
        })
        .where(eq(banks.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Banco não encontrado.' });

      await db.delete(bankServices).where(eq(bankServices.bankId, id));
      const srvRows = Array.isArray(b.services) ? b.services.filter((s) => s.name?.trim()) : [];
      if (srvRows.length > 0) {
        const allMods = await db.select().from(modalities);
        await db.insert(bankServices).values(
          srvRows.map((s) => {
            const mod = s.modalityId ? allMods.find((m) => m.id === Number(s.modalityId)) : null;
            return {
              bankId: id,
              name: s.name.trim(),
              modalityId: mod?.id || null,
              modalityDescription: mod?.description || s.modalityDescription || '',
              negotiationPercent: String(s.negotiationPercent ?? '45').replace(',', '.'),
              defaultInstallments: Math.max(1, Number(s.defaultInstallments || 12)),
            };
          })
        );
      }

      await db.delete(bankContacts).where(eq(bankContacts.bankId, id));
      const ctcRows = Array.isArray(b.contacts) ? b.contacts.filter((c) => c.name?.trim()) : [];
      if (ctcRows.length > 0) {
        await db.insert(bankContacts).values(
          ctcRows.map((c) => ({
            bankId: id,
            name: c.name.trim(),
            sector: (c.sector || '').trim(),
            phone: (c.phone || '').trim(),
            mobile: (c.mobile || '').trim(),
            isWhatsapp: Boolean(c.isWhatsapp),
            email: (c.email || '').trim(),
          }))
        );
      }

      const [savedServices, savedContacts] = await Promise.all([
        db.select().from(bankServices).where(eq(bankServices.bankId, id)),
        db.select().from(bankContacts).where(eq(bankContacts.bankId, id)),
      ]);

      await logAudit(req, 'BANK_UPDATE', 'bank', id, { name: updated.name, febrabanCode: updated.febrabanCode, servicesCount: savedServices.length, contactsCount: savedContacts.length });
      res.json({ data: { ...updated, services: savedServices, contacts: savedContacts } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar banco.' });
    }
  });

  app.delete('/api/cadastros/banks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(banks).where(eq(banks.id, id)).limit(1);
      const bank = rows[0];
      if (!bank) return res.status(404).json({ error: 'Banco não encontrado.' });

      const linkedAdms = await db
        .select({ v: count() })
        .from(admissions)
        .where(ilike(admissions.bankName, bank.name));
      if (Number(linkedAdms[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: existem ${linkedAdms[0].v} admissão(ões) utilizando o banco "${bank.name}".`,
        });
      }

      await db.delete(banks).where(eq(banks.id, id));
      await logAudit(req, 'BANK_DELETE', 'bank', id, { name: bank.name });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir banco.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. MODALIDADES
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/modalities', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const rows = await db.select().from(modalities).orderBy(asc(modalities.type), asc(modalities.description));
      res.json({ data: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar modalidades.' });
    }
  });

  app.post('/api/cadastros/modalities', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as { type?: string; description?: string; hasVehicleSection?: boolean; active?: boolean };
      if (!b.type?.trim() || !b.description?.trim()) {
        return res.status(400).json({ error: 'Tipo e Descrição da modalidade são obrigatórios.' });
      }
      const [created] = await db
        .insert(modalities)
        .values({
          type: b.type.trim(),
          description: b.description.trim(),
          hasVehicleSection: b.hasVehicleSection !== undefined ? Boolean(b.hasVehicleSection) : /ve[ií]culo/i.test(b.description),
          active: b.active !== false,
        })
        .returning();
      await logAudit(req, 'MODALITY_CREATE', 'modality', created.id, { type: created.type, description: created.description });
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar modalidade.' });
    }
  });

  app.put('/api/cadastros/modalities/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { type?: string; description?: string; hasVehicleSection?: boolean; active?: boolean };
      if (!b.type?.trim() || !b.description?.trim()) {
        return res.status(400).json({ error: 'Tipo e Descrição da modalidade são obrigatórios.' });
      }
      const [updated] = await db
        .update(modalities)
        .set({
          type: b.type.trim(),
          description: b.description.trim(),
          hasVehicleSection: Boolean(b.hasVehicleSection),
          active: b.active !== false,
        })
        .where(eq(modalities.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Modalidade não encontrada.' });
      await logAudit(req, 'MODALITY_UPDATE', 'modality', id, { type: updated.type, description: updated.description });
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar modalidade.' });
    }
  });

  app.delete('/api/cadastros/modalities/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(modalities).where(eq(modalities.id, id)).limit(1);
      const mod = rows[0];
      if (!mod) return res.status(404).json({ error: 'Modalidade não encontrada.' });

      const [admCnt, srvCnt] = await Promise.all([
        db.select({ v: count() }).from(admissions).where(ilike(admissions.modality, mod.description)),
        db.select({ v: count() }).from(bankServices).where(eq(bankServices.modalityId, id)),
      ]);
      const deps: string[] = [];
      if (Number(admCnt[0]?.v || 0) > 0) deps.push(`${admCnt[0].v} admissão(ões)`);
      if (Number(srvCnt[0]?.v || 0) > 0) deps.push(`${srvCnt[0].v} serviço(s) bancário(s)`);
      if (deps.length > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: modalidade vinculada a ${deps.join(' e ')}.`,
        });
      }

      await db.delete(modalities).where(eq(modalities.id, id));
      await logAudit(req, 'MODALITY_DELETE', 'modality', id, { description: mod.description });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir modalidade.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. PRODUTOS & UNIDADES DE MEDIDA (Modal de Unidade inline)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/measurement-units', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const rows = await db.select().from(measurementUnits).orderBy(asc(measurementUnits.name));
      res.json({ data: rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar unidades de medida.' });
    }
  });

  app.post('/api/cadastros/measurement-units', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as { name?: string; conversionFactor?: string | number };
      const name = String(b.name || '').trim().toUpperCase().slice(0, 5);
      if (!name) return res.status(400).json({ error: 'Sigla da unidade de medida (até 5 caracteres) é obrigatória.' });
      const [created] = await db
        .insert(measurementUnits)
        .values({
          name,
          conversionFactor: String(b.conversionFactor || '1').replace(',', '.'),
        })
        .returning();
      await logAudit(req, 'MEASUREMENT_UNIT_CREATE', 'measurement_unit', created.id, { name: created.name });
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar unidade de medida.' });
    }
  });

  app.put('/api/cadastros/measurement-units/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { name?: string; conversionFactor?: string | number };
      const name = String(b.name || '').trim().toUpperCase().slice(0, 5);
      if (!name) return res.status(400).json({ error: 'Sigla da unidade de medida é obrigatória.' });
      const [updated] = await db
        .update(measurementUnits)
        .set({
          name,
          conversionFactor: String(b.conversionFactor || '1').replace(',', '.'),
        })
        .where(eq(measurementUnits.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Unidade de medida não encontrada.' });
      await logAudit(req, 'MEASUREMENT_UNIT_UPDATE', 'measurement_unit', id, { name: updated.name });
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar unidade de medida.' });
    }
  });

  app.get('/api/cadastros/products', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const [allProds, allMu] = await Promise.all([
        db.select().from(products).orderBy(asc(products.description)),
        db.select().from(measurementUnits),
      ]);
      const data = allProds.map((p) => ({
        ...p,
        unitName: allMu.find((u) => u.id === p.unitId)?.name || '',
      }));
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar produtos.' });
    }
  });

  app.post('/api/cadastros/products', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as { type?: string; description?: string; unitId?: number | null };
      if (!b.description?.trim()) return res.status(400).json({ error: 'Descrição do produto/serviço é obrigatória.' });
      const [created] = await db
        .insert(products)
        .values({
          type: b.type === 'MATERIAL' ? 'MATERIAL' : 'SERVICO',
          description: b.description.trim(),
          unitId: b.unitId ? Number(b.unitId) : null,
        })
        .returning();
      await logAudit(req, 'PRODUCT_CREATE', 'product', created.id, { type: created.type, description: created.description });
      res.status(201).json({ data: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar produto.' });
    }
  });

  app.put('/api/cadastros/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as { type?: string; description?: string; unitId?: number | null };
      if (!b.description?.trim()) return res.status(400).json({ error: 'Descrição do produto/serviço é obrigatória.' });
      const [updated] = await db
        .update(products)
        .set({
          type: b.type === 'MATERIAL' ? 'MATERIAL' : 'SERVICO',
          description: b.description.trim(),
          unitId: b.unitId ? Number(b.unitId) : null,
        })
        .where(eq(products.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Produto não encontrado.' });
      await logAudit(req, 'PRODUCT_UPDATE', 'product', id, { type: updated.type, description: updated.description });
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar produto.' });
    }
  });

  app.delete('/api/cadastros/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado.' });
      await db.delete(products).where(eq(products.id, id));
      await logAudit(req, 'PRODUCT_DELETE', 'product', id, { description: rows[0].description });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir produto.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. SÉRIE / NÚMEROS (Persistência completa da subgrade por Unidade!)
  // ---------------------------------------------------------------------------
  app.get('/api/cadastros/series', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const [allSeries, allUnitNums] = await Promise.all([
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.sigla)),
        db.select().from(seriesUnitNumbering).orderBy(asc(seriesUnitNumbering.id)),
      ]);
      const data = allSeries.map((s) => ({
        ...s,
        unitNumbering: allUnitNums.filter((n) => n.seriesId === s.id),
      }));
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar séries.' });
    }
  });

  app.post('/api/cadastros/series', requireAuth, async (req: AuthRequest, res) => {
    try {
      const b = (req.body || {}) as {
        sigla?: string;
        description?: string;
        generalNumber?: number;
        isDefault?: boolean;
        unitNumbering?: Array<{ unitId: number; currentNumber: number }>;
      };
      const sigla = String(b.sigla || '').trim().toUpperCase().slice(0, 10);
      if (!sigla || !b.description?.trim()) {
        return res.status(400).json({ error: 'Sigla e Descrição da série são obrigatórias.' });
      }
      if (b.isDefault) {
        await db.update(seriesCatalog).set({ isDefault: false });
      }
      const [created] = await db
        .insert(seriesCatalog)
        .values({
          sigla,
          description: b.description.trim(),
          generalNumber: Math.max(1, Number(b.generalNumber || 1)),
          isDefault: Boolean(b.isDefault),
        })
        .returning();

      const unitRows = Array.isArray(b.unitNumbering)
        ? b.unitNumbering.filter((n) => Number(n.unitId) > 0)
        : [];
      if (unitRows.length > 0) {
        await db.insert(seriesUnitNumbering).values(
          unitRows.map((n) => ({
            seriesId: created.id,
            unitId: Number(n.unitId),
            currentNumber: Math.max(1, Number(n.currentNumber || 1)),
          }))
        );
      }

      const savedUnits = await db.select().from(seriesUnitNumbering).where(eq(seriesUnitNumbering.seriesId, created.id));
      await logAudit(req, 'SERIES_CREATE', 'series', created.id, { sigla: created.sigla, generalNumber: created.generalNumber, unitsCount: savedUnits.length });
      res.status(201).json({ data: { ...created, unitNumbering: savedUnits } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar série.' });
    }
  });

  app.put('/api/cadastros/series/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const b = (req.body || {}) as {
        sigla?: string;
        description?: string;
        generalNumber?: number;
        isDefault?: boolean;
        unitNumbering?: Array<{ unitId: number; currentNumber: number }>;
      };
      const sigla = String(b.sigla || '').trim().toUpperCase().slice(0, 10);
      if (!sigla || !b.description?.trim()) {
        return res.status(400).json({ error: 'Sigla e Descrição da série são obrigatórias.' });
      }
      if (b.isDefault) {
        await db.update(seriesCatalog).set({ isDefault: false });
      }
      const [updated] = await db
        .update(seriesCatalog)
        .set({
          sigla,
          description: b.description.trim(),
          generalNumber: Math.max(1, Number(b.generalNumber || 1)),
          isDefault: Boolean(b.isDefault),
        })
        .where(eq(seriesCatalog.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Série não encontrada.' });

      await db.delete(seriesUnitNumbering).where(eq(seriesUnitNumbering.seriesId, id));
      const unitRows = Array.isArray(b.unitNumbering)
        ? b.unitNumbering.filter((n) => Number(n.unitId) > 0)
        : [];
      if (unitRows.length > 0) {
        await db.insert(seriesUnitNumbering).values(
          unitRows.map((n) => ({
            seriesId: id,
            unitId: Number(n.unitId),
            currentNumber: Math.max(1, Number(n.currentNumber || 1)),
          }))
        );
      }

      const savedUnits = await db.select().from(seriesUnitNumbering).where(eq(seriesUnitNumbering.seriesId, id));
      await logAudit(req, 'SERIES_UPDATE', 'series', id, { sigla: updated.sigla, generalNumber: updated.generalNumber, unitsCount: savedUnits.length });
      res.json({ data: { ...updated, unitNumbering: savedUnits } });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar série.' });
    }
  });

  app.delete('/api/cadastros/series/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(seriesCatalog).where(eq(seriesCatalog.id, id)).limit(1);
      const s = rows[0];
      if (!s) return res.status(404).json({ error: 'Série não encontrada.' });

      const linkedAdms = await db.select({ v: count() }).from(admissions).where(eq(admissions.series, s.sigla));
      if (Number(linkedAdms[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada: existem ${linkedAdms[0].v} admissão(ões) utilizando a série "${s.sigla}".`,
        });
      }

      await db.delete(seriesCatalog).where(eq(seriesCatalog.id, id));
      await logAudit(req, 'SERIES_DELETE', 'series', id, { sigla: s.sigla });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir série.' });
    }
  });
}
