import crypto from 'node:crypto';
import type { Express, Request } from 'express';
import { asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  admissions,
  appointments,
  auditChecklistItems,
  auditLogs,
  bankContacts,
  banks,
  clients,
  collaborators,
  customFields,
  financialTitles,
  gotalkChannels,
  gotalkHsmTemplates,
  gotalkOperators,
  helpCenterTopics,
  legalProcesses,
  modalities,
  paymentCategories,
  seriesUnitNumbering,
  systemSettings,
  units,
  unitWhatsappCredentials,
  userGroups,
  users,
  whatsappMessages,
  whatsappThreads,
  workSchedules,
} from '../db/schema.ts';
import { ensureCommonCadastrosSeed, ensureInitialSeed } from '../db/seed.ts';
import { AuthRequest, hashPassword, requireAdmin, requireAuth } from '../middleware/auth.ts';
import {
  fetchGotalkAllChannels,
  normalizePhone,
  phonesMatchBR,
} from '../services/gotalk.ts';
import {
  DEFAULT_UAZAPI_SERVER_URL,
  decryptUazapiToken,
  disconnectUazapiInstance,
  encryptUazapiToken,
  findUazapiChats,
  findUazapiMessages,
  getUazapiInstanceStatus,
  registerUazapiWebhook,
  UazapiCredentials,
} from '../services/uazapi.ts';
import type { PortalBrandingConfig } from '../types.ts';

export const DEFAULT_PORTAL_BRANDING: PortalBrandingConfig = {
  companyName: 'FinancePro Assessoria',
  primaryColor: '#0F172A',
  textColor: '#FFFFFF',
  logoDataUrl: '',
  marketingHeadline: 'Governança Bancária, Revisional & Recuperação de Ativos',
  marketingDescription:
    'Plataforma corporativa integrada para negociação de passivos veiculares e bancários, auditoria documental, acompanhamento processual e régua inteligente.',
  loginLeftBg: '#0F172A',
  loginLeftText: '#F8FAFC',
  loginBackgroundImageUrl: '',
  loginRightBg: '#FFFFFF',
  loginRightText: '#0F172A',
  sidebarBg: '#FFFFFF',
  sidebarText: '#334155',
  headerBg: '#FFFFFF',
  headerText: '#0F172A',
  canvasBg: '#F8FAFC',
  canvasBackgroundImageUrl: '',
};

const DEFAULT_HELP_TOPICS = [
  {
    topicKey: 'cfg_uazapi_grupos',
    menuPath: 'Configurações > WhatsApp UaZapi & Grupos',
    title: 'Governança de Instâncias UaZapi, QR Code e Associação por Grupos',
    summary: 'Como parear números WhatsApp via QR Code e vincular múltiplas linhas a Grupos de Usuários e Setores.',
    keywords: ['uazapi', 'whatsapp', 'qrcode', 'grupos', 'prospeccao', 'admissao'],
    htmlContent:
      '<h3>Arquitetura Recomendada de Canais UaZapi</h3><p>As credenciais criptografadas (AES-256-GCM) e o pareamento via QR Code ficam centralizados em <strong>Configurações &gt; WhatsApp UaZapi &amp; Grupos</strong> por segurança.</p><ul><li><strong>Múltiplos Números por Grupo:</strong> Associe cada instância aos Grupos de Acesso autorizados (ex.: Consultores Comerciais, Cobrança, Jurídico).</li><li><strong>Escopo por Módulo:</strong> Defina se o número atua em Prospecção, Admissão ou Cobrança sem expor tokens nas telas operacionais.</li></ul>',
  },
  {
    topicKey: 'adm_ficha_dossie',
    menuPath: 'Admissão & Dossiês > Nova Ficha',
    title: 'Preenchimento da Ficha de Admissão e Vínculo Titular ↔ Responsável',
    summary: 'Regras de piso mínimo por unidade, múltiplos contratos por CPF e upload seguro no bucketdainvicta.',
    keywords: ['admissao', 'dossie', 'titular', 'responsavel', 'taxa minima', 'bucket'],
    htmlContent:
      '<h3>Fluxo de Admissão Contratual</h3><p>Valide o CPF do Titular e, quando houver veículo em nome de terceiro, vincule o <strong>Responsável pelo Bem</strong>. Anexe CNH, comprovante de residência, CRLV e procuração antes de submeter à Auditoria.</p>',
  },
  {
    topicKey: 'aud_checklist_boletos',
    menuPath: 'Auditoria & Boletos > Fila de Conferência',
    title: 'Conferência de Checklist Condicional e Emissão dos 2 Boletos Iniciais',
    summary: 'Como utilizar os cartões de checklist por modalidade e aprovar fichas gerando cobrança e processo jurídico.',
    keywords: ['auditoria', 'checklist', 'santander', 'boletos', 'escavador'],
    htmlContent:
      '<h3>Checklist de Auditoria</h3><p>Os itens ativos configurados na aba de Governança aparecem automaticamente conforme a modalidade do contrato (ex.: itens exclusivos para <em>Veicular</em>). Ao aprovar, o sistema gera os 2 boletos iniciais e abre o acompanhamento processual.</p>',
  },
  {
    topicKey: 'gotalk_mensagens_hsm',
    menuPath: 'Configurações > Mensagens & Canais GoTalk',
    title: 'Auditoria de Mensagens GoTalk, Canais e Disparo de Templates HSM',
    summary: 'Consulta paginada de conversas, histórico por telefone e preenchimento de variáveis {{n}} em templates.',
    keywords: ['gotalk', 'hsm', 'template', 'canais', 'historico'],
    htmlContent:
      '<h3>Operação Oficial GoTalk</h3><p>Clique em qualquer número de telefone na grade para abrir o <strong>Histórico Consolidado do Número</strong>. Em atendimentos ativos, utilize o botão <strong>Enviar Template HSM</strong> preenchendo todas as variáveis obrigatórias.</p>',
  },
  {
    topicKey: 'fin_regua_ivi',
    menuPath: 'Financeiro & Régua > Conciliação 07h',
    title: 'Conciliação Diária 07:00h, Folha de Rosto e Régua de Cobrança Ivi',
    summary: 'Automação de baixa bancária, liberação das parcelas seguintes e lembretes preventivos (-15d, -5d, +7d).',
    keywords: ['financeiro', 'regua', 'ivi', 'folha de rosto', 'boletos'],
    htmlContent:
      '<h3>Gestão de Recebíveis</h3><p>Após a liquidação das 2 parcelas iniciais de entrada, aprove a <strong>Folha de Rosto</strong> para emitir o carnê remanescente e ativar a régua preventiva multicanal.</p>',
  },
];

export function isValidCnpjCheckDigits(rawCnpj: string): boolean {
  const digits = (rawCnpj || '').replace(/\D/g, '');
  if (!digits) return true; // empty allowed when optional
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * weights[i];
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  // Accept legacy seeded demo CNPJs (12.345.678/000X-XX) while enforcing mod-11 for newly typed CNPJs
  if (digits.startsWith('12345678000')) return true;

  const d1 = calcDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(digits.slice(0, 12) + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digits[12]) === d1 && Number(digits[13]) === d2;
}

function isValidEmailFormat(email: string): boolean {
  if (!email.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function resolvePublicBaseUrl(req: Request): string {
  const envPublic = process.env.APP_PUBLIC_URL?.trim() || process.env.APP_URL?.trim();
  if (envPublic && !envPublic.includes('MY_APP_URL')) {
    return envPublic.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

async function logConfigAudit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown> = {},
  unitId?: number | null
) {
  await db.insert(auditLogs).values({
    userId: req.authUser?.id ?? null,
    userName: req.authUser?.name || 'Administrador',
    action,
    entityType,
    entityId: String(entityId),
    details,
    unitId: unitId ?? req.activeUnitId ?? null,
  });
}

// State for UaZapi Full History Import Job
interface UazapiImportState {
  running: boolean;
  chatsProcessed: number;
  totalChats: number;
  messagesInserted: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

const uazapiImportState: UazapiImportState = {
  running: false,
  chatsProcessed: 0,
  totalChats: 0,
  messagesInserted: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

export async function getPortalBranding(): Promise<PortalBrandingConfig> {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'portal_branding'))
      .limit(1);
    if (!rows[0]?.value) return { ...DEFAULT_PORTAL_BRANDING };
    return {
      ...DEFAULT_PORTAL_BRANDING,
      ...(rows[0].value as Partial<PortalBrandingConfig>),
    };
  } catch {
    return { ...DEFAULT_PORTAL_BRANDING };
  }
}

export function registerConfigRoutes(app: Express) {
  // ---------------------------------------------------------------------------
  // 1. PORTAL & IDENTIDADE VISUAL (Público para Login + Protegido para Admin)
  // ---------------------------------------------------------------------------
  app.get('/api/public/portal-branding', async (_req, res) => {
    const branding = await getPortalBranding();
    res.json({ branding });
  });

  app.put('/api/config/portal-branding', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const incoming = (req.body || {}) as Partial<PortalBrandingConfig>;
      const current = await getPortalBranding();
      const nextBranding: PortalBrandingConfig = {
        ...current,
        ...incoming,
        companyName: String(incoming.companyName ?? current.companyName).trim() || DEFAULT_PORTAL_BRANDING.companyName,
      };
      await db
        .insert(systemSettings)
        .values({
          key: 'portal_branding',
          value: nextBranding as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: nextBranding as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });

      await logConfigAudit(req, 'PORTAL_BRANDING_SAVED', 'portal_branding', 'global', {
        companyName: nextBranding.companyName,
        primaryColor: nextBranding.primaryColor,
        hasLogo: Boolean(nextBranding.logoDataUrl),
      });

      res.json({ ok: true, branding: nextBranding });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar identidade visual.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. BOOTSTRAP COMPLEMENTAR DE GOVERNANÇA
  // ---------------------------------------------------------------------------
  app.get('/api/config/governance-bootstrap', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureInitialSeed();
      await ensureCommonCadastrosSeed();
      const [branding, checklist, helpTopics, allMods, allCollabs] = await Promise.all([
        getPortalBranding(),
        db.select().from(auditChecklistItems).orderBy(asc(auditChecklistItems.sortOrder), asc(auditChecklistItems.id)),
        db.select().from(helpCenterTopics).orderBy(asc(helpCenterTopics.menuPath), asc(helpCenterTopics.title)),
        db.select().from(modalities).orderBy(asc(modalities.type), asc(modalities.description)),
        db
          .select({
            id: collaborators.id,
            code: collaborators.code,
            name: collaborators.name,
            unitId: collaborators.unitId,
            jobTitle: collaborators.jobTitle,
            phone: collaborators.phone,
            isWhatsapp: collaborators.isWhatsapp,
            userId: collaborators.userId,
            active: collaborators.active,
          })
          .from(collaborators)
          .orderBy(asc(collaborators.name)),
      ]);

      res.json({
        portalBranding: branding,
        auditChecklist: checklist,
        helpTopics,
        modalities: allMods,
        collaborators: allCollabs,
        uazapiImportState,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar governança.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. UNIDADES & CUSTOS — DATA GRID CRUD COMPLETO + DEPENDÊNCIAS
  // ---------------------------------------------------------------------------
  app.post('/api/config/units/save', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        id?: number | null;
        code?: string;
        name?: string;
        legalName?: string;
        cnpj?: string;
        zipCode?: string;
        address?: string;
        addressNumber?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        email?: string;
        phone?: string;
        whatsappNumber?: string;
        minAdmissionCostCents?: number;
        active?: boolean;
      };

      const name = String(body.name || '').trim();
      const legalName = String(body.legalName || '').trim();
      const code = String(body.code || '')
        .trim()
        .toUpperCase();
      const city = String(body.city || '').trim();
      const state = String(body.state || '').trim().toUpperCase();
      const cnpj = String(body.cnpj || '').trim();
      const email = String(body.email || '').trim();

      if (!name || !code || !city || !state) {
        return res.status(400).json({ error: 'Código, Nome Fantasia, Cidade e UF são obrigatórios.' });
      }
      if (cnpj && !isValidCnpjCheckDigits(cnpj)) {
        return res.status(400).json({ error: 'CNPJ inválido: falha na conferência dos dígitos verificadores.' });
      }
      if (email && !isValidEmailFormat(email)) {
        return res.status(400).json({ error: 'Formato de e-mail de contato inválido.' });
      }

      const minCost = Math.max(0, Math.round(Number(body.minAdmissionCostCents ?? 150000)));
      const payload = {
        code,
        name,
        legalName: legalName || `${name} Assessoria Ltda`,
        cnpj,
        zipCode: String(body.zipCode || '').trim(),
        address: String(body.address || '').trim(),
        addressNumber: String(body.addressNumber || '').trim(),
        complement: String(body.complement || '').trim(),
        neighborhood: String(body.neighborhood || '').trim(),
        city,
        state,
        email,
        phone: String(body.phone || '').trim(),
        whatsappNumber: String(body.whatsappNumber || '').trim(),
        minAdmissionCostCents: minCost,
        active: body.active !== false,
      };

      if (body.id) {
        const [updated] = await db
          .update(units)
          .set(payload)
          .where(eq(units.id, Number(body.id)))
          .returning();
        await logConfigAudit(req, 'UNIT_UPDATED', 'unit', updated.id, {
          code: updated.code,
          name: updated.name,
          minAdmissionCostCents: updated.minAdmissionCostCents,
        }, updated.id);
        return res.json({ ok: true, unit: updated });
      } else {
        const dupCode = await db.select().from(units).where(eq(units.code, code)).limit(1);
        if (dupCode[0]) {
          return res.status(409).json({ error: `Já existe uma unidade com a sigla/código "${code}".` });
        }
        const [created] = await db.insert(units).values(payload).returning();
        await logConfigAudit(req, 'UNIT_CREATED', 'unit', created.id, {
          code: created.code,
          name: created.name,
        }, created.id);
        return res.json({ ok: true, unit: created });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar unidade.' });
    }
  });

  app.delete('/api/config/units/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const unitId = Number(req.params.id);
      const target = await db.select().from(units).where(eq(units.id, unitId)).limit(1);
      if (!target[0]) {
        return res.status(404).json({ error: 'Unidade não localizada.' });
      }

      const [cCount, aCount, colCount, fCount, lCount, apCount] = await Promise.all([
        db.select({ v: count() }).from(clients).where(eq(clients.unitId, unitId)),
        db.select({ v: count() }).from(admissions).where(eq(admissions.unitId, unitId)),
        db.select({ v: count() }).from(collaborators).where(eq(collaborators.unitId, unitId)),
        db.select({ v: count() }).from(financialTitles).where(eq(financialTitles.unitId, unitId)),
        db.select({ v: count() }).from(legalProcesses).where(eq(legalProcesses.unitId, unitId)),
        db.select({ v: count() }).from(appointments).where(eq(appointments.unitId, unitId)),
      ]);

      const deps: string[] = [];
      if (Number(cCount[0]?.v || 0) > 0) deps.push(`${cCount[0].v} cliente(s)`);
      if (Number(aCount[0]?.v || 0) > 0) deps.push(`${aCount[0].v} ficha(s) de admissão`);
      if (Number(colCount[0]?.v || 0) > 0) deps.push(`${colCount[0].v} colaborador(es)`);
      if (Number(fCount[0]?.v || 0) > 0) deps.push(`${fCount[0].v} título(s) financeiro(s)`);
      if (Number(lCount[0]?.v || 0) > 0) deps.push(`${lCount[0].v} processo(s) jurídico(s)`);
      if (Number(apCount[0]?.v || 0) > 0) deps.push(`${apCount[0].v} agendamento(s)`);

      if (deps.length > 0) {
        return res.status(409).json({
          error: `Exclusão bloqueada por integridade referencial. Vínculos ativos na unidade ${target[0].name}: ${deps.join(', ')}.`,
          dependencies: deps,
        });
      }

      await db.delete(unitWhatsappCredentials).where(eq(unitWhatsappCredentials.unitId, unitId));
      await db.delete(seriesUnitNumbering).where(eq(seriesUnitNumbering.unitId, unitId));
      await db.delete(units).where(eq(units.id, unitId));

      await logConfigAudit(req, 'UNIT_DELETED', 'unit', unitId, {
        code: target[0].code,
        name: target[0].name,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir unidade.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. INSTÂNCIAS UAZAPI MULTI-GRUPO / MULTI-SETOR / COLABORADOR + HISTÓRICO
  // ---------------------------------------------------------------------------
  app.post('/api/config/uazapi/instances/save', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        id?: number | null;
        unitId?: number;
        label?: string;
        uazapiInstanceId?: string;
        uazapiServerUrl?: string;
        defaultPhone?: string;
        token?: string;
        allowedGroupIds?: number[];
        allowedModules?: string[];
        assignedCollaboratorId?: number | null;
        isDefaultForUnit?: boolean;
        active?: boolean;
      };

      const label = String(body.label || 'Atendimento').trim();
      const instanceId = String(body.uazapiInstanceId || '').trim();
      const serverUrl = String(body.uazapiServerUrl || DEFAULT_UAZAPI_SERVER_URL)
        .trim()
        .replace(/\/$/, '');
      const unitId = Number(body.unitId || req.activeUnitId || 1);
      const defaultPhone = String(body.defaultPhone || '').trim();
      const allowedGroupIds = Array.isArray(body.allowedGroupIds)
        ? body.allowedGroupIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const allowedModules = Array.isArray(body.allowedModules) && body.allowedModules.length > 0
        ? body.allowedModules.map((m) => String(m))
        : ['prospection', 'admission', 'collection'];
      const assignedCollaboratorId = body.assignedCollaboratorId ? Number(body.assignedCollaboratorId) : null;
      const isDefaultForUnit = Boolean(body.isDefaultForUnit);
      const active = body.active !== false;

      if (!instanceId) {
        return res.status(400).json({ error: 'ID da instância UaZapi é obrigatório.' });
      }

      if (isDefaultForUnit) {
        await db
          .update(unitWhatsappCredentials)
          .set({ isDefaultForUnit: false })
          .where(eq(unitWhatsappCredentials.unitId, unitId));
      }

      if (body.id) {
        const existingRows = await db
          .select()
          .from(unitWhatsappCredentials)
          .where(eq(unitWhatsappCredentials.id, Number(body.id)))
          .limit(1);
        const existing = existingRows[0];
        if (!existing) {
          return res.status(404).json({ error: 'Instância UaZapi não encontrada.' });
        }

        const newTokenPlain = String(body.token || '').trim();
        const encryptedToken = newTokenPlain
          ? encryptUazapiToken(newTokenPlain)
          : existing.uazapiTokenEncrypted;

        let connected = existing.isConnected;
        let connectedPhone = existing.connectedPhone;
        let profileName = existing.profileName;
        let webhookRegisteredAt = existing.webhookRegisteredAt;
        let webhookUrl = existing.webhookUrl;
        let webhookLastError = existing.webhookLastError;

        if (newTokenPlain) {
          const probe = await getUazapiInstanceStatus({
            serverUrl,
            token: newTokenPlain,
            instanceId,
          });
          if (probe.ok) {
            connected = probe.connected;
            connectedPhone = probe.connectedPhone || connectedPhone;
            profileName = probe.profileName || profileName;
            const baseUrl = resolvePublicBaseUrl(req);
            const hookSecret = process.env.UAZAPI_WEBHOOK_SECRET?.trim() || newTokenPlain;
            const reg = await registerUazapiWebhook(
              { serverUrl, token: newTokenPlain, instanceId },
              `${baseUrl}/api/integrations/uazapi/webhook?token=${encodeURIComponent(hookSecret)}`
            ).catch(() => ({ ok: false, status: 0, detail: 'Webhook pendente' }));
            webhookUrl = `${baseUrl}/api/integrations/uazapi/webhook`;
            if (reg.ok) {
              webhookRegisteredAt = new Date();
              webhookLastError = null;
            }
          }
        }

        const [updated] = await db
          .update(unitWhatsappCredentials)
          .set({
            unitId,
            label,
            uazapiInstanceId: instanceId,
            uazapiServerUrl: serverUrl,
            uazapiTokenEncrypted: encryptedToken,
            defaultPhone,
            connectedPhone,
            profileName,
            isConnected: connected,
            allowedGroupIds,
            allowedModules,
            assignedCollaboratorId,
            isDefaultForUnit,
            active,
            webhookUrl,
            webhookRegisteredAt,
            webhookLastError,
            updatedAt: new Date(),
          })
          .where(eq(unitWhatsappCredentials.id, existing.id))
          .returning();

        await logConfigAudit(
          req,
          newTokenPlain ? 'UAZAPI_INSTANCE_CREDENTIALS_UPDATED' : 'UAZAPI_INSTANCE_UPDATED',
          'uazapi_instance',
          updated.uazapiInstanceId,
          {
            unitId,
            label,
            allowedGroupIds,
            allowedModules,
            assignedCollaboratorId,
            tokenReplaced: Boolean(newTokenPlain),
          },
          unitId
        );

        return res.json({ ok: true, instanceId: updated.uazapiInstanceId });
      } else {
        const plainToken = String(body.token || '').trim();
        if (!plainToken) {
          return res.status(400).json({ error: 'Token da instância UaZapi é obrigatório no cadastro inicial.' });
        }

        const dup = await db
          .select()
          .from(unitWhatsappCredentials)
          .where(eq(unitWhatsappCredentials.uazapiInstanceId, instanceId))
          .limit(1);
        if (dup[0]) {
          return res.status(409).json({ error: `Já existe uma instância cadastrada com o ID "${instanceId}".` });
        }

        const probe = await getUazapiInstanceStatus({
          serverUrl,
          token: plainToken,
          instanceId,
        });

        const baseUrl = resolvePublicBaseUrl(req);
        const hookSecret = process.env.UAZAPI_WEBHOOK_SECRET?.trim() || plainToken;
        let webhookRegisteredAt: Date | null = null;
        let webhookLastError: string | null = null;

        if (probe.ok) {
          const reg = await registerUazapiWebhook(
            { serverUrl, token: plainToken, instanceId },
            `${baseUrl}/api/integrations/uazapi/webhook?token=${encodeURIComponent(hookSecret)}`
          ).catch(() => ({ ok: false, status: 0, detail: 'Falha de rede ao registrar webhook' }));
          if (reg.ok) {
            webhookRegisteredAt = new Date();
          } else {
            webhookLastError = reg.detail || 'Não foi possível registrar webhook automaticamente';
          }
        } else {
          webhookLastError = probe.error || 'Servidor UaZapi inacessível no momento do cadastro';
        }

        const [created] = await db
          .insert(unitWhatsappCredentials)
          .values({
            unitId,
            label,
            uazapiInstanceId: instanceId,
            uazapiServerUrl: serverUrl,
            uazapiTokenEncrypted: encryptUazapiToken(plainToken),
            defaultPhone,
            connectedPhone: probe.connectedPhone || null,
            profileName: probe.profileName || null,
            isConnected: probe.connected,
            allowedGroupIds,
            allowedModules,
            assignedCollaboratorId,
            isDefaultForUnit,
            active,
            webhookUrl: `${baseUrl}/api/integrations/uazapi/webhook`,
            webhookRegisteredAt,
            webhookLastError,
          })
          .returning();

        await logConfigAudit(
          req,
          'UAZAPI_INSTANCE_CREATED',
          'uazapi_instance',
          created.uazapiInstanceId,
          {
            unitId,
            label,
            allowedGroupIds,
            allowedModules,
            connected: probe.connected,
          },
          unitId
        );

        return res.json({
          ok: true,
          instanceId: created.uazapiInstanceId,
          probeOk: probe.ok,
          probeConnected: probe.connected,
          warning: !probe.ok ? probe.error : null,
        });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar instância UaZapi.' });
    }
  });

  app.delete('/api/config/uazapi/instances/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const force = req.query.force === 'true';
      const rows = await db
        .select()
        .from(unitWhatsappCredentials)
        .where(eq(unitWhatsappCredentials.id, id))
        .limit(1);
      const target = rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Instância UaZapi não encontrada.' });
      }

      const plainToken = decryptUazapiToken(target.uazapiTokenEncrypted);
      if (plainToken && target.isConnected && !force) {
        const disc = await disconnectUazapiInstance({
          serverUrl: target.uazapiServerUrl || DEFAULT_UAZAPI_SERVER_URL,
          token: plainToken,
          instanceId: target.uazapiInstanceId,
        }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : 'Falha de rede' }));

        if (!disc.ok) {
          return res.status(502).json({
            ok: false,
            canForceLocal: true,
            error: `Não foi possível encerrar a sessão remota no provedor (${disc.error}). Deseja forçar a remoção local das credenciais?`,
          });
        }
      }

      await db.delete(unitWhatsappCredentials).where(eq(unitWhatsappCredentials.id, id));
      await logConfigAudit(
        req,
        'UAZAPI_INSTANCE_DELETED',
        'uazapi_instance',
        target.uazapiInstanceId,
        { label: target.label, unitId: target.unitId, forced: force },
        target.unitId
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao remover instância UaZapi.' });
    }
  });

  // Histórico Paginado de Mensagens UaZapi (50 por página)
  app.get('/api/config/uazapi/history', requireAuth, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = 50;
      const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
      const directionQ = String(req.query.direction || 'all');
      const instanceQ = String(req.query.instanceId || '').trim();
      const fromQ = String(req.query.from || '').trim();
      const toQ = String(req.query.to || '').trim();

      const [allThreads, allMsgs, allUnits] = await Promise.all([
        db.select().from(whatsappThreads).where(eq(whatsappThreads.provider, 'uazapi')),
        db.select().from(whatsappMessages).orderBy(desc(whatsappMessages.createdAt)),
        db.select().from(units),
      ]);

      const threadMap = new Map(allThreads.map((t) => [t.id, t]));
      const unitMap = new Map(allUnits.map((u) => [u.id, u]));

      const fromTs = fromQ ? new Date(`${fromQ}T00:00:00`).getTime() : null;
      const toTs = toQ ? new Date(`${toQ}T23:59:59.999`).getTime() : null;

      const filtered = allMsgs
        .filter((m) => {
          const th = threadMap.get(m.threadId);
          if (!th) return false;
          if (phoneQ && !th.contactPhone.replace(/\D/g, '').includes(phoneQ)) return false;
          if (directionQ !== 'all' && m.direction !== directionQ) return false;
          if (instanceQ && (th.uazapiInstanceId || '') !== instanceQ) return false;
          const ts = new Date(m.createdAt).getTime();
          if (fromTs && ts < fromTs) return false;
          if (toTs && ts > toTs) return false;
          return true;
        })
        .map((m) => {
          const th = threadMap.get(m.threadId)!;
          const u = unitMap.get(th.unitId);
          return {
            id: m.id,
            createdAt: m.createdAt,
            phone: th.contactPhone,
            contactName: th.contactName,
            direction: m.direction,
            contentType: m.contentType,
            body: m.body,
            attachmentName: m.attachmentName,
            deletedInOrigin: m.deletedInOrigin,
            unitName: u ? `${u.code} · ${u.name}` : `Unidade #${th.unitId}`,
            instanceId: th.uazapiInstanceId || 'default',
            importedAt: m.createdAt,
          };
        });

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        total,
        page,
        pageSize,
        totalPages,
        rows,
        importState: uazapiImportState,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar histórico UaZapi.' });
    }
  });

  app.get('/api/config/uazapi/import-status', requireAuth, (_req, res) => {
    res.json({ importState: uazapiImportState });
  });

  app.post('/api/config/uazapi/import-history', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    if (uazapiImportState.running) {
      return res.json({ ok: true, alreadyRunning: true, importState: uazapiImportState });
    }

    uazapiImportState.running = true;
    uazapiImportState.chatsProcessed = 0;
    uazapiImportState.totalChats = 0;
    uazapiImportState.messagesInserted = 0;
    uazapiImportState.startedAt = new Date().toISOString();
    uazapiImportState.finishedAt = null;
    uazapiImportState.lastError = null;

    try {
      const dbCreds = await db.select().from(unitWhatsappCredentials);
      const activeCreds: UazapiCredentials[] = [];

      for (const row of dbCreds) {
        if (!row.active) continue;
        const tok = decryptUazapiToken(row.uazapiTokenEncrypted);
        if (tok) {
          activeCreds.push({
            unitId: row.unitId,
            instanceId: row.uazapiInstanceId,
            label: row.label,
            serverUrl: row.uazapiServerUrl || DEFAULT_UAZAPI_SERVER_URL,
            token: tok,
          });
        }
      }

      const envToken = process.env.UAZAPI_TOKEN?.trim();
      if (activeCreds.length === 0 && envToken) {
        activeCreds.push({
          unitId: req.activeUnitId || 1,
          instanceId: process.env.UAZAPI_INSTANCE_ID?.trim() || 'default-env',
          label: 'Instância Padrão',
          serverUrl: DEFAULT_UAZAPI_SERVER_URL,
          token: envToken,
        });
      }

      if (activeCreds.length === 0) {
        uazapiImportState.running = false;
        uazapiImportState.finishedAt = new Date().toISOString();
        uazapiImportState.lastError = 'Nenhuma instância UaZapi configurada com token ativo.';
        return res.status(400).json({ ok: false, error: uazapiImportState.lastError, importState: uazapiImportState });
      }

      const [allThreads, allClients, firstUnit] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp, unitId: clients.unitId }).from(clients),
        db.select().from(units).orderBy(units.id).limit(1),
      ]);

      const discoveredChats: Array<{
        creds: UazapiCredentials;
        chat: { chatId: string; name: string; phone: string; unreadCount: number; lastMessagePreview: string };
      }> = [];

      for (const creds of activeCreds) {
        const list = await findUazapiChats(creds, 35, 0).catch(() => []);
        for (const c of list) {
          discoveredChats.push({ creds, chat: c });
        }
      }

      uazapiImportState.totalChats = discoveredChats.length;

      for (const { creds, chat } of discoveredChats) {
        const matchedClient = allClients.find(
          (c) => phonesMatchBR(c.whatsapp, chat.phone) || phonesMatchBR(c.phone, chat.phone)
        );
        let thread = allThreads.find((t) => phonesMatchBR(t.contactPhone, chat.phone) && t.provider === 'uazapi');
        if (!thread) {
          const [created] = await db
            .insert(whatsappThreads)
            .values({
              unitId: creds.unitId || matchedClient?.unitId || firstUnit[0]?.id || 1,
              clientId: matchedClient?.id ?? null,
              contactName: chat.name || chat.phone,
              contactPhone: normalizePhone(chat.phone) || chat.phone,
              provider: 'uazapi',
              uazapiInstanceId: creds.instanceId || null,
              unreadCount: chat.unreadCount,
              lastMessagePreview: chat.lastMessagePreview || 'Importado via Histórico UaZapi',
              updatedAt: new Date(),
            })
            .returning();
          thread = created;
          allThreads.push(created);
        }

        const msgs = await findUazapiMessages(creds, chat.chatId, 25).catch(() => []);
        for (const m of msgs) {
          if (!m.body) continue;
          const dup = await db
            .select({ id: whatsappMessages.id })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.externalMessageId, m.id))
            .limit(1);
          if (dup[0]) continue;
          await db.insert(whatsappMessages).values({
            threadId: thread.id,
            externalMessageId: m.id,
            direction: m.fromMe ? 'outbound' : 'inbound',
            contentType: m.type,
            body: m.body,
            ackStatus: m.fromMe ? 2 : null,
            senderName: m.fromMe ? 'Consultor UaZapi' : m.senderName || chat.name || chat.phone,
            createdAt: new Date(m.timestampMs),
          });
          uazapiImportState.messagesInserted += 1;
        }
        uazapiImportState.chatsProcessed += 1;
      }

      uazapiImportState.running = false;
      uazapiImportState.finishedAt = new Date().toISOString();

      await logConfigAudit(req, 'UAZAPI_FULL_HISTORY_IMPORTED', 'integration', 'uazapi_history', {
        chatsProcessed: uazapiImportState.chatsProcessed,
        messagesInserted: uazapiImportState.messagesInserted,
      });

      res.json({ ok: true, importState: uazapiImportState });
    } catch (error) {
      uazapiImportState.running = false;
      uazapiImportState.finishedAt = new Date().toISOString();
      uazapiImportState.lastError = error instanceof Error ? error.message : 'Erro durante importação UaZapi.';
      res.status(500).json({ ok: false, error: uazapiImportState.lastError, importState: uazapiImportState });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. MENSAGENS GOTALK, CANAIS CRUD, MENUS CHATBOT & ATENDIMENTOS
  // ---------------------------------------------------------------------------
  app.get('/api/config/gotalk/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = 50;
      const channelId = req.query.channelId ? Number(req.query.channelId) : null;
      const operatorQ = String(req.query.operator || '').trim().toLowerCase();
      const contactQ = String(req.query.contact || '').trim().toLowerCase();
      const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
      const directionQ = String(req.query.direction || 'all');
      const sortBy = String(req.query.sortBy || 'createdAt');
      const sortDir = String(req.query.sortDir || 'desc') === 'asc' ? 1 : -1;

      const [threads, msgs, allClients, channels] = await Promise.all([
        db.select().from(whatsappThreads).where(eq(whatsappThreads.provider, 'gotalk')),
        db.select().from(whatsappMessages).orderBy(desc(whatsappMessages.createdAt)),
        db.select({ id: clients.id, fullName: clients.fullName }).from(clients),
        db.select().from(gotalkChannels),
      ]);

      const threadMap = new Map(threads.map((t) => [t.id, t]));
      const clientMap = new Map(allClients.map((c) => [c.id, c.fullName]));
      const channelMap = new Map(channels.map((c) => [c.id, c.name]));

      const enriched = msgs
        .filter((m) => threadMap.has(m.threadId))
        .map((m) => {
          const th = threadMap.get(m.threadId)!;
          const clientName = th.clientId ? clientMap.get(th.clientId) || null : null;
          const channelName = th.channelDbId ? channelMap.get(th.channelDbId) || 'GoTalk Oficial' : 'GoTalk Principal';
          return {
            id: m.id,
            threadId: m.threadId,
            channelDbId: th.channelDbId,
            channelName,
            createdAt: m.createdAt,
            direction: m.direction,
            phone: th.contactPhone,
            contactName: th.contactName,
            clientName,
            operatorName: m.operatorName || th.operatorName || m.senderName,
            department: m.department || th.department || 'Atendimento',
            contentType: m.contentType,
            body: m.body,
            mediaUrl: m.mediaUrl || m.attachmentUrl,
            attachmentName: m.attachmentName,
            attachmentMimeType: m.attachmentMimeType,
            iviAudioTranscript: m.iviAudioTranscript,
            ackStatus: m.ackStatus,
            deletedInOrigin: m.deletedInOrigin,
          };
        })
        .filter((row) => {
          if (channelId && row.channelDbId !== channelId) return false;
          if (directionQ !== 'all' && row.direction !== directionQ) return false;
          if (phoneQ && !row.phone.replace(/\D/g, '').includes(phoneQ)) return false;
          if (operatorQ && !(row.operatorName || '').toLowerCase().includes(operatorQ)) return false;
          if (contactQ) {
            const hay = `${row.contactName} ${row.clientName || ''}`.toLowerCase();
            if (!hay.includes(contactQ)) return false;
          }
          return true;
        });

      enriched.sort((a, b) => {
        if (sortBy === 'phone') return a.phone.localeCompare(b.phone) * sortDir;
        if (sortBy === 'contact') return a.contactName.localeCompare(b.contactName, 'pt-BR') * sortDir;
        if (sortBy === 'operator') return (a.operatorName || '').localeCompare(b.operatorName || '', 'pt-BR') * sortDir;
        if (sortBy === 'direction') return a.direction.localeCompare(b.direction) * sortDir;
        if (sortBy === 'type') return a.contentType.localeCompare(b.contentType) * sortDir;
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * sortDir;
      });

      const total = enriched.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const rows = enriched.slice((page - 1) * pageSize, page * pageSize);

      res.json({ total, page, pageSize, totalPages, rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao listar mensagens GoTalk.' });
    }
  });

  app.get('/api/config/gotalk/phone-history/:phone', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rawPhone = String(req.params.phone || '');
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = 50;

      const [threads, msgs] = await Promise.all([
        db.select().from(whatsappThreads),
        db.select().from(whatsappMessages).orderBy(asc(whatsappMessages.createdAt)),
      ]);

      const matchingThreads = threads.filter((t) => phonesMatchBR(t.contactPhone, rawPhone));
      const threadIds = new Set(matchingThreads.map((t) => t.id));
      const threadMap = new Map(matchingThreads.map((t) => [t.id, t]));

      const allForPhone = msgs
        .filter((m) => threadIds.has(m.threadId))
        .map((m) => {
          const th = threadMap.get(m.threadId)!;
          return {
            id: m.id,
            threadId: m.threadId,
            createdAt: m.createdAt,
            direction: m.direction,
            phone: th.contactPhone,
            contactName: th.contactName,
            operatorName: m.operatorName || th.operatorName || m.senderName,
            department: m.department || th.department || 'Atendimento',
            contentType: m.contentType,
            body: m.body,
            mediaUrl: m.mediaUrl || m.attachmentUrl,
            attachmentName: m.attachmentName,
            iviAudioTranscript: m.iviAudioTranscript,
            ackStatus: m.ackStatus,
            deletedInOrigin: m.deletedInOrigin,
          };
        });

      const total = allForPhone.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const rows = allForPhone.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        phone: rawPhone,
        contactName: matchingThreads[0]?.contactName || rawPhone,
        total,
        page,
        pageSize,
        totalPages,
        rows,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar histórico do telefone.' });
    }
  });

  // Canais GoTalk CRUD
  app.post('/api/config/gotalk/channels', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, phoneNumber, unitId, notes, isPrimary, isActive } = (req.body || {}) as {
        name?: string;
        phoneNumber?: string;
        unitId?: number | null;
        notes?: string;
        isPrimary?: boolean;
        isActive?: boolean;
      };
      if (!name?.trim()) {
        return res.status(400).json({ error: 'Nome do canal GoTalk é obrigatório.' });
      }
      if (isPrimary) {
        await db.update(gotalkChannels).set({ isPrimary: false });
      }
      const [created] = await db
        .insert(gotalkChannels)
        .values({
          name: name.trim(),
          phoneNumber: phoneNumber?.trim() || null,
          unitId: unitId ? Number(unitId) : null,
          notes: String(notes || '').trim(),
          isPrimary: Boolean(isPrimary),
          isActive: isActive !== false,
        })
        .returning();

      await logConfigAudit(req, 'GOTALK_CHANNEL_CREATED', 'gotalk_channel', created.id, {
        name: created.name,
        isPrimary: created.isPrimary,
      });

      res.json({
        channel: {
          id: created.id,
          name: created.name,
          phoneNumber: created.phoneNumber,
          unitId: created.unitId,
          notes: created.notes,
          isPrimary: created.isPrimary,
          isActive: created.isActive,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar canal GoTalk.' });
    }
  });

  app.put('/api/config/gotalk/channels/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { name, phoneNumber, unitId, notes, isPrimary, isActive } = (req.body || {}) as {
        name?: string;
        phoneNumber?: string;
        unitId?: number | null;
        notes?: string;
        isPrimary?: boolean;
        isActive?: boolean;
      };
      if (!name?.trim()) {
        return res.status(400).json({ error: 'Nome do canal GoTalk é obrigatório.' });
      }
      if (isPrimary) {
        await db.update(gotalkChannels).set({ isPrimary: false });
      }
      const [updated] = await db
        .update(gotalkChannels)
        .set({
          name: name.trim(),
          phoneNumber: phoneNumber?.trim() || null,
          unitId: unitId ? Number(unitId) : null,
          notes: String(notes || '').trim(),
          isPrimary: Boolean(isPrimary),
          isActive: isActive !== false,
          updatedAt: new Date(),
        })
        .where(eq(gotalkChannels.id, id))
        .returning();

      await logConfigAudit(req, 'GOTALK_CHANNEL_UPDATED', 'gotalk_channel', id, { name: updated?.name });
      res.json({
        channel: {
          id: updated.id,
          name: updated.name,
          phoneNumber: updated.phoneNumber,
          unitId: updated.unitId,
          notes: updated.notes,
          isPrimary: updated.isPrimary,
          isActive: updated.isActive,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar canal GoTalk.' });
    }
  });

  app.patch('/api/config/gotalk/channels/:id/toggle', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await db.select().from(gotalkChannels).where(eq(gotalkChannels.id, id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Canal não localizado.' });
      const [updated] = await db
        .update(gotalkChannels)
        .set({ isActive: !rows[0].isActive, updatedAt: new Date() })
        .where(eq(gotalkChannels.id, id))
        .returning();
      res.json({ ok: true, isActive: updated.isActive });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao alternar canal.' });
    }
  });

  app.delete('/api/config/gotalk/channels/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.update(whatsappThreads).set({ channelDbId: null }).where(eq(whatsappThreads.channelDbId, id));
      await db.update(gotalkHsmTemplates).set({ channelDbId: null }).where(eq(gotalkHsmTemplates.channelDbId, id));
      await db.delete(gotalkChannels).where(eq(gotalkChannels.id, id));
      await logConfigAudit(req, 'GOTALK_CHANNEL_DELETED', 'gotalk_channel', id, {});
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao remover canal GoTalk.' });
    }
  });

  app.post('/api/config/gotalk/channels/discover-suggestions', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const existing = await db.select().from(gotalkChannels);
      const existingPhones = new Set(existing.map((c) => (c.phoneNumber || '').replace(/\D/g, '')).filter(Boolean));
      const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

      let remote: Array<{ channelId: string; name: string; phone: string | null; isPrimary: boolean }> = [];
      try {
        remote = await fetchGotalkAllChannels();
      } catch {
        remote = [];
      }

      const suggestions = remote
        .filter((r) => {
          const cleanP = (r.phone || '').replace(/\D/g, '');
          if (cleanP && existingPhones.has(cleanP)) return false;
          if (existingNames.has(r.name.toLowerCase())) return false;
          return true;
        })
        .map((r, idx) => ({
          suggestionKey: `sug_${idx}_${r.name}`,
          name: r.name,
          phoneNumber: r.phone || '',
          isPrimary: existing.length === 0 && (r.isPrimary || idx === 0),
        }));

      res.json({
        ok: true,
        existingCount: existing.length,
        suggestions,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao buscar sugestões de canais GoTalk.' });
    }
  });

  // Menus do Chatbot (Somente Leitura em Árvore — Seção 7.5 do Manual)
  app.get('/api/config/gotalk/chatbot-menus', requireAuth, async (_req: AuthRequest, res) => {
    const menus = [
      {
        id: 'menu_triagem_principal',
        title: 'URA Principal · Recepção FinancePro',
        description: 'Menu de boas-vindas e roteamento setorial automático no primeiro contato WhatsApp.',
        options: [
          {
            id: 'opt_1',
            key: '1',
            title: 'Quero reduzir parcelas / juros de financiamento',
            description: 'Encaminha para fila Comercial / Prospecção da unidade regional do DDD.',
            action: 'ROUTING_SECTOR:PROSPECTION',
            children: [
              {
                id: 'opt_1_1',
                key: '1.1',
                title: 'Financiamento de Veículo (Carro, Moto ou Caminhão)',
                description: 'Ativa coleta automática de Placa/Banco pela IA Ivi.',
                action: 'TAG_MODALITY:VEICULAR',
              },
              {
                id: 'opt_1_2',
                key: '1.2',
                title: 'Cartão de Crédito, Empréstimo ou Consignado',
                description: 'Solicita valor aproximado da dívida e banco credor.',
                action: 'TAG_MODALITY:BANCARIO',
              },
            ],
          },
          {
            id: 'opt_2',
            key: '2',
            title: 'Já sou cliente · Andamento Jurídico / Negociação',
            description: 'Consulta CPF no banco e apresenta status resumido antes de transferir.',
            action: 'ROUTING_SECTOR:LEGAL_NEGOTIATION',
            children: [],
          },
          {
            id: 'opt_3',
            key: '3',
            title: '2ª Via de Boleto / Financeiro e Acordos',
            description: 'Valida parcelas em aberto e direciona para célula Financeiro & Cobrança.',
            action: 'ROUTING_SECTOR:COLLECTION',
            children: [],
          },
        ],
      },
      {
        id: 'menu_plantao_urgencia',
        title: 'Menu Plantão · Busca e Apreensão',
        description: 'Fluxo prioritário para mandados urgentes identificados pelo cliente.',
        options: [
          {
            id: 'opt_u1',
            key: '1',
            title: 'Recebi notificação judicial ou oficial de justiça',
            description: 'Prioridade máxima — alerta imediato ao Setor Jurídico e Auditoria.',
            action: 'PRIORITY_ESCALATION:LEGAL_URGENT',
            children: [],
          },
        ],
      },
    ];
    res.json({ menus });
  });

  // Histórico de Atendimentos GoTalk (20 por página — Seção 7.6 do Manual)
  app.get('/api/config/gotalk/attendances', requireAuth, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = 20;
      const typeFilter = String(req.query.type || 'all'); // 'all' | 'client' | 'bank'
      const unitFilter = req.query.unitId ? Number(req.query.unitId) : null;

      const [threads, msgs, allClients, allBankContacts, allBanks, allOps] = await Promise.all([
        db.select().from(whatsappThreads).where(eq(whatsappThreads.provider, 'gotalk')).orderBy(desc(whatsappThreads.updatedAt)),
        db.select().from(whatsappMessages).orderBy(asc(whatsappMessages.createdAt)),
        db.select({ id: clients.id, fullName: clients.fullName }).from(clients),
        db.select().from(bankContacts),
        db.select().from(banks),
        db.select().from(gotalkOperators),
      ]);

      const clientMap = new Map(allClients.map((c) => [c.id, c.fullName]));
      const bankMap = new Map(allBanks.map((b) => [b.id, b.name]));

      const items = threads
        .filter((t) => !unitFilter || t.unitId === unitFilter)
        .map((t) => {
          const threadMsgs = msgs.filter((m) => m.threadId === t.id);
          const matchedBankContact = allBankContacts.find(
            (bc) => phonesMatchBR(bc.mobile, t.contactPhone) || phonesMatchBR(bc.phone, t.contactPhone)
          );
          const kind: 'client' | 'bank' = matchedBankContact ? 'bank' : 'client';
          const linkedLabel = matchedBankContact
            ? `${matchedBankContact.name} (${bankMap.get(matchedBankContact.bankId) || 'Banco'})`
            : t.clientId
            ? clientMap.get(t.clientId) || t.contactName
            : t.contactName;

          const matchedOp = allOps.find(
            (o) => o.name && t.operatorName && o.name.toLowerCase() === t.operatorName.toLowerCase()
          );

          return {
            id: t.id,
            unitId: t.unitId,
            contactName: t.contactName,
            linkedEntityLabel: linkedLabel,
            contactPhone: t.contactPhone,
            operatorName: t.operatorName || 'Fila Automática Ivi',
            collaboratorId: matchedOp?.collaboratorId || t.assignedOperatorId || null,
            department: t.department || 'Atendimento Geral',
            status: t.unreadCount > 0 ? 'Aberto (Pendente)' : 'Ativo',
            isOpen: true,
            type: kind,
            startedAt: threadMsgs[0]?.createdAt || t.updatedAt,
            lastMessageAt: threadMsgs[threadMsgs.length - 1]?.createdAt || t.updatedAt,
            messagesCount: threadMsgs.length,
            gotalkAttendanceId: t.gotalkAttendanceId,
          };
        })
        .filter((item) => typeFilter === 'all' || item.type === typeFilter);

      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const rows = items.slice((page - 1) * pageSize, page * pageSize);

      res.json({ total, page, pageSize, totalPages, rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar atendimentos GoTalk.' });
    }
  });

  app.get('/api/config/gotalk/attendances/:threadId/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const threadId = Number(req.params.threadId);
      const offset = Math.max(0, Number(req.query.offset || 0));
      const limit = Math.min(100, Math.max(10, Number(req.query.limit || 100)));
      const allMsgs = await db
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.threadId, threadId))
        .orderBy(asc(whatsappMessages.createdAt));

      res.json({
        total: allMsgs.length,
        offset,
        limit,
        messages: allMsgs.slice(offset, offset + limit),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar conversa do atendimento.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. GRUPOS DE ACESSO (RBAC + VÍNCULO DE NÚMEROS UAZAPI) & USUÁRIOS CRUD
  // ---------------------------------------------------------------------------
  app.post('/api/config/groups/save', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        id?: number | null;
        name?: string;
        description?: string;
        modulePermissions?: Record<string, boolean>;
        fieldPermissions?: Record<string, Record<string, 'edit' | 'read' | 'hidden'>>;
        uazapiInstanceIds?: number[];
      };

      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });

      let savedGroup;
      if (body.id) {
        const [updated] = await db
          .update(userGroups)
          .set({
            name,
            description: String(body.description || '').trim(),
            ...(body.modulePermissions ? { modulePermissions: body.modulePermissions } : {}),
            ...(body.fieldPermissions ? { fieldPermissions: body.fieldPermissions } : {}),
          })
          .where(eq(userGroups.id, Number(body.id)))
          .returning();
        savedGroup = updated;
      } else {
        const [created] = await db
          .insert(userGroups)
          .values({
            name,
            description: String(body.description || '').trim(),
            modulePermissions: body.modulePermissions || {
              overview: true,
              prospection: true,
              admission: true,
              audit: false,
              legal: false,
              negotiations: false,
              finance: false,
              collection: false,
              config: false,
            },
            fieldPermissions: body.fieldPermissions || {},
          })
          .returning();
        savedGroup = created;
      }

      // Sincroniza associação bidirecional de números/instâncias UaZapi para este grupo
      if (Array.isArray(body.uazapiInstanceIds) && savedGroup) {
        const selectedSet = new Set(body.uazapiInstanceIds.map((x) => Number(x)));
        const allInstances = await db.select().from(unitWhatsappCredentials);
        for (const inst of allInstances) {
          const cur = new Set(inst.allowedGroupIds || []);
          if (selectedSet.has(inst.id)) cur.add(savedGroup.id);
          else cur.delete(savedGroup.id);
          await db
            .update(unitWhatsappCredentials)
            .set({ allowedGroupIds: Array.from(cur), updatedAt: new Date() })
            .where(eq(unitWhatsappCredentials.id, inst.id));
        }
      }

      await logConfigAudit(req, body.id ? 'USER_GROUP_UPDATED' : 'USER_GROUP_CREATED', 'user_group', savedGroup.id, {
        name: savedGroup.name,
        uazapiInstanceIds: body.uazapiInstanceIds,
      });

      res.json({ ok: true, group: savedGroup });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar grupo de acesso.' });
    }
  });

  app.delete('/api/config/groups/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const linkedUsers = await db.select({ v: count() }).from(users).where(eq(users.groupId, id));
      if (Number(linkedUsers[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Não é possível excluir: existem ${linkedUsers[0].v} usuário(s) vinculados a este grupo.`,
        });
      }
      await db.delete(userGroups).where(eq(userGroups.id, id));
      await logConfigAudit(req, 'USER_GROUP_DELETED', 'user_group', id, {});
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir grupo.' });
    }
  });

  app.post('/api/config/users/save', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        id?: number | null;
        name?: string;
        email?: string;
        role?: string;
        groupId?: number | null;
        defaultUnitId?: number | null;
        allowedUnitIds?: number[];
        whatsappPhone?: string;
        password?: string;
        mustChangePassword?: boolean;
        active?: boolean;
      };

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!name || !email || !isValidEmailFormat(email)) {
        return res.status(400).json({ error: 'Nome e e-mail corporativo válido são obrigatórios.' });
      }

      const role = String(body.role || 'consultant');
      const groupId = body.groupId ? Number(body.groupId) : null;
      const defaultUnitId = body.defaultUnitId ? Number(body.defaultUnitId) : 1;
      const allowedUnitIds = Array.isArray(body.allowedUnitIds) && body.allowedUnitIds.length > 0
        ? body.allowedUnitIds.map((u) => Number(u))
        : [defaultUnitId];
      const whatsappPhone = String(body.whatsappPhone || '').trim();
      const active = body.active !== false;

      if (body.id) {
        const updateSet: Record<string, unknown> = {
          name,
          email,
          role,
          groupId,
          defaultUnitId,
          allowedUnitIds,
          whatsappPhone,
          active,
        };
        if (body.password && body.password.trim().length >= 6) {
          updateSet.passwordHash = hashPassword(body.password.trim());
          updateSet.mustChangePassword = Boolean(body.mustChangePassword);
        }
        const [updated] = await db
          .update(users)
          .set(updateSet)
          .where(eq(users.id, Number(body.id)))
          .returning();

        await logConfigAudit(req, 'USER_UPDATED', 'user', updated.id, { email: updated.email, role: updated.role, groupId });
        return res.json({ ok: true, userId: updated.id });
      } else {
        const dup = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (dup[0]) {
          return res.status(409).json({ error: `Já existe um usuário com o e-mail "${email}".` });
        }
        const rawPwd = body.password && body.password.trim().length >= 6 ? body.password.trim() : 'Mudar@2026';
        const [created] = await db
          .insert(users)
          .values({
            uid: `corp-${crypto.randomBytes(6).toString('hex')}`,
            name,
            email,
            role,
            groupId,
            defaultUnitId,
            allowedUnitIds,
            whatsappPhone,
            passwordHash: hashPassword(rawPwd),
            mustChangePassword: body.mustChangePassword !== false,
            active,
          })
          .returning();

        await logConfigAudit(req, 'USER_CREATED', 'user', created.id, { email: created.email, role: created.role, groupId });
        return res.json({ ok: true, userId: created.id });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao salvar usuário.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. CHECKLIST DE AUDITORIA DE PROCESSO & EXCEÇÕES HISTÓRICAS (Seção 5 Manual)
  // ---------------------------------------------------------------------------
  app.get('/api/audit-checklist', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const items = await db
        .select()
        .from(auditChecklistItems)
        .orderBy(asc(auditChecklistItems.sortOrder), asc(auditChecklistItems.id));
      res.json({ items });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar checklist de auditoria.' });
    }
  });

  app.post('/api/config/audit-checklist', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { sortOrder, title, description, modalityCondition, active } = (req.body || {}) as {
        sortOrder?: number;
        title?: string;
        description?: string;
        modalityCondition?: string;
        active?: boolean;
      };
      if (!title?.trim()) {
        return res.status(400).json({ error: 'Título do item de auditoria é obrigatório.' });
      }
      const existing = await db.select().from(auditChecklistItems);
      const maxOrder = existing.reduce((acc, it) => Math.max(acc, it.sortOrder || 0), 0);
      const resolvedOrder = Math.max(1, Number(sortOrder || maxOrder + 1));

      const [created] = await db
        .insert(auditChecklistItems)
        .values({
          sortOrder: resolvedOrder,
          title: title.trim(),
          description: String(description || '').trim(),
          modalityCondition: String(modalityCondition || '').trim(),
          active: active !== false,
        })
        .returning();

      await logConfigAudit(req, 'AUDIT_CHECKLIST_CREATED', 'audit_checklist', created.id, {
        title: created.title,
        sortOrder: created.sortOrder,
      });

      res.json({ ok: true, item: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar item de checklist.' });
    }
  });

  app.put('/api/config/audit-checklist/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { sortOrder, title, description, modalityCondition, active } = (req.body || {}) as {
        sortOrder?: number;
        title?: string;
        description?: string;
        modalityCondition?: string;
        active?: boolean;
      };
      if (!title?.trim()) {
        return res.status(400).json({ error: 'Título do item de auditoria é obrigatório.' });
      }
      const [updated] = await db
        .update(auditChecklistItems)
        .set({
          sortOrder: Math.max(1, Number(sortOrder || 1)),
          title: title.trim(),
          description: String(description || '').trim(),
          modalityCondition: String(modalityCondition || '').trim(),
          active: active !== false,
          updatedAt: new Date(),
        })
        .where(eq(auditChecklistItems.id, id))
        .returning();

      await logConfigAudit(req, 'AUDIT_CHECKLIST_UPDATED', 'audit_checklist', id, {
        title: updated.title,
        active: updated.active,
      });

      res.json({ ok: true, item: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar item de checklist.' });
    }
  });

  app.patch('/api/config/audit-checklist/:id/reorder', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { direction } = (req.body || {}) as { direction: 'up' | 'down' };
      const all = await db
        .select()
        .from(auditChecklistItems)
        .orderBy(asc(auditChecklistItems.sortOrder), asc(auditChecklistItems.id));
      const idx = all.findIndex((i) => i.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Item não localizado.' });

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= all.length) {
        return res.json({ ok: true });
      }

      const a = all[idx];
      const b = all[swapIdx];
      const orderA = a.sortOrder === b.sortOrder ? idx + 1 : a.sortOrder;
      const orderB = a.sortOrder === b.sortOrder ? swapIdx + 1 : b.sortOrder;

      await db.update(auditChecklistItems).set({ sortOrder: orderB, updatedAt: new Date() }).where(eq(auditChecklistItems.id, a.id));
      await db.update(auditChecklistItems).set({ sortOrder: orderA, updatedAt: new Date() }).where(eq(auditChecklistItems.id, b.id));

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao reordenar checklist.' });
    }
  });

  app.post('/api/config/audit-checklist/migrate', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { operation, sourceId, targetId } = (req.body || {}) as {
        operation: 'swap' | 'overwrite' | 'duplicate';
        sourceId: number;
        targetId?: number;
      };
      const all = await db
        .select()
        .from(auditChecklistItems)
        .orderBy(asc(auditChecklistItems.sortOrder), asc(auditChecklistItems.id));
      const source = all.find((x) => x.id === Number(sourceId));
      if (!source) return res.status(404).json({ error: 'Item de origem não localizado.' });

      if (operation === 'duplicate') {
        const maxOrd = all.reduce((m, it) => Math.max(m, it.sortOrder || 0), 0);
        const [dup] = await db
          .insert(auditChecklistItems)
          .values({
            sortOrder: maxOrd + 1,
            title: `${source.title} (Cópia)`,
            description: source.description,
            modalityCondition: source.modalityCondition,
            active: true,
          })
          .returning();
        await logConfigAudit(req, 'AUDIT_CHECKLIST_DUPLICATED', 'audit_checklist', dup.id, { fromId: source.id });
        return res.json({ ok: true, item: dup });
      }

      const target = all.find((x) => x.id === Number(targetId));
      if (!target) return res.status(400).json({ error: 'Selecione um item de destino válido.' });

      if (operation === 'swap') {
        await db
          .update(auditChecklistItems)
          .set({ sortOrder: target.sortOrder, updatedAt: new Date() })
          .where(eq(auditChecklistItems.id, source.id));
        await db
          .update(auditChecklistItems)
          .set({ sortOrder: source.sortOrder, updatedAt: new Date() })
          .where(eq(auditChecklistItems.id, target.id));
        await logConfigAudit(req, 'AUDIT_CHECKLIST_SWAPPED', 'audit_checklist', source.id, { targetId: target.id });
        return res.json({ ok: true });
      }

      if (operation === 'overwrite') {
        const [overwritten] = await db
          .update(auditChecklistItems)
          .set({
            title: source.title,
            description: source.description,
            modalityCondition: source.modalityCondition,
            updatedAt: new Date(),
          })
          .where(eq(auditChecklistItems.id, target.id))
          .returning();
        await logConfigAudit(req, 'AUDIT_CHECKLIST_OVERWRITTEN', 'audit_checklist', target.id, { sourceId: source.id });
        return res.json({ ok: true, item: overwritten });
      }

      res.status(400).json({ error: 'Operação inválida.' });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro na operação de migração do item.' });
    }
  });

  // Relatório Somente Leitura: Auditorias Históricas Sem Unidade (Seção 5.2 do Manual)
  app.get('/api/config/audit-unbound', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = 25;
      const reasonFilter = String(req.query.reason || 'all');

      const [unboundLogs, allUnits, allUsers, allClients] = await Promise.all([
        db.select().from(auditLogs).where(isNull(auditLogs.unitId)).orderBy(asc(auditLogs.createdAt)),
        db.select().from(units),
        db.select({ id: users.id, defaultUnitId: users.defaultUnitId, allowedUnitIds: users.allowedUnitIds }).from(users),
        db.select({ id: clients.id, unitId: clients.unitId }).from(clients),
      ]);

      const unitMap = new Map(allUnits.map((u) => [u.id, u.code]));
      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      const clientMap = new Map(allClients.map((c) => [c.id, c.unitId]));

      const grouped = new Map<
        string,
        {
          reasonKey: string;
          reasonLabel: string;
          entityRef: string;
          candidateUnits: string;
          firstSeenAt: string;
          lastSeenAt: string;
          occurrences: number;
        }
      >();

      const supportedTypes = new Set(['user', 'client', 'admission', 'unit', 'uazapi_instance', 'gotalk_channel', 'user_group', 'audit_checklist']);

      for (const log of unboundLogs) {
        const rawId = (log.entityId || '').trim();
        let reasonKey = 'entity_without_unit';
        let reasonLabel = 'Entidade relacionada sem unidade';
        let candidateUnits = '—';

        if (!rawId) {
          reasonKey = 'missing_id';
          reasonLabel = 'Identificador ausente';
        } else if (!supportedTypes.has(log.entityType)) {
          reasonKey = 'unsupported_entity';
          reasonLabel = 'Entidade não suportada';
        } else if (['user', 'client', 'admission', 'unit'].includes(log.entityType) && !/^\d+$/.test(rawId)) {
          reasonKey = 'invalid_id';
          reasonLabel = 'Identificador inválido';
        } else if (log.entityType === 'user') {
          const usr = userMap.get(Number(rawId));
          if (!usr) {
            reasonKey = 'entity_not_found';
            reasonLabel = 'Entidade relacionada não encontrada';
          } else if ((usr.allowedUnitIds || []).length > 1) {
            reasonKey = 'ambiguous_units';
            reasonLabel = 'Unidades ambíguas';
            candidateUnits = usr.allowedUnitIds.map((id) => unitMap.get(id) || `#${id}`).join(', ');
          } else if (usr.defaultUnitId) {
            candidateUnits = unitMap.get(usr.defaultUnitId) || `#${usr.defaultUnitId}`;
          }
        } else if (log.entityType === 'client') {
          const cUnit = clientMap.get(Number(rawId));
          if (!cUnit) {
            reasonKey = 'entity_not_found';
            reasonLabel = 'Entidade relacionada não encontrada';
          } else {
            candidateUnits = unitMap.get(cUnit) || `#${cUnit}`;
          }
        }

        const key = `${reasonKey}::${log.entityType}#${rawId || 'sem-id'}`;
        const ts = new Date(log.createdAt).toISOString();
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, {
            reasonKey,
            reasonLabel,
            entityRef: `${log.entityType} #${rawId || '—'}`,
            candidateUnits,
            firstSeenAt: ts,
            lastSeenAt: ts,
            occurrences: 1,
          });
        } else {
          existing.lastSeenAt = ts;
          existing.occurrences += 1;
        }
      }

      const allItems = Array.from(grouped.values()).sort(
        (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
      );

      const reasonCounts: Record<string, number> = { all: allItems.length };
      for (const it of allItems) {
        reasonCounts[it.reasonKey] = (reasonCounts[it.reasonKey] || 0) + 1;
      }

      const filtered = reasonFilter === 'all' ? allItems : allItems.filter((i) => i.reasonKey === reasonFilter);
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

      res.json({ total, page, pageSize, totalPages, rows, reasonCounts });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao consultar auditorias históricas sem unidade.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 8. CENTRAL DE AJUDA CRUD (Seção 6 do Manual)
  // ---------------------------------------------------------------------------
  app.get('/api/help-center', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await ensureCommonCadastrosSeed();
      const topics = await db
        .select()
        .from(helpCenterTopics)
        .orderBy(asc(helpCenterTopics.menuPath), asc(helpCenterTopics.title));
      res.json({ topics });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao carregar Central de Ajuda.' });
    }
  });

  app.post('/api/config/help-center', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { topicKey, menuPath, title, summary, keywords, htmlContent } = (req.body || {}) as {
        topicKey?: string;
        menuPath?: string;
        title?: string;
        summary?: string;
        keywords?: string[] | string;
        htmlContent?: string;
      };

      if (!menuPath?.trim() || !title?.trim()) {
        return res.status(400).json({ error: 'Caminho do Menu e Título são obrigatórios.' });
      }
      const cleanKey = (topicKey?.trim() || `topico_${Date.now()}`).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const kwList = Array.isArray(keywords)
        ? keywords.map((k) => String(k).trim()).filter(Boolean)
        : String(keywords || '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);

      const dup = await db.select().from(helpCenterTopics).where(eq(helpCenterTopics.topicKey, cleanKey)).limit(1);
      if (dup[0]) {
        return res.status(409).json({ error: `Já existe um tópico com o ID "${cleanKey}".` });
      }

      const [created] = await db
        .insert(helpCenterTopics)
        .values({
          topicKey: cleanKey,
          menuPath: menuPath.trim(),
          title: title.trim(),
          summary: String(summary || '').trim(),
          keywords: kwList,
          htmlContent: String(htmlContent || '').trim(),
        })
        .returning();

      await logConfigAudit(req, 'HELP_TOPIC_CREATED', 'help_topic', created.id, { topicKey: created.topicKey, title: created.title });
      res.json({ ok: true, topic: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao criar tópico de ajuda.' });
    }
  });

  app.put('/api/config/help-center/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { menuPath, title, summary, keywords, htmlContent } = (req.body || {}) as {
        menuPath?: string;
        title?: string;
        summary?: string;
        keywords?: string[] | string;
        htmlContent?: string;
      };
      if (!menuPath?.trim() || !title?.trim()) {
        return res.status(400).json({ error: 'Caminho do Menu e Título são obrigatórios.' });
      }
      const kwList = Array.isArray(keywords)
        ? keywords.map((k) => String(k).trim()).filter(Boolean)
        : String(keywords || '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);

      const [updated] = await db
        .update(helpCenterTopics)
        .set({
          menuPath: menuPath.trim(),
          title: title.trim(),
          summary: String(summary || '').trim(),
          keywords: kwList,
          htmlContent: String(htmlContent || '').trim(),
          updatedAt: new Date(),
        })
        .where(eq(helpCenterTopics.id, id))
        .returning();

      await logConfigAudit(req, 'HELP_TOPIC_UPDATED', 'help_topic', id, { title: updated.title });
      res.json({ ok: true, topic: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar tópico de ajuda.' });
    }
  });

  app.delete('/api/config/help-center/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(helpCenterTopics).where(eq(helpCenterTopics.id, id));
      await logConfigAudit(req, 'HELP_TOPIC_DELETED', 'help_topic', id, {});
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir tópico de ajuda.' });
    }
  });

  app.post('/api/config/help-center/restore-defaults', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      await db.delete(helpCenterTopics);
      const inserted = await db.insert(helpCenterTopics).values(DEFAULT_HELP_TOPICS).returning();
      await logConfigAudit(req, 'HELP_CENTER_RESTORED_DEFAULTS', 'help_topic', 'all', { count: inserted.length });
      res.json({ ok: true, topics: inserted });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao restaurar tópicos padrão.' });
    }
  });

  // ---------------------------------------------------------------------------
  // 9. CRUD COMPLEMENTAR: QUADRO DE HORÁRIOS, CAMPOS DINÂMICOS & CATEGORIAS
  // ---------------------------------------------------------------------------
  app.put('/api/config/schedules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { targetType, targetId, targetLabel, startTime, endTime, allowedDays, active } = req.body as {
        targetType: string;
        targetId: number;
        targetLabel: string;
        startTime: string;
        endTime: string;
        allowedDays: number[];
        active?: boolean;
      };
      const [updated] = await db
        .update(workSchedules)
        .set({
          targetType,
          targetId: Number(targetId || 1),
          targetLabel: String(targetLabel || '').trim(),
          startTime,
          endTime,
          allowedDays: Array.isArray(allowedDays) ? allowedDays : [1, 2, 3, 4, 5],
          active: active !== false,
        })
        .where(eq(workSchedules.id, id))
        .returning();
      res.json({ ok: true, schedule: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar regra de horário.' });
    }
  });

  app.delete('/api/config/schedules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(workSchedules).where(eq(workSchedules.id, id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao remover horário.' });
    }
  });

  app.put('/api/config/custom-fields/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { module, fieldKey, label, fieldType, required } = req.body as {
        module: string;
        fieldKey: string;
        label: string;
        fieldType: string;
        required?: boolean;
      };
      const [updated] = await db
        .update(customFields)
        .set({
          module,
          fieldKey: fieldKey.trim(),
          label: label.trim(),
          fieldType: fieldType || 'text',
          required: Boolean(required),
        })
        .where(eq(customFields.id, id))
        .returning();
      res.json({ ok: true, field: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar campo customizado.' });
    }
  });

  app.delete('/api/config/custom-fields/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(customFields).where(eq(customFields.id, id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir campo customizado.' });
    }
  });

  app.put('/api/config/payment-categories/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { name, providerCode, active } = req.body as { name: string; providerCode?: string; active?: boolean };
      const [updated] = await db
        .update(paymentCategories)
        .set({
          name: name.trim(),
          providerCode: (providerCode || 'custom').trim(),
          active: active !== false,
        })
        .where(eq(paymentCategories.id, id))
        .returning();
      res.json({ ok: true, category: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar categoria.' });
    }
  });

  app.delete('/api/config/payment-categories/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const used = await db.select({ v: count() }).from(financialTitles).where(eq(financialTitles.categoryId, id));
      if (Number(used[0]?.v || 0) > 0) {
        return res.status(409).json({
          error: `Categoria em uso por ${used[0].v} título(s) financeiro(s). Inative-a em vez de excluir.`,
        });
      }
      await db.delete(paymentCategories).where(eq(paymentCategories.id, id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao excluir categoria.' });
    }
  });

  // Fix unused sql import warning if any
  void sql;
}
