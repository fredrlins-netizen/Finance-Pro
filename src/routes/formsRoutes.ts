import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { and, desc, eq, ilike, inArray, asc, or, sql } from 'drizzle-orm';
import mammoth from 'mammoth';
import { db } from '../db/index.ts';
import {
  admissions,
  auditLogs,
  bankAccounts,
  banks,
  bearers,
  chartOfAccounts,
  clients,
  collaborators,
  customForms,
  customFormSubmissions,
  departments,
  documentTypes,
  formTemplates,
  legalProcesses,
  modalities,
  negotiations,
  products,
  scheduleServices,
  seriesCatalog,
  units,
  type CustomFormField,
  type CustomFormSettings,
} from '../db/schema.ts';
import { EMBEDDED_FORM_TEMPLATES } from '../data/embeddedFormTemplates.ts';
import { requireAuth, requireModule, type AuthRequest } from '../middleware/auth.ts';
import { parsePositiveIntId, sanitizeErrorMessage } from '../utils/validation.ts';
import { fillDocxTemplateBuffer } from '../services/docx.ts';
import {
  iviAnalyzeFormSubmission,
  iviGenerateFormFromPromptOrModel,
} from '../services/ivi.ts';

const modelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(String(id || '').trim());
}

let formTemplatesSeedPromise: Promise<void> | null = null;

async function ensureFormTemplatesSeed(): Promise<void> {
  if (formTemplatesSeedPromise) return formTemplatesSeedPromise;
  formTemplatesSeedPromise = (async () => {
    try {
      const existing = await db.select({ id: formTemplates.id }).from(formTemplates).limit(1);
      if (existing.length > 0) return;

      await db.insert(formTemplates).values(
        EMBEDDED_FORM_TEMPLATES.map((tpl) => ({
          name: tpl.name,
          description: tpl.description,
          content: tpl.content,
          header: tpl.header,
          footer: tpl.footer,
          menuIds: tpl.menuIds,
          docxTemplate: tpl.docxTemplate ?? null,
        }))
      );
    } catch (err) {
      formTemplatesSeedPromise = null;
      console.error('ensureFormTemplatesSeed error:', err);
    }
  })();
  return formTemplatesSeedPromise;
}

function getAllowedUnitScope(req: AuthRequest): number[] | null {
  const user = req.authUser;
  if (!user || user.role === 'admin') return null;
  const list = Array.isArray(user.allowedUnitIds) ? user.allowedUnitIds.map(Number).filter(Boolean) : [];
  if (list.length > 0) return list;
  return user.defaultUnitId ? [Number(user.defaultUnitId)] : [1];
}

function isUnitPermitted(req: AuthRequest, unitId: number | null | undefined): boolean {
  if (!unitId) return true;
  const scope = getAllowedUnitScope(req);
  if (scope === null) return true;
  return scope.includes(Number(unitId));
}

function sanitizeCsvCell(val: unknown): string {
  const raw = String(val ?? '');
  const trimmed = raw.trimStart();
  const safe = /^[=+\-@\t\r]/.test(trimmed) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function formatAnswerForExport(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function computeSubmissionScore(fields: CustomFormField[], answers: Record<string, unknown>): number | null {
  const ratingFields = fields.filter((f) => f.type === 'rating');
  const booleanFields = fields.filter((f) => f.type === 'boolean' && (f.weight || 0) > 0);
  if (ratingFields.length === 0 && booleanFields.length === 0) return null;

  let earned = 0;
  let possible = 0;

  for (const rf of ratingFields) {
    const maxR = rf.maxRating || 5;
    const raw = Number(answers[rf.key]);
    if (Number.isFinite(raw)) {
      earned += Math.min(maxR, Math.max(0, raw));
      possible += maxR;
    }
  }

  for (const bf of booleanFields) {
    const w = bf.weight || 10;
    possible += w;
    if (answers[bf.key] === true || answers[bf.key] === 'Sim' || answers[bf.key] === 'true') {
      earned += w;
    }
  }

  if (possible <= 0) return null;
  return Math.round((earned / possible) * 100);
}

const DEFAULT_FORM_TEMPLATES: Array<{
  code: string;
  title: string;
  description: string;
  category: string;
  status: string;
  linkedEntity: string;
  isTemplate: boolean;
  allowAnonymous: boolean;
  publicSlug: string;
  fieldsJson: CustomFormField[];
  settingsJson: CustomFormSettings;
}> = [
  {
    code: 'MOD-TRIAGEM-01',
    title: 'Ficha de Triagem & Qualificação Financeira',
    description:
      'Levantamento inicial de endividamento bancário, renda familiar, riscos judiciais e capacidade de aporte.',
    category: 'triagem',
    status: 'publicado',
    linkedEntity: 'cliente',
    isTemplate: true,
    allowAnonymous: false,
    publicSlug: 'triagem-qualificacao-financeira',
    fieldsJson: [
      {
        id: 't1_sec1',
        key: 'sec_perfil',
        label: '1. Perfil Bancário & Renda',
        type: 'section_header',
        required: false,
        width: 'full',
      },
      {
        id: 't1_banco',
        key: 'banco_credor_principal',
        label: 'Banco / Instituição Credora Principal',
        type: 'text',
        required: true,
        placeholder: 'Ex: Banco BV, Itaú, Santander',
        width: 'half',
      },
      {
        id: 't1_modalidade',
        key: 'modalidade_divida',
        label: 'Modalidade do Contrato',
        type: 'select',
        options: ['Veicular (CDC / Alienação)', 'Empréstimo Pessoal', 'Cartão de Crédito', 'Capital de Giro / PJ'],
        required: true,
        width: 'half',
      },
      {
        id: 't1_saldo',
        key: 'saldo_devedor_atual',
        label: 'Saldo Devedor Total (R$)',
        type: 'currency',
        required: true,
        width: 'half',
      },
      {
        id: 't1_parcelas_atraso',
        key: 'parcelas_em_atraso',
        label: 'Quantidade de Parcelas em Atraso',
        type: 'number',
        required: true,
        width: 'half',
      },
      {
        id: 't1_sec2',
        key: 'sec_urgencia',
        label: '2. Diagnóstico de Risco & Capacidade',
        type: 'section_header',
        required: false,
        width: 'full',
      },
      {
        id: 't1_notificacao',
        key: 'notificacao_judicial',
        label: 'Cliente já recebeu notificação extrajudicial ou citação judicial?',
        type: 'radio',
        options: ['Não recebeu', 'Notificação extrajudicial / cartório', 'Ação judicial / Busca e apreensão'],
        required: true,
        width: 'full',
      },
      {
        id: 't1_capacidade',
        key: 'capacidade_quitacao_imediata',
        label: 'Cliente possui reserva para proposta de quitação à vista com deságio?',
        type: 'boolean',
        required: true,
        weight: 20,
        width: 'half',
      },
      {
        id: 't1_valor_reserva',
        key: 'valor_disponivel_acordo',
        label: 'Valor Disponível para Entrada / Acordo (R$)',
        type: 'currency',
        required: false,
        conditionalFieldId: 't1_capacidade',
        conditionalEquals: 'true',
        width: 'half',
      },
      {
        id: 't1_obs',
        key: 'parecer_triagem',
        label: 'Observações Estratégicas do Consultor',
        type: 'textarea',
        required: false,
        width: 'full',
      },
    ],
    settingsJson: {
      submitLabel: 'Protocolar Triagem',
      successMessage: 'Triagem financeira registrada e pronta para análise.',
      autoScoreEnabled: true,
      iviAutoAnalyze: true,
      requiresReview: true,
    },
  },
  {
    code: 'MOD-AUD-02',
    title: 'Checklist de Auditoria Pré-Protocolo & Compliance',
    description:
      'Conferência obrigatória de contrato assinado, procuração, CCB bancária e validação de boletos iniciais.',
    category: 'auditoria',
    status: 'publicado',
    linkedEntity: 'admissao',
    isTemplate: true,
    allowAnonymous: false,
    publicSlug: 'checklist-auditoria-pre-protocolo',
    fieldsJson: [
      {
        id: 'a1_sec1',
        key: 'sec_doc',
        label: '1. Conferência Documental Obrigatória',
        type: 'section_header',
        required: false,
        width: 'full',
      },
      {
        id: 'a1_docs',
        key: 'itens_conferidos',
        label: 'Marque os documentos validados no Cofre Documental',
        type: 'checkbox_group',
        options: [
          'Contrato de Honorários assinado e datado',
          'Procuração Ad Judicia com firma/gov.br',
          'Cédula de Crédito Bancário (CCB) ou contrato do banco',
          'Documento pessoal (CNH/RG) e comprovante de residência',
          'Planilha revisional anexada ao dossiê',
        ],
        required: true,
        width: 'full',
      },
      {
        id: 'a1_entrada_ok',
        key: 'entrada_confirmada',
        label: 'Pagamento da entrada / boletos iniciais confirmado no Financeiro?',
        type: 'boolean',
        required: true,
        weight: 25,
        width: 'half',
      },
      {
        id: 'a1_parecer',
        key: 'parecer_auditoria',
        label: 'Decisão da Auditoria',
        type: 'select',
        options: ['Aprovado para Protocolo', 'Devolvido à Admissão (Pendência)', 'Retido para Esclarecimento'],
        required: true,
        width: 'half',
      },
      {
        id: 'a1_nota',
        key: 'ressalvas_auditor',
        label: 'Ressalvas ou Motivo da Devolução',
        type: 'textarea',
        required: false,
        width: 'full',
      },
    ],
    settingsJson: {
      submitLabel: 'Concluir Checklist',
      successMessage: 'Checklist de auditoria salvo com sucesso.',
      autoScoreEnabled: true,
      iviAutoAnalyze: true,
      requiresReview: false,
    },
  },
  {
    code: 'MOD-NEG-03',
    title: 'Análise de Viabilidade de Acordo Bancário',
    description:
      'Formulário para mesa de negociação estruturar alçada de deságio, prazo e autorização do cliente.',
    category: 'negociacao',
    status: 'publicado',
    linkedEntity: 'negociacao',
    isTemplate: true,
    allowAnonymous: false,
    publicSlug: 'viabilidade-acordo-bancario',
    fieldsJson: [
      {
        id: 'n1_sec1',
        key: 'sec_mesa',
        label: '1. Parâmetros da Mesa Credora',
        type: 'section_header',
        required: false,
        width: 'full',
      },
      {
        id: 'n1_teto',
        key: 'desagio_obtido_pct',
        label: 'Percentual de Deságio Obtido com o Banco (%)',
        type: 'number',
        required: true,
        width: 'half',
      },
      {
        id: 'n1_valor',
        key: 'valor_proposta_banco',
        label: 'Valor Líquido da Proposta (R$)',
        type: 'currency',
        required: true,
        width: 'half',
      },
      {
        id: 'n1_cond',
        key: 'forma_pagamento_banco',
        label: 'Condição de Pagamento Oferecida',
        type: 'select',
        options: ['À vista (Boleto Único)', 'Entrada + 3x', 'Entrada + 6x', 'Parcelamento 12x+'],
        required: true,
        width: 'half',
      },
      {
        id: 'n1_validade',
        key: 'validade_proposta',
        label: 'Data Limite da Proposta Bancária',
        type: 'date',
        required: true,
        width: 'half',
      },
      {
        id: 'n1_ciente',
        key: 'cliente_ciente_termos',
        label: 'Cliente validou expressamente o valor e a data do boleto no WhatsApp?',
        type: 'boolean',
        required: true,
        weight: 20,
        width: 'full',
      },
      {
        id: 'n1_obs',
        key: 'detalhes_acordo',
        label: 'Observações & Canal do Contato no Banco',
        type: 'textarea',
        required: false,
        width: 'full',
      },
    ],
    settingsJson: {
      submitLabel: 'Registrar Viabilidade',
      successMessage: 'Viabilidade de acordo protocolada.',
      autoScoreEnabled: true,
      iviAutoAnalyze: true,
      requiresReview: true,
    },
  },
  {
    code: 'MOD-NPS-04',
    title: 'Pesquisa de Satisfação (NPS) & Experiência do Cliente',
    description:
      'Formulário avaliativo sobre atendimento do consultor, clareza contratual e indicação da assessoria.',
    category: 'nps',
    status: 'publicado',
    linkedEntity: 'cliente',
    isTemplate: true,
    allowAnonymous: true,
    publicSlug: 'pesquisa-satisfacao-nps',
    fieldsJson: [
      {
        id: 'nps_nota',
        key: 'nota_nps',
        label: 'De 0 a 10, o quanto você recomendaria a FinancePro Assessoria a um amigo ou familiar?',
        type: 'rating',
        maxRating: 10,
        required: true,
        width: 'full',
      },
      {
        id: 'nps_clareza',
        key: 'atendimento_claro',
        label: 'Todas as suas dúvidas sobre prazos e etapas foram respondidas com clareza?',
        type: 'boolean',
        required: true,
        weight: 10,
        width: 'half',
      },
      {
        id: 'nps_canal',
        key: 'canal_preferido',
        label: 'Qual canal foi mais eficiente para você?',
        type: 'select',
        options: ['WhatsApp', 'Atendimento Presencial', 'Ligação Telefônica', 'Vídeo Chamada'],
        required: false,
        width: 'half',
      },
      {
        id: 'nps_comentario',
        key: 'elogio_ou_sugestao',
        label: 'Deixe um comentário, elogio ou sugestão de melhoria',
        type: 'textarea',
        required: false,
        width: 'full',
      },
    ],
    settingsJson: {
      submitLabel: 'Enviar Avaliação',
      successMessage: 'Obrigado! Sua avaliação foi registrada para melhoria contínua.',
      autoScoreEnabled: true,
      iviAutoAnalyze: true,
      requiresReview: false,
    },
  },
];

let formsSeedPromise: Promise<void> | null = null;

async function ensureFormsSeed(): Promise<void> {
  if (formsSeedPromise) return formsSeedPromise;
  formsSeedPromise = (async () => {
    try {
      const existing = await db.select({ id: customForms.id }).from(customForms).limit(1);
      if (existing.length > 0) return;

      const inserted = await db
        .insert(customForms)
        .values(
          DEFAULT_FORM_TEMPLATES.map((tpl) => ({
            ...tpl,
            iviPromptOrigin: 'Modelo padrão corporativo FinancePro',
            version: 1,
            createdByName: 'Sistema',
          }))
        )
        .returning();

      const triagemForm = inserted.find((f) => f.code === 'MOD-TRIAGEM-01');
      const [firstClient] = await db.select().from(clients).limit(1);
      if (triagemForm && firstClient) {
        await db.insert(customFormSubmissions).values({
          formId: triagemForm.id,
          protocolCode: `RESP-${new Date().getFullYear()}-0001`,
          unitId: firstClient.unitId || 1,
          clientId: firstClient.id,
          clientName: firstClient.fullName,
          status: 'aprovado',
          answersJson: {
            banco_credor_principal: 'Banco BV',
            modalidade_divida: 'Veicular (CDC / Alienação)',
            saldo_devedor_atual: '38500.00',
            parcelas_em_atraso: '4',
            notificacao_judicial: 'Notificação extrajudicial / cartório',
            capacidade_quitacao_imediata: true,
            valor_disponivel_acordo: '15000.00',
            parecer_triagem: 'Cliente possui reserva para liquidação com meta de 58% de deságio.',
          },
          calculatedScore: 100,
          iviSummary: 'Triagem completa com liquidez imediata informada e notificação em andamento — priorizar mesa bancária.',
          iviClassification: 'Alta Viabilidade',
          submittedByName: 'Carla Dias',
          sourceChannel: 'interno',
          reviewedByName: 'Auditoria Técnica',
          reviewedNotes: 'Encaminhado para mesa de negociação.',
        });
      }
    } catch (err) {
      formsSeedPromise = null;
      console.error('ensureFormsSeed error:', err);
    }
  })();
  return formsSeedPromise;
}

export function registerFormsRoutes(
  app: Express,
  deps: { broadcast: (event: string, payload: unknown) => void }
) {
  // 1. BOOTSTRAP DA OPÇÃO ANÁLISES & CONSULTAS -> FORMULÁRIOS
  app.get('/api/forms/bootstrap', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureFormsSeed();
      const unitScope = getAllowedUnitScope(req);

      const [allForms, allSubmissions, clientRows, admissionRows, negRows, unitRows] = await Promise.all([
        db.select().from(customForms).orderBy(desc(customForms.updatedAt), desc(customForms.id)),
        unitScope
          ? db
              .select()
              .from(customFormSubmissions)
              .where(inArray(customFormSubmissions.unitId, unitScope))
              .orderBy(desc(customFormSubmissions.createdAt))
          : db.select().from(customFormSubmissions).orderBy(desc(customFormSubmissions.createdAt)),
        unitScope
          ? db
              .select({
                id: clients.id,
                fullName: clients.fullName,
                cpfCnpj: clients.cpfCnpj,
                unitId: clients.unitId,
              })
              .from(clients)
              .where(inArray(clients.unitId, unitScope))
              .orderBy(asc(clients.fullName))
          : db
              .select({
                id: clients.id,
                fullName: clients.fullName,
                cpfCnpj: clients.cpfCnpj,
                unitId: clients.unitId,
              })
              .from(clients)
              .orderBy(asc(clients.fullName)),
        unitScope
          ? db
              .select({
                id: admissions.id,
                clientId: admissions.clientId,
                protocolCode: admissions.protocolCode,
                bankName: admissions.bankName,
                contractNumber: admissions.contractNumber,
                unitId: admissions.unitId,
              })
              .from(admissions)
              .where(inArray(admissions.unitId, unitScope))
              .orderBy(desc(admissions.id))
          : db
              .select({
                id: admissions.id,
                clientId: admissions.clientId,
                protocolCode: admissions.protocolCode,
                bankName: admissions.bankName,
                contractNumber: admissions.contractNumber,
                unitId: admissions.unitId,
              })
              .from(admissions)
              .orderBy(desc(admissions.id)),
        unitScope
          ? db
              .select({
                id: negotiations.id,
                clientId: negotiations.clientId,
                clientName: negotiations.clientName,
                bankName: negotiations.bankName,
                contractNumber: negotiations.contractNumber,
                unitId: negotiations.unitId,
              })
              .from(negotiations)
              .where(inArray(negotiations.unitId, unitScope))
              .orderBy(desc(negotiations.id))
          : db
              .select({
                id: negotiations.id,
                clientId: negotiations.clientId,
                clientName: negotiations.clientName,
                bankName: negotiations.bankName,
                contractNumber: negotiations.contractNumber,
                unitId: negotiations.unitId,
              })
              .from(negotiations)
              .orderBy(desc(negotiations.id)),
        db.select().from(units).orderBy(asc(units.id)),
      ]);

      const scopedForms = allForms.filter((f) => !f.unitId || isUnitPermitted(req, f.unitId));
      const formMap = new Map(scopedForms.map((f) => [f.id, f]));
      const countByForm = new Map<number, number>();
      for (const s of allSubmissions) {
        countByForm.set(s.formId, (countByForm.get(s.formId) || 0) + 1);
      }

      const formsWithCounts = scopedForms.map((f) => ({
        ...f,
        submissionsCount: countByForm.get(f.id) || 0,
      }));

      const enrichedSubmissions = allSubmissions
        .filter((s) => formMap.has(s.formId))
        .map((s) => {
          const fm = formMap.get(s.formId);
          return {
            ...s,
            formTitle: fm?.title || `Formulário #${s.formId}`,
            formCode: fm?.code || '',
          };
        });

      const scoredSubs = enrichedSubmissions.filter((s) => typeof s.calculatedScore === 'number');
      const avgScore =
        scoredSubs.length > 0
          ? Math.round(scoredSubs.reduce((acc, s) => acc + (s.calculatedScore || 0), 0) / scoredSubs.length)
          : null;

      res.json({
        forms: formsWithCounts,
        submissions: enrichedSubmissions,
        clients: clientRows,
        admissions: admissionRows,
        negotiations: negRows,
        units: unitRows,
        kpis: {
          totalForms: formsWithCounts.length,
          publishedForms: formsWithCounts.filter((f) => f.status === 'publicado').length,
          templatesCount: formsWithCounts.filter((f) => f.isTemplate).length,
          totalSubmissions: enrichedSubmissions.length,
          pendingReviewCount: enrichedSubmissions.filter(
            (s) => s.status === 'recebido' || s.status === 'em_analise' || s.status === 'pendente_ajuste'
          ).length,
          approvedCount: enrichedSubmissions.filter((s) => s.status === 'aprovado').length,
          avgScore,
        },
      });
    } catch (err) {
      console.error('GET /api/forms/bootstrap error:', err);
      res.status(500).json({ error: 'Erro ao carregar módulo de Formulários.' });
    }
  });

  // 2. CRIAR FORMULÁRIO COM AJUDA DA IVI IA (PROMPT, MODELO BASE E/OU ARQUIVO ANEXADO)
  app.post(
    '/api/forms/ivi-generate',
    requireAuth,
    requireModule('forms'),
    (req: AuthRequest, res: Response, next) => {
      modelUpload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const msg =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'Arquivo modelo excede o limite de 12 MB.'
              : err instanceof Error
              ? err.message
              : 'Falha ao processar arquivo anexado.';
          return res.status(400).json({ error: msg });
        }
        next();
      });
    },
    async (req: AuthRequest, res: Response) => {
      try {
        const body = req.body as {
          prompt?: string;
          baseTemplateId?: string | number;
          category?: string;
          linkedEntity?: string;
        };

        const promptText = String(body.prompt || '').trim();
        const baseTemplateId = Number(body.baseTemplateId || 0);
        const uploaded = req.file;

        if (!promptText && !baseTemplateId && !uploaded) {
          return res.status(400).json({
            error: 'Informe um prompt, selecione um modelo base ou anexe um arquivo de referência para a Ivi IA.',
          });
        }

        let baseTemplate: { title: string; description?: string; fields: CustomFormField[] } | null = null;
        if (baseTemplateId > 0) {
          const [tpl] = await db.select().from(customForms).where(eq(customForms.id, baseTemplateId)).limit(1);
          if (tpl && isUnitPermitted(req, tpl.unitId)) {
            baseTemplate = {
              title: tpl.title,
              description: tpl.description,
              fields: tpl.fieldsJson || [],
            };
          }
        }

        const generated = await iviGenerateFormFromPromptOrModel({
          prompt: promptText,
          category: body.category ? String(body.category) : undefined,
          linkedEntity: body.linkedEntity ? String(body.linkedEntity) : undefined,
          baseTemplate,
          referenceFile: uploaded
            ? {
                mimeType: uploaded.mimetype || 'application/octet-stream',
                buffer: uploaded.buffer,
                fileName: uploaded.originalname || 'modelo',
              }
            : null,
        });

        await db.insert(auditLogs).values({
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'IVI_FORM_GENERATE',
          entityType: 'custom_forms',
          entityId: 'draft',
          details: {
            provider: generated.provider,
            fieldsCount: generated.fields.length,
            hasReferenceFile: Boolean(uploaded),
            baseTemplateId: baseTemplateId || null,
          },
          unitId: req.activeUnitId || 1,
        });

        res.json({ generated });
      } catch (err) {
        console.error('POST /api/forms/ivi-generate error:', err);
        res.status(500).json({ error: 'Falha ao gerar estrutura de formulário com a Ivi IA.' });
      }
    }
  );

  // 3. CRIAR / SALVAR NOVO FORMULÁRIO
  app.post('/api/forms', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as {
        title?: string;
        description?: string;
        category?: string;
        status?: string;
        linkedEntity?: string;
        isTemplate?: boolean;
        allowAnonymous?: boolean;
        fieldsJson?: CustomFormField[];
        settingsJson?: CustomFormSettings;
        iviPromptOrigin?: string;
        unitId?: number | null;
      };

      const title = String(body.title || '').trim();
      if (!title) {
        return res.status(400).json({ error: 'O título do formulário é obrigatório.' });
      }
      if (body.unitId && !isUnitPermitted(req, body.unitId)) {
        return res.status(403).json({ error: 'Unidade não autorizada.' });
      }

      const code = `FRM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const baseSlug = title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42);
      const publicSlug = `${baseSlug || 'form'}-${crypto.randomBytes(2).toString('hex')}`;

      const [created] = await db
        .insert(customForms)
        .values({
          code,
          title,
          description: String(body.description || '').trim(),
          category: String(body.category || 'operacional'),
          status: ['rascunho', 'publicado', 'arquivado'].includes(String(body.status))
            ? String(body.status)
            : 'publicado',
          linkedEntity: String(body.linkedEntity || 'cliente'),
          isTemplate: Boolean(body.isTemplate),
          allowAnonymous: Boolean(body.allowAnonymous),
          publicSlug,
          fieldsJson: Array.isArray(body.fieldsJson) ? body.fieldsJson : [],
          settingsJson: body.settingsJson || {},
          iviPromptOrigin: String(body.iviPromptOrigin || ''),
          version: 1,
          unitId: body.unitId ?? null,
          createdByUserId: req.authUser!.id,
          createdByName: req.authUser!.name,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_FORM',
        entityType: 'custom_forms',
        entityId: String(created.id),
        details: { code: created.code, title: created.title, fieldsCount: created.fieldsJson.length },
        unitId: created.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'created', formId: created.id });
      res.status(201).json({ form: { ...created, submissionsCount: 0 } });
    } catch (err) {
      console.error('POST /api/forms error:', err);
      res.status(500).json({ error: 'Erro ao salvar formulário.' });
    }
  });

  // 4. ATUALIZAR FORMULÁRIO
  app.put('/api/forms/:id', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID do formulário inválido.' });
      const [existing] = await db.select().from(customForms).where(eq(customForms.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Formulário não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Acesso negado para esta unidade.' });
      }

      const body = req.body as Partial<{
        title: string;
        description: string;
        category: string;
        status: string;
        linkedEntity: string;
        isTemplate: boolean;
        allowAnonymous: boolean;
        fieldsJson: CustomFormField[];
        settingsJson: CustomFormSettings;
        unitId: number | null;
      }>;

      const [updated] = await db
        .update(customForms)
        .set({
          ...(body.title !== undefined ? { title: String(body.title).trim() || existing.title } : {}),
          ...(body.description !== undefined ? { description: String(body.description) } : {}),
          ...(body.category !== undefined ? { category: String(body.category) } : {}),
          ...(body.status !== undefined ? { status: String(body.status) } : {}),
          ...(body.linkedEntity !== undefined ? { linkedEntity: String(body.linkedEntity) } : {}),
          ...(body.isTemplate !== undefined ? { isTemplate: Boolean(body.isTemplate) } : {}),
          ...(body.allowAnonymous !== undefined ? { allowAnonymous: Boolean(body.allowAnonymous) } : {}),
          ...(Array.isArray(body.fieldsJson) ? { fieldsJson: body.fieldsJson } : {}),
          ...(body.settingsJson !== undefined ? { settingsJson: body.settingsJson } : {}),
          ...(body.unitId !== undefined ? { unitId: body.unitId } : {}),
          version: (existing.version || 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(customForms.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_FORM',
        entityType: 'custom_forms',
        entityId: String(updated.id),
        details: { version: updated.version, status: updated.status, fieldsCount: updated.fieldsJson.length },
        unitId: updated.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'updated', formId: updated.id });
      res.json({ form: updated });
    } catch (err) {
      console.error('PUT /api/forms/:id error:', err);
      res.status(500).json({ error: 'Erro ao atualizar formulário.' });
    }
  });

  // 5. DUPLICAR MODELO OU FORMULÁRIO EXISTENTE
  app.post('/api/forms/:id/duplicate', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID do formulário inválido.' });
      const [source] = await db.select().from(customForms).where(eq(customForms.id, id)).limit(1);
      if (!source) return res.status(404).json({ error: 'Modelo/formulário de origem não encontrado.' });
      if (!isUnitPermitted(req, source.unitId)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      const code = `FRM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const publicSlug = `${source.publicSlug || 'form'}-${crypto.randomBytes(2).toString('hex')}`;

      const [copy] = await db
        .insert(customForms)
        .values({
          code,
          title: `${source.title} (Cópia)`,
          description: source.description,
          category: source.category,
          status: 'rascunho',
          linkedEntity: source.linkedEntity,
          isTemplate: false,
          allowAnonymous: false,
          publicSlug,
          fieldsJson: (source.fieldsJson || []).map((f) => ({
            ...f,
            id: `fld_${crypto.randomBytes(4).toString('hex')}`,
          })),
          settingsJson: source.settingsJson || {},
          iviPromptOrigin: source.iviPromptOrigin,
          version: 1,
          unitId: req.activeUnitId || source.unitId,
          createdByUserId: req.authUser!.id,
          createdByName: req.authUser!.name,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DUPLICATE_FORM',
        entityType: 'custom_forms',
        entityId: String(copy.id),
        details: { sourceId: source.id, code: copy.code },
        unitId: copy.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'duplicated', formId: copy.id });
      res.status(201).json({ form: { ...copy, submissionsCount: 0 } });
    } catch (err) {
      console.error('POST /api/forms/:id/duplicate error:', err);
      res.status(500).json({ error: 'Erro ao duplicar formulário.' });
    }
  });

  // 6. EXCLUIR FORMULÁRIO
  app.delete('/api/forms/:id', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID do formulário inválido.' });
      const [existing] = await db.select().from(customForms).where(eq(customForms.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Formulário não encontrado.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      await db.delete(customForms).where(eq(customForms.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_FORM',
        entityType: 'custom_forms',
        entityId: String(id),
        details: { code: existing.code, title: existing.title },
        unitId: existing.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'deleted', formId: id });
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/forms/:id error:', err);
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Erro ao excluir formulário.') });
    }
  });

  // 7. PROTOCOLAR NOVA RESPOSTA DE FORMULÁRIO
  app.post('/api/forms/:id/submissions', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const formId = parsePositiveIntId(req.params.id);
      if (!formId) return res.status(400).json({ error: 'ID do formulário inválido.' });
      const [form] = await db.select().from(customForms).where(eq(customForms.id, formId)).limit(1);
      if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });
      if (!isUnitPermitted(req, form.unitId)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      const body = req.body as {
        clientId?: number | null;
        admissionId?: number | null;
        negotiationId?: number | null;
        unitId?: number | null;
        answersJson?: Record<string, unknown>;
        runIviAnalyze?: boolean;
      };

      const answers = body.answersJson && typeof body.answersJson === 'object' ? body.answersJson : {};
      const fields = Array.isArray(form.fieldsJson) ? form.fieldsJson : [];

      for (const f of fields) {
        if (f.type === 'section_header' || !f.required) continue;
        // Skip conditional fields whose condition is not met
        if (f.conditionalFieldId) {
          const parentField = fields.find((pf) => pf.id === f.conditionalFieldId);
          if (parentField) {
            const parentVal = String(answers[parentField.key] ?? '');
            if (parentVal !== String(f.conditionalEquals ?? '')) continue;
          }
        }
        const val = answers[f.key];
        const isEmpty =
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0);
        if (isEmpty) {
          return res.status(400).json({ error: `O campo obrigatório "${f.label}" não foi preenchido.` });
        }
      }

      let resolvedClientName = '';
      let parsedClientId: number | null = null;
      if (body.clientId !== undefined && body.clientId !== null && body.clientId !== ('' as unknown)) {
        parsedClientId = parsePositiveIntId(body.clientId);
        if (!parsedClientId) return res.status(400).json({ error: 'ID do cliente inválido.' });
        const [cl] = await db
          .select({ id: clients.id, fullName: clients.fullName, unitId: clients.unitId })
          .from(clients)
          .where(eq(clients.id, parsedClientId))
          .limit(1);
        if (!cl) return res.status(404).json({ error: 'Cliente informado não encontrado.' });
        if (!isUnitPermitted(req, cl.unitId)) {
          return res.status(403).json({ error: 'Cliente pertence a uma unidade não autorizada.' });
        }
        resolvedClientName = cl.fullName;
      }

      const targetUnitId = body.unitId ? parsePositiveIntId(body.unitId) : (req.activeUnitId ?? 1);
      if (!targetUnitId) return res.status(400).json({ error: 'Unidade inválida.' });
      if (!isUnitPermitted(req, targetUnitId)) {
        return res.status(403).json({ error: 'Acesso negado para a unidade informada.' });
      }

      const calculatedScore = computeSubmissionScore(fields, answers);
      const protocolCode = `RESP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      let iviSummary = '';
      let iviClassification = '';
      if (body.runIviAnalyze || form.settingsJson?.iviAutoAnalyze) {
        const analysis = await iviAnalyzeFormSubmission({
          formTitle: form.title,
          formCategory: form.category,
          clientName: resolvedClientName,
          fields,
          answers,
        });
        iviSummary = `${analysis.summary}${analysis.recommendedAction ? ` Próxima ação: ${analysis.recommendedAction}` : ''}`;
        iviClassification = analysis.classification;
      }

      const [submission] = await db
        .insert(customFormSubmissions)
        .values({
          formId: form.id,
          protocolCode,
          unitId: targetUnitId,
          clientId: parsedClientId,
          clientName: resolvedClientName,
          admissionId: body.admissionId ? Number(body.admissionId) : null,
          negotiationId: body.negotiationId ? Number(body.negotiationId) : null,
          status: form.settingsJson?.requiresReview === false ? 'aprovado' : 'recebido',
          answersJson: answers,
          calculatedScore,
          iviSummary,
          iviClassification,
          submittedByUserId: req.authUser!.id,
          submittedByName: req.authUser!.name,
          sourceChannel: 'interno',
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'SUBMIT_FORM_RESPONSE',
        entityType: 'custom_form_submissions',
        entityId: String(submission.id),
        details: { formId: form.id, protocolCode, clientId: submission.clientId },
        unitId: targetUnitId,
      });

      deps.broadcast('forms_updated', { action: 'submitted', formId: form.id, submissionId: submission.id });
      res.status(201).json({
        submission: {
          ...submission,
          formTitle: form.title,
          formCode: form.code,
        },
      });
    } catch (err) {
      console.error('POST /api/forms/:id/submissions error:', err);
      res.status(500).json({ error: 'Erro ao protocolar resposta do formulário.' });
    }
  });

  // 8. TRIAGEM E REVISÃO DE RESPOSTA
  app.patch('/api/forms/submissions/:subId', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const subId = parsePositiveIntId(req.params.subId);
      if (!subId) return res.status(400).json({ error: 'ID da resposta inválido.' });
      const [existing] = await db
        .select()
        .from(customFormSubmissions)
        .where(eq(customFormSubmissions.id, subId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Resposta não encontrada.' });
      if (!isUnitPermitted(req, existing.unitId)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      const body = req.body as { status?: string; reviewedNotes?: string };
      const allowedStatuses = ['recebido', 'em_analise', 'aprovado', 'pendente_ajuste', 'arquivado'];
      const nextStatus =
        body.status && allowedStatuses.includes(body.status) ? body.status : existing.status;

      const [updated] = await db
        .update(customFormSubmissions)
        .set({
          status: nextStatus,
          ...(body.reviewedNotes !== undefined ? { reviewedNotes: String(body.reviewedNotes) } : {}),
          reviewedByName: req.authUser!.name,
          updatedAt: new Date(),
        })
        .where(eq(customFormSubmissions.id, subId))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'REVIEW_FORM_SUBMISSION',
        entityType: 'custom_form_submissions',
        entityId: String(updated.id),
        details: { status: updated.status },
        unitId: updated.unitId || req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'reviewed', submissionId: updated.id });
      res.json({ submission: updated });
    } catch (err) {
      console.error('PATCH /api/forms/submissions/:subId error:', err);
      res.status(500).json({ error: 'Erro ao atualizar triagem da resposta.' });
    }
  });

  // 9. ANALISAR RESPOSTA SOB DEMANDA COM IVI IA
  app.post('/api/forms/submissions/:subId/ivi-analyze', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const subId = parsePositiveIntId(req.params.subId);
      if (!subId) return res.status(400).json({ error: 'ID da resposta inválido.' });
      const [sub] = await db
        .select()
        .from(customFormSubmissions)
        .where(eq(customFormSubmissions.id, subId))
        .limit(1);
      if (!sub) return res.status(404).json({ error: 'Resposta não encontrada.' });
      if (!isUnitPermitted(req, sub.unitId)) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      const [form] = await db.select().from(customForms).where(eq(customForms.id, sub.formId)).limit(1);
      if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });

      const analysis = await iviAnalyzeFormSubmission({
        formTitle: form.title,
        formCategory: form.category,
        clientName: sub.clientName,
        fields: form.fieldsJson || [],
        answers: sub.answersJson || {},
      });

      const [updated] = await db
        .update(customFormSubmissions)
        .set({
          iviSummary: `${analysis.summary}${analysis.recommendedAction ? ` Próxima ação: ${analysis.recommendedAction}` : ''}`,
          iviClassification: analysis.classification,
          updatedAt: new Date(),
        })
        .where(eq(customFormSubmissions.id, subId))
        .returning();

      res.json({ submission: updated, analysis });
    } catch (err) {
      console.error('POST /api/forms/submissions/:subId/ivi-analyze error:', err);
      res.status(500).json({ error: 'Erro ao analisar resposta com a Ivi IA.' });
    }
  });

  // 10. EXPORTAR RESPOSTAS EM CSV SEGURO (EXCEL PT-BR)
  app.get('/api/forms/:id/export-csv', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const formId = parsePositiveIntId(req.params.id);
      if (!formId) return res.status(400).json({ error: 'ID do formulário inválido.' });
      const [form] = await db.select().from(customForms).where(eq(customForms.id, formId)).limit(1);
      if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });
      if (!isUnitPermitted(req, form.unitId)) return res.status(403).json({ error: 'Acesso negado.' });

      const unitScope = getAllowedUnitScope(req);
      const rows = unitScope
        ? await db
            .select()
            .from(customFormSubmissions)
            .where(and(eq(customFormSubmissions.formId, formId), inArray(customFormSubmissions.unitId, unitScope)))
            .orderBy(desc(customFormSubmissions.createdAt))
        : await db
            .select()
            .from(customFormSubmissions)
            .where(eq(customFormSubmissions.formId, formId))
            .orderBy(desc(customFormSubmissions.createdAt));

      const dataFields = (form.fieldsJson || []).filter((f) => f.type !== 'section_header');
      const headers = [
        'Protocolo',
        'Data',
        'Status',
        'Cliente',
        'Responsavel',
        'Score',
        'Classificacao Ivi',
        ...dataFields.map((f) => f.label),
      ];

      const lines = rows.map((r) => [
        r.protocolCode,
        new Date(r.createdAt).toLocaleString('pt-BR'),
        r.status,
        r.clientName || '—',
        r.submittedByName,
        r.calculatedScore !== null && r.calculatedScore !== undefined ? `${r.calculatedScore}%` : '—',
        r.iviClassification || '—',
        ...dataFields.map((f) => formatAnswerForExport((r.answersJson || {})[f.key])),
      ]);

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'EXPORT_FORM_CSV',
        entityType: 'custom_forms',
        entityId: String(formId),
        details: { rowsExported: lines.length },
        unitId: req.activeUnitId || 1,
      });

      const csv = [headers, ...lines].map((row) => row.map(sanitizeCsvCell).join(';')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="formulario_${form.code}.csv"`);
      res.send(`\uFEFF${csv}`);
    } catch (err) {
      console.error('GET /api/forms/:id/export-csv error:', err);
      res.status(500).json({ error: 'Erro ao exportar CSV das respostas.' });
    }
  });

  // 11. ENDPOINT PÚBLICO OPCIONAL (SOMENTE PARA FORMULÁRIOS COM allowAnonymous=true)
  app.get('/api/public/forms/:slug', async (req: Request, res: Response) => {
    try {
      await ensureFormsSeed();
      const slug = String(req.params.slug || '').trim();
      const [form] = await db
        .select({
          id: customForms.id,
          code: customForms.code,
          title: customForms.title,
          description: customForms.description,
          status: customForms.status,
          allowAnonymous: customForms.allowAnonymous,
          fieldsJson: customForms.fieldsJson,
          settingsJson: customForms.settingsJson,
        })
        .from(customForms)
        .where(eq(customForms.publicSlug, slug))
        .limit(1);

      if (!form || form.status !== 'publicado' || !form.allowAnonymous) {
        return res.status(404).json({ error: 'Formulário público indisponível ou não publicado.' });
      }

      res.json({ form });
    } catch (err) {
      console.error('GET /api/public/forms/:slug error:', err);
      res.status(500).json({ error: 'Erro ao carregar formulário público.' });
    }
  });

  // =========================================================================
  // 12. GERENCIADOR DE MODELOS A4 (form_templates - PostgreSQL UUID)
  // =========================================================================

  // 12.1 Listar modelos por rotina vinculada (para módulos consumidores Admissão, Auditoria, Jurídico, etc.)
  app.get('/api/form-templates/by-menu/:menuId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      await ensureFormTemplatesSeed();
      const menuId = String(req.params.menuId || '').trim();
      if (!menuId) return res.status(400).json({ error: 'menuId é obrigatório.' });

      const rows = await db
        .select()
        .from(formTemplates)
        .where(sql`${formTemplates.menuIds} @> ${JSON.stringify([menuId])}::jsonb`)
        .orderBy(asc(formTemplates.name));

      res.json({ items: rows });
    } catch (err) {
      console.error('GET /api/form-templates/by-menu/:menuId error:', err);
      res.status(500).json({ error: 'Erro ao listar modelos vinculados à rotina.' });
    }
  });

  // 12.2 Dados reais para pré-visualização / teste de preenchimento de variáveis no editor
  app.get('/api/form-templates/context-data', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const unitScope = getAllowedUnitScope(req);
      const [
        clientRows,
        admissionRows,
        legalRows,
        collaboratorRows,
        bankRows,
        unitRows,
        modalityRows,
        productRows,
        serviceRows,
        bankAccountRows,
        docTypeRows,
        bearerRows,
        coaRows,
        departmentRows,
        seriesRows,
      ] = await Promise.all([
        unitScope
          ? db.select().from(clients).where(inArray(clients.unitId, unitScope)).orderBy(asc(clients.fullName)).limit(100)
          : db.select().from(clients).orderBy(asc(clients.fullName)).limit(100),
        unitScope
          ? db.select().from(admissions).where(inArray(admissions.unitId, unitScope)).orderBy(desc(admissions.id)).limit(100)
          : db.select().from(admissions).orderBy(desc(admissions.id)).limit(100),
        unitScope
          ? db.select().from(legalProcesses).where(inArray(legalProcesses.unitId, unitScope)).orderBy(desc(legalProcesses.id)).limit(80)
          : db.select().from(legalProcesses).orderBy(desc(legalProcesses.id)).limit(80),
        db.select().from(collaborators).orderBy(asc(collaborators.name)).limit(100),
        db.select().from(banks).orderBy(asc(banks.name)).limit(100),
        db.select().from(units).orderBy(asc(units.id)),
        db.select().from(modalities).orderBy(asc(modalities.id)).limit(50),
        db.select().from(products).orderBy(asc(products.id)).limit(50),
        db.select().from(scheduleServices).orderBy(asc(scheduleServices.id)).limit(50),
        db.select().from(bankAccounts).orderBy(asc(bankAccounts.id)).limit(50),
        db.select().from(documentTypes).orderBy(asc(documentTypes.id)).limit(50),
        db.select().from(bearers).orderBy(asc(bearers.id)).limit(50),
        db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.id)).limit(50),
        db.select().from(departments).orderBy(asc(departments.id)).limit(50),
        db.select().from(seriesCatalog).orderBy(asc(seriesCatalog.id)).limit(50),
      ]);

      res.json({
        clients: clientRows,
        admissions: admissionRows,
        legalProcesses: legalRows,
        collaborators: collaboratorRows,
        banks: bankRows,
        units: unitRows,
        modalities: modalityRows,
        products: productRows,
        services: serviceRows,
        bankAccounts: bankAccountRows,
        documentTypes: docTypeRows,
        bearers: bearerRows,
        chartOfAccounts: coaRows,
        departments: departmentRows,
        series: seriesRows,
      });
    } catch (err) {
      console.error('GET /api/form-templates/context-data error:', err);
      res.status(500).json({ error: 'Erro ao carregar dados de contexto para pré-visualização.' });
    }
  });

  // 12.3 Importar arquivo .docx -> HTML via mammoth + Base64 para preservação de layout Word
  app.post(
    '/api/form-templates/import-docx',
    requireAuth,
    requireModule('forms'),
    modelUpload.single('file'),
    async (req: AuthRequest, res: Response) => {
      try {
        const uploaded = req.file;
        if (!uploaded) {
          return res.status(400).json({ error: 'Nenhum arquivo .docx foi enviado.' });
        }
        const nameLower = String(uploaded.originalname || '').toLowerCase();
        if (nameLower.endsWith('.doc') && !nameLower.endsWith('.docx')) {
          return res.status(400).json({
            error: 'Arquivos .doc antigos não são suportados. Salve como .docx no Word e tente novamente.',
          });
        }
        if (!nameLower.endsWith('.docx')) {
          return res.status(400).json({ error: 'Formato inválido. Selecione um arquivo .docx válido.' });
        }

        const result = await mammoth.convertToHtml(
          { buffer: uploaded.buffer },
          {
            styleMap: [
              "p[style-name='Title'] => h1:fresh",
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
            ],
          }
        );

        res.json({
          html: result.value || '<p></p>',
          docxTemplate: uploaded.buffer.toString('base64'),
          fileName: uploaded.originalname,
          warnings: (result.messages || []).map((m) => m.message),
        });
      } catch (err) {
        console.error('POST /api/form-templates/import-docx error:', err);
        res.status(500).json({ error: 'Erro ao converter arquivo .docx. Verifique se o documento é válido.' });
      }
    }
  );

  // 12.4 Listar modelos A4 com busca e paginação
  app.get('/api/form-templates', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      await ensureFormTemplatesSeed();
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
      const search = String(req.query.search || '').trim();
      const offset = (page - 1) * limit;

      const filterClause = search
        ? or(ilike(formTemplates.name, `%${search}%`), ilike(formTemplates.description, `%${search}%`))
        : undefined;

      const [rows, countRes] = await Promise.all([
        filterClause
          ? db
              .select()
              .from(formTemplates)
              .where(filterClause)
              .orderBy(desc(formTemplates.updatedAt), desc(formTemplates.createdAt))
              .limit(limit)
              .offset(offset)
          : db
              .select()
              .from(formTemplates)
              .orderBy(desc(formTemplates.updatedAt), desc(formTemplates.createdAt))
              .limit(limit)
              .offset(offset),
        filterClause
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(formTemplates)
              .where(filterClause)
          : db.select({ count: sql<number>`count(*)::int` }).from(formTemplates),
      ]);

      const total = countRes[0]?.count ?? 0;
      res.json({
        items: rows,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err) {
      console.error('GET /api/form-templates error:', err);
      res.status(500).json({ error: 'Erro ao listar modelos de formulários A4.' });
    }
  });

  // 12.5 Obter modelo A4 por UUID
  app.get('/api/form-templates/:id', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!isValidUuid(id)) {
        return res.status(400).json({ error: 'Identificador UUID do modelo inválido.' });
      }
      const [row] = await db.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: 'Formulário não encontrado.' });
      res.json({ item: row });
    } catch (err) {
      console.error('GET /api/form-templates/:id error:', err);
      res.status(500).json({ error: 'Erro ao buscar modelo de formulário.' });
    }
  });

  // 12.6 Criar modelo A4
  app.post('/api/form-templates', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as Partial<{
        id: string;
        name: string;
        description: string;
        content: string;
        header: string;
        footer: string;
        menuIds: string[];
        docxTemplate: string | null;
      }>;

      const name = String(body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'O nome do formulário é obrigatório.' });
      }
      if (name.length > 255) {
        return res.status(400).json({ error: 'O nome do formulário deve ter no máximo 255 caracteres.' });
      }

      const menuIds = Array.isArray(body.menuIds)
        ? Array.from(new Set(body.menuIds.map((m) => String(m).trim()).filter(Boolean)))
        : [];

      const [created] = await db
        .insert(formTemplates)
        .values({
          name,
          description: String(body.description || '').trim(),
          content: String(body.content || ''),
          header: String(body.header || ''),
          footer: String(body.footer || ''),
          menuIds,
          docxTemplate: body.docxTemplate ? String(body.docxTemplate) : null,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_FORM_TEMPLATE',
        entityType: 'form_templates',
        entityId: created.id,
        details: { name: created.name, menuIds: created.menuIds },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'template_created', templateId: created.id });
      res.status(201).json({ item: created });
    } catch (err) {
      console.error('POST /api/form-templates error:', err);
      res.status(500).json({ error: 'Erro ao criar modelo de formulário.' });
    }
  });

  // 12.7 Atualizar modelo A4
  app.put('/api/form-templates/:id', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!isValidUuid(id)) {
        return res.status(400).json({ error: 'Identificador UUID inválido.' });
      }

      const [existing] = await db.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Formulário não encontrado.' });

      const body = req.body as Partial<{
        name: string;
        description: string;
        content: string;
        header: string;
        footer: string;
        menuIds: string[];
        docxTemplate: string | null;
      }>;

      let nextName = existing.name;
      if (body.name !== undefined) {
        nextName = String(body.name || '').trim();
        if (!nextName) {
          return res.status(400).json({ error: 'O nome do formulário é obrigatório.' });
        }
        if (nextName.length > 255) {
          return res.status(400).json({ error: 'O nome do formulário deve ter no máximo 255 caracteres.' });
        }
      }

      const nextMenuIds =
        body.menuIds !== undefined
          ? Array.isArray(body.menuIds)
            ? Array.from(new Set(body.menuIds.map((m) => String(m).trim()).filter(Boolean)))
            : []
          : existing.menuIds;

      const [updated] = await db
        .update(formTemplates)
        .set({
          name: nextName,
          ...(body.description !== undefined ? { description: String(body.description || '') } : {}),
          ...(body.content !== undefined ? { content: String(body.content || '') } : {}),
          ...(body.header !== undefined ? { header: String(body.header || '') } : {}),
          ...(body.footer !== undefined ? { footer: String(body.footer || '') } : {}),
          menuIds: nextMenuIds,
          ...(body.docxTemplate !== undefined
            ? { docxTemplate: body.docxTemplate ? String(body.docxTemplate) : null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(formTemplates.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_FORM_TEMPLATE',
        entityType: 'form_templates',
        entityId: updated.id,
        details: { name: updated.name, menuIds: updated.menuIds },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'template_updated', templateId: updated.id });
      res.json({ item: updated });
    } catch (err) {
      console.error('PUT /api/form-templates/:id error:', err);
      res.status(500).json({ error: 'Erro ao atualizar modelo de formulário.' });
    }
  });

  // 12.8 Duplicar modelo A4
  app.post('/api/form-templates/:id/duplicate', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!isValidUuid(id)) {
        return res.status(400).json({ error: 'Identificador UUID inválido.' });
      }
      const [source] = await db.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1);
      if (!source) return res.status(404).json({ error: 'Formulário de origem não encontrado.' });

      const baseName = source.name.slice(0, 240);
      const [copy] = await db
        .insert(formTemplates)
        .values({
          name: `${baseName} (Cópia)`,
          description: source.description,
          content: source.content,
          header: source.header,
          footer: source.footer,
          menuIds: source.menuIds || [],
          docxTemplate: source.docxTemplate ?? null,
        })
        .returning();

      deps.broadcast('forms_updated', { action: 'template_duplicated', templateId: copy.id });
      res.status(201).json({ item: copy });
    } catch (err) {
      console.error('POST /api/form-templates/:id/duplicate error:', err);
      res.status(500).json({ error: 'Erro ao duplicar modelo de formulário.' });
    }
  });

  // 12.9 Excluir modelo A4 (físico)
  app.delete('/api/form-templates/:id', requireAuth, requireModule('forms'), async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!isValidUuid(id)) {
        return res.status(400).json({ error: 'Identificador UUID inválido.' });
      }
      const [existing] = await db.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Formulário não encontrado.' });

      await db.delete(formTemplates).where(eq(formTemplates.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_FORM_TEMPLATE',
        entityType: 'form_templates',
        entityId: id,
        details: { name: existing.name },
        unitId: req.activeUnitId || 1,
      });

      deps.broadcast('forms_updated', { action: 'template_deleted', templateId: id });
      res.json({ success: true, message: 'Formulário excluído com sucesso' });
    } catch (err) {
      console.error('DELETE /api/form-templates/:id error:', err);
      res.status(500).json({ error: 'Erro ao excluir modelo de formulário.' });
    }
  });

  // 12.10 Renderizar .docx salvo preenchendo variáveis dinâmicas
  app.post('/api/form-templates/:id/render-docx', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!isValidUuid(id)) {
        return res.status(400).json({ error: 'Identificador UUID inválido.' });
      }
      const [tpl] = await db.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1);
      if (!tpl) return res.status(404).json({ error: 'Modelo de formulário não encontrado.' });
      if (!tpl.docxTemplate) {
        return res.status(400).json({ error: 'Este modelo não possui arquivo Word (.docx) embutido.' });
      }

      const body = req.body as { vars?: Record<string, string>; fileName?: string };
      const vars = body.vars && typeof body.vars === 'object' ? body.vars : {};
      const inputBuf = Buffer.from(tpl.docxTemplate, 'base64');
      const outputBuf = fillDocxTemplateBuffer(inputBuf, vars);

      const safeFile = String(body.fileName || tpl.name || 'documento')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_');

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeFile}.docx"`);
      res.send(outputBuf);
    } catch (err) {
      console.error('POST /api/form-templates/:id/render-docx error:', err);
      res.status(500).json({ error: 'Erro ao renderizar arquivo Word (.docx) a partir do modelo.' });
    }
  });
}

