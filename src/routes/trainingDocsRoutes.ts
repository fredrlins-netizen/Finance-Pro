import { Express } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  iviAudioCache,
  iviKnowledgeArticles,
  systemModuleDocs,
  trainingSessions,
  type SystemDocFieldDef,
  type SystemDocIntegrationDef,
  type SystemDocTrainingStep,
  type TrainingQaHistoryEntry,
} from '../db/schema.ts';
import { AuthRequest, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { ensureSystemModuleDocsSeed } from '../services/systemDocsCatalog.ts';
import {
  iviAnswerFromDocumentation,
  iviSynthesizeSpeechCached,
  iviTranscribeAudioNote,
} from '../services/ivi.ts';
import { parsePositiveIntId } from '../utils/validation.ts';

function normalizeKbScope(raw: unknown): 'prospection' | 'system_doc' | 'learned_insight' {
  const s = String(raw || '').trim();
  if (s === 'system_doc' || s === 'learned_insight' || s === 'prospection') return s;
  return 'prospection';
}

export function registerTrainingDocsRoutes(app: Express) {
  // ---------------------------------------------------------------------------
  // DOCUMENTAÇÃO DO SISTEMA (MÓDULOS, CAMPOS, TELAS E INTEGRAÇÃO)
  // ---------------------------------------------------------------------------
  app.get('/api/docs/modules', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureSystemModuleDocsSeed();
      const includeInactive = req.query.includeInactive === '1' && req.authUser?.role === 'admin';

      const [rawDocs, rawArticles, audioStatsRows] = await Promise.all([
        db.select().from(systemModuleDocs).orderBy(asc(systemModuleDocs.sortOrder), asc(systemModuleDocs.id)),
        db.select().from(iviKnowledgeArticles).orderBy(desc(iviKnowledgeArticles.hitCount), desc(iviKnowledgeArticles.id)),
        db
          .select({
            count: sql<number>`count(*)::int`,
            totalHits: sql<number>`coalesce(sum(${iviAudioCache.hitCount}), 0)::int`,
            totalTokensSaved: sql<number>`coalesce(sum(${iviAudioCache.tokensSavedEstimate}), 0)::int`,
            totalBytes: sql<number>`coalesce(sum(${iviAudioCache.sizeBytes}), 0)::int`,
          })
          .from(iviAudioCache),
      ]);

      const modules = includeInactive ? rawDocs : rawDocs.filter((d) => d.active);
      const knowledgeArticles = includeInactive ? rawArticles : rawArticles.filter((k) => k.active);

      const integrationGraph = {
        nodes: modules.map((m) => ({
          moduleKey: m.moduleKey,
          title: m.title,
          menuGroup: m.menuGroup,
          inputsCount: (m.integrationsJson?.inputsFrom || []).length,
          outputsCount: (m.integrationsJson?.outputsTo || []).length,
        })),
        edges: modules.flatMap((m) =>
          (m.integrationsJson?.outputsTo || []).map((out) => ({
            from: m.moduleKey,
            to: out.moduleKey,
            label: out.label,
            description: out.description,
          }))
        ),
      };

      res.json({
        modules,
        knowledgeArticles,
        audioCacheStats: audioStatsRows[0] || {
          count: 0,
          totalHits: 0,
          totalTokensSaved: 0,
          totalBytes: 0,
        },
        integrationGraph,
      });
    } catch (error) {
      console.error('GET /api/docs/modules error:', error);
      res.status(500).json({ error: 'Erro ao carregar documentação modular da Ivi.' });
    }
  });

  app.post('/api/docs/modules', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      await ensureSystemModuleDocsSeed();
      const body = req.body as {
        moduleKey?: string;
        title?: string;
        menuGroup?: string;
        menuPath?: string;
        sortOrder?: number;
        summary?: string;
        objective?: string;
        screenshotUrl?: string;
        fieldsJson?: SystemDocFieldDef[];
        integrationsJson?: SystemDocIntegrationDef;
        trainingStepsJson?: SystemDocTrainingStep[];
        active?: boolean;
      };
      const cleanKey = String(body.moduleKey || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const cleanTitle = String(body.title || '').trim();
      if (!cleanKey || !cleanTitle) {
        return res.status(400).json({ error: 'Informe a chave e o título do módulo.' });
      }

      const [created] = await db
        .insert(systemModuleDocs)
        .values({
          moduleKey: cleanKey,
          title: cleanTitle,
          menuGroup: String(body.menuGroup || 'Operação & Tratativa').trim(),
          menuPath: String(body.menuPath || cleanTitle).trim(),
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 99,
          summary: String(body.summary || '').trim(),
          objective: String(body.objective || '').trim(),
          screenshotUrl: String(body.screenshotUrl || '/assets/module-docs/overview.png').trim(),
          fieldsJson: Array.isArray(body.fieldsJson) ? body.fieldsJson : [],
          integrationsJson: body.integrationsJson || { inputsFrom: [], outputsTo: [] },
          trainingStepsJson: Array.isArray(body.trainingStepsJson) ? body.trainingStepsJson : [],
          active: body.active !== false,
          updatedByName: req.authUser!.name,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CRIAR_DOC_MODULO',
        entityType: 'system_module_docs',
        entityId: String(created.id),
        details: { moduleKey: created.moduleKey, title: created.title },
        unitId: req.activeUnitId,
      });

      res.json({ module: created });
    } catch (error) {
      console.error('POST /api/docs/modules error:', error);
      res.status(500).json({ error: 'Erro ao criar documentação de módulo.' });
    }
  });

  app.put('/api/docs/modules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db.select().from(systemModuleDocs).where(eq(systemModuleDocs.id, id)).limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Módulo não encontrado na documentação.' });

      const body = req.body as Partial<typeof existing>;
      const [updated] = await db
        .update(systemModuleDocs)
        .set({
          title: body.title !== undefined ? String(body.title).trim() : existing.title,
          menuGroup: body.menuGroup !== undefined ? String(body.menuGroup).trim() : existing.menuGroup,
          menuPath: body.menuPath !== undefined ? String(body.menuPath).trim() : existing.menuPath,
          sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sortOrder,
          summary: body.summary !== undefined ? String(body.summary).trim() : existing.summary,
          objective: body.objective !== undefined ? String(body.objective).trim() : existing.objective,
          screenshotUrl: body.screenshotUrl !== undefined ? String(body.screenshotUrl).trim() : existing.screenshotUrl,
          fieldsJson: Array.isArray(body.fieldsJson) ? body.fieldsJson : existing.fieldsJson,
          integrationsJson: body.integrationsJson || existing.integrationsJson,
          trainingStepsJson: Array.isArray(body.trainingStepsJson) ? body.trainingStepsJson : existing.trainingStepsJson,
          active: body.active !== undefined ? Boolean(body.active) : existing.active,
          updatedByName: req.authUser!.name,
          updatedAt: new Date(),
        })
        .where(eq(systemModuleDocs.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'ATUALIZAR_DOC_MODULO',
        entityType: 'system_module_docs',
        entityId: String(id),
        details: {
          previousLabel: existing.title,
          newLabel: updated.title,
          moduleKey: updated.moduleKey,
          fieldsCount: (updated.fieldsJson || []).length,
        },
        unitId: req.activeUnitId,
      });

      res.json({ module: updated });
    } catch (error) {
      console.error('PUT /api/docs/modules/:id error:', error);
      res.status(500).json({ error: 'Erro ao atualizar documentação de módulo.' });
    }
  });

  app.delete('/api/docs/modules/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db.select().from(systemModuleDocs).where(eq(systemModuleDocs.id, id)).limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Módulo não encontrado.' });

      await db.delete(systemModuleDocs).where(eq(systemModuleDocs.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'EXCLUIR_DOC_MODULO',
        entityType: 'system_module_docs',
        entityId: String(id),
        details: { moduleKey: existing.moduleKey, title: existing.title },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/docs/modules/:id error:', error);
      res.status(500).json({ error: 'Erro ao remover documentação de módulo.' });
    }
  });

  // ---------------------------------------------------------------------------
  // BASE DE CONHECIMENTO IVI (DOCUMENTAÇÃO, APRENDIZADO E PROSPECÇÃO — CRUD ADMIN)
  // ---------------------------------------------------------------------------
  app.get('/api/ivi/knowledge', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureSystemModuleDocsSeed();
      const scope = String(req.query.scope || 'all').trim();
      const includeInactive = req.query.includeInactive === '1' && req.authUser?.role === 'admin';

      const rows = await db
        .select()
        .from(iviKnowledgeArticles)
        .orderBy(desc(iviKnowledgeArticles.hitCount), desc(iviKnowledgeArticles.id));

      const filtered = rows.filter((item) => {
        if (!includeInactive && !item.active) return false;
        if (scope === 'all' || !scope) return true;
        return item.scope === scope;
      });

      res.json({ articles: filtered });
    } catch (error) {
      console.error('GET /api/ivi/knowledge error:', error);
      res.status(500).json({ error: 'Erro ao listar base de conhecimento da Ivi.' });
    }
  });

  app.post('/api/ivi/knowledge', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      await ensureSystemModuleDocsSeed();
      const body = req.body as {
        scope?: string;
        moduleKey?: string;
        questionPattern?: string;
        answerTemplate?: string;
        category?: string;
        sourceChannel?: string;
        active?: boolean;
      };
      const questionPattern = String(body.questionPattern || '').trim();
      const answerTemplate = String(body.answerTemplate || '').trim();
      if (!questionPattern || !answerTemplate) {
        return res.status(400).json({ error: 'Informe a pergunta/título e a resposta oficial da Ivi.' });
      }

      const [created] = await db
        .insert(iviKnowledgeArticles)
        .values({
          scope: normalizeKbScope(body.scope),
          moduleKey: String(body.moduleKey || '').trim(),
          questionPattern,
          answerTemplate,
          category: String(body.category || 'orientacao').trim(),
          sourceChannel: String(body.sourceChannel || 'admin_manual').trim(),
          hitCount: 1,
          updatedByName: req.authUser!.name,
          active: body.active !== false,
        })
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CRIAR_KB_IVI',
        entityType: 'ivi_knowledge_articles',
        entityId: String(created.id),
        details: { scope: created.scope, moduleKey: created.moduleKey, questionPattern: created.questionPattern },
        unitId: req.activeUnitId,
      });

      res.json({ article: created });
    } catch (error) {
      console.error('POST /api/ivi/knowledge error:', error);
      res.status(500).json({ error: 'Erro ao incluir item na base da Ivi.' });
    }
  });

  app.put('/api/ivi/knowledge/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db
        .select()
        .from(iviKnowledgeArticles)
        .where(eq(iviKnowledgeArticles.id, id))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Artigo não encontrado.' });

      const body = req.body as Partial<typeof existing>;
      const [updated] = await db
        .update(iviKnowledgeArticles)
        .set({
          scope: body.scope !== undefined ? normalizeKbScope(body.scope) : existing.scope,
          moduleKey: body.moduleKey !== undefined ? String(body.moduleKey).trim() : existing.moduleKey,
          questionPattern:
            body.questionPattern !== undefined ? String(body.questionPattern).trim() : existing.questionPattern,
          answerTemplate:
            body.answerTemplate !== undefined ? String(body.answerTemplate).trim() : existing.answerTemplate,
          category: body.category !== undefined ? String(body.category).trim() : existing.category,
          sourceChannel: body.sourceChannel !== undefined ? String(body.sourceChannel).trim() : existing.sourceChannel,
          active: body.active !== undefined ? Boolean(body.active) : existing.active,
          updatedByName: req.authUser!.name,
          updatedAt: new Date(),
        })
        .where(eq(iviKnowledgeArticles.id, id))
        .returning();

      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'EDITAR_KB_IVI',
        entityType: 'ivi_knowledge_articles',
        entityId: String(id),
        details: {
          previousQuestion: existing.questionPattern,
          newQuestion: updated.questionPattern,
          scope: updated.scope,
          active: updated.active,
        },
        unitId: req.activeUnitId,
      });

      res.json({ article: updated });
    } catch (error) {
      console.error('PUT /api/ivi/knowledge/:id error:', error);
      res.status(500).json({ error: 'Erro ao atualizar artigo na base da Ivi.' });
    }
  });

  app.delete('/api/ivi/knowledge/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db
        .select()
        .from(iviKnowledgeArticles)
        .where(eq(iviKnowledgeArticles.id, id))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Artigo não encontrado.' });

      await db.delete(iviKnowledgeArticles).where(eq(iviKnowledgeArticles.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'EXCLUIR_KB_IVI',
        entityType: 'ivi_knowledge_articles',
        entityId: String(id),
        details: {
          scope: existing.scope,
          questionPattern: existing.questionPattern,
          answerTemplate: existing.answerTemplate.slice(0, 140),
        },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/ivi/knowledge/:id error:', error);
      res.status(500).json({ error: 'Erro ao excluir item da base da Ivi.' });
    }
  });

  // ---------------------------------------------------------------------------
  // CONSULTA À IVI BASEADA NA DOCUMENTAÇÃO + APRENDIZADO COERENTE + GEMINI AUDIO
  // ---------------------------------------------------------------------------
  app.post('/api/ivi/doc-ask', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureSystemModuleDocsSeed();
      const {
        question,
        moduleKey,
        traineeName,
        allowLearn,
        withAudio,
        lessonMode,
        currentFieldLabel,
        currentFieldDescription,
        voiceName,
      } = req.body as {
        question?: string;
        moduleKey?: string;
        traineeName?: string;
        allowLearn?: boolean;
        withAudio?: boolean;
        lessonMode?: boolean;
        currentFieldLabel?: string;
        currentFieldDescription?: string;
        voiceName?: string;
      };
      if (!String(question || '').trim()) {
        return res.status(400).json({ error: 'Digite ou grave uma pergunta para consultar a Ivi.' });
      }

      const result = await iviAnswerFromDocumentation({
        question: String(question),
        moduleKey,
        traineeName,
        allowLearn: Boolean(allowLearn),
        learnedByName: req.authUser!.name,
        withAudio: Boolean(withAudio),
        lessonMode: Boolean(lessonMode),
        currentFieldLabel,
        currentFieldDescription,
        voiceName,
      });

      res.json(result);
    } catch (error) {
      console.error('POST /api/ivi/doc-ask error:', error);
      res.status(500).json({ error: 'Erro ao consultar documentação com a Ivi.' });
    }
  });

  app.post('/api/ivi/tts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { text, voiceName, sourceType, moduleKey } = req.body as {
        text?: string;
        voiceName?: string;
        sourceType?: 'training' | 'static_doc' | 'prospection';
        moduleKey?: string;
      };
      if (!String(text || '').trim()) {
        return res.status(400).json({ error: 'Informe o texto para leitura em áudio.' });
      }
      const tts = await iviSynthesizeSpeechCached({
        text: String(text),
        voiceName: voiceName || 'Aoede',
        sourceType: sourceType || 'training',
        moduleKey: moduleKey || '',
        createdByName: req.authUser!.name,
      });
      res.json({
        cacheHash: tts.cacheHash,
        audioUrl: tts.audioBase64 ? `/api/ivi/audio/${tts.cacheHash}` : '',
        mimeType: tts.mimeType,
        sizeBytes: tts.sizeBytes,
        cached: tts.cached,
        hitCount: tts.hitCount,
        tokensSavedEstimate: tts.tokensSavedEstimate,
        model: tts.model,
        unavailableReason: tts.unavailableReason,
      });
    } catch (error) {
      console.error('POST /api/ivi/tts error:', error);
      res.status(500).json({ error: 'Erro ao sintetizar áudio Gemini.' });
    }
  });

  app.get('/api/ivi/audio/:hash', requireAuth, async (req: AuthRequest, res) => {
    try {
      const cacheHash = String(req.params.hash || '').trim();
      if (!cacheHash || !/^[a-f0-9]{16,128}$/i.test(cacheHash)) {
        return res.status(400).json({ error: 'Hash de áudio inválido.' });
      }
      const rows = await db
        .select()
        .from(iviAudioCache)
        .where(eq(iviAudioCache.cacheHash, cacheHash))
        .limit(1);
      const item = rows[0];
      if (!item || !item.audioBase64) {
        return res.status(404).json({ error: 'Áudio em cache não encontrado.' });
      }
      const buffer = Buffer.from(item.audioBase64, 'base64');
      res.setHeader('Content-Type', item.mimeType || 'audio/wav');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(buffer);
    } catch (error) {
      console.error('GET /api/ivi/audio/:hash error:', error);
      res.status(500).json({ error: 'Erro ao reproduzir áudio do cache da Ivi.' });
    }
  });

  app.post('/api/ivi/transcribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { audioDataUri, mimeType, moduleKey } = req.body as {
        audioDataUri?: string;
        mimeType?: string;
        moduleKey?: string;
      };
      if (!String(audioDataUri || '').trim()) {
        return res.status(400).json({ error: 'Envie o áudio gravado para transcrição.' });
      }
      const result = await iviTranscribeAudioNote(
        String(audioDataUri),
        mimeType || 'audio/webm',
        moduleKey || 'training_docs',
        req.authUser!.name
      );
      res.json(result);
    } catch (error) {
      console.error('POST /api/ivi/transcribe error:', error);
      res.status(500).json({ error: 'Erro ao transcrever áudio com Gemini.' });
    }
  });

  app.get('/api/ivi/audio-cache', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const items = await db
        .select({
          id: iviAudioCache.id,
          cacheHash: iviAudioCache.cacheHash,
          sourceType: iviAudioCache.sourceType,
          moduleKey: iviAudioCache.moduleKey,
          voiceName: iviAudioCache.voiceName,
          model: iviAudioCache.model,
          textContent: iviAudioCache.textContent,
          mimeType: iviAudioCache.mimeType,
          sizeBytes: iviAudioCache.sizeBytes,
          hitCount: iviAudioCache.hitCount,
          tokensSavedEstimate: iviAudioCache.tokensSavedEstimate,
          createdByName: iviAudioCache.createdByName,
          lastUsedAt: iviAudioCache.lastUsedAt,
          createdAt: iviAudioCache.createdAt,
        })
        .from(iviAudioCache)
        .orderBy(desc(iviAudioCache.lastUsedAt), desc(iviAudioCache.id))
        .limit(200);

      res.json({ items });
    } catch (error) {
      console.error('GET /api/ivi/audio-cache error:', error);
      res.status(500).json({ error: 'Erro ao listar cache de áudios Gemini.' });
    }
  });

  app.delete('/api/ivi/audio-cache/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveIntId(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });

      const existingRows = await db
        .select({
          id: iviAudioCache.id,
          cacheHash: iviAudioCache.cacheHash,
          sourceType: iviAudioCache.sourceType,
          moduleKey: iviAudioCache.moduleKey,
          textContent: iviAudioCache.textContent,
        })
        .from(iviAudioCache)
        .where(eq(iviAudioCache.id, id))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Áudio não encontrado no cache.' });

      await db.delete(iviAudioCache).where(eq(iviAudioCache.id, id));
      await db.insert(auditLogs).values({
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'EXCLUIR_CACHE_AUDIO_IVI',
        entityType: 'ivi_audio_cache',
        entityId: String(id),
        details: {
          cacheHash: existing.cacheHash,
          sourceType: existing.sourceType,
          moduleKey: existing.moduleKey,
          preview: existing.textContent.slice(0, 100),
        },
        unitId: req.activeUnitId,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/ivi/audio-cache/:id error:', error);
      res.status(500).json({ error: 'Erro ao excluir áudio do cache.' });
    }
  });

  // ---------------------------------------------------------------------------
  // SESSÕES DE TREINAMENTO DO COLABORADOR
  // ---------------------------------------------------------------------------
  app.get('/api/training/sessions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const viewAll = req.query.all === '1' && req.authUser?.role === 'admin';
      const rows = viewAll
        ? await db.select().from(trainingSessions).orderBy(desc(trainingSessions.updatedAt)).limit(100)
        : await db
            .select()
            .from(trainingSessions)
            .where(eq(trainingSessions.userId, req.authUser!.id))
            .orderBy(desc(trainingSessions.updatedAt))
            .limit(50);

      res.json({ sessions: rows });
    } catch (error) {
      console.error('GET /api/training/sessions error:', error);
      res.status(500).json({ error: 'Erro ao carregar sessões de treinamento.' });
    }
  });

  app.post('/api/training/sessions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as {
        traineeName?: string;
        moduleKey?: string;
        currentStepIndex?: number;
        completedStepsJson?: number[];
        qaHistoryJson?: TrainingQaHistoryEntry[];
        classroomCourseId?: string;
        classroomCourseTitle?: string;
        status?: 'em_andamento' | 'concluido';
      };

      const traineeName = String(body.traineeName || req.authUser!.name).trim().slice(0, 120);
      const moduleKey = String(body.moduleKey || 'diagrama_integracao').trim();
      if (!traineeName || !moduleKey) {
        return res.status(400).json({ error: 'Informe nome do treinando e módulo.' });
      }

      const existingRows = await db
        .select()
        .from(trainingSessions)
        .where(
          and(
            eq(trainingSessions.userId, req.authUser!.id),
            eq(trainingSessions.traineeName, traineeName),
            eq(trainingSessions.moduleKey, moduleKey)
          )
        )
        .limit(1);

      const status = body.status === 'concluido' ? 'concluido' : 'em_andamento';
      if (existingRows[0]) {
        const [updated] = await db
          .update(trainingSessions)
          .set({
            currentStepIndex: body.currentStepIndex ?? existingRows[0].currentStepIndex,
            completedStepsJson: Array.isArray(body.completedStepsJson)
              ? body.completedStepsJson
              : existingRows[0].completedStepsJson,
            qaHistoryJson: Array.isArray(body.qaHistoryJson) ? body.qaHistoryJson : existingRows[0].qaHistoryJson,
            status,
            completedAt: status === 'concluido' ? new Date() : existingRows[0].completedAt,
            updatedAt: new Date(),
          })
          .where(eq(trainingSessions.id, existingRows[0].id))
          .returning();
        return res.json({ session: updated });
      }

      const [created] = await db
        .insert(trainingSessions)
        .values({
          userId: req.authUser!.id,
          traineeName,
          moduleKey,
          classroomCourseId: '',
          classroomCourseTitle: '',
          currentStepIndex: Number(body.currentStepIndex || 0),
          completedStepsJson: Array.isArray(body.completedStepsJson) ? body.completedStepsJson : [],
          qaHistoryJson: Array.isArray(body.qaHistoryJson) ? body.qaHistoryJson : [],
          status,
          completedAt: status === 'concluido' ? new Date() : null,
        })
        .returning();

      res.json({ session: created });
    } catch (error) {
      console.error('POST /api/training/sessions error:', error);
      res.status(500).json({ error: 'Erro ao salvar progresso do treinamento.' });
    }
  });

  app.post('/api/training/sessions/reset', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as { traineeName?: string };
      const traineeName = String(body.traineeName || req.authUser!.name).trim().slice(0, 120) || req.authUser!.name;

      await db.delete(trainingSessions).where(eq(trainingSessions.userId, req.authUser!.id));

      const [initialSession] = await db
        .insert(trainingSessions)
        .values({
          userId: req.authUser!.id,
          traineeName,
          moduleKey: 'diagrama_integracao',
          classroomCourseId: '',
          classroomCourseTitle: '',
          currentStepIndex: 0,
          completedStepsJson: [],
          qaHistoryJson: [],
          status: 'em_andamento',
          completedAt: null,
        })
        .returning();

      res.json({ session: initialSession, sessions: [initialSession] });
    } catch (error) {
      console.error('POST /api/training/sessions/reset error:', error);
      res.status(500).json({ error: 'Erro ao iniciar novo treinamento a partir do Módulo 1.' });
    }
  });
}
