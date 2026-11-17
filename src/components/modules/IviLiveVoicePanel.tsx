import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Radio, Sparkles, Volume2 } from 'lucide-react';
import { getAuthToken } from '../../lib/api.ts';

interface IviLiveVoicePanelProps {
  traineeName: string;
  moduleKey: string;
  fieldLabel: string;
  fieldDescription: string;
  originModule: string;
  destinationModule: string;
  voiceName: string;
  onSpeakingChange?: (speaking: boolean) => void;
  onUserSpeechEnded?: () => void;
  onLiveAction?: (action: 'advance_next' | 'out_of_context_advance', finalTranscript: string) => void;
  onTranscriptMessage?: (speaker: 'user' | 'ivi', text: string) => void;
}

function pcmFloat32ToBase64(floatData: Float32Array): string {
  const int16 = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i++) {
    const s = Math.max(-1, Math.min(1, floatData[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToFloat32Pcm(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export const IviLiveVoicePanel: React.FC<IviLiveVoicePanelProps> = ({
  traineeName,
  moduleKey,
  fieldLabel,
  fieldDescription,
  originModule,
  destinationModule,
  voiceName,
  onSpeakingChange,
  onUserSpeechEnded,
  onLiveAction,
  onTranscriptMessage,
}) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [liveUserText, setLiveUserText] = useState('');
  const [liveIviText, setLiveIviText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef(false);
  const userTranscriptRef = useRef('');
  const iviSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const stopLiveSession = () => {
    if (iviSpeakingTimerRef.current) {
      clearTimeout(iviSpeakingTimerRef.current);
      iviSpeakingTimerRef.current = null;
    }
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current.clear();

    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    nextStartTimeRef.current = 0;
    onSpeakingChange?.(false);
    setStatus('idle');
  };

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  // Push updated field context dynamically whenever trainee switches step
  useEffect(() => {
    if (status === 'connected' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'context_update',
          traineeName,
          moduleKey,
          fieldLabel,
          fieldDescription,
          originModule,
          destinationModule,
        })
      );
    }
  }, [status, traineeName, moduleKey, fieldLabel, fieldDescription, originModule, destinationModule]);

  const playPcm24kChunk = (base64Pcm: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;
    if (outCtx.state === 'suspended') {
      void outCtx.resume();
    }

    const float32 = base64ToFloat32Pcm(base64Pcm);
    if (float32.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(new Float32Array(float32), 0);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    onSpeakingChange?.(true);
    if (iviSpeakingTimerRef.current) clearTimeout(iviSpeakingTimerRef.current);
    const msUntilEnd = Math.max(250, Math.round((nextStartTimeRef.current - now) * 1000) + 180);
    iviSpeakingTimerRef.current = setTimeout(() => {
      onSpeakingChange?.(false);
    }, msUntilEnd);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
    source.start(startAt);
  };

  const startLiveSession = async () => {
    const token = getAuthToken();
    if (!token) {
      setErrorMsg('Sessão expirada. Faça login novamente para falar ao vivo com a Ivi.');
      setStatus('error');
      return;
    }

    setErrorMsg('');
    setLiveUserText('');
    setLiveIviText('');
    userTranscriptRef.current = '';
    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/ivi-live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            token,
            traineeName,
            moduleKey,
            fieldLabel,
            fieldDescription,
            originModule,
            destinationModule,
            voiceName,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data || '{}')) as {
            ready?: boolean;
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            turnComplete?: boolean;
            finalTranscript?: string;
            action?: 'advance_next' | 'out_of_context_advance' | null;
            error?: string;
            closed?: boolean;
          };

          if (msg.error) {
            setErrorMsg(msg.error);
            setStatus('error');
            stopLiveSession();
            return;
          }

          if (msg.ready) {
            setStatus('connected');
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (ev) => {
              if (mutedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
              const channelData = ev.inputBuffer.getChannelData(0);
              const base64 = pcmFloat32ToBase64(channelData);
              wsRef.current.send(JSON.stringify({ audio: base64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
            return;
          }

          if (msg.inputTranscript) {
            userTranscriptRef.current += msg.inputTranscript;
            setLiveUserText(userTranscriptRef.current.trim());
            onUserSpeechEnded?.();
          }

          if (msg.outputTranscript) {
            setLiveIviText(msg.outputTranscript);
          }

          if (msg.audio) {
            playPcm24kChunk(msg.audio);
          }

          if (msg.interrupted) {
            for (const src of activeSourcesRef.current) {
              try {
                src.stop();
              } catch {
                // ignore
              }
            }
            activeSourcesRef.current.clear();
            if (outputCtxRef.current) {
              nextStartTimeRef.current = outputCtxRef.current.currentTime;
            }
            onSpeakingChange?.(false);
          }

          if (msg.turnComplete) {
            if (userTranscriptRef.current.trim()) {
              onTranscriptMessage?.('user', userTranscriptRef.current.trim());
              userTranscriptRef.current = '';
            }
            if (msg.finalTranscript) {
              onTranscriptMessage?.('ivi', msg.finalTranscript);
            }
            if (msg.action) {
              onLiveAction?.(msg.action, msg.finalTranscript || '');
            }
          }

          if (msg.closed) {
            stopLiveSession();
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setErrorMsg('Não foi possível conectar ao canal de voz em tempo real da Ivi.');
        setStatus('error');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          stopLiveSession();
        }
      };
    } catch {
      setErrorMsg('Permissão de microfone negada ou indisponível neste dispositivo.');
      setStatus('error');
      stopLiveSession();
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2.5 dark:border-indigo-800/70 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              status === 'connected'
                ? 'bg-emerald-600 text-white animate-pulse'
                : 'bg-indigo-600 text-white'
            }`}
          >
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-indigo-950 dark:text-indigo-100 flex items-center gap-1.5">
              <span>Conversa por Voz em Tempo Real · Gemini Live</span>
              {status === 'connected' && (
                <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                  AO VIVO
                </span>
              )}
            </div>
            <p className="text-[11px] text-indigo-800/80 dark:text-indigo-200/80">
              Converse naturalmente por voz com a Ivi sobre este campo ou diga “sem dúvidas” para avançar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === 'connected' ? (
            <>
              <button
                type="button"
                onClick={() => setMuted((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold border ${
                  muted
                    ? 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-emerald-600" />}
                {muted ? 'Mudo' : 'Mic Aberto'}
              </button>
              <button
                type="button"
                onClick={stopLiveSession}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Encerrar Voz
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={status === 'connecting'}
              onClick={() => void startLiveSession()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              {status === 'connecting' ? 'Conectando Gemini Live...' : 'Falar ao Vivo com Ivi'}
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {(status === 'connected' || liveUserText || liveIviText) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Mic className="w-3 h-3" />
              Você ({traineeName || 'Treinando'})
            </div>
            <p className="mt-1 text-slate-800 dark:text-slate-100">
              {liveUserText || 'Pode falar naturalmente no microfone...'}
            </p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 dark:border-indigo-800/70 dark:bg-slate-900">
            <div className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              <span>Ivi ao Vivo</span>
              <Sparkles className="w-3 h-3" />
            </div>
            <p className="mt-1 text-slate-800 dark:text-slate-100">
              {liveIviText || 'Ouvindo você com atenção...'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
