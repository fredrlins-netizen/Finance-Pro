import http from 'node:http';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { verifySocketSessionToken } from '../middleware/auth.ts';
import { SYSTEM_DOCS_CATALOG } from './systemDocsCatalog.ts';

import { humanizeSystemDocText } from './ivi.ts';

interface LiveStartPayload {
  type: 'start' | 'context_update' | 'text' | 'audio';
  token?: string;
  traineeName?: string;
  moduleKey?: string;
  fieldLabel?: string;
  fieldDescription?: string;
  originModule?: string;
  destinationModule?: string;
  voiceName?: string;
  text?: string;
  audio?: string;
}

const LIVE_ALLOWED_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

function mapLiveVoice(voice?: string): string {
  const clean = String(voice || '').trim();
  if (LIVE_ALLOWED_VOICES.has(clean)) return clean;
  return 'Zephyr';
}

function buildIviLiveInstruction(ctx: {
  traineeName: string;
  moduleKey: string;
  fieldLabel: string;
  fieldDescription: string;
  originModule: string;
  destinationModule: string;
}): string {
  const docMeta = SYSTEM_DOCS_CATALOG.find((m) => m.moduleKey === ctx.moduleKey);
  const moduleTitle = docMeta?.title || humanizeSystemDocText(ctx.moduleKey);
  const fieldsList = (docMeta?.fieldsJson || [])
    .map(
      (f) =>
        `- ${f.fieldLabel}: ${humanizeSystemDocText(f.description)} (Vem de: ${humanizeSystemDocText(
          f.originModule
        )} -> Vai para: ${humanizeSystemDocText(f.destinationModule)})`
    )
    .join('\n');

  return [
    'Você é a Ivi, instrutora oficial da Invicta Assessoria Financeira (sistema FinancePro), apresentando em sua Sala de Aula Invicta vestindo a camisa da empresa.',
    `Você está conversando AO VIVO por voz com ${ctx.traineeName || 'o(a) colega'}.`,
    `PERSONALIDADE: Fale sempre de forma descontraída, acolhedora, segura e bem-humorada, mantendo o foco no conteúdo da aula e chamando ${ctx.traineeName || 'você'} pelo nome naturalmente.`,
    'PROIBIDO FALAR CÓDIGO OU TERMOS TÉCNICOS EM INGLÊS: Nunca diga caminhos de API (/api/...), nomes de tabelas, termos como middleware, checkbox_group, audit_logs ou chaves técnicas em inglês. Use SEMPRE os nomes das telas e rótulos dos campos em Português do Brasil.',
    `AULA ATUAL: Tela "${moduleTitle}".`,
    ctx.fieldLabel
      ? `CAMPO EM DESTAQUE NO QUADRO AGORA: "${ctx.fieldLabel}" — ${humanizeSystemDocText(
          ctx.fieldDescription
        )} | Origem: ${humanizeSystemDocText(ctx.originModule)} | Destino: ${humanizeSystemDocText(
          ctx.destinationModule
        )}.`
      : '',
    fieldsList ? `CAMPOS DOCUMENTADOS DESTA TELA:\n${fieldsList}` : '',
    'REGRAS DE CONDUÇÃO DA AULA:',
    '1. Responda às dúvidas estritamente com base na documentação do FinancePro acima, de forma clara, leve e prática.',
    `2. Se ${ctx.traineeName || 'o aluno'} disser que NÃO tem dúvidas, está tudo certo ou pedir para seguir, comemore rapidinho e termine sua fala com a tag exata [ACTION:ADVANCE_NEXT].`,
    `3. Se ${ctx.traineeName || 'o aluno'} fizer uma pergunta totalmente FORA DE CONTEXTO (que não tem relação com a Invicta Assessoria, FinancePro, tela, campo, atendimento, jurídico ou financeiro — ex: futebol, comida, clima, novela, piada aleatória), dê uma resposta bem-humorada e divertida dizendo que isso fugiu totalmente da aula e que vocês já vão pular para a próxima aula, terminando sua fala com a tag exata [ACTION:OUT_OF_CONTEXT_ADVANCE].`,
    '4. Fale sempre em Português do Brasil, com frases curtas e ritmo natural de conversa.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createIviLiveWebSocketServer() {
  const liveWss = new WebSocketServer({ noServer: true });

  liveWss.on('connection', (clientWs: WebSocket) => {
    let authenticated = false;
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let outputTranscriptBuffer = '';
    let activeContext = {
      traineeName: 'Colega',
      moduleKey: 'diagrama_integracao',
      fieldLabel: '',
      fieldDescription: '',
      originModule: '',
      destinationModule: '',
      voiceName: 'Zephyr',
    };

    const sendSafe = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeAll = () => {
      try {
        liveSession?.close();
      } catch {
        // ignore
      }
      liveSession = null;
    };

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        sendSafe({ error: 'Tempo limite de autenticação Live API expirado.' });
        try {
          clientWs.close(4001, 'Auth timeout');
        } catch {
          // ignore
        }
      }
    }, 8000);

    clientWs.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(String(rawData || '{}')) as LiveStartPayload;

        if (!authenticated) {
          if (msg.type !== 'start' || !msg.token) {
            sendSafe({ error: 'Envie o pacote start com token corporativo válido.' });
            clientWs.close(4001, 'Unauthorized');
            return;
          }
          const verified = await verifySocketSessionToken(msg.token.trim());
          if (!verified) {
            sendSafe({ error: 'Sessão inválida ou expirada.' });
            clientWs.close(4001, 'Invalid token');
            return;
          }
          authenticated = true;
          clearTimeout(authTimeout);

          activeContext = {
            traineeName: String(msg.traineeName || 'Colega').trim() || 'Colega',
            moduleKey: String(msg.moduleKey || 'diagrama_integracao').trim(),
            fieldLabel: String(msg.fieldLabel || '').trim(),
            fieldDescription: String(msg.fieldDescription || '').trim(),
            originModule: String(msg.originModule || '').trim(),
            destinationModule: String(msg.destinationModule || '').trim(),
            voiceName: mapLiveVoice(msg.voiceName),
          };

          if (!process.env.GEMINI_API_KEY) {
            sendSafe({ error: 'GEMINI_API_KEY não configurada no servidor para Live API.' });
            return;
          }

          const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            apiVersion: 'v1beta',
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
            },
          });

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: activeContext.voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: buildIviLiveInstruction(activeContext),
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  sendSafe({ inputTranscript: content.inputTranscription.text });
                }
                if (content?.outputTranscription?.text) {
                  outputTranscriptBuffer += content.outputTranscription.text;
                  const cleanDisplay = outputTranscriptBuffer
                    .replace(/\[ACTION:ADVANCE_NEXT\]/g, '')
                    .replace(/\[ACTION:OUT_OF_CONTEXT_ADVANCE\]/g, '')
                    .trim();
                  sendSafe({ outputTranscript: cleanDisplay });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendSafe({ audio: part.inlineData.data });
                  }
                }
                if (content?.interrupted) {
                  outputTranscriptBuffer = '';
                  sendSafe({ interrupted: true });
                }
                if (content?.turnComplete) {
                  let action: 'advance_next' | 'out_of_context_advance' | null = null;
                  if (outputTranscriptBuffer.includes('[ACTION:OUT_OF_CONTEXT_ADVANCE]')) {
                    action = 'out_of_context_advance';
                  } else if (outputTranscriptBuffer.includes('[ACTION:ADVANCE_NEXT]')) {
                    action = 'advance_next';
                  }
                  const finalClean = outputTranscriptBuffer
                    .replace(/\[ACTION:ADVANCE_NEXT\]/g, '')
                    .replace(/\[ACTION:OUT_OF_CONTEXT_ADVANCE\]/g, '')
                    .trim();
                  outputTranscriptBuffer = '';
                  sendSafe({
                    turnComplete: true,
                    finalTranscript: finalClean,
                    action,
                  });
                }
              },
              onerror: (err) => {
                console.warn('Gemini Live session error:', err);
                sendSafe({ error: 'Conexão Live API com a Ivi sofreu instabilidade. Tente reconectar.' });
              },
              onclose: () => {
                sendSafe({ closed: true });
              },
            },
          });

          sendSafe({ ready: true, voiceName: activeContext.voiceName });
          return;
        }

        if (!liveSession) return;

        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendRealtimeInput({
            text: msg.text.trim(),
          });
        } else if (msg.type === 'context_update') {
          activeContext = {
            ...activeContext,
            traineeName: String(msg.traineeName || activeContext.traineeName).trim(),
            moduleKey: String(msg.moduleKey || activeContext.moduleKey).trim(),
            fieldLabel: String(msg.fieldLabel || '').trim(),
            fieldDescription: String(msg.fieldDescription || '').trim(),
            originModule: String(msg.originModule || '').trim(),
            destinationModule: String(msg.destinationModule || '').trim(),
          };
          const updatedModTitle =
            SYSTEM_DOCS_CATALOG.find((m) => m.moduleKey === activeContext.moduleKey)?.title ||
            humanizeSystemDocText(activeContext.moduleKey);
          liveSession.sendRealtimeInput({
            text: `[CONTEXTO ATUALIZADO DA TELA] Agora estamos explicando para ${activeContext.traineeName} o campo "${activeContext.fieldLabel}" (${humanizeSystemDocText(activeContext.fieldDescription)}) da tela "${updatedModTitle}". Origem: ${humanizeSystemDocText(activeContext.originModule)}. Destino: ${humanizeSystemDocText(activeContext.destinationModule)}.`,
          });
        }
      } catch (err) {
        console.warn('Ivi Live WS frame error:', err);
        sendSafe({
          error: err instanceof Error ? err.message : 'Erro ao processar sessão de voz Gemini Live.',
        });
      }
    });

    clientWs.on('close', () => {
      clearTimeout(authTimeout);
      closeAll();
    });

    clientWs.on('error', () => {
      clearTimeout(authTimeout);
      closeAll();
    });
  });

  return {
    handleUpgrade(request: http.IncomingMessage, socket: any, head: Buffer) {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    },
  };
}
