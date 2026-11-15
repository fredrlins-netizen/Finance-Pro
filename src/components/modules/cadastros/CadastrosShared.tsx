import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  History,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatBytes, formatDateBR, formatDateTimeBR } from '../../../lib/api.ts';
import { Admission, Client, DocumentObject, Unit } from '../../../types.ts';

export const BRAZILIAN_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export function formatCpfCnpjMask(raw: string, nature?: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 14);
  if (!digits) return '';
  if (nature === 'PJ' || digits.length > 11) {
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatPhoneMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCepMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCpfOrCnpj(raw: string, nature?: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return true; // optional when empty
  if (nature === 'PJ') return digits.length === 14;
  return digits.length === 11 || digits.length === 14;
}

export interface AuditLogRow {
  id: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// MODAL: HISTÓRICO DE AUDITORIA DA ENTIDADE
// -----------------------------------------------------------------------------
export const EntityAuditModal: React.FC<{
  open: boolean;
  title: string;
  entityType: string;
  entityId: string | number;
  onClose: () => void;
}> = ({ open, title, entityType, entityId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr('');
    apiFetch<{ logs: AuditLogRow[] }>(`/api/cadastros/audit/${entityType}/${entityId}`)
      .then((res) => setLogs(res.logs || []))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Falha ao carregar auditoria.'))
      .finally(() => setLoading(false));
  }, [open, entityType, entityId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <h3 className="font-display text-sm font-bold text-slate-900">
              Auditoria · {title}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {loading ? (
            <div className="py-8 text-center text-slate-500">Carregando trilha de auditoria...</div>
          ) : err ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700">{err}</div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-slate-500">Nenhum evento registrado para este cadastro.</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-slate-900">{log.action}</span>
                  <span className="font-mono text-[11px] text-slate-500">{formatDateTimeBR(log.createdAt)}</span>
                </div>
                <div className="text-slate-600">
                  Responsável: <strong className="text-slate-800">{log.userName}</strong>
                </div>
                {log.details && Object.keys(log.details).length > 0 && (
                  <pre className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 font-mono text-[10px] text-slate-600 overflow-x-auto">
                    {JSON.stringify(log.details)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: CONFIRMAÇÃO DE EXCLUSÃO SEGURA (SUBSTITUI window.confirm NO IFRAME)
// -----------------------------------------------------------------------------
export const ConfirmDeleteModal: React.FC<{
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ open, title, description, busy, error, onCancel, onConfirm }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-sm font-bold text-slate-900">{title}</h3>
            <p className="text-slate-600 leading-relaxed">{description}</p>
          </div>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {busy ? 'Excluindo...' : 'Confirmar Exclusão'}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: CAPTURA DE CÂMERA DO COLABORADOR
// -----------------------------------------------------------------------------
export const CameraCaptureModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}> = ({ open, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [isMirrored, setIsMirrored] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    let cancelled = false;
    setErr('');
    setLoading(true);
    navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then(async (initialStream) => {
        if (cancelled) {
          initialStream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = initialStream;
        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        if (cams[0]) setSelectedDeviceId(cams[0].deviceId);
        if (videoRef.current) {
          videoRef.current.srcObject = initialStream;
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setErr('Permissão de câmera negada ou dispositivo não encontrado neste navegador.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  const switchDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    stopStream();
    setLoading(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 960 }, height: { ideal: 720 } },
      });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch {
      setErr('Não foi possível alternar para a câmera selecionada.');
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopStream();
    onCapture(dataUrl);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
            <Camera className="w-4 h-4 text-emerald-700" />
            Capturar Foto do Colaborador
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-700 space-y-2">
            <p className="font-semibold">{err}</p>
            <p className="text-[11px] text-red-600">
              Você ainda pode enviar uma foto por arquivo diretamente no formulário.
            </p>
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                Iniciando câmera...
              </div>
            )}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${isMirrored ? 'scale-x-[-1]' : ''}`}
            />
            <button
              type="button"
              onClick={() => setIsMirrored((m) => !m)}
              className="absolute bottom-2 right-2 rounded-lg bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-900"
            >
              Espelhar
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        {!err && devices.length > 1 && (
          <select
            value={selectedDeviceId}
            onChange={(e) => switchDevice(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
          >
            {devices.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId}>
                {d.label || `Câmera ${idx + 1}`}
              </option>
            ))}
          </select>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
          >
            Cancelar
          </button>
          {!err && (
            <button
              type="button"
              disabled={loading}
              onClick={handleCapture}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5" />
              Capturar Foto
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: GERENCIAR ESTADOS CIVIS
// -----------------------------------------------------------------------------
export const MaritalStatusModal: React.FC<{
  open: boolean;
  options: string[];
  onClose: () => void;
  onUpdated: (next: string[]) => void;
}> = ({ open, options, onClose, onUpdated }) => {
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ options: string[] }>('/api/cadastros/marital-statuses', {
        method: 'POST',
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      setNewLabel('');
      onUpdated(res.options);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao adicionar estado civil.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (label: string) => {
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ options: string[] }>(
        `/api/cadastros/marital-statuses/${encodeURIComponent(label)}`,
        { method: 'DELETE' }
      );
      onUpdated(res.options);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao remover estado civil.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-display text-sm font-bold text-slate-900">Gerenciar Estados Civis</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Novo estado civil..."
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy || !newLabel.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        </form>

        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}

        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {options.map((opt) => (
            <div key={opt} className="flex items-center justify-between px-3 py-2">
              <span className="font-medium text-slate-800">{opt}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRemove(opt)}
                className="text-red-600 hover:text-red-800 p-1"
                title="Remover opção"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: BLOQUEAR / SUSPENDER / DESBLOQUEAR CLIENTE (BlockClientModal)
// -----------------------------------------------------------------------------
export const BlockClientModal: React.FC<{
  open: boolean;
  client: Client | null;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: (client: Client) => void;
}> = ({ open, client, isAdmin, onClose, onUpdated }) => {
  const [statusChoice, setStatusChoice] = useState<'suspenso' | 'cancelado'>('suspenso');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (client) {
      setStatusChoice(client.status === 'cancelado' ? 'cancelado' : 'suspenso');
      setReason(client.suspensionReason || client.cancelledReason || '');
      setErr('');
    }
  }, [client, open]);

  if (!open || !client) return null;
  const isBlocked = client.status === 'suspenso' || client.status === 'cancelado';

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErr('Informe o motivo do bloqueio/suspensão.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ client: Client }>(`/api/cadastros/clients/${client.id}/block`, {
        method: 'POST',
        body: JSON.stringify({ status: statusChoice, reason: reason.trim() }),
      });
      onUpdated(res.client);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao aplicar bloqueio.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch<{ client: Client }>(`/api/cadastros/clients/${client.id}/unblock`, {
        method: 'POST',
      });
      onUpdated(res.client);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao desbloquear cliente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            Administrar Restrição · {client.fullName}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isBlocked && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1 text-amber-900">
            <div className="font-bold uppercase text-[11px]">Status atual: {client.status}</div>
            <div>Motivo: {client.suspensionReason || client.cancelledReason || '—'}</div>
          </div>
        )}

        <form onSubmit={handleBlock} className="space-y-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Tipo de Restrição</label>
            <select
              value={statusChoice}
              onChange={(e) => setStatusChoice(e.target.value as 'suspenso' | 'cancelado')}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold"
            >
              <option value="suspenso">Suspenso Temporariamente</option>
              <option value="cancelado">Bloqueado / Cancelado</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Motivo da Restrição *</label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo administrativo ou financeiro da restrição..."
              className="w-full rounded-lg border border-slate-200 p-2.5"
            />
          </div>

          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            {isBlocked ? (
              <button
                type="button"
                disabled={busy || !isAdmin}
                onClick={handleUnblock}
                title={isAdmin ? 'Remover bloqueio e reativar cliente' : 'Apenas administradores podem desbloquear'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Unlock className="w-3.5 h-3.5" />
                {isAdmin ? 'Desbloquear Cliente' : 'Desbloqueio (Admin)'}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700"
              >
                Fechar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                {busy ? 'Salvando...' : 'Aplicar Restrição'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: EXCLUIR CLIENTE (COM ABAS DADOS & DOCUMENTOS CONFORME MANUAL)
// -----------------------------------------------------------------------------
export const DeleteClientModal: React.FC<{
  open: boolean;
  client: (Client & { docsCount?: number; admissionsCount?: number }) | null;
  clientDocs: DocumentObject[];
  onClose: () => void;
  onGoToDocs: () => void;
  onDeleted: () => void;
}> = ({ open, client, clientDocs, onClose, onGoToDocs, onDeleted }) => {
  const [tab, setTab] = useState<'dados' | 'documentos'>('dados');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setTab('dados');
      setErr('');
    }
  }, [open, client?.id]);

  if (!open || !client) return null;

  const docsTotal = Math.max(clientDocs.length, client.docsCount || 0);
  const admsTotal = client.admissionsCount || 0;
  const hasDocs = docsTotal > 0;

  const handleConfirm = async () => {
    if (hasDocs) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/cadastros/clients/${client.id}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erro ao excluir cliente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-red-700">
            <Trash2 className="w-4 h-4" />
            Excluir Cliente · {client.fullName}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab('dados')}
            className={`px-3 py-2 font-semibold border-b-2 ${
              tab === 'dados' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'
            }`}
          >
            Dados & Vínculos
          </button>
          <button
            type="button"
            onClick={() => setTab('documentos')}
            className={`px-3 py-2 font-semibold border-b-2 ${
              tab === 'documentos' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'
            }`}
          >
            Documentos ({docsTotal})
          </button>
        </div>

        {tab === 'dados' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div><strong>CPF/CNPJ:</strong> <span className="font-mono">{client.cpfCnpj || '—'}</span></div>
              <div><strong>Telefone:</strong> {client.phone || '—'}</div>
              <div><strong>Cidade/UF:</strong> {client.city || '—'}/{client.state || '—'}</div>
              <div><strong>Fichas de Admissão:</strong> {admsTotal}</div>
            </div>
            {hasDocs && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 space-y-1.5">
                <div className="font-bold">Exclusão desabilitada por segurança</div>
                <p>
                  Existem <strong>{docsTotal} documento(s)</strong> armazenado(s) no bucket Cloudflare R2 para este cliente. Exclua ou mova os documentos antes de remover o cadastro.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onGoToDocs();
                  }}
                  className="font-bold text-blue-700 hover:underline"
                >
                  Abrir guia Documentos do Cliente →
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {clientDocs.length === 0 ? (
              <div className="p-4 text-center text-slate-500">
                {docsTotal > 0
                  ? `Existem ${docsTotal} documento(s) vinculado(s) a este cliente.`
                  : 'Nenhum documento ativo no bucket.'}
              </div>
            ) : (
              clientDocs.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{d.fileName}</div>
                    <div className="text-[11px] text-slate-500">{d.docCategory} · {formatBytes(d.sizeBytes)}</div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">{formatDateBR(d.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || hasDocs}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {busy ? 'Excluindo...' : 'Excluir Definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// MODAL: VISUALIZAR ADMISSÃO RÁPIDA (DENTRO DA EDIÇÃO DO CLIENTE)
// -----------------------------------------------------------------------------
export const AdmissionQuickViewerModal: React.FC<{
  open: boolean;
  admission: Admission | null;
  units: Unit[];
  clients: Client[];
  onClose: () => void;
  onOpenInAdmissionModule: (admissionId: number) => void;
}> = ({ open, admission, units, clients, onClose, onOpenInAdmissionModule }) => {
  if (!open || !admission) return null;
  const resp = clients.find((c) => c.id === admission.clientId);
  const tit = admission.assetOwnerId ? clients.find((c) => c.id === admission.assetOwnerId) : undefined;
  const unit = units.find((u) => u.id === admission.unitId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
            <FileText className="w-4 h-4 text-blue-700" />
            Ficha {admission.series || 'ADM'} · {admission.contractNumber}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Responsável</div>
            <div className="font-bold text-slate-900">{resp?.fullName || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Titular</div>
            <div className="font-bold text-slate-900">{tit?.fullName || 'Mesmo responsável'}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Banco / Modalidade</div>
            <div className="font-semibold text-slate-800">{admission.bankName} · {admission.modality || admission.debtType}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Unidade / Status</div>
            <div className="font-semibold text-slate-800">{unit?.name || admission.unitId} · {admission.status.toUpperCase()}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Dívida Base</div>
            <div className="font-mono font-bold text-slate-900">{formatBRL(admission.debtAmountCents)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">Serviços / Honorários</div>
            <div className="font-mono font-bold text-emerald-700">{formatBRL(admission.serviceFeeCents)}</div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenInAdmissionModule(admission.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
          >
            <Check className="w-3.5 h-3.5" />
            Abrir Ficha em Admissão &amp; Dossiês
          </button>
        </div>
      </div>
    </div>
  );
};
