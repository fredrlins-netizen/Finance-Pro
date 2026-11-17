import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { db } from '../db/index.ts';
import {
  CustomFormField,
  CustomFormSettings,
  IviChecklistVerificationItem,
  iviAudioCache,
  iviKnowledgeArticles,
  systemModuleDocs,
  systemSettings,
} from '../db/schema.ts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { putBucketObject } from './bucketStorage.ts';

export type IviProviderId = 'claude_code' | 'openai' | 'gemini' | 'deepseek';

const DEFAULT_CHAIN: IviProviderId[] = ['claude_code', 'openai', 'gemini', 'deepseek'];

let _geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!_geminiClient) {
    _geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return _geminiClient;
}

let _geminiAudioClient: GoogleGenAI | null = null;
function getGeminiAudioClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!_geminiAudioClient) {
    _geminiAudioClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return _geminiAudioClient;
}

export async function getIviChainConfig(): Promise<{ order: IviProviderId[]; status: Record<IviProviderId, boolean> }> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, 'ivi_chain')).limit(1);
    const saved = rows[0]?.value as { order?: IviProviderId[] } | undefined;
    const order = saved?.order?.length ? saved.order : DEFAULT_CHAIN;
    return {
      order,
      status: {
        claude_code: Boolean(process.env.CLAUDE_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY),
        deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      },
    };
  } catch {
    return {
      order: DEFAULT_CHAIN,
      status: {
        claude_code: Boolean(process.env.CLAUDE_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY),
        deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      },
    };
  }
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Claude returned empty content');
  return text;
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty content');
  return text;
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) throw new Error('GEMINI_API_KEY not configured');
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
    },
  });
  if (!response.text) throw new Error('Gemini returned empty text');
  return response.text;
}

async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('DeepSeek returned empty content');
  return text;
}

export async function runIviOrchestrator(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; provider: IviProviderId | 'knowledge_fallback'; trace: string[] }> {
  const { order } = await getIviChainConfig();
  const trace: string[] = [];

  for (const provider of order) {
    try {
      let text = '';
      if (provider === 'claude_code') text = await callClaude(systemPrompt, userPrompt);
      else if (provider === 'openai') text = await callOpenAI(systemPrompt, userPrompt);
      else if (provider === 'gemini') text = await callGemini(systemPrompt, userPrompt);
      else if (provider === 'deepseek') text = await callDeepSeek(systemPrompt, userPrompt);
      trace.push(`${provider}:ok`);
      return { text, provider, trace };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      trace.push(`${provider}:${msg}`);
    }
  }

  return {
    text: 'Ivi encaminhou esta solicitação para validação do consultor especialista e registrou o histórico na base de conhecimento.',
    provider: 'knowledge_fallback',
    trace,
  };
}

export async function iviSynthesizeSpeechCached(params: {
  text: string;
  voiceName?: string;
  sourceType?: 'training' | 'static_doc' | 'prospection';
  moduleKey?: string;
  createdByName?: string;
}): Promise<{
  cacheHash: string;
  audioBase64: string;
  mimeType: string;
  sizeBytes: number;
  cached: boolean;
  hitCount: number;
  tokensSavedEstimate: number;
  model: string;
  unavailableReason?: string;
}> {
  const cleanText = String(params.text || '').trim().slice(0, 3200);
  const voiceName = String(params.voiceName || 'Aoede').trim() || 'Aoede';
  const sourceType = params.sourceType || 'training';
  const moduleKey = String(params.moduleKey || '').trim();
  const model = 'gemini-3.8-flash-lite-tts';

  if (!cleanText) {
    throw new Error('Informe um texto para leitura em áudio pela Ivi.');
  }

  const cacheHash = crypto
    .createHash('sha256')
    .update(`${model}::${voiceName}::${cleanText}`)
    .digest('hex');

  const existing = await db
    .select()
    .from(iviAudioCache)
    .where(eq(iviAudioCache.cacheHash, cacheHash))
    .limit(1);

  if (existing[0] && existing[0].audioBase64) {
    const estTokensPerPlay = Math.max(80, Math.ceil(cleanText.length / 3) + 120);
    const nextHits = (existing[0].hitCount || 1) + 1;
    const nextTokensSaved = (existing[0].tokensSavedEstimate || 0) + estTokensPerPlay;
    await db
      .update(iviAudioCache)
      .set({
        hitCount: nextHits,
        tokensSavedEstimate: nextTokensSaved,
        lastUsedAt: new Date(),
      })
      .where(eq(iviAudioCache.id, existing[0].id));

    return {
      cacheHash: existing[0].cacheHash,
      audioBase64: existing[0].audioBase64,
      mimeType: existing[0].mimeType || 'audio/wav',
      sizeBytes: existing[0].sizeBytes || 0,
      cached: true,
      hitCount: nextHits,
      tokensSavedEstimate: nextTokensSaved,
      model: existing[0].model || model,
    };
  }

  const ai = getGeminiAudioClient();
  if (!ai) {
    return {
      cacheHash,
      audioBase64: '',
      mimeType: 'audio/wav',
      sizeBytes: 0,
      cached: false,
      hitCount: 0,
      tokensSavedEstimate: 0,
      model,
      unavailableReason: 'GEMINI_API_KEY não configurada no servidor.',
    };
  }

  try {
    const allowedVoice = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Aoede'].includes(voiceName)
      ? voiceName
      : 'Kore';
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                style:
                  sourceType === 'prospection'
                    ? 'Cordial, consultiva, clara e natural em português do Brasil'
                    : 'Descontraída, calorosa, intimista, próxima, bem-humorada e didática em português do Brasil',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: allowedVoice },
          },
        },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const audioBase64 = part?.data || '';
    const mimeType = part?.mimeType || 'audio/wav';
    if (!audioBase64) {
      throw new Error('Gemini TTS retornou áudio vazio.');
    }
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const sizeBytes = audioBuffer.length;

    await db
      .insert(iviAudioCache)
      .values({
        cacheHash,
        sourceType,
        moduleKey,
        voiceName,
        model,
        textContent: cleanText,
        mimeType,
        sizeBytes,
        audioBase64,
        hitCount: 1,
        tokensSavedEstimate: 0,
        createdByName: params.createdByName || 'Ivi Instrutora',
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: iviAudioCache.cacheHash,
        set: {
          audioBase64,
          mimeType,
          sizeBytes,
          lastUsedAt: new Date(),
        },
      });

    // Replica WAV gerado também no bucketdainvicta (R2 / Storage Cifrado)
    try {
      await putBucketObject(audioBuffer, {
        folderPath: `ivi-audio-cache/${moduleKey || sourceType}`,
        mimeType,
        originalName: `ivi-audio-${cacheHash.slice(0, 16)}.wav`,
      });
    } catch (bucketErr) {
      console.warn('BucketdaInvicta audio archive warning:', bucketErr);
    }

    return {
      cacheHash,
      audioBase64,
      mimeType,
      sizeBytes,
      cached: false,
      hitCount: 1,
      tokensSavedEstimate: 0,
      model,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Falha na síntese de áudio Gemini';
    console.warn('Gemini TTS generation failed:', reason);
    return {
      cacheHash,
      audioBase64: '',
      mimeType: 'audio/wav',
      sizeBytes: 0,
      cached: false,
      hitCount: 0,
      tokensSavedEstimate: 0,
      model,
      unavailableReason: reason,
    };
  }
}

export async function iviRespondProspection(
  message: string,
  channel: string,
  leadName: string,
  options?: { clientSentAudio?: boolean; replyWithAudio?: boolean; createdByName?: string }
) {
  const articles = await db
    .select()
    .from(iviKnowledgeArticles)
    .where(and(eq(iviKnowledgeArticles.scope, 'prospection'), eq(iviKnowledgeArticles.active, true)))
    .orderBy(desc(iviKnowledgeArticles.hitCount));

  const kbContext = articles
    .slice(0, 20)
    .map((a) => `- [ID:${a.id} | ${a.category}] Pergunta: ${a.questionPattern} | Resposta oficial: ${a.answerTemplate}`)
    .join('\n');

  const attachOptionalAudio = async (replyText: string, aiWantsAudio: boolean) => {
    if (!options?.clientSentAudio && !options?.replyWithAudio && !aiWantsAudio) {
      return { audioCacheHash: '', audioMimeType: '', audioCached: false };
    }
    const tts = await iviSynthesizeSpeechCached({
      text: replyText,
      sourceType: 'prospection',
      moduleKey: 'prospection',
      createdByName: options?.createdByName || 'Ivi Prospecção',
    });
    return {
      audioCacheHash: tts.audioBase64 ? tts.cacheHash : '',
      audioMimeType: tts.audioBase64 ? tts.mimeType : '',
      audioCached: tts.cached,
    };
  };

  const ai = getGeminiClient();
  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Cliente: ${leadName}\nCanal: ${channel}\nCliente enviou áudio?: ${
          options?.clientSentAudio ? 'Sim' : 'Não'
        }\nMensagem: "${message}"\n\nBase de conhecimento oficial de Prospecção (priorize este material):\n${kbContext}`,
        config: {
          systemInstruction:
            'Você é Ivi, assistente comercial inteligente do FinancePro / Invicta Assessoria Financeira (especialista em negociação de dívidas veiculares, cartão, empréstimos e cheque especial). Busque a resposta prioritariamente na Base de Conhecimento fornecida. Responda em Português do Brasil de forma objetiva, esclarecedora, acolhedora e sugira agendamento (Presencial, Telefone ou Vídeo Chamada). Se a dúvida exigir análise jurídica específica ou intervenção comercial, marque needsHuman=true. Marque suggestAudioReply=true se o cliente enviou áudio ou se uma explicação verbal ajudar muito a esclarecer.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              needsHuman: { type: Type.BOOLEAN },
              suggestAudioReply: { type: Type.BOOLEAN },
              matchedArticleId: { type: Type.INTEGER },
              suggestedModality: { type: Type.STRING },
              knowledgeTitle: { type: Type.STRING },
            },
            required: ['reply', 'needsHuman'],
          },
        },
      });
      const parsed = JSON.parse((res.text || '{}').trim()) as {
        reply?: string;
        needsHuman?: boolean;
        suggestAudioReply?: boolean;
        matchedArticleId?: number;
        suggestedModality?: string;
        knowledgeTitle?: string;
      };
      if (parsed.reply) {
        if (parsed.matchedArticleId && articles.some((a) => a.id === parsed.matchedArticleId)) {
          await db
            .update(iviKnowledgeArticles)
            .set({ hitCount: sql`${iviKnowledgeArticles.hitCount} + 1`, updatedAt: new Date() })
            .where(eq(iviKnowledgeArticles.id, parsed.matchedArticleId));
        } else {
          await db.insert(iviKnowledgeArticles).values({
            scope: 'prospection',
            moduleKey: 'prospection',
            questionPattern: message.slice(0, 180),
            answerTemplate: parsed.reply,
            category: parsed.knowledgeTitle || 'prospeccao',
            sourceChannel: channel,
            hitCount: 1,
            updatedByName: 'Aprendizado Automático Ivi',
            active: true,
          });
        }
        const audioMeta = await attachOptionalAudio(parsed.reply, Boolean(parsed.suggestAudioReply));
        return {
          reply: parsed.reply,
          needsHuman: Boolean(parsed.needsHuman),
          suggestAudioReply: Boolean(parsed.suggestAudioReply || options?.clientSentAudio || options?.replyWithAudio),
          suggestedModality: parsed.suggestedModality || 'presencial',
          provider: 'gemini' as const,
          chainTrace: ['claude_code:fallback', 'openai:fallback', 'gemini:ok'],
          ...audioMeta,
        };
      }
    } catch (e) {
      console.warn('Gemini structured prospection fallback:', e);
    }
  }

  const lowerMsg = message.toLowerCase();
  const matchedLocal = articles.find((a) => {
    const words = a.questionPattern.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    return words.some((w) => lowerMsg.includes(w));
  });

  if (matchedLocal) {
    await db
      .update(iviKnowledgeArticles)
      .set({ hitCount: sql`${iviKnowledgeArticles.hitCount} + 1`, updatedAt: new Date() })
      .where(eq(iviKnowledgeArticles.id, matchedLocal.id));
    const audioMeta = await attachOptionalAudio(matchedLocal.answerTemplate, false);
    return {
      reply: matchedLocal.answerTemplate,
      needsHuman: /processo|apreens|mandado|processual|urgente|advogado|valor/i.test(message),
      suggestAudioReply: Boolean(options?.clientSentAudio || options?.replyWithAudio),
      suggestedModality: 'presencial',
      provider: 'knowledge_fallback' as const,
      chainTrace: ['kb_prospection:hit'],
      ...audioMeta,
    };
  }

  const out = await runIviOrchestrator(
    'Você é Ivi, assistente comercial do FinancePro Assessoria. Responda em PT-BR usando a base de prospecção e sugira agendamento.',
    `Lead ${leadName} via ${channel}: ${message}\nBase:\n${kbContext}`
  );
  const needsHuman = /processo|apreens|mandado|processual|urgente|advogado|valor/i.test(message);
  await db.insert(iviKnowledgeArticles).values({
    scope: 'prospection',
    moduleKey: 'prospection',
    questionPattern: message.slice(0, 180),
    answerTemplate: out.text,
    category: 'atendimento',
    sourceChannel: channel,
    hitCount: 1,
    updatedByName: 'Aprendizado Automático Ivi',
    active: true,
  });
  const audioMeta = await attachOptionalAudio(out.text, false);
  return {
    reply: out.text,
    needsHuman,
    suggestAudioReply: Boolean(options?.clientSentAudio || options?.replyWithAudio),
    suggestedModality: 'presencial',
    provider: out.provider,
    chainTrace: out.trace,
    ...audioMeta,
  };
}

export async function iviTranslateLegalDispatch(originalDispatch: string) {
  const result = await runIviOrchestrator(
    'Você é Ivi, especialista jurídica do FinancePro Assessoria. Traduza o despacho judicial ("juridiquês") para Português do Brasil claro, objetivo e compreensível para o cliente final, destacando: 1) O que aconteceu, 2) Risco de busca e apreensão, 3) Próximo passo recomendado em até 3 frases.',
    originalDispatch
  );
  return result;
}

export async function iviTranscribeAudioNote(
  audioDescriptionOrBase64: string,
  mimeType = 'audio/webm',
  moduleKey = 'prospection',
  createdByName = 'Ivi IA'
) {
  const rawPayload = String(audioDescriptionOrBase64 || '');
  const hash = crypto.createHash('sha256').update(`transcribe::${mimeType}::${rawPayload}`).digest('hex');

  const cachedRows = await db
    .select()
    .from(iviAudioCache)
    .where(eq(iviAudioCache.cacheHash, hash))
    .limit(1);

  if (cachedRows[0] && cachedRows[0].textContent) {
    const nextHits = (cachedRows[0].hitCount || 1) + 1;
    const saved = (cachedRows[0].tokensSavedEstimate || 0) + 180;
    await db
      .update(iviAudioCache)
      .set({ hitCount: nextHits, tokensSavedEstimate: saved, lastUsedAt: new Date() })
      .where(eq(iviAudioCache.id, cachedRows[0].id));
    return {
      transcript: cachedRows[0].textContent,
      provider: 'gemini' as const,
      cached: true,
      cacheHash: cachedRows[0].cacheHash,
    };
  }

  const ai = getGeminiClient();
  if (ai && rawPayload.startsWith('data:')) {
    try {
      const base64 = rawPayload.split(',')[1] || '';
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Transcreva fielmente este áudio em Português do Brasil e forneça um resumo objetivo da fala.' },
          ],
        },
      });
      if (response.text) {
        await db
          .insert(iviAudioCache)
          .values({
            cacheHash: hash,
            sourceType: 'transcription',
            moduleKey,
            voiceName: 'Transcricao',
            model: 'gemini-3.5-transcribe',
            textContent: response.text,
            mimeType,
            sizeBytes: Buffer.from(base64, 'base64').length,
            audioBase64: '',
            hitCount: 1,
            tokensSavedEstimate: 0,
            createdByName,
            lastUsedAt: new Date(),
          })
          .onConflictDoNothing();
        return { transcript: response.text, provider: 'gemini' as const, cached: false, cacheHash: hash };
      }
    } catch (err) {
      console.warn('Audio transcription fallback:', err);
    }
  }

  const fallback = await runIviOrchestrator(
    'Você é Ivi no FinancePro. Gere uma transcrição estruturada e resumo objetivo a partir do áudio recebido.',
    `Conteúdo do áudio recebido: ${rawPayload.slice(0, 2000)}`
  );
  return { transcript: fallback.text, provider: fallback.provider, cached: false, cacheHash: hash };
}

export async function iviDraftCollectionMessage(params: {
  clientName: string;
  amountFormatted: string;
  daysOffset: number;
  processSummary: string;
}) {
  const tone =
    params.daysOffset < 0
      ? `Lembrete amigável (${Math.abs(params.daysOffset)} dias antes do vencimento)`
      : `Cobrança educada e objetiva (${params.daysOffset} dias após o vencimento), pedindo que não deixe o processo ser paralisado por inadimplência`;

  return runIviOrchestrator(
    'Você é Ivi, assistente financeira do FinancePro Assessoria. Escreva uma mensagem curta para WhatsApp e E-mail em PT-BR com tom respeitoso, claro e acolhedor.',
    `Cliente: ${params.clientName}\nValor do boleto: ${params.amountFormatted}\nMomento da régua: ${tone}\nResumo do processo: ${params.processSummary}`
  );
}

export async function iviSummarizeConversation(params: {
  leadName: string;
  channel: string;
  transcript: Array<{
    sender: string;
    text: string;
    type?: string;
    audioTranscript?: string;
    authorName?: string;
    timestamp: string;
  }>;
}): Promise<{ summary: string; provider: IviProviderId | 'knowledge_fallback' }> {
  const formattedHistory = params.transcript
    .map((item) => {
      const who =
        item.sender === 'cliente'
          ? params.leadName || 'Cliente'
          : item.sender === 'ivi'
          ? 'Ivi IA'
          : item.authorName || 'Operador';
      const content =
        item.type === 'audio' && item.audioTranscript
          ? `[Áudio transcrito]: ${item.audioTranscript}`
          : item.text;
      return `- ${who} (${item.timestamp}): ${content}`;
    })
    .join('\n');

  if (!formattedHistory.trim()) {
    return {
      summary: 'Atendimento iniciado sem histórico textual registrado até o momento.',
      provider: 'knowledge_fallback',
    };
  }

  const out = await runIviOrchestrator(
    'Você é Ivi, assistente comercial do FinancePro Assessoria. Resuma objetivamente em Português do Brasil (máximo 4 linhas) o que foi discutido neste atendimento (incluindo transcrições de áudio, interesse do cliente, valores/veículo mencionados e próximo passo recomendado para o consultor no agendamento). Não invente dados.',
    `Cliente: ${params.leadName || 'Não identificado'}\nCanal: ${params.channel}\nHistórico:\n${formattedHistory}`
  );
  return { summary: out.text, provider: out.provider };
}

export interface AuditAnalysisFindingInput {
  severity: 'ok' | 'atencao' | 'critico';
  category: string;
  title: string;
  detail: string;
}

export interface AuditDossierAnalyzeInput {
  protocolCode: string;
  status: string;
  debtType: string;
  modality: string;
  bankName: string;
  contractNumber: string;
  clientName: string;
  clientCpfCnpj: string;
  titularName?: string | null;
  titularCpfCnpj?: string | null;
  debtAmountFormatted: string;
  financedAmountFormatted: string;
  serviceFeeFormatted: string;
  initialInstallmentFormatted: string;
  installmentsCount: number;
  debtTotalInstallments: number;
  debtPaidInstallments: number;
  debtOverdueInstallments: number;
  vehicleInfo: string;
  vehiclePlate: string;
  isElectricVehicle: boolean;
  escavadorAlert: boolean;
  documents: Array<{ fileName: string; docCategory: string; mimeType: string }>;
  critiquesCount: number;
  lastCritiqueReason?: string | null;
  checklistTotal: number;
  checklistChecked: number;
  existingTitlesCount: number;
  legalProcessesSummary: string;
  notes?: string;
}

function buildDeterministicAuditFindings(input: AuditDossierAnalyzeInput): {
  findings: AuditAnalysisFindingInput[];
  missingDocs: string[];
  hasCritical: boolean;
  hasWarning: boolean;
} {
  const findings: AuditAnalysisFindingInput[] = [];
  const docCats = new Set(input.documents.map((d) => String(d.docCategory || '').toLowerCase()));
  const docNames = input.documents.map((d) => d.fileName.toLowerCase()).join(' ');
  const missingDocs: string[] = [];

  if (input.isElectricVehicle || /eletric|elétric|byd|dolphin|ora |seal/i.test(`${input.vehicleInfo} ${input.notes || ''}`)) {
    findings.push({
      severity: 'critico',
      category: 'Elegibilidade do Bem',
      title: 'Veículo elétrico / híbrido sinalizado',
      detail: 'A política operacional bloqueia aprovação padrão para veículos elétricos sem exceção expressa. Confirme o modelo no CRLV antes de prosseguir.',
    });
  }

  if (input.documents.length === 0) {
    findings.push({
      severity: 'critico',
      category: 'Documentação',
      title: 'Nenhum documento vinculado no Cofre',
      detail: 'Não há anexos disponíveis para conferência de identidade, contrato ou procuração.',
    });
    missingDocs.push('Documento Pessoal (RG/CNH)', 'Comprovante de Residência', 'Contrato Bancário', 'Procuração Assinada');
  } else {
    const hasPersonal = docCats.has('pessoal') || /rg|cnh|cpf|identidade/.test(docNames);
    const hasResidence = docCats.has('residencia') || /residencia|endereco|luz|agua|energia/.test(docNames);
    const hasContract = docCats.has('contrato') || docCats.has('ficha_admissao') || /contrato|ccb|admissao/.test(docNames);
    const hasProxy = docCats.has('procuracao') || /procuracao/.test(docNames);
    const isVehicular = input.debtType.toLowerCase().includes('veic') || input.modality.toLowerCase().includes('veíc');
    const hasCrlv = docCats.has('crlv') || /crlv|renavam|veiculo|documento_veic/.test(docNames);

    if (!hasPersonal) missingDocs.push('Documento Pessoal (RG/CNH)');
    if (!hasResidence) missingDocs.push('Comprovante de Residência');
    if (!hasContract) missingDocs.push('Contrato / CCB');
    if (!hasProxy) missingDocs.push('Procuração Assinada');
    if (isVehicular && !hasCrlv) missingDocs.push('CRLV do Veículo');

    if (missingDocs.length > 0) {
      findings.push({
        severity: 'atencao',
        category: 'Documentação',
        title: `${missingDocs.length} categoria(s) documental(is) pendente(s)`,
        detail: `Recomenda-se conferir ou solicitar: ${missingDocs.join(', ')}.`,
      });
    } else {
      findings.push({
        severity: 'ok',
        category: 'Documentação',
        title: 'Dossiê documental completo',
        detail: `${input.documents.length} arquivo(s) localizado(s) no cofre cobrindo as categorias essenciais.`,
      });
    }
  }

  if (input.titularName && input.titularCpfCnpj && input.titularCpfCnpj !== input.clientCpfCnpj) {
    findings.push({
      severity: 'atencao',
      category: 'Partes & Titularidade',
      title: 'Contrato em nome de Terceiro (Titular ≠ Responsável)',
      detail: `Responsável: ${input.clientName} | Titular do bem/contrato: ${input.titularName}. Conferir procuração específica e vínculo documental.`,
    });
  } else {
    findings.push({
      severity: 'ok',
      category: 'Partes & Titularidade',
      title: 'Titularidade unificada',
      detail: `Responsável principal ${input.clientName} (${input.clientCpfCnpj}) alinhado à ficha.`,
    });
  }

  if (input.escavadorAlert || input.legalProcessesSummary.toLowerCase().includes('busca')) {
    findings.push({
      severity: 'critico',
      category: 'Risco Jurídico',
      title: 'Sinalização de Busca e Apreensão / Risco Processual',
      detail: 'Há alerta jurídico registrado. Ao aprovar, mantenha a flag "Busca e Apreensão (Escavador/Detran)" marcada para priorizar o setor Jurídico.',
    });
  } else if (input.debtOverdueInstallments >= 3) {
    findings.push({
      severity: 'atencao',
      category: 'Risco Jurídico',
      title: `${input.debtOverdueInstallments} parcelas em atraso no banco`,
      detail: 'Risco elevado de ajuizamento iminente. Recomenda-se validar consulta Escavador antes da emissão.',
    });
  }

  if (input.existingTitlesCount >= 2) {
    findings.push({
      severity: 'ok',
      category: 'Financeiro & Boletos',
      title: `${input.existingTitlesCount} boleto(s) já vinculado(s) à admissão`,
      detail: 'Verifique a aba Boletos & Histórico antes de aprovar para evitar duplicidade.',
    });
  } else {
    findings.push({
      severity: 'ok',
      category: 'Financeiro & Boletos',
      title: `Pronto para gerar 2 boletos de ${input.initialInstallmentFormatted}`,
      detail: `Honorários totais de ${input.serviceFeeFormatted} em ${input.installmentsCount}x (${input.debtAmountFormatted} de passivo).`,
    });
  }

  if (input.critiquesCount > 0 && input.lastCritiqueReason) {
    findings.push({
      severity: 'atencao',
      category: 'Reincidência / Retornos',
      title: `Dossiê já passou por ${input.critiquesCount} devolução(ões)`,
      detail: `Última crítica registrada: "${input.lastCritiqueReason}". Confirme se a correção foi atendida antes de concluir.`,
    });
  }

  const hasCritical = findings.some((f) => f.severity === 'critico');
  const hasWarning = findings.some((f) => f.severity === 'atencao');
  return { findings, missingDocs, hasCritical, hasWarning };
}

export async function iviAnalyzeAuditDossier(input: AuditDossierAnalyzeInput) {
  const det = buildDeterministicAuditFindings(input);
  const ai = getGeminiClient();

  if (ai) {
    try {
      const promptContext = [
        `Protocolo: ${input.protocolCode} | Status atual: ${input.status}`,
        `Cliente Responsável: ${input.clientName} (${input.clientCpfCnpj})`,
        input.titularName ? `Titular do Bem/Contrato: ${input.titularName} (${input.titularCpfCnpj || ''})` : 'Titular: Mesmo que responsável',
        `Banco/Credor: ${input.bankName} | Contrato: ${input.contractNumber} | Modalidade: ${input.modality} (${input.debtType})`,
        `Passivo Total: ${input.debtAmountFormatted} | Financiado: ${input.financedAmountFormatted}`,
        `Honorários/Serviços: ${input.serviceFeeFormatted} | Parcela Inicial (2 boletos): ${input.initialInstallmentFormatted} (${input.installmentsCount}x)`,
        `Parcelas Banco: ${input.debtPaidInstallments} pagas / ${input.debtOverdueInstallments} em atraso / ${input.debtTotalInstallments} totais`,
        `Veículo: ${input.vehicleInfo || 'N/A'} | Placa: ${input.vehiclePlate || 'N/A'} | Veículo Elétrico: ${input.isElectricVehicle ? 'SIM' : 'NÃO'}`,
        `Alerta Escavador/Busca e Apreensão: ${input.escavadorAlert ? 'SIM' : 'NÃO'} | Processos: ${input.legalProcessesSummary || 'Nenhum'}`,
        `Documentos anexados (${input.documents.length}): ${input.documents.map((d) => `${d.fileName} [${d.docCategory}]`).join('; ') || 'Nenhum'}`,
        `Faltas pré-detectadas: ${det.missingDocs.join(', ') || 'Nenhuma'}`,
        `Checklist marcado: ${input.checklistChecked}/${input.checklistTotal} | Títulos já gerados: ${input.existingTitlesCount}`,
        `Devoluções anteriores: ${input.critiquesCount} ${input.lastCritiqueReason ? `| Última: ${input.lastCritiqueReason}` : ''}`,
        input.notes ? `Anotações comerciais: ${input.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptContext,
        config: {
          systemInstruction:
            'Você é Ivi, copiloto especialista em Auditoria Documental e Financeira do FinancePro Assessoria. Analise os dados do dossiê de admissão e ajude o auditor humano a tomar uma decisão segura e rápida em Português do Brasil. Não invente dados que não constam no resumo. Se houver veículo elétrico ou falta grave de documentos, recomende DEVOLVER_COMERCIAL. Se faltar documento secundário ou houver titular diferente/reincidência, recomende CONFERIR_PONTOS. Se estiver íntegro, recomende APROVAR.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: { type: Type.STRING, description: 'APROVAR, CONFERIR_PONTOS ou DEVOLVER_COMERCIAL' },
              verdictLabel: { type: Type.STRING },
              executiveSummary: { type: Type.STRING },
              nextStepRecommendation: { type: Type.STRING },
              suggestedCritiqueDraft: { type: Type.STRING },
              extraFindings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING, description: 'ok, atencao ou critico' },
                    category: { type: Type.STRING },
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                  },
                  required: ['severity', 'category', 'title', 'detail'],
                },
              },
            },
            required: ['verdict', 'verdictLabel', 'executiveSummary', 'nextStepRecommendation', 'suggestedCritiqueDraft'],
          },
        },
      });

      const parsed = JSON.parse((res.text || '{}').trim()) as {
        verdict?: string;
        verdictLabel?: string;
        executiveSummary?: string;
        nextStepRecommendation?: string;
        suggestedCritiqueDraft?: string;
        extraFindings?: AuditAnalysisFindingInput[];
      };

      const verdictNorm =
        parsed.verdict === 'DEVOLVER_COMERCIAL' || parsed.verdict === 'CONFERIR_PONTOS' || parsed.verdict === 'APROVAR'
          ? parsed.verdict
          : det.hasCritical
          ? 'DEVOLVER_COMERCIAL'
          : det.hasWarning
          ? 'CONFERIR_PONTOS'
          : 'APROVAR';

      const mergedFindings = [...det.findings];
      if (Array.isArray(parsed.extraFindings)) {
        for (const f of parsed.extraFindings.slice(0, 3)) {
          if (!mergedFindings.some((m) => m.title.toLowerCase() === f.title.toLowerCase())) {
            mergedFindings.push({
              severity: f.severity === 'critico' || f.severity === 'atencao' ? f.severity : 'ok',
              category: f.category || 'Análise Ivi',
              title: f.title,
              detail: f.detail,
            });
          }
        }
      }

      return {
        verdict: verdictNorm as 'APROVAR' | 'CONFERIR_PONTOS' | 'DEVOLVER_COMERCIAL',
        verdictLabel:
          parsed.verdictLabel ||
          (verdictNorm === 'APROVAR'
            ? 'Pronta para Aprovação'
            : verdictNorm === 'CONFERIR_PONTOS'
            ? 'Requer Conferência Pontual'
            : 'Recomenda Devolução ao Comercial'),
        executiveSummary:
          parsed.executiveSummary ||
          `Dossiê ${input.protocolCode} analisado com ${input.documents.length} anexo(s) e ${det.missingDocs.length} pendência(s) documental(is).`,
        keyFindings: mergedFindings,
        missingDocs: det.missingDocs,
        suggestedChecklistTitles: det.missingDocs.length > 0 ? ['Conferência documental completa'] : ['Apto para emitir 2 boletos'],
        suggestedCritiqueDraft:
          parsed.suggestedCritiqueDraft ||
          (det.missingDocs.length > 0
            ? `Solicitamos complementação documental referente a: ${det.missingDocs.join(', ')} para seguimento da auditoria.`
            : ''),
        nextStepRecommendation:
          parsed.nextStepRecommendation ||
          (verdictNorm === 'APROVAR'
            ? 'Confira o documento pessoal e aprove o dossiê para emitir os 2 boletos iniciais.'
            : 'Revise os pontos destacados antes de aprovar ou devolva utilizando o texto sugerido.'),
        provider: 'gemini' as const,
        analyzedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('Gemini iviAnalyzeAuditDossier fallback:', err);
    }
  }

  const fallbackVerdict = det.hasCritical ? 'DEVOLVER_COMERCIAL' : det.hasWarning ? 'CONFERIR_PONTOS' : 'APROVAR';
  return {
    verdict: fallbackVerdict as 'APROVAR' | 'CONFERIR_PONTOS' | 'DEVOLVER_COMERCIAL',
    verdictLabel:
      fallbackVerdict === 'APROVAR'
        ? 'Pronta para Aprovação'
        : fallbackVerdict === 'CONFERIR_PONTOS'
        ? 'Requer Conferência Pontual'
        : 'Recomenda Devolução ao Comercial',
    executiveSummary: `Ivi executou a verificação estrutural do protocolo ${input.protocolCode}: ${input.documents.length} documento(s) localizado(s), passivo de ${input.debtAmountFormatted} com ${input.bankName}.`,
    keyFindings: det.findings,
    missingDocs: det.missingDocs,
    suggestedChecklistTitles: det.missingDocs,
    suggestedCritiqueDraft:
      det.missingDocs.length > 0
        ? `Identificamos pendências para conclusão da auditoria: ${det.missingDocs.join(', ')}. Por favor regularizar junto ao cliente.`
        : input.isElectricVehicle
        ? 'Contrato vinculado a veículo elétrico/híbrido requer validação especial antes da emissão.'
        : '',
    nextStepRecommendation:
      fallbackVerdict === 'APROVAR'
        ? 'Todos os critérios base estão atendidos. Valide o checklist e conclua a emissão dos boletos.'
        : 'Analise os alertas acima na aba Documentação & Prévia antes de decidir.',
    provider: 'knowledge_fallback',
    analyzedAt: new Date().toISOString(),
  };
}

export async function iviInspectAuditDocument(params: {
  documentId: number;
  fileName: string;
  docCategory: string;
  mimeType: string;
  buffer: Buffer | null;
  dossierExpected: {
    protocolCode: string;
    clientName: string;
    clientCpfCnpj: string;
    titularName?: string | null;
    bankName: string;
    contractNumber: string;
    vehiclePlate?: string;
    vehicleModel?: string;
  };
}) {
  const canSendBinary =
    Boolean(params.buffer) &&
    params.buffer!.length > 0 &&
    params.buffer!.length <= 8 * 1024 * 1024 &&
    (params.mimeType.startsWith('image/') || params.mimeType === 'application/pdf');

  const ai = getGeminiClient();
  if (ai && canSendBinary) {
    try {
      const base64 = params.buffer!.toString('base64');
      const expectedPrompt = [
        `Você está auditando o arquivo "${params.fileName}" (categoria declarada: "${params.docCategory}").`,
        `Compare o conteúdo visual/textual do arquivo com os dados cadastrados na Ficha de Admissão (${params.dossierExpected.protocolCode}):`,
        `- Responsável esperado: ${params.dossierExpected.clientName} | CPF/CNPJ: ${params.dossierExpected.clientCpfCnpj}`,
        params.dossierExpected.titularName ? `- Titular esperado: ${params.dossierExpected.titularName}` : '',
        `- Banco/Credor esperado: ${params.dossierExpected.bankName} | Nº Contrato: ${params.dossierExpected.contractNumber}`,
        params.dossierExpected.vehiclePlate || params.dossierExpected.vehicleModel
          ? `- Veículo esperado: ${params.dossierExpected.vehicleModel || ''} | Placa: ${params.dossierExpected.vehiclePlate || ''}`
          : '',
        'Verifique legibilidade, assinaturas visíveis e se nome/CPF/contrato/banco/placa conferem com a ficha.',
      ]
        .filter(Boolean)
        .join('\n');

      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            { inlineData: { mimeType: params.mimeType, data: base64 } },
            { text: expectedPrompt },
          ],
        },
        config: {
          systemInstruction:
            'Você é Ivi, auditora documental do FinancePro Assessoria. Analise o documento anexado com rigor técnico e responda sempre em Português do Brasil em JSON estruturado.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentDetected: { type: Type.STRING },
              legibility: { type: Type.STRING, description: 'LEGIVEL, PARCIAL ou ILEGIVEL' },
              matchesDossier: { type: Type.STRING, description: 'CONFERE, DIVERGENCIA ou NAO_IDENTIFICADO' },
              extractedFields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    foundInDoc: { type: Type.STRING },
                    expectedInDossier: { type: Type.STRING },
                    match: { type: Type.BOOLEAN },
                  },
                  required: ['label', 'foundInDoc', 'expectedInDossier', 'match'],
                },
              },
              alerts: { type: Type.ARRAY, items: { type: Type.STRING } },
              summary: { type: Type.STRING },
              suggestedCritiqueText: { type: Type.STRING },
            },
            required: ['documentDetected', 'legibility', 'matchesDossier', 'extractedFields', 'alerts', 'summary'],
          },
        },
      });

      const parsed = JSON.parse((res.text || '{}').trim()) as {
        documentDetected?: string;
        legibility?: string;
        matchesDossier?: string;
        extractedFields?: Array<{ label: string; foundInDoc: string; expectedInDossier: string; match: boolean }>;
        alerts?: string[];
        summary?: string;
        suggestedCritiqueText?: string;
      };

      return {
        documentId: params.documentId,
        fileName: params.fileName,
        documentDetected: parsed.documentDetected || params.docCategory,
        legibility: (parsed.legibility === 'ILEGIVEL' || parsed.legibility === 'PARCIAL' ? parsed.legibility : 'LEGIVEL') as
          | 'LEGIVEL'
          | 'PARCIAL'
          | 'ILEGIVEL',
        matchesDossier: (
          parsed.matchesDossier === 'CONFERE' || parsed.matchesDossier === 'DIVERGENCIA'
            ? parsed.matchesDossier
            : 'NAO_IDENTIFICADO'
        ) as 'CONFERE' | 'DIVERGENCIA' | 'NAO_IDENTIFICADO',
        extractedFields: Array.isArray(parsed.extractedFields) ? parsed.extractedFields : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        summary: parsed.summary || 'Documento inspecionado pela Ivi.',
        suggestedCritiqueText: parsed.suggestedCritiqueText || '',
        provider: 'gemini',
      };
    } catch (err) {
      console.warn('Gemini iviInspectAuditDocument fallback:', err);
    }
  }

  return {
    documentId: params.documentId,
    fileName: params.fileName,
    documentDetected: params.docCategory || 'Anexo de Dossiê',
    legibility: params.buffer ? ('PARCIAL' as const) : ('ILEGIVEL' as const),
    matchesDossier: 'NAO_IDENTIFICADO' as const,
    extractedFields: [
      {
        label: 'Categoria declarada',
        foundInDoc: params.docCategory,
        expectedInDossier: params.dossierExpected.protocolCode,
        match: true,
      },
      {
        label: 'Titular / Cliente',
        foundInDoc: params.buffer ? 'Requer conferência visual no painel' : 'Arquivo físico não encontrado no cofre',
        expectedInDossier: params.dossierExpected.clientName,
        match: Boolean(params.buffer),
      },
    ],
    alerts: params.buffer
      ? ['Inspeção automática por visão requer imagem ou PDF de até 8 MB. Verifique os dados no visualizador ao lado.']
      : ['Objeto binário não localizado no armazenamento; solicite reenvio se necessário.'],
    summary: params.buffer
      ? `Arquivo "${params.fileName}" disponível no visualizador para conferência direta pelo auditor.`
      : `Não foi possível ler o binário de "${params.fileName}" no bucket para extração automática.`,
    suggestedCritiqueText: params.buffer
      ? ''
      : `Arquivo "${params.fileName}" ilegível ou ausente no armazenamento; favor reenviar para conferência.`,
    provider: 'knowledge_fallback',
  };
}

export async function iviAskAboutAuditDossier(params: {
  question: string;
  dossierContextText: string;
}) {
  const result = await runIviOrchestrator(
    'Você é Ivi, assistente especialista de Auditoria do FinancePro Assessoria. Responda dúvidas do auditor de forma objetiva, prática e fundamentada estritamente nos dados da ficha de admissão informada, sempre em Português do Brasil.',
    `Contexto do dossiê:\n${params.dossierContextText}\n\nPergunta do auditor:\n${params.question}`
  );
  return result;
}

export interface AuditSystemRuleInput {
  id: number;
  sortOrder: number;
  title: string;
  description: string;
  modalityCondition: string;
  checked: boolean;
}

export function computeAuditFingerprint(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

export function buildChecklistVerificationReport(
  dossier: AuditDossierAnalyzeInput,
  applicableChecklist: AuditSystemRuleInput[]
): {
  items: IviChecklistVerificationItem[];
  inconsistenciesCount: number;
  attentionMeasuresCount: number;
  suggestedChecklistItemIds: number[];
  missingDocs: string[];
  det: ReturnType<typeof buildDeterministicAuditFindings>;
} {
  const det = buildDeterministicAuditFindings(dossier);
  const items: IviChecklistVerificationItem[] = [];
  const docCatNames = dossier.documents
    .map((d) => `${d.docCategory} ${d.fileName}`.toLowerCase())
    .join(' ');
  const suggestedChecklistItemIds: number[] = [];

  // 1. Operational & Cross-Field Consistency Rules
  if (
    dossier.isElectricVehicle ||
    /eletric|elétric|byd|dolphin|ora |seal/i.test(`${dossier.vehicleInfo} ${dossier.notes || ''}`)
  ) {
    items.push({
      ruleCode: 'REGRA-EL-01',
      ruleTitle: 'Política de Veículo Elétrico / Híbrido',
      category: 'regra_operacional',
      classification: 'INCONSISTENCIA',
      detail: 'Veículo elétrico ou híbrido identificado na ficha/observações.',
      recommendedAction:
        'Bloquear conclusão padrão ou validar exceção diretiva antes de emitir boletos.',
    });
  }

  if (
    dossier.debtTotalInstallments > 0 &&
    dossier.debtPaidInstallments + dossier.debtOverdueInstallments > dossier.debtTotalInstallments
  ) {
    items.push({
      ruleCode: 'REGRA-PARC-01',
      ruleTitle: 'Consistência de Parcelas (Pagas + Atrasadas vs Total)',
      category: 'regra_operacional',
      classification: 'INCONSISTENCIA',
      detail: `Soma de parcelas pagas (${dossier.debtPaidInstallments}) + em atraso (${dossier.debtOverdueInstallments}) supera o total contratado (${dossier.debtTotalInstallments}).`,
      recommendedAction: 'Revisar histórico de parcelas na ficha ou devolver para ajuste comercial.',
    });
  }

  if (dossier.documents.length === 0) {
    items.push({
      ruleCode: 'REGRA-DOC-00',
      ruleTitle: 'Cofre Documental da Admissão',
      category: 'documentacao',
      classification: 'INCONSISTENCIA',
      detail: 'Nenhum documento anexado no cofre para comprovação cadastral.',
      recommendedAction: 'Solicitar ao Comercial o envio de RG/CNH, residência, contrato e procuração.',
    });
  } else if (det.missingDocs.length > 0) {
    items.push({
      ruleCode: 'REGRA-DOC-01',
      ruleTitle: 'Completude Documental Obrigatória',
      category: 'documentacao',
      classification: 'MEDIDA_ATENCAO',
      detail: `Categorias ainda não localizadas por nome/categoria: ${det.missingDocs.join(', ')}.`,
      recommendedAction: 'Conferir os anexos na aba Documentação & Prévia ou solicitar complemento.',
    });
  } else {
    items.push({
      ruleCode: 'REGRA-DOC-01',
      ruleTitle: 'Completude Documental Obrigatória',
      category: 'documentacao',
      classification: 'CONFORME',
      detail: `${dossier.documents.length} anexo(s) localizado(s) cobrindo todas as categorias obrigatórias.`,
      recommendedAction: 'Validar assinatura e legibilidade no visualizador.',
    });
  }

  if (dossier.titularName && dossier.titularCpfCnpj && dossier.titularCpfCnpj !== dossier.clientCpfCnpj) {
    const hasProxy = /procur/.test(docCatNames);
    items.push({
      ruleCode: 'REGRA-TIT-01',
      ruleTitle: 'Contrato em Nome de Terceiro (Titular ≠ Responsável)',
      category: 'regra_operacional',
      classification: hasProxy ? 'MEDIDA_ATENCAO' : 'INCONSISTENCIA',
      detail: `Titular ${dossier.titularName} difere do responsável ${dossier.clientName}${hasProxy ? ' (procuração localizada)' : ' e procuração não identificada'}.`,
      recommendedAction: hasProxy
        ? 'Confirmar assinatura do titular na procuração e vínculo no contrato.'
        : 'Devolver ou exigir procuração assinada pelo titular antes de aprovar.',
    });
  }

  if (dossier.escavadorAlert || dossier.legalProcessesSummary.toLowerCase().includes('busca')) {
    items.push({
      ruleCode: 'REGRA-JUR-01',
      ruleTitle: 'Alerta Jurídico / Busca e Apreensão',
      category: 'regra_operacional',
      classification: 'MEDIDA_ATENCAO',
      detail: 'Sinalização ativa de busca e apreensão ou processo vinculado.',
      recommendedAction: 'Manter a flag "Alerta Busca e Apreensão (Escavador)" ativa ao aprovar.',
    });
  } else if (dossier.debtOverdueInstallments >= 3) {
    items.push({
      ruleCode: 'REGRA-JUR-02',
      ruleTitle: 'Risco por Inadimplência Elevada',
      category: 'regra_operacional',
      classification: 'MEDIDA_ATENCAO',
      detail: `${dossier.debtOverdueInstallments} parcelas em atraso elevam risco de ajuizamento.`,
      recommendedAction: 'Verificar consulta Escavador/Detran antes de emitir os boletos.',
    });
  }

  if (dossier.critiquesCount > 0 && dossier.lastCritiqueReason) {
    items.push({
      ruleCode: 'REGRA-RET-01',
      ruleTitle: `Reincidência (${dossier.critiquesCount} devolução(ões) anterior(es))`,
      category: 'regra_operacional',
      classification: 'MEDIDA_ATENCAO',
      detail: `Última crítica registrada: "${dossier.lastCritiqueReason}".`,
      recommendedAction: 'Confirmar que o ponto criticado anteriormente foi corrigido nos anexos.',
    });
  }

  // 2. Configured System Checklist Items
  for (const rule of applicableChecklist) {
    const titleLower = `${rule.title} ${rule.description}`.toLowerCase();
    const mentionsProxy = /procura/.test(titleLower);
    const mentionsPersonal = /rg|cnh|pessoal|identidade|cpf/.test(titleLower);
    const mentionsCrlv = /crlv|veic|renavam|chassi|eletric/.test(titleLower);
    const mentionsContract = /contrato|ccb|banco|taxa|parcela/.test(titleLower);
    const mentionsResidence = /resid|enderec|comprovante/.test(titleLower);
    const mentionsLegal = /jurídic|juridic|escavador|busca|process/.test(titleLower);

    if (rule.checked) {
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'CONFORME',
        detail: 'Item conferido e marcado manualmente pelo auditor.',
        recommendedAction: 'Nenhuma ação pendente.',
      });
      continue;
    }

    if (dossier.documents.length === 0 && (mentionsProxy || mentionsPersonal || mentionsCrlv || mentionsContract || mentionsResidence)) {
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'INCONSISTENCIA',
        detail: 'Não há documentos no cofre para atender este requisito obrigatório do checklist.',
        recommendedAction: 'Anexar documento faltante ou devolver ao Comercial.',
      });
    } else if (mentionsCrlv && dossier.isElectricVehicle) {
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'INCONSISTENCIA',
        detail: 'Checklist veicular impactado por sinalização de veículo elétrico/híbrido.',
        recommendedAction: 'Conferir CRLV e validar exceção operacional.',
      });
    } else if (mentionsProxy && /procur/.test(docCatNames)) {
      suggestedChecklistItemIds.push(rule.id);
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'CONFORME',
        detail: 'Procuração detectada no cofre; item apto para marcação automática.',
        recommendedAction: 'Aplicar marcação automática após conferência rápida da assinatura.',
      });
    } else if ((mentionsPersonal || mentionsContract || mentionsResidence || mentionsCrlv) && det.missingDocs.length === 0) {
      suggestedChecklistItemIds.push(rule.id);
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'CONFORME',
        detail: 'Documentação essencial localizada no cofre; item apto para marcação.',
        recommendedAction: 'Validar legibilidade no visualizador e marcar item.',
      });
    } else if (mentionsLegal && !dossier.escavadorAlert && dossier.debtOverdueInstallments < 3) {
      suggestedChecklistItemIds.push(rule.id);
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'CONFORME',
        detail: 'Sem alertas críticos de busca e apreensão na base.',
        recommendedAction: 'Marcar item como conferido.',
      });
    } else {
      items.push({
        checklistItemId: rule.id,
        ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
        ruleTitle: rule.title,
        category: 'checklist',
        classification: 'MEDIDA_ATENCAO',
        detail: rule.description || 'Requisito do checklist ainda pendente de validação visual.',
        recommendedAction: 'Revisar documento correspondente na aba Documentação & Prévia e marcar item.',
      });
    }
  }

  const inconsistenciesCount = items.filter((i) => i.classification === 'INCONSISTENCIA').length;
  const attentionMeasuresCount = items.filter((i) => i.classification === 'MEDIDA_ATENCAO').length;

  return {
    items,
    inconsistenciesCount,
    attentionMeasuresCount,
    suggestedChecklistItemIds,
    missingDocs: det.missingDocs,
    det,
  };
}

export function iviSweepChecklistLocal(params: {
  dossier: AuditDossierAnalyzeInput;
  applicableChecklist: AuditSystemRuleInput[];
  cacheKeyHash: string;
}) {
  const report = buildChecklistVerificationReport(params.dossier, params.applicableChecklist);
  const verdict: 'APROVAR' | 'CONFERIR_PONTOS' | 'DEVOLVER_COMERCIAL' =
    report.inconsistenciesCount > 0
      ? 'DEVOLVER_COMERCIAL'
      : report.attentionMeasuresCount > 0
      ? 'CONFERIR_PONTOS'
      : 'APROVAR';

  const verdictLabel =
    verdict === 'APROVAR'
      ? 'Checklist Conforme · Apto para Aprovação'
      : verdict === 'CONFERIR_PONTOS'
      ? `${report.attentionMeasuresCount} Medida(s) de Atenção no Checklist`
      : `${report.inconsistenciesCount} Inconsistência(s) Detectada(s)`;

  const incTitles = report.items
    .filter((i) => i.classification === 'INCONSISTENCIA')
    .map((i) => i.ruleTitle);
  const attTitles = report.items
    .filter((i) => i.classification === 'MEDIDA_ATENCAO')
    .map((i) => i.ruleTitle);

  const executiveSummary =
    report.inconsistenciesCount > 0
      ? `Varredura do checklist identificou ${report.inconsistenciesCount} inconsistência(s) (${incTitles.slice(0, 2).join('; ')}) e ${report.attentionMeasuresCount} medida(s) de atenção. Decisão salva na base do sistema.`
      : report.attentionMeasuresCount > 0
      ? `Checklist verificado sem bloqueios graves: ${report.attentionMeasuresCount} medida(s) de atenção (${attTitles.slice(0, 2).join('; ')}). Decisão salva na base do sistema.`
      : `Checklist completo e consistente para ${params.dossier.protocolCode} (${params.dossier.documents.length} anexo(s) validado(s)). Decisão salva na base do sistema.`;

  const suggestedCritiqueDraft =
    report.inconsistenciesCount > 0
      ? `Inconsistência(s) identificada(s) pela auditoria no protocolo ${params.dossier.protocolCode}: ${incTitles.join(', ')}. Favor regularizar para prosseguimento.`
      : report.missingDocs.length > 0
      ? `Pendência documental identificada: ${report.missingDocs.join(', ')}. Favor providenciar anexo legível.`
      : '';

  return {
    verdict,
    verdictLabel,
    executiveSummary,
    keyFindings: report.det.findings,
    missingDocs: report.missingDocs,
    suggestedChecklistTitles: report.items
      .filter((i) => i.checklistItemId && report.suggestedChecklistItemIds.includes(i.checklistItemId))
      .map((i) => i.ruleTitle),
    suggestedCritiqueDraft,
    nextStepRecommendation:
      verdict === 'APROVAR'
        ? 'Todos os critérios base do checklist estão atendidos. Conclua a conferência visual e emita os 2 boletos.'
        : 'Abra o modal de auditoria deste cliente para revisar as inconsistências/medidas de atenção listadas.',
    provider: 'local_rules_db',
    analyzedAt: new Date().toISOString(),
    inconsistenciesCount: report.inconsistenciesCount,
    attentionMeasuresCount: report.attentionMeasuresCount,
    checklistItemsChecked: report.items,
    fromDatabaseCache: false,
    aiCallsSaved: 0,
    cacheKeyHash: params.cacheKeyHash,
  };
}

export async function iviGenerateAuditInsightsPanel(params: {
  admissionId: number;
  dossier: AuditDossierAnalyzeInput;
  applicableChecklist: AuditSystemRuleInput[];
  cachedDocInspection?: Awaited<ReturnType<typeof iviInspectAuditDocument>> | null;
  skipAiRefinement?: boolean;
  selectedDoc: {
    documentId: number;
    fileName: string;
    docCategory: string;
    mimeType: string;
    buffer: Buffer | null;
    dossierExpected: {
      protocolCode: string;
      clientName: string;
      clientCpfCnpj: string;
      titularName?: string | null;
      bankName: string;
      contractNumber: string;
      vehiclePlate?: string;
      vehicleModel?: string;
    };
  } | null;
}) {
  const det = buildDeterministicAuditFindings(params.dossier);

  // Reuse cached document inspection from DB if available, avoiding redundant Gemini Vision calls!
  const documentInspection = params.cachedDocInspection
    ? params.cachedDocInspection
    : params.selectedDoc
    ? await iviInspectAuditDocument(params.selectedDoc)
    : null;

  const ruleChecks: Array<{
    ruleCode: string;
    ruleTitle: string;
    source: 'checklist_sistema' | 'regra_operacional' | 'documentacao';
    status: 'ATENDE' | 'ATENCAO' | 'IMPEDITIVO';
    explanation: string;
    checklistItemId?: number;
  }> = [];

  // Map operational & documentation rules
  if (params.dossier.isElectricVehicle) {
    ruleChecks.push({
      ruleCode: 'REGRA-VEICULO-ELETRICO',
      ruleTitle: 'Restrição de Veículo Elétrico / Híbrido',
      source: 'regra_operacional',
      status: 'IMPEDITIVO',
      explanation: 'Veículo elétrico sinalizado bloqueia conclusão padrão da auditoria e emissão automática sem autorização.',
    });
  }

  if (det.missingDocs.length > 0) {
    ruleChecks.push({
      ruleCode: 'REGRA-COMPLETUDE-DOC',
      ruleTitle: 'Documentação Mínima do Cofre',
      source: 'documentacao',
      status: params.dossier.documents.length === 0 ? 'IMPEDITIVO' : 'ATENCAO',
      explanation: `Faltam categorias obrigatórias no cofre: ${det.missingDocs.join(', ')}.`,
    });
  } else {
    ruleChecks.push({
      ruleCode: 'REGRA-COMPLETUDE-DOC',
      ruleTitle: 'Documentação Mínima do Cofre',
      source: 'documentacao',
      status: 'ATENDE',
      explanation: `Todas as categorias essenciais localizadas entre os ${params.dossier.documents.length} anexo(s).`,
    });
  }

  if (params.dossier.titularName && params.dossier.titularCpfCnpj !== params.dossier.clientCpfCnpj) {
    ruleChecks.push({
      ruleCode: 'REGRA-TITULARIDADE',
      ruleTitle: 'Contrato em Nome de Terceiro (Titular ≠ Responsável)',
      source: 'regra_operacional',
      status: 'ATENCAO',
      explanation: `Titular ${params.dossier.titularName} difere do responsável ${params.dossier.clientName}. Validar procuração e assinatura do titular.`,
    });
  }

  if (params.dossier.escavadorAlert || params.dossier.debtOverdueInstallments >= 3) {
    ruleChecks.push({
      ruleCode: 'REGRA-BUSCA-APREENSAO',
      ruleTitle: 'Prioridade Jurídica / Busca e Apreensão',
      source: 'regra_operacional',
      status: params.dossier.escavadorAlert ? 'ATENCAO' : 'ATENCAO',
      explanation: params.dossier.escavadorAlert
        ? 'Alerta Escavador/Detran ativo: manter flag Busca e Apreensão marcada ao aprovar.'
        : `${params.dossier.debtOverdueInstallments} parcelas em atraso elevam risco de busca e apreensão.`,
    });
  }

  if (documentInspection) {
    ruleChecks.push({
      ruleCode: 'REGRA-DOC-SELECIONADO',
      ruleTitle: `Leitura do Anexo: ${documentInspection.fileName}`,
      source: 'documentacao',
      status:
        documentInspection.legibility === 'ILEGIVEL' || documentInspection.matchesDossier === 'DIVERGENCIA'
          ? 'IMPEDITIVO'
          : documentInspection.legibility === 'PARCIAL' || documentInspection.matchesDossier === 'NAO_IDENTIFICADO'
          ? 'ATENCAO'
          : 'ATENDE',
      explanation: documentInspection.summary,
    });
  }

  // Evaluate configured Audit Checklist Rules from System Config
  const suggestedChecklistItemIds: number[] = [];
  const docCatNames = params.dossier.documents.map((d) => `${d.docCategory} ${d.fileName}`.toLowerCase()).join(' ');

  for (const rule of params.applicableChecklist) {
    const titleLower = `${rule.title} ${rule.description}`.toLowerCase();
    let status: 'ATENDE' | 'ATENCAO' | 'IMPEDITIVO' = rule.checked ? 'ATENDE' : 'ATENCAO';
    let explanation = rule.checked
      ? 'Item já conferido e marcado pelo auditor.'
      : rule.description || 'Pendente de marcação no checklist de conformidade.';

    if (!rule.checked) {
      const mentionsProxy = /procura/.test(titleLower);
      const mentionsDoc = /rg|cnh|pessoal|identidade|crlv|contrato|resid/.test(titleLower);
      const mentionsLegal = /jurídic|juridic|escavador|busca|process/.test(titleLower);

      if (mentionsProxy && /procur/.test(docCatNames) && (!documentInspection || documentInspection.matchesDossier !== 'DIVERGENCIA')) {
        status = 'ATENDE';
        explanation = 'Procuração detectada no cofre; item apto para marcação automática.';
        suggestedChecklistItemIds.push(rule.id);
      } else if (mentionsDoc && det.missingDocs.length === 0) {
        status = 'ATENDE';
        explanation = 'Documentação essencial localizada no cofre; item apto para marcação.';
        suggestedChecklistItemIds.push(rule.id);
      } else if (mentionsLegal && !params.dossier.escavadorAlert) {
        status = 'ATENDE';
        explanation = 'Sem alertas críticos de busca e apreensão pendentes.';
        suggestedChecklistItemIds.push(rule.id);
      }
    }

    ruleChecks.push({
      ruleCode: `CHK-${String(rule.sortOrder).padStart(2, '0')}`,
      ruleTitle: rule.title,
      source: 'checklist_sistema',
      status,
      explanation,
      checklistItemId: rule.id,
    });
  }

  const hasBlocker = ruleChecks.some((r) => r.status === 'IMPEDITIVO');
  const hasAttention = ruleChecks.some((r) => r.status === 'ATENCAO');
  let recommendedDecision: 'APROVAR' | 'SALVAR_EM_ANALISE' | 'DEVOLVER_ADMISSAO' = hasBlocker
    ? 'DEVOLVER_ADMISSAO'
    : hasAttention
    ? 'SALVAR_EM_ANALISE'
    : 'APROVAR';

  let recommendedDecisionLabel =
    recommendedDecision === 'APROVAR'
      ? 'Aprovar Dossiê & Emitir 2 Boletos'
      : recommendedDecision === 'SALVAR_EM_ANALISE'
      ? 'Manter Em Análise / Conferir Pendências'
      : 'Devolver para Admissão & Comercial';

  const blockersText = ruleChecks
    .filter((r) => r.status === 'IMPEDITIVO')
    .map((r) => `${r.ruleTitle}: ${r.explanation}`);
  const attentionText = ruleChecks
    .filter((r) => r.status === 'ATENCAO')
    .map((r) => `${r.ruleTitle}`);

  let decisionRationale = hasBlocker
    ? `Há impeditivo(s) pelas regras de auditoria: ${blockersText.join(' | ')}`
    : hasAttention
    ? `Pontos que pedem atenção antes da emissão dos boletos: ${attentionText.slice(0, 3).join(', ')}.`
    : `Documento conferido e todas as regras aplicáveis atendidas para o protocolo ${params.dossier.protocolCode}.`;

  let suggestedRejectionReason =
    documentInspection?.suggestedCritiqueText ||
    (det.missingDocs.length > 0
      ? `Para conclusão da auditoria do protocolo ${params.dossier.protocolCode}, favor providenciar: ${det.missingDocs.join(', ')}.`
      : params.dossier.isElectricVehicle
      ? 'Veículo elétrico/híbrido identificado; confirmar política comercial de exceção.'
      : '');

  let providerUsed = documentInspection?.provider === 'gemini' ? 'gemini' : 'local_rules_db';

  // Use Gemini to refine decision rationale only when not skipped (saves AI calls when DB cache/local rules suffice)
  const ai = !params.skipAiRefinement ? getGeminiClient() : null;
  if (ai) {
    try {
      const promptText = [
        `Ficha ${params.dossier.protocolCode} (${params.dossier.clientName} | Banco ${params.dossier.bankName} | Contrato ${params.dossier.contractNumber})`,
        `Modalidade: ${params.dossier.modality} (${params.dossier.debtType}) | Passivo: ${params.dossier.debtAmountFormatted} | 2x Boletos: ${params.dossier.initialInstallmentFormatted}`,
        `Documento atualmente selecionado: ${documentInspection ? `${documentInspection.fileName} -> ${documentInspection.documentDetected} | Legibilidade: ${documentInspection.legibility} | Cruzamento: ${documentInspection.matchesDossier} | Resumo: ${documentInspection.summary}` : 'Nenhum selecionado'}`,
        `Regras avaliadas do sistema:\n${ruleChecks.map((r) => `- [${r.status}] (${r.ruleCode}) ${r.ruleTitle}: ${r.explanation}`).join('\n')}`,
      ].join('\n\n');

      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptText,
        config: {
          systemInstruction:
            'Você é Ivi, assistente de Auditoria do FinancePro. Com base nas regras do sistema e na leitura do documento selecionado, forneça em Português do Brasil uma sugestão objetiva de decisão (APROVAR, SALVAR_EM_ANALISE ou DEVOLVER_ADMISSAO), uma justificativa prática citando as regras relevantes e um rascunho de devolução caso haja pendência ou divergência.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recommendedDecision: {
                type: Type.STRING,
                description: 'APROVAR, SALVAR_EM_ANALISE ou DEVOLVER_ADMISSAO',
              },
              recommendedDecisionLabel: { type: Type.STRING },
              decisionRationale: { type: Type.STRING },
              suggestedRejectionReason: { type: Type.STRING },
            },
            required: ['recommendedDecision', 'recommendedDecisionLabel', 'decisionRationale'],
          },
        },
      });

      const parsed = JSON.parse((res.text || '{}').trim()) as {
        recommendedDecision?: string;
        recommendedDecisionLabel?: string;
        decisionRationale?: string;
        suggestedRejectionReason?: string;
      };

      if (
        parsed.recommendedDecision === 'APROVAR' ||
        parsed.recommendedDecision === 'SALVAR_EM_ANALISE' ||
        parsed.recommendedDecision === 'DEVOLVER_ADMISSAO'
      ) {
        // Keep blocker safety: never recommend APROVAR if deterministic rule found IMPEDITIVO
        if (!hasBlocker) {
          recommendedDecision = parsed.recommendedDecision;
        }
      }
      if (parsed.recommendedDecisionLabel) {
        recommendedDecisionLabel = parsed.recommendedDecisionLabel;
      }
      if (parsed.decisionRationale) {
        decisionRationale = parsed.decisionRationale;
      }
      if (parsed.suggestedRejectionReason) {
        suggestedRejectionReason = parsed.suggestedRejectionReason;
      }
      providerUsed = 'gemini';
    } catch (err) {
      console.warn('Gemini iviGenerateAuditInsightsPanel fallback:', err);
    }
  }

  const inconsistenciesCount = ruleChecks.filter((r) => r.status === 'IMPEDITIVO').length;
  const attentionMeasuresCount = ruleChecks.filter((r) => r.status === 'ATENCAO').length;

  return {
    admissionId: params.admissionId,
    protocolCode: params.dossier.protocolCode,
    analyzedAt: new Date().toISOString(),
    provider: providerUsed,
    recommendedDecision,
    recommendedDecisionLabel,
    decisionRationale,
    suggestedSearchSeizureFlag:
      Boolean(params.dossier.escavadorAlert) ||
      params.dossier.legalProcessesSummary.toLowerCase().includes('busca'),
    suggestedChecklistItemIds,
    suggestedRejectionReason,
    ruleChecks,
    documentInspection,
    availableDocumentsCount: params.dossier.documents.length,
    fromDatabaseCache: false,
    aiCallsSaved: 0,
    inconsistenciesCount,
    attentionMeasuresCount,
  };
}

// =============================================================================
// IVI COBRANÇA & COORDENAÇÃO (WhatsApp 3-Colunas, Insights e Relatórios)
// =============================================================================

export async function iviSummarizeCollectionWhatsapp(params: {
  clientName: string;
  cpfCnpj?: string;
  operatorName: string;
  providerLabel: string;
  openBalanceFormatted: string;
  messages: Array<{
    direction: string;
    senderName: string;
    contentType: string;
    body: string;
    audioTranscript?: string | null;
    createdAt: string;
    provider?: string;
  }>;
}) {
  const transcriptLines = params.messages
    .slice(-35)
    .map((m) => {
      const who = m.direction === 'outbound' ? m.senderName || params.operatorName || 'Operador' : params.clientName;
      const text = m.audioTranscript ? `[Áudio transcrito] ${m.audioTranscript}` : m.body;
      return `- [${m.createdAt}] ${who}: ${text}`;
    })
    .join('\n');

  if (!transcriptLines.trim()) {
    return {
      summary: `Nenhuma mensagem trocada ainda com ${params.clientName} (${params.providerLabel}). Saldo aberto: ${params.openBalanceFormatted}.`,
      sentiment: 'Sem interação registrada',
      commitments: [] as string[],
      recommendedNextStep: 'Iniciar contato ativo pelo WhatsApp enviando lembrete cordial do título em aberto.',
      provider: 'knowledge_fallback',
      analyzedAt: new Date().toISOString(),
    };
  }

  const ai = getGeminiClient();
  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Cliente: ${params.clientName} (${params.cpfCnpj || 'CPF não inf.'}) | Saldo em aberto: ${params.openBalanceFormatted}`,
          `Canal/Provedor: ${params.providerLabel} | Operador: ${params.operatorName || 'Não atribuído'}`,
          `Histórico recente:\n${transcriptLines}`,
        ].join('\n\n'),
        config: {
          systemInstruction:
            'Você é Ivi, analista sênior de Cobrança do FinancePro Assessoria. Analise a conversa de WhatsApp e gere em Português do Brasil um resumo executivo curto, identificando o sentimento/postura do cliente, eventuais compromissos/datas de pagamento combinadas e a próxima ação sugerida para a Coordenação. Baseie-se apenas nas mensagens fornecidas.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              sentiment: { type: Type.STRING },
              commitments: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendedNextStep: { type: Type.STRING },
            },
            required: ['summary', 'sentiment', 'commitments', 'recommendedNextStep'],
          },
        },
      });
      const parsed = JSON.parse((res.text || '{}').trim()) as {
        summary?: string;
        sentiment?: string;
        commitments?: string[];
        recommendedNextStep?: string;
      };
      if (parsed.summary) {
        return {
          summary: parsed.summary,
          sentiment: parsed.sentiment || 'Neutro / Em tratativa',
          commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
          recommendedNextStep:
            parsed.recommendedNextStep || 'Acompanhar promessa de pagamento e conferir baixa no Financeiro.',
          provider: 'gemini',
          analyzedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn('Gemini iviSummarizeCollectionWhatsapp fallback:', err);
    }
  }

  const lastInbound = [...params.messages].reverse().find((m) => m.direction === 'inbound');
  const lastOutbound = [...params.messages].reverse().find((m) => m.direction === 'outbound');
  const commitments: string[] = [];
  const fullTextLower = transcriptLines.toLowerCase();
  if (/amanh|dia \d|segunda|terca|terça|quarta|quinta|sexta|pix|boleto|pagar|comprovante/.test(fullTextLower)) {
    commitments.push('Cliente mencionou intenção/meio de pagamento ou envio de comprovante nas mensagens.');
  }
  if (/cancel|desist|nao vou pagar|não vou pagar|sem condi/.test(fullTextLower)) {
    commitments.push('Sinalização de resistência ou possível pedido de cancelamento detectada no texto.');
  }

  return {
    summary: `Conversa com ${params.messages.length} mensagem(ns) via ${params.providerLabel} atendida por ${params.operatorName || 'equipe'}. ${
      lastInbound
        ? `Último retorno do cliente: "${(lastInbound.audioTranscript || lastInbound.body).slice(0, 120)}".`
        : 'Cliente ainda não respondeu à última abordagem.'
    }`,
    sentiment: commitments.some((c) => c.includes('resistência'))
      ? 'Resistência / Atenção Coordenação'
      : lastInbound
      ? 'Engajado em negociação'
      : 'Aguardando resposta',
    commitments,
    recommendedNextStep: lastOutbound && !lastInbound
      ? 'Realizar follow-up telefônico ou novo lembrete amigável caso não responda hoje.'
      : 'Confirmar data exata do depósito/PIX e anexar comprovante ao lançamento.',
    provider: 'knowledge_fallback',
    analyzedAt: new Date().toISOString(),
  };
}

export interface CollectionPortfolioSnapshot {
  totalActiveCount: number;
  overdueCount: number;
  partialCount: number;
  paidCount: number;
  totalOpenCents: number;
  overdueBalanceCents: number;
  recoveredCents: number;
  unassignedOverdueCount: number;
  unassignedOverdueCents: number;
  over60DaysCount: number;
  over60DaysCents: number;
  blockedWithOpenTitlesCount: number;
  pendingCancelRequestsCount: number;
  partialMissingReceiptCount: number;
  paidMissingReceiptCount: number;
  topBanks: Array<{ bankName: string; overdueCents: number; count: number }>;
  topUfs: Array<{ uf: string; overdueCents: number; count: number }>;
  operatorLoad: Array<{ collaboratorId: number; name: string; count: number; overdueCents: number }>;
}

export async function iviAnalyzeCollectionInsights(snapshot: CollectionPortfolioSnapshot) {
  const fmtBRL = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const detInsights: Array<{
    id: string;
    severity: 'critico' | 'atencao' | 'oportunidade';
    category: string;
    title: string;
    description: string;
    recommendedAction: string;
    filterPreset?: {
      overdueOnly?: boolean;
      filterStatus?: string;
      filterCollaborator?: string;
      filterAgingBucket?: string;
      filterUf?: string;
    };
  }> = [];

  if (snapshot.unassignedOverdueCount > 0) {
    detInsights.push({
      id: 'unassigned-overdue',
      severity: 'critico',
      category: 'Distribuição de Carteira',
      title: `${snapshot.unassignedOverdueCount} título(s) vencido(s) sem operador atribuído`,
      description: `Somam ${fmtBRL(snapshot.unassignedOverdueCents)} parados sem responsável definido na equipe operacional.`,
      recommendedAction: 'Filtrar vencidos sem atribuição e distribuir em lote entre os operadores disponíveis.',
      filterPreset: { overdueOnly: true, filterCollaborator: '__unassigned__' },
    });
  }

  if (snapshot.over60DaysCount > 0) {
    detInsights.push({
      id: 'aging-over-60',
      severity: 'critico',
      category: 'Envelhecimento Crítico (>60d)',
      title: `${snapshot.over60DaysCount} título(s) acima de 60 dias em atraso`,
      description: `Representam ${fmtBRL(snapshot.over60DaysCents)} com alta probabilidade de inadimplência definitiva.`,
      recommendedAction: 'Priorizar renegociação assistida, revisão da Ficha do Cliente ou ação preventiva com coordenação.',
      filterPreset: { overdueOnly: true, filterAgingBucket: '61_90' },
    });
  }

  if (snapshot.partialCount > 0) {
    detInsights.push({
      id: 'partial-followup',
      severity: 'atencao',
      category: 'Recebimentos Parciais',
      title: `${snapshot.partialCount} lançamento(s) com Recebimento Parcial em aberto`,
      description: `${snapshot.partialMissingReceiptCount} ainda não possuem comprovante vinculado no bucket da Invicta.`,
      recommendedAction: 'Cobrar saldo remanescente e anexar o comprovante bancário no lançamento.',
      filterPreset: { filterStatus: 'PARCIAL' },
    });
  }

  if (snapshot.paidMissingReceiptCount > 0) {
    detInsights.push({
      id: 'paid-receipt-audit',
      severity: 'atencao',
      category: 'Compliance Documental',
      title: `${snapshot.paidMissingReceiptCount} Recebimento(s) Total(is) sem comprovante no bucket`,
      description: 'Títulos liquidados sem arquivo de comprovante anexado para auditoria financeira.',
      recommendedAction: 'Filtrar Recebimento Total e anexar comprovantes pendentes no bucket da Invicta.',
      filterPreset: { filterStatus: 'PAGO' },
    });
  }

  if (snapshot.pendingCancelRequestsCount > 0) {
    detInsights.push({
      id: 'pending-cancel-requests',
      severity: 'atencao',
      category: 'Retenção & Cancelamentos',
      title: `${snapshot.pendingCancelRequestsCount} solicitação(ões) de cancelamento aguardando decisão`,
      description: 'Operadores registraram pedidos de cancelamento que exigem análise da coordenação no Dashboard.',
      recommendedAction: 'Revisar as solicitações no Dashboard e espelhar a tela do operador envolvido antes de decidir.',
    });
  }

  if (snapshot.topUfs[0] && snapshot.topUfs[0].overdueCents > 0) {
    detInsights.push({
      id: 'uf-concentration',
      severity: 'oportunidade',
      category: 'Concentração Geográfica',
      title: `Maior concentração vencida em ${snapshot.topUfs[0].uf}`,
      description: `Estado ${snapshot.topUfs[0].uf} concentra ${snapshot.topUfs[0].count} título(s) vencido(s) totalizando ${fmtBRL(snapshot.topUfs[0].overdueCents)}.`,
      recommendedAction: `Direcionar régua e operadores especialistas para o estado ${snapshot.topUfs[0].uf}.`,
      filterPreset: { overdueOnly: true, filterUf: snapshot.topUfs[0].uf },
    });
  }

  const ai = getGeminiClient();
  let executiveHeadline =
    snapshot.overdueCount > 0
      ? `Carteira possui ${snapshot.overdueCount} título(s) vencido(s) (${fmtBRL(snapshot.overdueBalanceCents)}) e ${fmtBRL(snapshot.recoveredCents)} já recuperados.`
      : `Carteira equilibrada: ${fmtBRL(snapshot.recoveredCents)} recuperados com baixo índice de atraso.`;
  let provider = 'knowledge_fallback';

  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: JSON.stringify(snapshot),
        config: {
          systemInstruction:
            'Você é Ivi, estrategista de Cobrança & Governança do FinancePro Assessoria. Com base exclusivamente nos números reais fornecidos em JSON, escreva em Português do Brasil uma manchete executiva (máximo 2 frases) e opcionalmente 1 insight estratégico adicional focado em maximizar a recuperação de caixa e equilibrar a carga entre operadores. Não altere nem invente valores.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveHeadline: { type: Type.STRING },
              extraInsightTitle: { type: Type.STRING },
              extraInsightDescription: { type: Type.STRING },
              extraInsightAction: { type: Type.STRING },
            },
            required: ['executiveHeadline'],
          },
        },
      });
      const parsed = JSON.parse((res.text || '{}').trim()) as {
        executiveHeadline?: string;
        extraInsightTitle?: string;
        extraInsightDescription?: string;
        extraInsightAction?: string;
      };
      if (parsed.executiveHeadline) executiveHeadline = parsed.executiveHeadline;
      if (parsed.extraInsightTitle && parsed.extraInsightDescription) {
        detInsights.unshift({
          id: 'ivi-strategic-top',
          severity: 'oportunidade',
          category: 'Recomendação Ivi IA',
          title: parsed.extraInsightTitle,
          description: parsed.extraInsightDescription,
          recommendedAction: parsed.extraInsightAction || 'Aplicar sugestão na rotina de distribuição e acompanhamento.',
        });
      }
      provider = 'gemini';
    } catch (err) {
      console.warn('Gemini iviAnalyzeCollectionInsights fallback:', err);
    }
  }

  return {
    analyzedAt: new Date().toISOString(),
    provider,
    executiveHeadline,
    insights: detInsights.slice(0, 6),
  };
}

export interface CollectionReportBuildInput {
  reportType: 'carteira_vencida' | 'ranking_operadores' | 'recebimentos' | 'inadimplencia_uf' | 'custom_ivi';
  customPrompt?: string;
  titles: Array<{
    id: number;
    documentNumber: string;
    titleCode: string;
    clientId: number;
    clientName: string;
    clientUf: string;
    bankName: string;
    dueDateIso: string;
    agingDays: number;
    originalValueCents: number;
    currentBalanceCents: number;
    status: string;
    collectionStatus: string;
    collaboratorName: string;
    hasReceipt: boolean;
  }>;
  operatorsRanking: Array<{
    name: string;
    role: string;
    points: number;
    closedRecoveriesCount?: number;
    assignedCount: number;
    overdueCount: number;
    openBalanceCents: number;
    recoveredCount: number;
    recoveredCents: number;
    notesCount: number;
  }>;
}

export async function iviBuildCollectionReport(input: CollectionReportBuildInput) {
  const fmtBRL = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let effectiveType = input.reportType;
  let customFilterMinDays = 0;
  let customOnlyUnassigned = false;
  let customStatusFilter = '';

  const pLower = String(input.customPrompt || '').toLowerCase();
  if (effectiveType === 'custom_ivi' && pLower) {
    if (/ranking|operador|colaborador|ponto|equipe/.test(pLower)) {
      effectiveType = 'ranking_operadores';
    } else if (/receb|pago|parcial|comprovante|liquid/.test(pLower)) {
      effectiveType = 'recebimentos';
    } else if (/estado|uf|regi/.test(pLower)) {
      effectiveType = 'inadimplencia_uf';
    } else {
      effectiveType = 'carteira_vencida';
    }
    if (/sem operador|sem atribu/.test(pLower)) customOnlyUnassigned = true;
    if (/60|sessenta/.test(pLower)) customFilterMinDays = 60;
    else if (/30|trinta/.test(pLower)) customFilterMinDays = 30;
    if (/parcial/.test(pLower)) customStatusFilter = 'PARCIAL';
    else if (/total|pago|liquid/.test(pLower)) customStatusFilter = 'PAGO';
  }

  let title = 'Relatório Ivi de Cobrança';
  let columns: Array<{ key: string; label: string; format?: 'text' | 'currency' | 'number' | 'percent' | 'date' }> = [];
  let rows: Array<Record<string, string | number>> = [];
  let chartSeries: Array<{ label: string; value: number; secondaryValue?: number }> = [];
  let insights: string[] = [];
  let executiveSummary = '';

  if (effectiveType === 'ranking_operadores') {
    title = 'Ranking dos Colaboradores — Fechamentos & Valor Recuperado';
    columns = [
      { key: 'name', label: 'Colaborador', format: 'text' },
      { key: 'closedRecoveriesCount', label: 'Qtd. Recuperações c/ Fechamento', format: 'number' },
      { key: 'recoveredReais', label: 'Valor Financeiro Recuperado', format: 'currency' },
      { key: 'recoveredCount', label: 'Títulos Baixados', format: 'number' },
      { key: 'assignedCount', label: 'Títulos Ativos', format: 'number' },
      { key: 'overdueCount', label: 'Em Atraso', format: 'number' },
      { key: 'openBalanceReais', label: 'Carteira Aberta', format: 'currency' },
      { key: 'notesCount', label: 'Tratativas', format: 'number' },
    ];
    rows = input.operatorsRanking.map((op) => ({
      name: op.name,
      closedRecoveriesCount: op.closedRecoveriesCount ?? op.recoveredCount,
      recoveredReais: Number((op.recoveredCents / 100).toFixed(2)),
      recoveredCount: op.recoveredCount,
      assignedCount: op.assignedCount,
      overdueCount: op.overdueCount,
      openBalanceReais: Number((op.openBalanceCents / 100).toFixed(2)),
      notesCount: op.notesCount,
    }));
    chartSeries = input.operatorsRanking.slice(0, 8).map((op) => ({
      label: op.name,
      value: Math.round(op.recoveredCents / 100),
      secondaryValue: op.closedRecoveriesCount ?? op.recoveredCount,
    }));
    const topByCount = [...input.operatorsRanking].sort(
      (a, b) =>
        (b.closedRecoveriesCount ?? b.recoveredCount) - (a.closedRecoveriesCount ?? a.recoveredCount) ||
        b.recoveredCents - a.recoveredCents
    )[0];
    const topByValue = [...input.operatorsRanking].sort(
      (a, b) =>
        b.recoveredCents - a.recoveredCents ||
        (b.closedRecoveriesCount ?? b.recoveredCount) - (a.closedRecoveriesCount ?? a.recoveredCount)
    )[0];
    executiveSummary = `Ranking consolidado com ${rows.length} colaborador(es). ${
      topByCount
        ? `Líder em quantidade de recuperações com fechamento: ${topByCount.name} (${topByCount.closedRecoveriesCount ?? topByCount.recoveredCount} fechamento(s)). `
        : ''
    }${
      topByValue
        ? `Maior valor financeiro recuperado: ${topByValue.name} (${fmtBRL(topByValue.recoveredCents)}).`
        : ''
    }`;
    insights = [
      `Total recuperado pela equipe: ${fmtBRL(input.operatorsRanking.reduce((s, o) => s + o.recoveredCents, 0))}.`,
      `Total de recuperações com fechamento: ${input.operatorsRanking.reduce((s, o) => s + (o.closedRecoveriesCount ?? o.recoveredCount), 0)}.`,
      `Total de tratativas registradas pela equipe: ${input.operatorsRanking.reduce((s, o) => s + o.notesCount, 0)}.`,
      `Carteira ativa distribuída soma ${fmtBRL(input.operatorsRanking.reduce((s, o) => s + o.openBalanceCents, 0))}.`,
    ];
  } else if (effectiveType === 'recebimentos') {
    title = 'Planilha de Recebimentos Totais vs Parciais & Comprovantes';
    const subset = input.titles.filter((t) => {
      const st = String(t.status || '').toUpperCase();
      if (customStatusFilter) return st === customStatusFilter;
      return st === 'PAGO' || st === 'PARCIAL';
    });
    columns = [
      { key: 'clientName', label: 'Cliente', format: 'text' },
      { key: 'documentNumber', label: 'Documento', format: 'text' },
      { key: 'dueDateIso', label: 'Vencimento', format: 'date' },
      { key: 'statusLabel', label: 'Status Recebimento', format: 'text' },
      { key: 'originalReais', label: 'Valor Original', format: 'currency' },
      { key: 'balanceReais', label: 'Saldo Restante', format: 'currency' },
      { key: 'paidReais', label: 'Valor Recebido', format: 'currency' },
      { key: 'receiptStatus', label: 'Comprovante Bucket', format: 'text' },
      { key: 'collaboratorName', label: 'Responsável', format: 'text' },
    ];
    rows = subset.map((t) => {
      const st = String(t.status || '').toUpperCase();
      const paidCents = Math.max(0, t.originalValueCents - (st === 'PAGO' ? 0 : t.currentBalanceCents));
      return {
        clientName: t.clientName,
        documentNumber: t.documentNumber || t.titleCode,
        dueDateIso: t.dueDateIso,
        statusLabel: st === 'PAGO' ? 'Recebimento Total' : 'Recebimento Parcial',
        originalReais: Number((t.originalValueCents / 100).toFixed(2)),
        balanceReais: Number(((st === 'PAGO' ? 0 : t.currentBalanceCents) / 100).toFixed(2)),
        paidReais: Number((paidCents / 100).toFixed(2)),
        receiptStatus: t.hasReceipt ? 'Anexado no Bucket' : 'Pendente Anexo',
        collaboratorName: t.collaboratorName || 'Sem atribuição',
      };
    });
    const totalPaidCount = subset.filter((t) => String(t.status).toUpperCase() === 'PAGO').length;
    const partialCount = subset.filter((t) => String(t.status).toUpperCase() === 'PARCIAL').length;
    const withReceipt = subset.filter((t) => t.hasReceipt).length;
    chartSeries = [
      { label: 'Recebimento Total', value: totalPaidCount },
      { label: 'Recebimento Parcial', value: partialCount },
      { label: 'Com Comprovante', value: withReceipt },
      { label: 'Sem Comprovante', value: Math.max(0, subset.length - withReceipt) },
    ];
    executiveSummary = `Mapeados ${subset.length} lançamento(s) com recebimento (${totalPaidCount} Totais e ${partialCount} Parciais), sendo ${withReceipt} já auditado(s) com comprovante no Bucket da Invicta.`;
    insights = [
      `${Math.max(0, subset.length - withReceipt)} lançamento(s) ainda aguardam upload do comprovante bancário.`,
      `Valor líquido já recebido nesta visão: ${fmtBRL(rows.reduce((s, r) => s + Number(r.paidReais || 0) * 100, 0))}.`,
    ];
  } else if (effectiveType === 'inadimplencia_uf') {
    title = 'Mapa de Inadimplência por Estado (UF) e Banco';
    const byUf = new Map<string, { uf: string; count: number; overdueCount: number; openCents: number; overdueCents: number }>();
    for (const t of input.titles) {
      if (String(t.status || '').toUpperCase() === 'PAGO') continue;
      const uf = t.clientUf || 'N/I';
      const entry = byUf.get(uf) || { uf, count: 0, overdueCount: 0, openCents: 0, overdueCents: 0 };
      entry.count += 1;
      entry.openCents += t.currentBalanceCents;
      if (t.agingDays > 0) {
        entry.overdueCount += 1;
        entry.overdueCents += t.currentBalanceCents;
      }
      byUf.set(uf, entry);
    }
    const sortedUfs = [...byUf.values()].sort((a, b) => b.overdueCents - a.overdueCents);
    columns = [
      { key: 'uf', label: 'Estado (UF)', format: 'text' },
      { key: 'count', label: 'Títulos Abertos', format: 'number' },
      { key: 'overdueCount', label: 'Títulos Vencidos', format: 'number' },
      { key: 'openReais', label: 'Saldo Aberto', format: 'currency' },
      { key: 'overdueReais', label: 'Saldo Vencido', format: 'currency' },
      { key: 'defaultSharePct', label: '% Inadimplência', format: 'percent' },
    ];
    rows = sortedUfs.map((u) => ({
      uf: u.uf,
      count: u.count,
      overdueCount: u.overdueCount,
      openReais: Number((u.openCents / 100).toFixed(2)),
      overdueReais: Number((u.overdueCents / 100).toFixed(2)),
      defaultSharePct: u.count > 0 ? Number(((u.overdueCount * 100) / u.count).toFixed(1)) : 0,
    }));
    chartSeries = sortedUfs.slice(0, 10).map((u) => ({
      label: u.uf,
      value: Math.round(u.overdueCents / 100),
      secondaryValue: u.overdueCount,
    }));
    const topUf = sortedUfs[0];
    executiveSummary = `Análise geográfica abrangendo ${sortedUfs.length} UF(s). ${
      topUf ? `Maior exposição vencida em ${topUf.uf}: ${fmtBRL(topUf.overdueCents)} (${topUf.overdueCount} título(s)).` : ''
    }`;
    insights = [
      `Total em atraso consolidado entre todos os estados: ${fmtBRL(sortedUfs.reduce((s, u) => s + u.overdueCents, 0))}.`,
    ];
  } else {
    title = input.customPrompt?.trim()
      ? `Planilha Personalizada Ivi: ${input.customPrompt.trim().slice(0, 55)}`
      : 'Planilha Analítica de Carteira Vencida & Aging';
    const subset = input.titles
      .filter((t) => {
        const st = String(t.status || '').toUpperCase();
        if (st === 'PAGO') return false;
        if (customOnlyUnassigned && t.collaboratorName !== 'Sem atribuição') return false;
        if (customFilterMinDays > 0 && t.agingDays < customFilterMinDays) return false;
        if (input.reportType === 'carteira_vencida' && t.agingDays <= 0) return false;
        return true;
      })
      .sort((a, b) => b.agingDays - a.agingDays || b.currentBalanceCents - a.currentBalanceCents)
      .slice(0, 250);

    columns = [
      { key: 'clientName', label: 'Cliente', format: 'text' },
      { key: 'clientUf', label: 'UF', format: 'text' },
      { key: 'documentNumber', label: 'Documento', format: 'text' },
      { key: 'dueDateIso', label: 'Vencimento', format: 'date' },
      { key: 'agingDays', label: 'Dias Atraso', format: 'number' },
      { key: 'statusLabel', label: 'Status', format: 'text' },
      { key: 'balanceReais', label: 'Saldo Devedor', format: 'currency' },
      { key: 'collaboratorName', label: 'Operador', format: 'text' },
    ];
    rows = subset.map((t) => ({
      clientName: t.clientName,
      clientUf: t.clientUf || '—',
      documentNumber: t.documentNumber || t.titleCode,
      dueDateIso: t.dueDateIso,
      agingDays: Math.max(0, t.agingDays),
      statusLabel:
        String(t.status).toUpperCase() === 'PARCIAL'
          ? 'Recebimento Parcial'
          : String(t.status).toUpperCase() === 'PROTESTADO'
          ? 'Protestado'
          : 'Em Aberto',
      balanceReais: Number((t.currentBalanceCents / 100).toFixed(2)),
      collaboratorName: t.collaboratorName || 'Sem atribuição',
    }));

    const bucketTotals = {
      '1-30d': 0,
      '31-60d': 0,
      '61-90d': 0,
      '90+d': 0,
    };
    for (const t of subset) {
      if (t.agingDays <= 30) bucketTotals['1-30d'] += t.currentBalanceCents;
      else if (t.agingDays <= 60) bucketTotals['31-60d'] += t.currentBalanceCents;
      else if (t.agingDays <= 90) bucketTotals['61-90d'] += t.currentBalanceCents;
      else bucketTotals['90+d'] += t.currentBalanceCents;
    }
    chartSeries = Object.entries(bucketTotals).map(([label, cents]) => ({
      label,
      value: Math.round(cents / 100),
    }));
    const totalBalance = subset.reduce((s, t) => s + t.currentBalanceCents, 0);
    const unassignedCount = subset.filter((t) => !t.collaboratorName || t.collaboratorName === 'Sem atribuição').length;
    executiveSummary = `Planilha gerada com ${subset.length} título(s) vencido(s) somando ${fmtBRL(totalBalance)}. ${
      unassignedCount > 0 ? `${unassignedCount} ainda sem operador atribuído.` : 'Toda a amostra já está distribuída.'
    }`;
    insights = [
      `Maior concentração por faixa de atraso: ${
        [...chartSeries].sort((a, b) => b.value - a.value)[0]?.label || '1-30d'
      }.`,
      `${unassignedCount} título(s) vencido(s) sem responsável podem ser atribuídos imediatamente no Grid.`,
    ];
  }

  let provider = 'knowledge_fallback';
  const ai = getGeminiClient();
  if (ai) {
    try {
      const sampleRows = rows.slice(0, 12);
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Título do Relatório: ${title}`,
          input.customPrompt ? `Solicitação do Coordenador: ${input.customPrompt}` : '',
          `Total de linhas geradas: ${rows.length}`,
          `Resumo calculado do banco: ${executiveSummary}`,
          `Série do gráfico: ${JSON.stringify(chartSeries)}`,
          `Primeiras linhas reais: ${JSON.stringify(sampleRows)}`,
        ]
          .filter(Boolean)
          .join('\n'),
        config: {
          systemInstruction:
            'Você é Ivi, analista de BI e Cobrança do FinancePro. A planilha e o gráfico JÁ foram calculados exatamente a partir do banco de dados. Escreva em Português do Brasil um parágrafo executivo objetivo (executiveSummary) e 3 insights práticos baseados exclusivamente nesses dados reais.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: { type: Type.STRING },
              insights: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['executiveSummary', 'insights'],
          },
        },
      });
      const parsed = JSON.parse((res.text || '{}').trim()) as {
        executiveSummary?: string;
        insights?: string[];
      };
      if (parsed.executiveSummary) executiveSummary = parsed.executiveSummary;
      if (Array.isArray(parsed.insights) && parsed.insights.length > 0) {
        insights = parsed.insights.slice(0, 4);
      }
      provider = 'gemini';
    } catch (err) {
      console.warn('Gemini iviBuildCollectionReport narrative fallback:', err);
    }
  }

  return {
    title,
    reportType: effectiveType,
    prompt: input.customPrompt || '',
    executiveSummary,
    insightsJson: insights,
    columnsJson: columns,
    rowsJson: rows,
    chartSeriesJson: chartSeries,
    provider,
  };
}

export interface NegotiationAdvisorContextInput {
  negotiationId: number;
  clientName: string;
  clientCpfCnpj?: string;
  bankName: string;
  contractNumber: string;
  originalDebtCents: number;
  negotiationStatus: string;
  targetReductionPct: number;
  currentReductionPct: number;
  collaboratorName: string;
  nextContactDate?: string | null;
  nextContactDescription?: string | null;
  notes?: string;
  bankServices: Array<{
    name: string;
    modalityDescription: string;
    negotiationPercent: string;
    defaultInstallments: number;
  }>;
  bankContacts: Array<{
    id: number;
    name: string;
    sector: string;
    phone: string;
    mobile: string;
    isWhatsapp: boolean;
    email: string;
  }>;
  selectedBankContactName?: string;
  contacts: Array<{
    date: string;
    type: string;
    result: string;
    target?: string;
    bankContactName?: string;
    description: string;
    responsible: string;
  }>;
  proposals: Array<{
    date: string;
    origin: string;
    proposedValue: string;
    discountPercentage?: string;
    installments?: number;
    status: string;
    notes?: string;
  }>;
  clientWhatsappMessages: Array<{
    direction: string;
    senderName: string;
    body: string;
    audioTranscript?: string | null;
    createdAt: string;
  }>;
  bankWhatsappMessages: Array<{
    direction: string;
    senderName: string;
    body: string;
    audioTranscript?: string | null;
    createdAt: string;
  }>;
}

export async function iviAnalyzeNegotiationAdvisor(input: NegotiationAdvisorContextInput) {
  const fmtBRL = (cents: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

  const maxServiceCeilingPct = input.bankServices.reduce((acc, s) => {
    const pct = parseFloat(String(s.negotiationPercent || '0').replace(',', '.'));
    return Number.isFinite(pct) && pct > acc ? pct : acc;
  }, 0);

  const recommendedDiscountPct = Math.max(
    input.targetReductionPct || 50,
    maxServiceCeilingPct > 0 ? Math.round(maxServiceCeilingPct) : 55
  );
  const recommendedTargetValueCents = Math.max(
    10000,
    Math.round(input.originalDebtCents * (1 - recommendedDiscountPct / 100))
  );
  const recommendedInstallments =
    input.bankServices[0]?.defaultInstallments && input.bankServices[0].defaultInstallments > 0
      ? input.bankServices[0].defaultInstallments
      : 12;

  const primaryBankContact =
    input.bankContacts.find((c) => c.name === input.selectedBankContactName) ||
    input.bankContacts[0] ||
    null;

  const clientMsgCount = input.clientWhatsappMessages.length;
  const bankMsgCount = input.bankWhatsappMessages.length;
  const lastClientMsg = input.clientWhatsappMessages[input.clientWhatsappMessages.length - 1];
  const lastBankMsg = input.bankWhatsappMessages[input.bankWhatsappMessages.length - 1];
  const latestProposal = input.proposals[input.proposals.length - 1];

  let summaryClient =
    clientMsgCount > 0
      ? `Canal WhatsApp Cliente possui ${clientMsgCount} mensagem(ns). Última interação de ${lastClientMsg.senderName}: "${(lastClientMsg.audioTranscript || lastClientMsg.body).slice(0, 140)}". Cliente aguarda posicionamento objetivo sobre desconto e condições de quitação.`
      : `Sem histórico recente de WhatsApp com ${input.clientName}. Recomenda-se alinhar disponibilidade de recursos à vista ou entrada antes de formalizar contraproposta ao ${input.bankName}.`;

  let summaryBank =
    bankMsgCount > 0
      ? `Canal WhatsApp Contato do Banco (${primaryBankContact ? `${primaryBankContact.name} · ${primaryBankContact.sector}` : input.bankName}) registra ${bankMsgCount} mensagem(ns). Último retorno: "${(lastBankMsg.audioTranscript || lastBankMsg.body).slice(0, 140)}".`
      : primaryBankContact
      ? `Contato bancário vinculado: ${primaryBankContact.name} (${primaryBankContact.sector} — ${primaryBankContact.mobile || primaryBankContact.phone}). Ainda sem troca de mensagens diretas neste dossiê.`
      : `Nenhum contato bancário acionado via WhatsApp até o momento para ${input.bankName}.`;

  let strategicDiagnosis = `Dívida original de ${fmtBRL(input.originalDebtCents)} no contrato ${input.contractNumber || 'S/N'} (${input.bankName}). ${
    maxServiceCeilingPct > 0
      ? `A política cadastrada para ${input.bankName} permite teto de referência de até ${maxServiceCeilingPct}% de deságio em até ${recommendedInstallments}x.`
      : `Meta operacional posicionada em ${recommendedDiscountPct}% de redução.`
  } ${
    latestProposal
      ? `Última proposta registrada (${latestProposal.origin}) em R$ ${latestProposal.proposedValue} (${latestProposal.discountPercentage || '0'}% desc.) encontra-se com status ${latestProposal.status}.`
      : 'Ainda não há propostas formalizadas; abrir negociação com ancoragem técnica.'
  }`;

  let nextBestActions: string[] = [
    primaryBankContact
      ? `Acionar ${primaryBankContact.name} (${primaryBankContact.sector} - ${input.bankName}) apresentando proposta ancorada em ${fmtBRL(recommendedTargetValueCents)} (${recommendedDiscountPct}% de desconto).`
      : `Vincular um contato da mesa de negociação do ${input.bankName} e formalizar proposta inicial.`,
    `Confirmar com o cliente ${input.clientName} o limite de liquidez imediata para pagamento à vista (boleto único) ou entrada + ${recommendedInstallments} parcelas.`,
    input.nextContactDate
      ? `Cumprir agendamento de próximo contato programado para ${input.nextContactDate}${input.nextContactDescription ? ` (${input.nextContactDescription})` : ''}.`
      : `Agendar data de próximo follow-up na Ficha da Negociação para não perder janela de fechamento mensal.`,
  ];

  let suggestedBankWhatsappDraft = `Olá ${primaryBankContact ? primaryBankContact.name : `equipe ${input.bankName}`}, tudo bem? Aqui é ${input.collaboratorName || 'da equipe de Negociação Bancária'}. Referente ao cliente ${input.clientName} (Contrato ${input.contractNumber || 'em análise'}, saldo de ${fmtBRL(input.originalDebtCents)}), temos autorização para fechamento imediato mediante liquidação por ${fmtBRL(recommendedTargetValueCents)} (${recommendedDiscountPct}% de deságio) à vista ou em até ${recommendedInstallments}x. Conseguimos aprovar nessa alçada hoje para emissão do acordo?`;

  let suggestedClientWhatsappDraft = `Olá ${input.clientName}, tudo bem? Aqui é ${input.collaboratorName || 'seu consultor de negociação'}. Estamos avançando nas tratativas do seu contrato junto ao ${input.bankName}. Nossa meta técnica está posicionada na faixa de ${fmtBRL(recommendedTargetValueCents)} (redução aproximada de ${recommendedDiscountPct}%). Assim que a mesa do banco validar a alçada, te envio os detalhes para sua aprovação final!`;

  let riskAlerts: string[] = [];
  if (!input.nextContactDate) {
    riskAlerts.push('Negociação sem data de Próximo Contato agendada.');
  }
  if (input.proposals.length === 0) {
    riskAlerts.push('Nenhuma proposta formal registrada no histórico da negociação.');
  }
  if (input.contacts.length === 0) {
    riskAlerts.push('Nenhum acionamento registrado na linha do tempo de contatos.');
  }
  if (riskAlerts.length === 0) {
    riskAlerts.push('Fluxo operacional em dia — manter acompanhamento da resposta da mesa bancária.');
  }

  let provider = 'knowledge_fallback';
  const ai = getGeminiClient();
  if (ai) {
    try {
      const promptLines = [
        `Negociação #${input.negotiationId} | Status: ${input.negotiationStatus}`,
        `Cliente: ${input.clientName} (${input.clientCpfCnpj || 'CPF/CNPJ não informado'})`,
        `Banco: ${input.bankName} | Contrato: ${input.contractNumber || 'S/N'}`,
        `Valor Original da Dívida: ${fmtBRL(input.originalDebtCents)}`,
        `Negociador Responsável: ${input.collaboratorName}`,
        `Teto de Serviços Cadastrados no Banco: ${JSON.stringify(input.bankServices)}`,
        `Contatos do Banco Cadastrados: ${JSON.stringify(input.bankContacts)}`,
        `Histórico de Contatos Realizados (${input.contacts.length}): ${JSON.stringify(input.contacts.slice(-8))}`,
        `Histórico de Propostas (${input.proposals.length}): ${JSON.stringify(input.proposals.slice(-6))}`,
        `Mensagens de WhatsApp com o Cliente (${input.clientWhatsappMessages.length}): ${JSON.stringify(input.clientWhatsappMessages.slice(-10))}`,
        `Mensagens de WhatsApp com o Contato do Banco (${input.bankWhatsappMessages.length}): ${JSON.stringify(input.bankWhatsappMessages.slice(-10))}`,
        `Observações Internas: ${input.notes || 'Sem observações'}`,
      ].join('\n');

      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptLines,
        config: {
          systemInstruction:
            'Você é a Ivi IA, Assessora Sênior de Negociações Bancárias do FinancePro. Analise o dossiê da negociação, os contatos e parâmetros do banco, as propostas e as conversas de WhatsApp tanto do Cliente quanto do Contato do Banco. Retorne em Português do Brasil resumos executivos das conversas (Cliente e Banco), diagnóstico estratégico de alçada, recomendações práticas, alertas de risco e duas minutas prontas de WhatsApp (uma técnica para o contato do banco e uma clara/acolhedora para o cliente).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summaryClient: { type: Type.STRING },
              summaryBank: { type: Type.STRING },
              strategicDiagnosis: { type: Type.STRING },
              recommendedDiscountPct: { type: Type.NUMBER },
              recommendedInstallments: { type: Type.NUMBER },
              nextBestActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedBankWhatsappDraft: { type: Type.STRING },
              suggestedClientWhatsappDraft: { type: Type.STRING },
              riskAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'summaryClient',
              'summaryBank',
              'strategicDiagnosis',
              'recommendedDiscountPct',
              'recommendedInstallments',
              'nextBestActions',
              'suggestedBankWhatsappDraft',
              'suggestedClientWhatsappDraft',
              'riskAlerts',
            ],
          },
        },
      });

      const parsed = JSON.parse((res.text || '{}').trim());
      if (parsed.summaryClient) summaryClient = parsed.summaryClient;
      if (parsed.summaryBank) summaryBank = parsed.summaryBank;
      if (parsed.strategicDiagnosis) strategicDiagnosis = parsed.strategicDiagnosis;
      if (typeof parsed.recommendedDiscountPct === 'number' && parsed.recommendedDiscountPct > 0 && parsed.recommendedDiscountPct <= 95) {
        // recalculate target value
        const pct = Math.round(parsed.recommendedDiscountPct);
        const targetCents = Math.max(10000, Math.round(input.originalDebtCents * (1 - pct / 100)));
        if (Array.isArray(parsed.nextBestActions) && parsed.nextBestActions.length > 0) {
          nextBestActions = parsed.nextBestActions.slice(0, 4);
        }
        if (parsed.suggestedBankWhatsappDraft) suggestedBankWhatsappDraft = parsed.suggestedBankWhatsappDraft;
        if (parsed.suggestedClientWhatsappDraft) suggestedClientWhatsappDraft = parsed.suggestedClientWhatsappDraft;
        if (Array.isArray(parsed.riskAlerts) && parsed.riskAlerts.length > 0) {
          riskAlerts = parsed.riskAlerts.slice(0, 4);
        }
        provider = 'gemini';
        return {
          summaryClient,
          summaryBank,
          strategicDiagnosis,
          recommendedDiscountPct: pct,
          recommendedTargetValueCents: targetCents,
          recommendedInstallments:
            typeof parsed.recommendedInstallments === 'number' && parsed.recommendedInstallments > 0
              ? Math.round(parsed.recommendedInstallments)
              : recommendedInstallments,
          nextBestActions,
          suggestedBankWhatsappDraft,
          suggestedClientWhatsappDraft,
          riskAlerts,
          provider,
          generatedAt: new Date().toISOString(),
        };
      }
      if (Array.isArray(parsed.nextBestActions) && parsed.nextBestActions.length > 0) {
        nextBestActions = parsed.nextBestActions.slice(0, 4);
      }
      if (parsed.suggestedBankWhatsappDraft) suggestedBankWhatsappDraft = parsed.suggestedBankWhatsappDraft;
      if (parsed.suggestedClientWhatsappDraft) suggestedClientWhatsappDraft = parsed.suggestedClientWhatsappDraft;
      if (Array.isArray(parsed.riskAlerts) && parsed.riskAlerts.length > 0) {
        riskAlerts = parsed.riskAlerts.slice(0, 4);
      }
      provider = 'gemini';
    } catch (err) {
      console.warn('Gemini iviAnalyzeNegotiationAdvisor fallback:', err);
    }
  }

  return {
    summaryClient,
    summaryBank,
    strategicDiagnosis,
    recommendedDiscountPct,
    recommendedTargetValueCents,
    recommendedInstallments,
    nextBestActions,
    suggestedBankWhatsappDraft,
    suggestedClientWhatsappDraft,
    riskAlerts,
    provider,
    generatedAt: new Date().toISOString(),
  };
}

export async function iviAskNegotiationCopilot(params: {
  question: string;
  context: NegotiationAdvisorContextInput;
}) {
  const advisor = await iviAnalyzeNegotiationAdvisor(params.context);
  const ai = getGeminiClient();
  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Pergunta do Operador: ${params.question}`,
          `Contexto da Negociação (#${params.context.negotiationId} - ${params.context.clientName} vs ${params.context.bankName}):`,
          `Diagnóstico: ${advisor.strategicDiagnosis}`,
          `Resumo Cliente: ${advisor.summaryClient}`,
          `Resumo Banco: ${advisor.summaryBank}`,
          `Contatos do Banco: ${JSON.stringify(params.context.bankContacts)}`,
          `Propostas: ${JSON.stringify(params.context.proposals)}`,
        ].join('\n'),
        config: {
          systemInstruction:
            'Você é a Ivi IA, Assessora de Negociações Bancárias. Responda diretamente à dúvida do operador com argumentação técnica bancária, cálculo objetivo de deságio/parcelamento e orientação prática de fechamento em Português do Brasil (máximo 2 parágrafos curtos).',
        },
      });
      const text = (res.text || '').trim();
      if (text) {
        return {
          answer: text,
          provider: 'gemini',
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn('Gemini iviAskNegotiationCopilot fallback:', err);
    }
  }

  return {
    answer: `Com base no dossiê de ${params.context.clientName} junto ao ${params.context.bankName}: ${advisor.strategicDiagnosis} Sugiro atuar com desconto-alvo de ${advisor.recommendedDiscountPct}% e acionar o contato bancário com a minuta recomendada.`,
    provider: 'knowledge_fallback',
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// ANÁLISES & CONSULTAS -> FORMULÁRIOS: ARQUITETA DE FORMULÁRIOS IVI IA
// =============================================================================

const ALLOWED_FORM_FIELD_TYPES = new Set<CustomFormField['type']>([
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'select',
  'radio',
  'checkbox_group',
  'boolean',
  'rating',
  'cpf_cnpj',
  'phone',
  'email',
  'file_note',
  'section_header',
]);

function sanitizeGeneratedFields(rawFields: unknown[]): CustomFormField[] {
  if (!Array.isArray(rawFields)) return [];
  const usedKeys = new Set<string>();
  return rawFields
    .map((item, idx): CustomFormField | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const rawType = String(obj.type || 'text').trim() as CustomFormField['type'];
      const type = ALLOWED_FORM_FIELD_TYPES.has(rawType) ? rawType : 'text';
      const label = String(obj.label || `Campo ${idx + 1}`).trim().slice(0, 140);
      if (!label) return null;
      let baseKey = String(obj.key || label)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
      if (!baseKey) baseKey = `campo_${idx + 1}`;
      let uniqueKey = baseKey;
      let suffix = 2;
      while (usedKeys.has(uniqueKey)) {
        uniqueKey = `${baseKey}_${suffix++}`;
      }
      usedKeys.add(uniqueKey);

      const options = Array.isArray(obj.options)
        ? obj.options
            .map((o) => String(o || '').trim())
            .filter(Boolean)
            .slice(0, 20)
        : undefined;

      return {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: uniqueKey,
        label,
        type,
        required: type === 'section_header' ? false : Boolean(obj.required),
        placeholder: obj.placeholder ? String(obj.placeholder).slice(0, 120) : undefined,
        helpText: obj.helpText ? String(obj.helpText).slice(0, 240) : undefined,
        options:
          options && options.length > 0
            ? options
            : type === 'select' || type === 'radio' || type === 'checkbox_group'
            ? ['Opção 1', 'Opção 2', 'Opção 3']
            : undefined,
        width: obj.width === 'half' && type !== 'section_header' && type !== 'textarea' ? 'half' : 'full',
        maxRating: type === 'rating' ? (Number(obj.maxRating) === 10 ? 10 : 5) : undefined,
        weight: typeof obj.weight === 'number' ? obj.weight : undefined,
      };
    })
    .filter((f): f is CustomFormField => f !== null);
}

function buildHeuristicFormFromPrompt(params: {
  prompt: string;
  category?: string;
  linkedEntity?: string;
  baseTemplate?: { title: string; description?: string; fields: CustomFormField[] } | null;
}): {
  title: string;
  description: string;
  category: string;
  linkedEntity: string;
  fields: CustomFormField[];
  settings: CustomFormSettings;
} {
  const lower = (params.prompt || '').toLowerCase();
  if (params.baseTemplate && params.baseTemplate.fields.length > 0) {
    return {
      title: `${params.baseTemplate.title} (Adaptado Ivi)`,
      description:
        params.prompt.trim() ||
        params.baseTemplate.description ||
        'Formulário estruturado a partir de modelo corporativo.',
      category: params.category || 'operacional',
      linkedEntity: params.linkedEntity || 'cliente',
      fields: params.baseTemplate.fields.map((f) => ({
        ...f,
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
      })),
      settings: {
        submitLabel: 'Registrar Formulário',
        successMessage: 'Respostas registradas e disponibilizadas para consulta.',
        autoScoreEnabled: true,
        iviAutoAnalyze: true,
        requiresReview: true,
      },
    };
  }

  const isNps = /nps|satisfa|pesquisa|feedback|atendimento/.test(lower);
  const isVehicle = /veicul|carro|moto|busca|apreens|fipe|renavam|placa/.test(lower);
  const isAudit = /auditor|checklist|confer|boleto|protocolo|document/.test(lower);

  const fields: CustomFormField[] = [
    {
      id: `fld_${crypto.randomBytes(4).toString('hex')}`,
      key: 'bloco_identificacao',
      label: '1. Identificação & Vínculo',
      type: 'section_header',
      required: false,
      width: 'full',
    },
    {
      id: `fld_${crypto.randomBytes(4).toString('hex')}`,
      key: 'nome_responsavel_preenchimento',
      label: 'Nome Completo / Solicitante',
      type: 'text',
      required: true,
      width: 'half',
    },
    {
      id: `fld_${crypto.randomBytes(4).toString('hex')}`,
      key: 'cpf_cnpj_titular',
      label: 'CPF / CNPJ',
      type: 'cpf_cnpj',
      required: false,
      width: 'half',
    },
  ];

  if (isVehicle) {
    fields.push(
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'bloco_veiculo',
        label: '2. Dados do Veículo & Risco Processual',
        type: 'section_header',
        required: false,
        width: 'full',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'placa_modelo_veiculo',
        label: 'Placa e Modelo do Veículo',
        type: 'text',
        required: true,
        width: 'half',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'saldo_devedor_estimado',
        label: 'Saldo Devedor Estimado (R$)',
        type: 'currency',
        required: true,
        width: 'half',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'risco_busca_apreensao',
        label: 'Há notificação extrajudicial ou mandado de busca e apreensão?',
        type: 'radio',
        options: ['Não há risco imediato', 'Notificação recebida', 'Ação judicial ativa / Urgente'],
        required: true,
        width: 'full',
      }
    );
  } else if (isNps) {
    fields.push(
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'nota_atendimento',
        label: 'Em uma escala de 0 a 10, qual a probabilidade de recomendar nossa assessoria?',
        type: 'rating',
        maxRating: 10,
        required: true,
        width: 'full',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'clareza_consultor',
        label: 'O consultor explicou claramente prazos, honorários e metas de desconto?',
        type: 'boolean',
        required: true,
        width: 'half',
      }
    );
  } else if (isAudit) {
    fields.push(
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'documentos_conferidos',
        label: 'Documentos Obrigatórios Validados',
        type: 'checkbox_group',
        options: [
          'Contrato de Prestação de Serviços assinado',
          'Procuração Ad Judicia válida',
          'Cédula de Crédito Bancário (CCB) legível',
          'Comprovante de pagamento da entrada',
        ],
        required: true,
        width: 'full',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'parecer_conformidade',
        label: 'Parecer Final de Conformidade',
        type: 'select',
        options: ['Aprovado sem ressalvas', 'Aprovado com ressalva', 'Devolvido para correção'],
        required: true,
        width: 'half',
      }
    );
  } else {
    fields.push(
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'valor_referencia',
        label: 'Valor Envolvido / Orçamento (R$)',
        type: 'currency',
        required: false,
        width: 'half',
      },
      {
        id: `fld_${crypto.randomBytes(4).toString('hex')}`,
        key: 'prioridade_tratativa',
        label: 'Prioridade da Análise',
        type: 'select',
        options: ['Normal', 'Alta', 'Crítica / Urgente'],
        required: true,
        width: 'half',
      }
    );
  }

  fields.push({
    id: `fld_${crypto.randomBytes(4).toString('hex')}`,
    key: 'observacoes_complementares',
    label: 'Observações & Encaminhamentos',
    type: 'textarea',
    required: false,
    placeholder: 'Detalhe pontos relevantes para consulta e análise posterior...',
    width: 'full',
  });

  return {
    title: isVehicle
      ? 'Formulário de Triagem Veicular & Risco'
      : isNps
      ? 'Pesquisa de Satisfação & NPS'
      : isAudit
      ? 'Checklist Estruturado de Auditoria'
      : 'Formulário Personalizado de Análise',
    description: params.prompt.trim().slice(0, 240) || 'Formulário corporativo criado com apoio da Ivi IA.',
    category: params.category || (isNps ? 'nps' : isAudit ? 'auditoria' : 'operacional'),
    linkedEntity: params.linkedEntity || 'cliente',
    fields,
    settings: {
      submitLabel: 'Enviar Resposta',
      successMessage: 'Formulário enviado e protocolado com sucesso.',
      autoScoreEnabled: isNps,
      iviAutoAnalyze: true,
      requiresReview: !isNps,
    },
  };
}

export async function iviGenerateFormFromPromptOrModel(params: {
  prompt: string;
  category?: string;
  linkedEntity?: string;
  baseTemplate?: { title: string; description?: string; fields: CustomFormField[] } | null;
  referenceFile?: { mimeType: string; buffer: Buffer; fileName: string } | null;
}): Promise<{
  title: string;
  description: string;
  category: string;
  linkedEntity: string;
  fields: CustomFormField[];
  settings: CustomFormSettings;
  provider: string;
}> {
  const ai = getGeminiClient();
  const baseTextParts: string[] = [
    `Solicitação do usuário: ${params.prompt || 'Gerar formulário estruturado corporativo completo.'}`,
    params.category ? `Categoria sugerida: ${params.category}` : '',
    params.linkedEntity ? `Entidade de vínculo sugerida: ${params.linkedEntity}` : '',
    params.baseTemplate
      ? `Modelo base para adaptar:\nTítulo: ${params.baseTemplate.title}\nCampos atuais: ${JSON.stringify(
          params.baseTemplate.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options }))
        )}`
      : '',
  ].filter(Boolean);

  if (ai) {
    try {
      const contentsParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      if (params.referenceFile) {
        let mime = (params.referenceFile.mimeType || '').toLowerCase();
        const lowerName = (params.referenceFile.fileName || '').toLowerCase();
        if (!mime || mime === 'application/octet-stream' || mime === 'application/x-pdf') {
          if (lowerName.endsWith('.pdf')) mime = 'application/pdf';
          else if (lowerName.endsWith('.png')) mime = 'image/png';
          else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) mime = 'image/jpeg';
          else if (lowerName.endsWith('.webp')) mime = 'image/webp';
        }
        if (mime.startsWith('image/') || mime === 'application/pdf') {
          contentsParts.push({
            inlineData: {
              mimeType: mime,
              data: params.referenceFile.buffer.toString('base64'),
            },
          });
          baseTextParts.push(
            `Arquivo modelo anexado: "${params.referenceFile.fileName}" (${mime}). Extraia fielmente todas as seções, perguntas, tipos de campos e regras presentes neste arquivo modelo e combine com o prompt.`
          );
        } else {
          const textExtract = params.referenceFile.buffer.toString('utf8').slice(0, 14000);
          baseTextParts.push(
            `Conteúdo do arquivo modelo anexado ("${params.referenceFile.fileName}"):\n---\n${textExtract}\n---`
          );
        }
      }

      contentsParts.push({ text: baseTextParts.join('\n\n') });

      const aiPromise = ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: contentsParts },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: [
            'Você é a Ivi IA, arquiteta especialista em formulários corporativos e processos de assessoria bancária/jurídica do FinancePro.',
            'Transforme o prompt, modelo base e/ou arquivo anexado em um formulário completo, bem organizado com blocos (section_header), validações reais e rótulos claros em Português do Brasil.',
            'Tipos de campo permitidos: text, textarea, number, currency, date, select, radio, checkbox_group, boolean, rating, cpf_cnpj, phone, email, file_note, section_header.',
            'Para select, radio e checkbox_group, sempre preencha options com alternativas realistas.',
            'Para layout limpo, use width="half" em pares de campos curtos (ex: CPF + Telefone, Data + Valor) e width="full" em section_header, textarea, radio e checkbox_group.',
          ].join(' '),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              category: { type: Type.STRING },
              linkedEntity: { type: Type.STRING },
              submitLabel: { type: Type.STRING },
              autoScoreEnabled: { type: Type.BOOLEAN },
              requiresReview: { type: Type.BOOLEAN },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    label: { type: Type.STRING },
                    type: { type: Type.STRING },
                    required: { type: Type.BOOLEAN },
                    placeholder: { type: Type.STRING },
                    helpText: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    width: { type: Type.STRING },
                    maxRating: { type: Type.INTEGER },
                  },
                  required: ['label', 'type'],
                },
              },
            },
            required: ['title', 'fields'],
          },
        },
      });

      const res = await Promise.race([
        aiPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timeout (22s)')), 22000)
        ),
      ]);

      const rawJson = (res.text || '{}')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(rawJson) as {
        title?: string;
        description?: string;
        category?: string;
        linkedEntity?: string;
        submitLabel?: string;
        autoScoreEnabled?: boolean;
        requiresReview?: boolean;
        fields?: unknown[];
      };

      const fields = sanitizeGeneratedFields(parsed.fields || []);
      if (fields.length > 0) {
        return {
          title: (parsed.title || 'Formulário Estruturado (Ivi IA)').trim().slice(0, 140),
          description: (parsed.description || params.prompt || '').trim().slice(0, 400),
          category: params.category || parsed.category || 'operacional',
          linkedEntity: params.linkedEntity || parsed.linkedEntity || 'cliente',
          fields,
          settings: {
            submitLabel: parsed.submitLabel || 'Enviar Resposta',
            successMessage: 'Formulário protocolado e disponível para análise.',
            autoScoreEnabled: Boolean(parsed.autoScoreEnabled),
            iviAutoAnalyze: true,
            requiresReview: parsed.requiresReview !== false,
          },
          provider: 'gemini',
        };
      }
    } catch (err) {
      console.warn('Gemini iviGenerateFormFromPromptOrModel fallback:', err);
    }
  }

  const fallback = buildHeuristicFormFromPrompt(params);
  return { ...fallback, provider: 'knowledge_fallback' };
}

export async function iviAnalyzeFormSubmission(params: {
  formTitle: string;
  formCategory: string;
  clientName?: string;
  fields: CustomFormField[];
  answers: Record<string, unknown>;
}): Promise<{
  classification: string;
  summary: string;
  recommendedAction: string;
  provider: string;
}> {
  const ai = getGeminiClient();
  const formattedPairs = params.fields
    .filter((f) => f.type !== 'section_header')
    .map((f) => `- ${f.label}: ${JSON.stringify(params.answers[f.key] ?? 'Não informado')}`)
    .join('\n');

  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Formulário: ${params.formTitle} (${params.formCategory})\nCliente: ${
          params.clientName || 'Não vinculado'
        }\nRespostas:\n${formattedPairs}`,
        config: {
          systemInstruction:
            'Você é Ivi IA, analista de qualidade e governança do FinancePro. Resuma objetivamente as respostas preenchidas, aponte riscos ou pendências e indique a próxima ação recomendada em Português do Brasil.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              classification: { type: Type.STRING },
              summary: { type: Type.STRING },
              recommendedAction: { type: Type.STRING },
            },
            required: ['classification', 'summary'],
          },
        },
      });
      const parsed = JSON.parse((res.text || '{}').trim()) as {
        classification?: string;
        summary?: string;
        recommendedAction?: string;
      };
      if (parsed.summary) {
        return {
          classification: parsed.classification || 'Conforme / Analisado',
          summary: parsed.summary,
          recommendedAction: parsed.recommendedAction || 'Seguir fluxo padrão de análise.',
          provider: 'gemini',
        };
      }
    } catch (err) {
      console.warn('Gemini iviAnalyzeFormSubmission fallback:', err);
    }
  }

  const answeredCount = params.fields.filter(
    (f) => f.type !== 'section_header' && params.answers[f.key] !== undefined && params.answers[f.key] !== ''
  ).length;
  const totalCount = Math.max(1, params.fields.filter((f) => f.type !== 'section_header').length);

  return {
    classification: answeredCount === totalCount ? 'Completo' : 'Parcialmente Preenchido',
    summary: `Preenchidos ${answeredCount} de ${totalCount} campos no formulário "${params.formTitle}"${
      params.clientName ? ` para ${params.clientName}` : ''
    }.`,
    recommendedAction: 'Validar evidências anexadas e definir status da triagem.',
    provider: 'knowledge_fallback',
  };
}

function detectNoDoubtPhrase(text: string): boolean {
  const norm = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, '')
    .trim();
  if (!norm || norm.length > 65) return false;
  return /^(n[aã]o|sem d[uú]vidas?|nenhuma d[uú]vida|nenhuma|zero d[uú]vidas?|tudo certo|tudo ok|ok|beleza|show|entendi|entendido|perfeito|claro|pode seguir|pode passar|pr[oó]xima|bora|segue|nada a perguntar)(\b.*)?$/.test(
    norm
  );
}

const MODULE_KEY_TO_PT_TITLE: Record<string, string> = {
  diagrama_integracao: 'Diagrama Geral de Integração do Sistema',
  login: 'Acesso Corporativo & Dupla Verificação (LGPD)',
  home: 'Home Corporativa',
  overview: 'Visão Executiva',
  managerial_dashboard: 'Dashboard Gerencial',
  appointments: 'Agendamentos',
  cadastros_comuns: 'Cadastros Comuns',
  prospection: 'Prospecção & Atendimento',
  admission: 'Admissão & Dossiê',
  audit: 'Auditoria & Boletos',
  legal: 'Jurídico & Escavador',
  negotiations: 'Negociações Bancárias',
  internal_messaging: 'Mensageria Interna (Ivi)',
  finance: 'Administração Financeira',
  collection: 'Cobrança & Ranking',
  forms: 'Formulários Personalizados',
  reports: 'Relatórios Gerais',
  acomp_juridico: 'Acompanhamento Jurídico',
  config: 'Governança & Configurações',
  backup_restore: 'Backup & Restore (Google Drive)',
  training_docs: 'Treinamento & Docs Ivi',
};

export function humanizeSystemDocText(text: string): string {
  let out = String(text || '');
  const replacements: Array<[RegExp, string]> = [
    [/\bAPI\s+\/api\/auth\/captcha\b/gi, 'Tela de Acesso Corporativo (Desafios de Verificação)'],
    [/\bAPI\s+\/api\/auth\/login\b/gi, 'Tela de Acesso Corporativo (Validação de Entrada)'],
    [/\/api\/auth\/captcha\b/gi, 'Desafios de Verificação do Acesso Corporativo'],
    [/\/api\/auth\/login\b/gi, 'Validação de Entrada do Acesso Corporativo'],
    [/\/api\/[a-z0-9_/-]+/gi, 'rotina do sistema'],
    [/\baudit_logs\b/gi, 'Auditoria Geral'],
    [/\bsystem_module_docs\b/gi, 'Documentação dos Módulos'],
    [/\btraining_sessions\b/gi, 'Progresso do Treinamento'],
    [/\bcheckbox_group\b/gi, 'Múltipla Escolha'],
    [/\bgoogle\s+classroom\b|\bsala\s+de\s+aula\s+do\s+google\b|\bclassroom\b/gi, 'Sala de Aula da Invicta'],
  ];
  for (const [rx, rep] of replacements) {
    out = out.replace(rx, rep);
  }
  out = out.replace(
    /\b(diagrama_integracao|login|home|overview|managerial_dashboard|appointments|cadastros_comuns|prospection|admission|audit|legal|negotiations|internal_messaging|finance|collection|forms|reports|acomp_juridico|config|backup_restore|training_docs)\b/g,
    (m: string) => MODULE_KEY_TO_PT_TITLE[m] || m
  );
  return out;
}

const PT_STOPWORDS = new Set([
  'como', 'funciona', 'funcionam', 'para', 'que', 'qual', 'quais', 'sobre', 'onde', 'esse', 'essa', 'este', 'esta',
  'isso', 'aqui', 'uma', 'uns', 'umas', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'por', 'pela', 'pelo', 'mais',
  'muito', 'pode', 'posso', 'quero', 'saber', 'explica', 'explique', 'me', 'te', 'se', 'de', 'da', 'do', 'em', 'na', 'no',
]);

function normalizeIviQuestion(q: string, traineeName?: string): string {
  let out = String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  if (traineeName && traineeName.trim().length >= 2) {
    const escaped = traineeName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function extractQuestionKeywords(q: string, traineeName?: string): string[] {
  return normalizeIviQuestion(q, traineeName)
    .split(' ')
    .filter((w) => w.length >= 3 && !PT_STOPWORDS.has(w));
}

function templatizeExplanationForTrainee(answer: string, traineeName: string): string {
  const clean = String(answer || '').trim();
  const trimmedName = String(traineeName || '').trim();
  if (!trimmedName || trimmedName.toLowerCase() === 'colega') return clean;
  const escaped = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '{TRAINEE}');
}

function personalizeCachedExplanation(template: string, callName: string): string {
  return String(template || '').replace(/\{TRAINEE\}/g, callName);
}

async function archiveExplanationToBucket(payload: {
  moduleKey: string;
  fieldLabel?: string;
  question: string;
  normalizedQuestion: string;
  answerTemplate: string;
  provider: string;
  citedModules: string[];
}): Promise<string | null> {
  try {
    const hash = crypto
      .createHash('sha256')
      .update(`${payload.moduleKey}::${payload.normalizedQuestion}::${payload.answerTemplate.slice(0, 120)}`)
      .digest('hex');
    const jsonBuffer = Buffer.from(
      JSON.stringify({
        ...payload,
        cacheHash: hash,
        savedAt: new Date().toISOString(),
      }),
      'utf8'
    );
    const stored = await putBucketObject(jsonBuffer, {
      folderPath: `ivi-explanations/${payload.moduleKey || 'geral'}`,
      mimeType: 'application/json',
      originalName: `ivi-explicacao-${hash.slice(0, 16)}.json`,
    });
    return stored.storageUri;
  } catch (err) {
    console.warn('BucketdaInvicta explanation archive warning:', err);
    return null;
  }
}

export async function iviAnswerFromDocumentation(params: {
  question: string;
  moduleKey?: string;
  traineeName?: string;
  allowLearn?: boolean;
  learnedByName?: string;
  withAudio?: boolean;
  lessonMode?: boolean;
  currentFieldLabel?: string;
  currentFieldDescription?: string;
  voiceName?: string;
}): Promise<{
  answer: string;
  citedModules: string[];
  citedFields: Array<{ moduleKey: string; fieldLabel: string; originModule: string; destinationModule: string }>;
  learnedArticle: { id: number; questionPattern: string; answerTemplate: string; moduleKey: string } | null;
  audioCacheHash?: string;
  audioMimeType?: string;
  audioCached?: boolean;
  inContext: boolean;
  noDoubtDetected: boolean;
  shouldAdvanceToNextLesson: boolean;
  provider: string;
}> {
  const cleanQuestion = String(params.question || '').trim();
  const cleanTrainee = String(params.traineeName || '').trim();
  const focusModuleKey = String(params.moduleKey || '').trim();
  const callName = cleanTrainee || 'colega';
  const normalizedQ = normalizeIviQuestion(cleanQuestion, cleanTrainee);
  const qKeywords = extractQuestionKeywords(cleanQuestion, cleanTrainee);

  if (params.lessonMode && detectNoDoubtPhrase(cleanQuestion)) {
    const answer = `Show de bola, ${callName}! Zero dúvidas por aqui — bora logo para a próxima aula porque tem coisa boa esperando!`;
    let audioCacheHash: string | undefined;
    let audioMimeType: string | undefined;
    let audioCached = false;
    if (params.withAudio) {
      const tts = await iviSynthesizeSpeechCached({
        text: answer,
        voiceName: params.voiceName || 'Aoede',
        sourceType: 'training',
        moduleKey: focusModuleKey,
        createdByName: params.learnedByName || callName,
      });
      if (tts.audioBase64) {
        audioCacheHash = tts.cacheHash;
        audioMimeType = tts.mimeType;
        audioCached = tts.cached;
      }
    }
    return {
      answer,
      citedModules: focusModuleKey ? [focusModuleKey] : [],
      citedFields: [],
      learnedArticle: null,
      audioCacheHash,
      audioMimeType,
      audioCached,
      inContext: true,
      noDoubtDetected: true,
      shouldAdvanceToNextLesson: true,
      provider: 'lesson_flow',
    };
  }

  const [docs, kbRows] = await Promise.all([
    db.select().from(systemModuleDocs).where(eq(systemModuleDocs.active, true)).orderBy(systemModuleDocs.sortOrder),
    db
      .select()
      .from(iviKnowledgeArticles)
      .where(
        and(
          inArray(iviKnowledgeArticles.scope, ['system_doc', 'learned_insight']),
          eq(iviKnowledgeArticles.active, true)
        )
      )
      .orderBy(desc(iviKnowledgeArticles.hitCount), desc(iviKnowledgeArticles.id)),
  ]);

  // Economia máxima de tokens: consulta primeiro explicações já gravadas na base para o mesmo módulo/contexto
  if (normalizedQ.length >= 6 && qKeywords.length >= 2) {
    const contextScopedRows = kbRows.filter((k) => {
      if (focusModuleKey && k.moduleKey && k.moduleKey !== focusModuleKey) return false;
      return k.category === 'explicacao_em_cache' || k.sourceChannel === 'ivi_doc_cache' || k.scope === 'learned_insight';
    });
    const exactMatch = contextScopedRows.find(
      (k) => normalizeIviQuestion(k.questionPattern, cleanTrainee) === normalizedQ
    );
    const fuzzyMatch =
      exactMatch ||
      contextScopedRows.find((k) => {
        const patWords = extractQuestionKeywords(k.questionPattern);
        if (patWords.length < 2) return false;
        const overlap = qKeywords.filter((w) => patWords.includes(w)).length;
        const jaccard = overlap / new Set([...qKeywords, ...patWords]).size;
        return jaccard >= 0.8 && (!params.currentFieldLabel || k.answerTemplate.includes(params.currentFieldLabel) || overlap >= 3);
      });

    if (fuzzyMatch && fuzzyMatch.answerTemplate) {
      await db
        .update(iviKnowledgeArticles)
        .set({ hitCount: (fuzzyMatch.hitCount || 0) + 1 })
        .where(eq(iviKnowledgeArticles.id, fuzzyMatch.id));

      const cachedAnswer = humanizeSystemDocText(personalizeCachedExplanation(fuzzyMatch.answerTemplate, callName));
      const matchedDoc = docs.find((d) => d.moduleKey === (fuzzyMatch.moduleKey || focusModuleKey));
      const cachedFields = (matchedDoc?.fieldsJson || []).slice(0, 4).map((f) => ({
        moduleKey: matchedDoc!.moduleKey,
        fieldLabel: f.fieldLabel,
        originModule: humanizeSystemDocText(f.originModule),
        destinationModule: humanizeSystemDocText(f.destinationModule),
      }));

      let audioCacheHash: string | undefined;
      let audioMimeType: string | undefined;
      let audioCached = false;
      if (params.withAudio && cachedAnswer) {
        const tts = await iviSynthesizeSpeechCached({
          text: cachedAnswer,
          voiceName: params.voiceName || 'Aoede',
          sourceType: params.lessonMode ? 'training' : 'static_doc',
          moduleKey: fuzzyMatch.moduleKey || focusModuleKey || '',
          createdByName: params.learnedByName || callName,
        });
        if (tts.audioBase64) {
          audioCacheHash = tts.cacheHash;
          audioMimeType = tts.mimeType;
          audioCached = tts.cached;
        }
      }

      return {
        answer: cachedAnswer,
        citedModules: fuzzyMatch.moduleKey ? [fuzzyMatch.moduleKey] : focusModuleKey ? [focusModuleKey] : [],
        citedFields: cachedFields,
        learnedArticle: null,
        audioCacheHash,
        audioMimeType,
        audioCached,
        inContext: true,
        noDoubtDetected: false,
        shouldAdvanceToNextLesson: false,
        provider: 'base_cache',
      };
    }
  }

  const docsSnapshot = docs.map((d) => ({
    moduleKey: d.moduleKey,
    title: d.title,
    menuPath: d.menuPath,
    summary: humanizeSystemDocText(d.summary),
    objective: humanizeSystemDocText(d.objective),
    integrations: d.integrationsJson,
    fields: (d.fieldsJson || []).map((f) => ({
      fieldLabel: f.fieldLabel,
      fieldType: f.fieldType,
      description: humanizeSystemDocText(f.description),
      originModule: humanizeSystemDocText(f.originModule),
      destinationModule: humanizeSystemDocText(f.destinationModule),
    })),
  }));

  const focusModuleTitle =
    docs.find((d) => d.moduleKey === focusModuleKey)?.title || MODULE_KEY_TO_PT_TITLE[focusModuleKey] || focusModuleKey;

  const kbContext = kbRows
    .slice(0, 35)
    .map(
      (k) =>
        `- [ID:${k.id} | Módulo:${MODULE_KEY_TO_PT_TITLE[k.moduleKey] || 'Geral'}] ${humanizeSystemDocText(
          k.questionPattern
        )} => ${humanizeSystemDocText(personalizeCachedExplanation(k.answerTemplate, callName))}`
    )
    .join('\n');

  let answer = '';
  let citedModules: string[] = [];
  let citedFields: Array<{ moduleKey: string; fieldLabel: string; originModule: string; destinationModule: string }> = [];
  let learnedArticle: { id: number; questionPattern: string; answerTemplate: string; moduleKey: string } | null = null;
  let inContext = true;
  let noDoubtDetected = false;
  let shouldAdvanceToNextLesson = false;
  let provider = 'knowledge_fallback';

  const ai = getGeminiClient();
  if (ai && docsSnapshot.length > 0) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Nome do treinando/usuário: ${callName}`,
          focusModuleTitle ? `Tela/Módulo atualmente selecionado: ${focusModuleTitle}` : '',
          params.lessonMode && params.currentFieldLabel
            ? `Aula atual focada no campo: "${params.currentFieldLabel}" (${humanizeSystemDocText(
                params.currentFieldDescription || ''
              )})`
            : '',
          `Modo aula interativa descontraída?: ${params.lessonMode ? 'SIM' : 'NÃO'}`,
          `Permitir aprendizado de novo ponto de vista se coerente?: ${params.allowLearn ? 'SIM' : 'NÃO'}`,
          `Mensagem / Dúvida do usuário: "${cleanQuestion}"`,
          `\nDOCUMENTAÇÃO OFICIAL DOS MÓDULOS (FONTE ÚNICA DE VERDADE):\n${JSON.stringify(docsSnapshot)}`,
          kbContext ? `\nARTIGOS & APRENDIZADOS COERENTES NA BASE:\n${kbContext}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        config: {
          systemInstruction: [
            'Você é Ivi, instrutora oficial da Invicta Assessoria Financeira (sistema FinancePro).',
            `TOM E PERSONALIDADE: Fale de forma descontraída, calorosa, intimista e bem próxima de ${callName}, sempre citando o nome "${callName}" na resposta como uma conversa amigável entre colegas!`,
            'PROIBIDO JARGÃO TÉCNICO OU TERMOS DE PROGRAMAÇÃO: Nunca cite caminhos de API (como /api/...), nomes de tabelas do banco, chaves em inglês (como cadastros_comuns, checkbox_group, middleware, hmac, scrypt) nem mencione Google Classroom. Sempre refira-se às telas e campos pelos seus nomes e rótulos reais em Português do Brasil (ex: "Tela de Acesso Corporativo", "Cadastros Comuns", "Auditoria Geral", "Campo E-mail cadastrado").',
            'REGRA RÍGIDA DE FIDELIDADE OPERACIONAL: Toda explicação sobre o sistema deve vir EXCLUSIVAMENTE da DOCUMENTAÇÃO OFICIAL DOS MÓDULOS e dos ARTIGOS & APRENDIZADOS fornecidos. Nunca invente campos, telas ou regras que não existam.',
            'Sempre que explicar campos, cite o nome da tela/módulo em português, a funcionalidade do campo, de qual tela os dados vêm (ORIGEM) e para qual tela seguem depois (DESTINO).',
            'CLASSIFICAÇÃO DE CONTEXTO (OBRIGATÓRIA):',
            '- Verifique se a pergunta tem relação com o FinancePro, a Invicta Assessoria, os módulos, campos, clientes, financeiro, jurídico, cobrança, prospecção, agendamentos, LGPD, permissões ou treinamento.',
            `- Se NÃO tiver nada a ver com o contexto do sistema/aula (ex: futebol, culinária, clima, novela, fofoca, astrologia, assunto pessoal aleatório), defina inContext=false e escreva no campo "answer" uma brincadeira leve, simpática e divertida contando para ${callName} que essa pergunta está totalmente fora do contexto da nossa aula — e avisando com humor que vocês já vão passar para a próxima aula!`,
            '- Se o usuário estiver apenas dizendo que não tem dúvidas ou pode seguir, defina noDoubtDetected=true e inContext=true.',
            'APRENDIZADO COERENTE: Se inContext=true, allowLearn=SIM e o usuário trouxe uma regra prática ou ponto de vista novo coerente com os módulos, preencha shouldLearn=true, learnedTitle, learnedSummary e learnedModuleKey.',
          ].join(' '),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              inContext: { type: Type.BOOLEAN },
              noDoubtDetected: { type: Type.BOOLEAN },
              citedModules: { type: Type.ARRAY, items: { type: Type.STRING } },
              citedFieldLabels: { type: Type.ARRAY, items: { type: Type.STRING } },
              shouldLearn: { type: Type.BOOLEAN },
              learnedTitle: { type: Type.STRING },
              learnedSummary: { type: Type.STRING },
              learnedModuleKey: { type: Type.STRING },
            },
            required: ['answer', 'inContext', 'citedModules'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim()) as {
        answer?: string;
        inContext?: boolean;
        noDoubtDetected?: boolean;
        citedModules?: string[];
        citedFieldLabels?: string[];
        shouldLearn?: boolean;
        learnedTitle?: string;
        learnedSummary?: string;
        learnedModuleKey?: string;
      };

      if (parsed.answer) {
        answer = humanizeSystemDocText(parsed.answer.trim());
        provider = 'gemini';
        inContext = parsed.inContext !== false;
        noDoubtDetected = Boolean(parsed.noDoubtDetected);
        shouldAdvanceToNextLesson = !inContext || noDoubtDetected;
        citedModules = Array.isArray(parsed.citedModules) ? parsed.citedModules : [];
        if (inContext) {
          const labelSet = new Set((parsed.citedFieldLabels || []).map((l) => l.toLowerCase()));
          for (const d of docsSnapshot) {
            if (!citedModules.includes(d.moduleKey) && focusModuleKey !== d.moduleKey) continue;
            for (const f of d.fields) {
              if (
                labelSet.size === 0 ||
                labelSet.has(f.fieldLabel.toLowerCase())
              ) {
                citedFields.push({
                  moduleKey: d.moduleKey,
                  fieldLabel: f.fieldLabel,
                  originModule: f.originModule,
                  destinationModule: f.destinationModule,
                });
              }
            }
          }

          if (params.allowLearn && parsed.shouldLearn && parsed.learnedTitle && parsed.learnedSummary) {
            const modKey = parsed.learnedModuleKey || focusModuleKey || citedModules[0] || 'login';
            const [inserted] = await db
              .insert(iviKnowledgeArticles)
              .values({
                scope: 'learned_insight',
                moduleKey: modKey,
                questionPattern: humanizeSystemDocText(parsed.learnedTitle).slice(0, 180),
                answerTemplate: humanizeSystemDocText(parsed.learnedSummary),
                category: 'aprendizado_treinamento',
                sourceChannel: 'training_qa',
                hitCount: 1,
                updatedByName: params.learnedByName || cleanTrainee || 'Aprendizado Ivi',
                active: true,
              })
              .returning();
            if (inserted) {
              learnedArticle = {
                id: inserted.id,
                questionPattern: inserted.questionPattern,
                answerTemplate: inserted.answerTemplate,
                moduleKey: inserted.moduleKey,
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Gemini iviAnswerFromDocumentation fallback:', err);
    }
  }

  if (!answer) {
    const tokens = cleanQuestion
      .toLowerCase()
      .split(/[\s,.;:!?()]+/)
      .filter((w) => w.length >= 3);

    const scoredDocs = docs
      .map((d) => {
        const hay = `${d.title} ${d.menuPath} ${d.summary} ${d.objective} ${JSON.stringify(d.fieldsJson)} ${JSON.stringify(d.integrationsJson)}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (hay.includes(t)) score += 2;
        }
        return { doc: d, score };
      })
      .sort((a, b) => b.score - a.score);

    const bestScore = scoredDocs[0]?.score || 0;
    const bestDoc =
      bestScore > 0
        ? scoredDocs[0]?.doc
        : docs.find((d) => d.moduleKey === focusModuleKey) || scoredDocs[0]?.doc;
    const matchedKb = kbRows.find((k) =>
      tokens.some((t) => `${k.questionPattern} ${k.answerTemplate}`.toLowerCase().includes(t))
    );

    const systemWords =
      /campo|tela|m[oó]dulo|sistema|fluxo|origem|destino|ivi|cliente|admiss|prospec|agenda|auditor|boleto|jur[ií]dic|escavador|negocia|financ|cobran|relat[oó]ri|formul[aá]ri|config|backup|drive|login|senha|lgpd|dossi[eê]|invicta|financepro|captcha|acesso|usu[aá]rio/.test(
        cleanQuestion.toLowerCase()
      );

    if (params.lessonMode && bestScore === 0 && !matchedKb && !systemWords) {
      inContext = false;
      shouldAdvanceToNextLesson = true;
      answer = `Hahaha, peguei você nessa, ${callName}! Essa pergunta aí fugiu totalmente do roteiro da nossa aula sobre "${params.currentFieldLabel || 'esta tela'}"! Adorei o papo, mas bora manter o foco porque ainda temos coisa boa pela frente — partiu próxima aula!`;
    } else if (matchedKb) {
      const modTitle = MODULE_KEY_TO_PT_TITLE[matchedKb.moduleKey] || 'Sistema';
      answer = `Boa pergunta, ${callName}! Olha só o que temos na documentação da tela "${modTitle}": ${humanizeSystemDocText(matchedKb.answerTemplate)}`;
      citedModules = matchedKb.moduleKey ? [matchedKb.moduleKey] : [];
    } else if (bestDoc) {
      const inputs =
        (bestDoc.integrationsJson?.inputsFrom || []).map((i) => i.label).join(', ') || 'Entrada direta do usuário';
      const outputs =
        (bestDoc.integrationsJson?.outputsTo || []).map((o) => o.label).join(', ') || 'Armazenamento e Auditoria Geral';
      const topFields = (bestDoc.fieldsJson || []).slice(0, 3);
      const fieldText = topFields
        .map(
          (f) =>
            `• ${f.fieldLabel}: ${humanizeSystemDocText(f.description)} (Vem de: ${humanizeSystemDocText(
              f.originModule
            )} → Segue para: ${humanizeSystemDocText(f.destinationModule)})`
        )
        .join('\n');
      answer = `Olha que legal, ${callName}! Falando da tela "${bestDoc.title}" (${bestDoc.menuPath}): ${humanizeSystemDocText(
        bestDoc.summary
      )}\n\nDe onde vêm os dados: ${inputs}\nPara onde vão depois: ${outputs}\n\nCampos que merecem atenção:\n${fieldText}`;
      citedModules = [bestDoc.moduleKey];
      citedFields = topFields.map((f) => ({
        moduleKey: bestDoc.moduleKey,
        fieldLabel: f.fieldLabel,
        originModule: humanizeSystemDocText(f.originModule),
        destinationModule: humanizeSystemDocText(f.destinationModule),
      }));
    } else {
      answer = `Poxa, ${callName}, não achei esse detalhe específico na base oficial ainda. Pede para o Administrador cadastrar essa dica na Gestão da Base da Ivi que eu aprendo na hora!`;
    }
  }

  const cleanFinalAnswer = humanizeSystemDocText(answer);

  // Grava automaticamente TODA explicação válida na base de conhecimento E no bucketdainvicta
  // para economizar tokens e acelerar respostas futuras
  if (inContext && !noDoubtDetected && cleanFinalAnswer && normalizedQ.length >= 6) {
    const targetModKey = focusModuleKey || citedModules[0] || 'login';
    const answerTemplate = templatizeExplanationForTrainee(cleanFinalAnswer, callName);
    const cleanPattern = humanizeSystemDocText(cleanQuestion).slice(0, 220);

    try {
      const alreadySaved = kbRows.find(
        (k) =>
          k.moduleKey === targetModKey &&
          normalizeIviQuestion(k.questionPattern, cleanTrainee) === normalizedQ
      );
      if (!alreadySaved && !learnedArticle) {
        await db.insert(iviKnowledgeArticles).values({
          scope: 'learned_insight',
          moduleKey: targetModKey,
          questionPattern: cleanPattern,
          answerTemplate,
          category: 'explicacao_em_cache',
          sourceChannel: 'ivi_doc_cache',
          hitCount: 1,
          updatedByName: params.learnedByName || callName || 'Ivi Instrutora',
          active: true,
        });
      }
    } catch (kbErr) {
      console.warn('Knowledge base explanation auto-archive warning:', kbErr);
    }

    await archiveExplanationToBucket({
      moduleKey: targetModKey,
      fieldLabel: params.currentFieldLabel,
      question: cleanPattern,
      normalizedQuestion: normalizedQ,
      answerTemplate,
      provider,
      citedModules: citedModules.length > 0 ? citedModules : [targetModKey],
    });
  }

  let audioCacheHash: string | undefined;
  let audioMimeType: string | undefined;
  let audioCached = false;
  if (params.withAudio && cleanFinalAnswer) {
    const tts = await iviSynthesizeSpeechCached({
      text: cleanFinalAnswer,
      voiceName: params.voiceName || 'Aoede',
      sourceType: params.lessonMode ? 'training' : 'static_doc',
      moduleKey: focusModuleKey || citedModules[0] || '',
      createdByName: params.learnedByName || callName,
    });
    if (tts.audioBase64) {
      audioCacheHash = tts.cacheHash;
      audioMimeType = tts.mimeType;
      audioCached = tts.cached;
    }
  }

  return {
    answer: cleanFinalAnswer,
    citedModules,
    citedFields: citedFields.slice(0, 8),
    learnedArticle,
    audioCacheHash,
    audioMimeType,
    audioCached,
    inContext,
    noDoubtDetected,
    shouldAdvanceToNextLesson,
    provider,
  };
}


