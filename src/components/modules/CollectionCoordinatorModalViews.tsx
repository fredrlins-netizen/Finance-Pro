import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  FolderOpen,
  History,
  Lock,
  MessageSquare,
  Monitor,
  Paperclip,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  User,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBRL,
  formatBytes,
  formatDateBR,
  formatDateTimeBR,
  getActiveUnitHeader,
  getAuthToken,
  parseJsonResponse,
} from '../../lib/api.ts';
import { DossierDocumentPreviewModal } from '../DossierDocumentViewer.tsx';
import {
  Admission,
  AuditLogEntry,
  BankItem,
  Client,
  CollaboratorItem,
  DocumentObject,
  FinancialTitle,
  GotalkChannelPublic,
  GotalkHsmTemplate,
  GotalkOperatorPublic,
  IviWhatsappSummaryPayload,
  ModalityItem,
  Negotiation,
  OperatorMirrorPayload,
  RecalcScenario,
  SeriesItem,
  TitleSettlement,
  UazapiInstanceOption,
  Unit,
  WhatsappCallLogItem,
  WhatsappMessage,
  WhatsappThread,
} from '../../types.ts';

// -----------------------------------------------------------------------------
// UTILITÁRIOS DE DATA / FORMATAÇÃO
// -----------------------------------------------------------------------------
export function toIsoDateInput(val: string | Date | null | undefined): string {
  if (!val) return '';
  const str = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function formatDueDateLocalBR(val: string | Date | null | undefined): string {
  const iso = toIsoDateInput(val);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

export function computeAgingDays(dueDateVal: string | Date | null | undefined): number {
  const iso = toIsoDateInput(dueDateVal);
  if (!iso) return 0;
  const [y, m, d] = iso.split('-').map(Number);
  const due = new Date(y, (m || 1) - 1, d || 1);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

export function getAgingBucket(days: number): 'a_vencer' | '1_30' | '31_60' | '61_90' | '90_plus' {
  if (days <= 0) return 'a_vencer';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

export function translateTitleStatus(status: string | undefined): string {
  const s = String(status || '').trim().toUpperCase();
  const map: Record<string, string> = {
    ABERTO: 'Em Aberto',
    VENCIDO: 'Em Aberto',
    PAGO: 'Recebimento Total',
    PARCIAL: 'Recebimento Parcial',
    CANCELADO: 'Cancelado',
    AGRUPADO: 'Fatura Gerada',
    FATURA_GERADA: 'Fatura Gerada',
    PROTESTADO: 'Protestado',
    PROVISAO: 'Provisão',
  };
  return map[s] || s || 'Em Aberto';
}

export function translateCollectionSituation(sit: string | undefined): string {
  const s = String(sit || 'EM_DIA').trim().toUpperCase();
  if (s === 'COBRAR') return 'Cobrar';
  if (s === 'NAO_COBRAR') return 'Não Cobrar';
  return 'Em Dia';
}

function playBlockedClientAlertTone() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.setValueAtTime(390, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // browser autoplay policy may block Web Audio
  }
}

async function downloadAuthenticatedDocument(doc: DocumentObject) {
  const url = doc.storageUri?.startsWith('/api/')
    ? doc.storageUri
    : `/api/documents/${doc.id}/download`;
  const token = getAuthToken();
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error('Falha no download do arquivo.');
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = doc.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

// -----------------------------------------------------------------------------
// VISUALIZADOR AUTENTICADO DE ARQUIVOS DO BUCKET DA INVICTA (Tela Livre + Tema)
// -----------------------------------------------------------------------------
export const AuthenticatedBucketViewer: React.FC<{
  doc: DocumentObject;
  heightClass?: string;
  onClose?: () => void;
}> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [mime, setMime] = useState<string>(doc.mimeType || '');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    let createdUrl = '';
    setLoading(true);
    setErrorMsg('');
    setBlobUrl('');

    const url = doc.storageUri?.startsWith('/api/')
      ? doc.storageUri
      : `/api/documents/${doc.id}/download`;
    const token = getAuthToken();

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error('Não foi possível abrir o arquivo no Bucket da Invicta.');
        }
        const blob = await resp.blob();
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setMime(doc.mimeType || blob.type || '');
        setBlobUrl(createdUrl);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar arquivo.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc.id, doc.storageUri, doc.mimeType]);

  return (
    <DossierDocumentPreviewModal
      open={true}
      title={doc.fileName}
      subtitle={`${doc.folderPath || 'bucketdainvicta'} · ${formatBytes(doc.sizeBytes)}`}
      mimeType={mime}
      blobUrl={blobUrl}
      loading={loading}
      errorMsg={errorMsg}
      onDownload={() => void downloadAuthenticatedDocument(doc)}
      onClose={() => onClose?.()}
    />
  );
};

// -----------------------------------------------------------------------------
// 1. MODAL ATRIBUIR OU TRANSFERIR COLABORADOR (Com Log de Auditoria De -> Para)
// -----------------------------------------------------------------------------
export const BatchAssignModal: React.FC<{
  open: boolean;
  selectedTitles: FinancialTitle[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  onClose: () => void;
  onSuccess: (msg: string) => Promise<void>;
}> = ({ open, selectedTitles, clients, collaborators, onClose, onSuccess }) => {
  const [collaboratorId, setCollaboratorId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (open) {
      setCollaboratorId('');
      setTransferReason('');
      setErrorMsg('');
    }
  }, [open]);

  const collabNameMap = useMemo(
    () => new Map(collaborators.map((c) => [c.id, c.name])),
    [collaborators]
  );

  const assignmentBreakdown = useMemo(() => {
    const alreadyAssigned = selectedTitles.filter((t) => Boolean(t.assignedCollaboratorId));
    const unassigned = selectedTitles.filter((t) => !t.assignedCollaboratorId);
    const previousNames = [
      ...new Set(
        alreadyAssigned.map((t) =>
          t.assignedCollaboratorId ? collabNameMap.get(t.assignedCollaboratorId) || `#${t.assignedCollaboratorId}` : ''
        )
      ),
    ].filter(Boolean);
    return { alreadyAssignedCount: alreadyAssigned.length, unassignedCount: unassigned.length, previousNames };
  }, [selectedTitles, collabNameMap]);

  const isTransferMode = assignmentBreakdown.alreadyAssignedCount > 0;

  const handleConfirm = async () => {
    setErrorMsg('');
    if (!collaboratorId) {
      setErrorMsg('Selecione o operador de destino.');
      return;
    }
    if (selectedTitles.length === 0) {
      setErrorMsg('Selecione pelo menos um título.');
      return;
    }
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const hasBlocked = selectedTitles.some((t) => {
      const cl = clientMap.get(t.clientId);
      return cl && (cl.status === 'suspenso' || cl.status === 'cancelado');
    });
    if (hasBlocked) {
      setErrorMsg('Existem títulos de clientes bloqueados na seleção. Não é possível atribuir/transferir cobrança.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch<{
        updatedCount: number;
        transferredCount?: number;
        collaborator: CollaboratorItem;
      }>('/api/collection/coordinator/assign', {
        method: 'POST',
        body: JSON.stringify({
          titleIds: selectedTitles.map((t) => t.id),
          collaboratorId: Number(collaboratorId),
          collectionStatus: 'COBRAR',
          transferReason: transferReason.trim() || undefined,
        }),
      });
      const verb = (res.transferredCount || 0) > 0 ? 'atribuído(s)/transferido(s)' : 'atribuído(s)';
      await onSuccess(
        `${res.updatedCount} título(s) ${verb} para ${res.collaborator?.name || 'operador'} com registro completo no Log de Auditoria.`
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao atribuir/transferir títulos.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busy) {
        e.preventDefault();
        void handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2 dark:text-slate-100">
            <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            {isTransferMode ? 'Atribuir / Transferir Operador' : 'Atribuir Operador'}
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            <strong className="tabular-nums">{selectedTitles.length}</strong> título(s) selecionado(s) passarão para{' '}
            <strong>Cobrar</strong> com auditoria completa de movimentação.
          </p>
        </div>

        {isTransferMode && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5 text-xs text-blue-950 space-y-1 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
            <div className="font-semibold">
              Transferência de Carteira ({assignmentBreakdown.alreadyAssignedCount} título(s) já atribuído(s)
              {assignmentBreakdown.unassignedCount > 0
                ? `, ${assignmentBreakdown.unassignedCount} sem atribuição`
                : ''}
              )
            </div>
            <div className="text-[11px] text-blue-800 dark:text-blue-300">
              Operador(es) anterior(es):{' '}
              <strong>{assignmentBreakdown.previousNames.join(', ') || '—'}</strong>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Operador de Destino
            </label>
            <select
              value={collaboratorId}
              onChange={(e) => setCollaboratorId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Selecione...</option>
              {collaborators.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Motivo / Observação da {isTransferMode ? 'Transferência' : 'Atribuição'} (gravado no log)
            </label>
            <input
              type="text"
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              placeholder={
                isTransferMode
                  ? 'Ex.: Redistribuição de carteira, férias, cobertura de SLA...'
                  : 'Opcional — registrado no histórico de movimentações'
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[11px] text-slate-400 font-mono dark:text-slate-400">Ctrl+Enter para confirmar</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCollaboratorId('');
                onClose();
              }}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConfirm()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {busy
                ? 'Processando...'
                : isTransferMode
                ? 'Confirmar Transferência / Atribuição'
                : 'Confirmar Atribuição'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 2. MODAL EDITAR LANÇAMENTO + VISUALIZAR / ANEXAR COMPROVANTE NO BUCKET DA INVICTA
// -----------------------------------------------------------------------------
export const EditTitleModal: React.FC<{
  title: FinancialTitle | null;
  client: Client | undefined;
  collaborators: CollaboratorItem[];
  documents?: DocumentObject[];
  titleSettlements?: TitleSettlement[];
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}> = ({
  title,
  client,
  collaborators,
  documents = [],
  titleSettlements = [],
  onClose,
  onSaved,
}) => {
  const [documentNumber, setDocumentNumber] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [forecastDate, setForecastDate] = useState('');
  const [status, setStatus] = useState('ABERTO');
  const [collectionStatus, setCollectionStatus] = useState('EM_DIA');
  const [assignedCollaboratorId, setAssignedCollaboratorId] = useState('');
  const [interestReais, setInterestReais] = useState('0');
  const [fineReais, setFineReais] = useState('0');
  const [discountReais, setDiscountReais] = useState('0');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Comprovante no Bucket da Invicta
  const [attachedDocOverride, setAttachedDocOverride] = useState<DocumentObject | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptFeedback, setReceiptFeedback] = useState('');
  const [previewDoc, setPreviewDoc] = useState<DocumentObject | null>(null);

  useEffect(() => {
    if (!title) return;
    setDocumentNumber(title.documentNumber || title.titleCode || '');
    setDueDate(toIsoDateInput(title.dueDate));
    setForecastDate(toIsoDateInput(title.forecastDate));
    const st = String(title.status || 'ABERTO').toUpperCase();
    setStatus(st === 'VENCIDO' ? 'ABERTO' : st);
    setCollectionStatus(String(title.collectionStatus || 'EM_DIA').toUpperCase());
    setAssignedCollaboratorId(title.assignedCollaboratorId ? String(title.assignedCollaboratorId) : '');
    setInterestReais(((Number(title.interestCents || 0)) / 100).toFixed(2));
    setFineReais(((Number(title.fineCents || 0)) / 100).toFixed(2));
    setDiscountReais(((Number(title.discountCents || 0)) / 100).toFixed(2));
    setDescription(title.description || '');
    setErrorMsg('');
    setAttachedDocOverride(null);
    setReceiptFile(null);
    setReceiptFeedback('');
    setPreviewDoc(null);
  }, [title]);

  const linkedReceiptDoc = useMemo(() => {
    if (attachedDocOverride) return attachedDocOverride;
    if (!title) return null;
    if (title.receiptDocId) {
      const exact = documents.find((d) => d.id === title.receiptDocId && !d.deletedAt);
      if (exact) return exact;
    }
    return null;
  }, [attachedDocOverride, title, documents]);

  const clientReceiptDocs = useMemo(() => {
    if (!title) return [];
    return documents.filter(
      (d) =>
        !d.deletedAt &&
        d.clientId === title.clientId &&
        d.docCategory === 'comprovante' &&
        d.id !== linkedReceiptDoc?.id
    );
  }, [documents, title, linkedReceiptDoc?.id]);

  const relatedSettlements = useMemo(() => {
    if (!title) return [];
    return titleSettlements.filter((s) => s.titleId === title.id);
  }, [titleSettlements, title]);

  const handleUploadReceipt = async () => {
    if (!title || !receiptFile) return;
    setUploadingReceipt(true);
    setErrorMsg('');
    setReceiptFeedback('');
    try {
      const formData = new FormData();
      formData.append('file', receiptFile);
      const token = getAuthToken();
      const resp = await fetch(`/api/financial-titles/${title.id}/receipt`, {
        method: 'POST',
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
      const json = await parseJsonResponse<{
        document?: DocumentObject;
        error?: string;
        backend?: string;
      }>(resp, 'Erro ao enviar comprovante para o Bucket da Invicta.');
      if (!json.document) {
        throw new Error(json.error || 'Erro ao enviar comprovante para o Bucket da Invicta.');
      }
      setAttachedDocOverride(json.document);
      setPreviewDoc(json.document);
      setReceiptFile(null);
      setReceiptFeedback(
        `Comprovante "${json.document.fileName}" armazenado com sucesso no Bucket da Invicta.`
      );
      await onSaved(`Comprovante anexado ao título ${title.documentNumber || title.titleCode}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao anexar comprovante.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSave = async () => {
    if (!title) return;
    if (!dueDate) {
      setErrorMsg('Informe a data de vencimento.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const toCents = (v: string) => Math.max(0, Math.round((parseFloat(v || '0') || 0) * 100));
      await apiFetch(`/api/financial-titles/${title.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          titleScope: 'RECEBER',
          documentNumber: documentNumber.trim() || title.titleCode,
          dueDate,
          forecastDate: forecastDate || null,
          status,
          isProtested: status === 'PROTESTADO',
          isProvision: status === 'PROVISAO',
          collectionStatus,
          assignedCollaboratorId: assignedCollaboratorId ? Number(assignedCollaboratorId) : null,
          interestCents: toCents(interestReais),
          fineCents: toCents(fineReais),
          discountCents: toCents(discountReais),
          description: description.trim() || title.description || documentNumber,
        }),
      });
      await onSaved('Lançamento atualizado com sucesso.');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao atualizar lançamento.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!title) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !saving) {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!title) return null;

  const origCents = Number(title.originalValueCents || title.amountCents || 0);
  const balCents = Number(status === 'PAGO' ? 0 : title.currentBalanceCents ?? title.amountCents ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] dark:border-slate-700 dark:bg-slate-900">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Lançamento & Comprovante · Bucket da Invicta
            </h3>
            <p className="text-xs text-slate-500 truncate dark:text-slate-400">
              {client?.fullName || title.clientName || 'Cliente'} · Doc.{' '}
              <span className="font-mono">{title.documentNumber || title.titleCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar edição"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {/* 3 Informações somente leitura */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Valor Original</div>
              <div className="font-mono text-sm font-bold text-blue-700 tabular-nums dark:text-blue-300">
                {formatBRL(origCents)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Saldo Atual</div>
              <div className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatBRL(balCents)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Emissão</div>
              <div className="font-mono text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                {formatDueDateLocalBR(title.issueDate)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Nº Documento</label>
              <input
                type="text"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Vencimento *</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Previsão de Recebimento
              </label>
              <input
                type="date"
                value={forecastDate}
                onChange={(e) => setForecastDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="ABERTO">Em Aberto</option>
                <option value="PARCIAL">Recebimento Parcial</option>
                <option value="PAGO">Recebimento Total</option>
                <option value="PROTESTADO">Protestado</option>
                <option value="PROVISAO">Provisão</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">
                Situação de Cobrança
              </label>
              <select
                value={collectionStatus}
                onChange={(e) => setCollectionStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="EM_DIA">Em Dia</option>
                <option value="COBRAR">Cobrar</option>
                <option value="NAO_COBRAR">Não Cobrar</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Responsável</label>
              <select
                value={assignedCollaboratorId}
                onChange={(e) => setAssignedCollaboratorId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Sem atribuição</option>
                {collaborators.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Juros (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={interestReais}
                onChange={(e) => setInterestReais(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 tabular-nums dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Multa (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fineReais}
                onChange={(e) => setFineReais(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 tabular-nums dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Desconto (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discountReais}
                onChange={(e) => setDiscountReais(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 tabular-nums dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">
              Histórico / Descrição
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
            />
          </div>

          {/* Seção Comprovante de Pagamento no Bucket da Invicta */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                <span className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                  Comprovante de Pagamento (Bucket da Invicta)
                </span>
              </div>
              {linkedReceiptDoc ? (
                <span className="font-mono text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                  Vinculado: #{linkedReceiptDoc.id}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Sem comprovante vinculado</span>
              )}
            </div>

            {receiptFeedback && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                {receiptFeedback}
              </div>
            )}

            {linkedReceiptDoc && (
              <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-emerald-800/70 dark:bg-slate-900">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate dark:text-slate-100">{linkedReceiptDoc.fileName}</div>
                  <div className="text-[11px] font-mono text-slate-500 truncate dark:text-slate-400">
                    {linkedReceiptDoc.folderPath} · {formatBytes(linkedReceiptDoc.sizeBytes)} ·{' '}
                    {formatDateTimeBR(linkedReceiptDoc.createdAt)} · por {linkedReceiptDoc.uploadedBy || 'Equipe'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewDoc((prev) => (prev?.id === linkedReceiptDoc.id ? null : linkedReceiptDoc))
                    }
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {previewDoc?.id === linkedReceiptDoc.id ? 'Ocultar' : 'Visualizar Comprovante'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadAuthenticatedDocument(linkedReceiptDoc)}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar
                  </button>
                </div>
              </div>
            )}

            {clientReceiptDocs.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Outros comprovantes deste cliente no Bucket ({clientReceiptDocs.length}):
                </div>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                  {clientReceiptDocs.slice(0, 4).map((doc) => (
                    <div
                      key={doc.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                        {doc.fileName} · {formatDateBR(doc.createdAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(doc)}
                        className="font-semibold text-blue-700 hover:underline shrink-0 dark:text-blue-300"
                      >
                        Visualizar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewDoc && (
              <AuthenticatedBucketViewer
                doc={previewDoc}
                heightClass="h-64"
                onClose={() => setPreviewDoc(null)}
              />
            )}

            {/* Upload novo comprovante direto para bucketdainvicta */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                className="flex-1 text-xs text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-100 dark:text-slate-300 dark:file:bg-slate-800 dark:file:border-slate-700 dark:file:text-slate-100"
              />
              <button
                type="button"
                disabled={!receiptFile || uploadingReceipt}
                onClick={() => void handleUploadReceipt()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingReceipt ? 'Enviando ao Bucket...' : 'Anexar no Bucket da Invicta'}
              </button>
            </div>

            {relatedSettlements.length > 0 && (
              <div className="pt-2 border-t border-slate-200 space-y-1 dark:border-slate-700">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Baixas Registradas ({relatedSettlements.length}):
                </div>
                {relatedSettlements.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between text-[11px] bg-white border border-slate-200 rounded px-2.5 py-1.5 dark:bg-slate-900 dark:border-slate-700"
                  >
                    <span className="text-slate-700 dark:text-slate-200">
                      {formatDueDateLocalBR(st.settlementDate)} · {st.paymentMethod || st.origin} ·{' '}
                      {st.history || 'Baixa financeira'}
                    </span>
                    <span className="font-mono font-bold text-emerald-800 tabular-nums dark:text-emerald-300">
                      {formatBRL(st.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-[11px] text-slate-400 font-mono dark:text-slate-400">Ctrl+Enter para salvar alterações</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 3. MODAL CONFIRMAÇÃO DE EXCLUSÃO (Título / Solicitação - §2.4 & §2.5)
// -----------------------------------------------------------------------------
export const ConfirmDeleteModal: React.FC<{
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}> = ({ open, title, message, busy = false, onCancel, onConfirm }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 shrink-0 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300">
            <Trash2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed dark:text-slate-300">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            {busy ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 4. MODAL HISTÓRICO DE MOVIMENTAÇÕES (§2.6 - Somente Leitura, 15 linhas/página)
// -----------------------------------------------------------------------------
export const AuditHistoryModal: React.FC<{
  title: FinancialTitle | null;
  clientName: string;
  onClose: () => void;
}> = ({ title, clientName, onClose }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!title) return;
    setPage(1);
    setLogs([]);
    setErrorMsg('');
    setLoading(true);
    apiFetch<{ logs: AuditLogEntry[] }>(
      `/api/audit-logs?entityId=${title.id}&entityType=CONTA_RECEBER`
    )
      .then((res) => setLogs(res.logs || []))
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Erro ao consultar histórico.'))
      .finally(() => setLoading(false));
  }, [title]);

  const flatRows = useMemo(() => {
    const out: Array<{
      id: string;
      createdAt: string;
      userName: string;
      action: string;
      newLabel: string;
      newValue: string;
      previousLabel: string;
      previousValue: string;
    }> = [];
    for (const log of logs) {
      const details = (log.details || {}) as {
        changes?: Array<{
          field?: string;
          label?: string;
          previousLabel?: string;
          newLabel?: string;
          from?: string;
          to?: string;
          previousValue?: string;
          newValue?: string;
        }>;
        description?: string;
        transferReason?: string;
      };
      const topChanges = Array.isArray(log.changes) ? log.changes : [];
      const changes =
        topChanges.length > 0
          ? topChanges
          : Array.isArray(details.changes)
          ? details.changes
          : [];
      const isInsert = String(log.action || '').toUpperCase().includes('INSERT') || String(log.action || '').toUpperCase().includes('CREATE');
      const isDelete = String(log.action || '').toUpperCase().includes('DELETE');
      if (changes.length > 0) {
        changes.forEach((ch, idx) => {
          const lbl = ch.label || ch.field || '—';
          const prevV = String(ch.previousValue ?? ch.from ?? '—');
          const nextV = String(ch.newValue ?? ch.to ?? '—');
          out.push({
            id: `${log.id}-${idx}`,
            createdAt: log.createdAt,
            userName: log.userName || 'Sistema',
            action: log.action,
            newLabel: ch.newLabel || (isDelete ? '— (Removido)' : lbl),
            newValue: nextV,
            previousLabel: ch.previousLabel || (isInsert ? '— (Novo registro)' : lbl),
            previousValue: prevV,
          });
        });
      } else {
        out.push({
          id: `${log.id}-0`,
          createdAt: log.createdAt,
          userName: log.userName || 'Sistema',
          action: log.action,
          newLabel: 'Ação Executada',
          newValue: details.description || details.transferReason || log.action,
          previousLabel: isInsert ? '— (Novo registro)' : 'Ação Executada',
          previousValue: '—',
        });
      }
    }
    return out;
  }, [logs]);

  if (!title) return null;

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(flatRows.length / pageSize));
  const pagedRows = flatRows.slice((page - 1) * pageSize, page * pageSize);

  const actionColor = (action: string) => {
    const a = String(action || '').toUpperCase();
    if (a.includes('DELETE') || a.includes('CANCEL')) return 'text-red-700 dark:text-red-300';
    if (a.includes('TRANSFER')) return 'text-indigo-700';
    if (a.includes('CREATE') || a.includes('BAIXA') || a.includes('RECEIPT')) return 'text-emerald-700 dark:text-emerald-300';
    if (a.includes('ASSIGN') || a.includes('UPDATE')) return 'text-blue-700 dark:text-blue-300';
    return 'text-slate-700 dark:text-slate-200';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[88vh] dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Auditoria Acumulativa de Movimentações
              </h3>
              <span className="text-[11px] font-mono text-slate-500 border border-slate-200 rounded px-1.5 py-0.5 dark:text-slate-400 dark:border-slate-700">
                Somente Leitura
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate dark:text-slate-400">
              {clientName} · Documento{' '}
              <span className="font-mono">{title.documentNumber || title.titleCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              Carregando movimentações...
            </div>
          ) : errorMsg ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {errorMsg}
            </div>
          ) : flatRows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhuma movimentação registrada para este item.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg dark:border-slate-700">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2 px-3 whitespace-nowrap">Usuário</th>
                    <th className="py-2 px-3 whitespace-nowrap">Data e Horário</th>
                    <th className="py-2 px-3 whitespace-nowrap">Campo Alterado (Label)</th>
                    <th className="py-2 px-3">Conteúdo da Alteração</th>
                    <th className="py-2 px-3 whitespace-nowrap">Campo Anterior (Label)</th>
                    <th className="py-2 px-3">Valor Campo Anterior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pagedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-2 px-3 align-top whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{row.userName}</div>
                        <div className={`font-mono text-[10px] font-bold ${actionColor(row.action)}`}>{row.action}</div>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap tabular-nums align-top dark:text-slate-300">
                        {formatDateTimeBR(row.createdAt)}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 align-top dark:text-slate-100">{row.newLabel}</td>
                      <td className="py-2 px-3 font-mono font-semibold text-emerald-800 bg-emerald-50/40 max-w-[220px] break-words align-top dark:bg-emerald-950/20 dark:text-emerald-300">
                        {row.newValue}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-700 align-top dark:text-slate-300">{row.previousLabel}</td>
                      <td className="py-2 px-3 font-mono text-red-700 bg-red-50/40 max-w-[220px] break-words align-top dark:bg-red-950/20 dark:text-red-300">
                        {row.previousValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
          <span className="font-mono tabular-nums">{flatRows.length} alteração(ões)</span>
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                >
                  Anterior
                </button>
                <span className="font-mono text-[11px] tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                >
                  Próxima
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 4B. PAINEL REUTILIZÁVEL DE LIGAÇÃO VIA UAZAPI (VOZ / VÍDEO + HISTÓRICO)
// -----------------------------------------------------------------------------
function formatCallDurationClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const UazapiCallPanel: React.FC<{
  client?: Client | null;
  thread?: WhatsappThread | null;
  onCallLogged?: () => Promise<void> | void;
}> = ({ client, thread, onCallLogged }) => {
  const defaultPhone = useMemo(
    () => client?.whatsapp || client?.phone || thread?.contactPhone || '',
    [client?.whatsapp, client?.phone, thread?.contactPhone]
  );

  const [phoneInput, setPhoneInput] = useState(defaultPhone);
  const [instances, setInstances] = useState<UazapiInstanceOption[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [envConfigured, setEnvConfigured] = useState(false);
  const [calls, setCalls] = useState<WhatsappCallLogItem[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [activeCall, setActiveCall] = useState<WhatsappCallLogItem | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callFeedback, setCallFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    setPhoneInput(defaultPhone);
    setCallFeedback(null);
    setActiveCall(null);
    setElapsedSeconds(0);
  }, [client?.id, thread?.id, defaultPhone]);

  const loadCallData = useCallback(async () => {
    if (!client?.id && !thread?.id && !defaultPhone) return;
    setLoadingCalls(true);
    try {
      const qs = new URLSearchParams();
      if (client?.id) qs.set('clientId', String(client.id));
      if (thread?.id) qs.set('threadId', String(thread.id));
      if (defaultPhone) qs.set('phone', defaultPhone);
      const res = await apiFetch<{
        calls: WhatsappCallLogItem[];
        instances: UazapiInstanceOption[];
        envConfigured?: boolean;
      }>(`/api/whatsapp/uazapi/calls?${qs.toString()}`);

      const loadedCalls = res.calls || [];
      setCalls(loadedCalls);
      setInstances(res.instances || []);
      setEnvConfigured(Boolean(res.envConfigured));

      const preferred =
        thread?.uazapiInstanceId ||
        (res.instances || []).find((i) => i.isConnected)?.uazapiInstanceId ||
        (res.instances || [])[0]?.uazapiInstanceId ||
        '';
      setSelectedInstanceId((prev) => prev || preferred);

      const ongoing = loadedCalls.find((c) => c.status === 'initiated');
      if (ongoing) {
        setActiveCall(ongoing);
        const diff = Math.max(
          0,
          Math.floor((Date.now() - new Date(ongoing.createdAt).getTime()) / 1000)
        );
        setElapsedSeconds(diff);
      }
    } catch {
      // ignore load failure silently until manual action
    } finally {
      setLoadingCalls(false);
    }
  }, [client?.id, thread?.id, thread?.uazapiInstanceId, defaultPhone]);

  useEffect(() => {
    void loadCallData();
  }, [loadCallData]);

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'initiated') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall]);

  const handleStartCall = async (isVideo: boolean) => {
    if (!phoneInput.trim()) {
      setCallFeedback({ type: 'err', text: 'Informe o número com DDD para discar via Uazapi.' });
      return;
    }
    setDialing(true);
    setCallFeedback(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        call?: WhatsappCallLogItem;
        result?: { detail?: string };
        error?: string;
      }>('/api/whatsapp/uazapi/calls/start', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client?.id ?? null,
          threadId: thread?.id ?? null,
          phone: phoneInput.trim(),
          isVideo,
          instanceId: selectedInstanceId || null,
        }),
      });
      if (res.call) {
        setActiveCall(res.call);
        setElapsedSeconds(0);
      }
      setCallFeedback({
        type: 'ok',
        text:
          res.result?.detail ||
          `Ligação ${isVideo ? 'de vídeo' : 'de voz'} via Uazapi iniciada para ${phoneInput.trim()}.`,
      });
      await loadCallData();
      if (onCallLogged) await onCallLogged();
    } catch (err) {
      setCallFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao iniciar ligação via Uazapi.',
      });
      await loadCallData();
    } finally {
      setDialing(false);
    }
  };

  const handleTerminateCall = async () => {
    if (!activeCall) return;
    setTerminating(true);
    setCallFeedback(null);
    try {
      const res = await apiFetch<{ ok: boolean; call?: WhatsappCallLogItem }>(
        `/api/whatsapp/uazapi/calls/${activeCall.id}/terminate`,
        { method: 'POST' }
      );
      setActiveCall(null);
      setElapsedSeconds(0);
      setCallFeedback({
        type: 'ok',
        text: `Ligação encerrada (${formatCallDurationClock(res.call?.durationSeconds || elapsedSeconds)}).`,
      });
      await loadCallData();
    } catch (err) {
      setCallFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao encerrar ligação via Uazapi.',
      });
    } finally {
      setTerminating(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-300" />
          <span className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
            Ligação via Uazapi (WhatsApp Voz/Vídeo)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline dark:text-slate-300 dark:hover:text-white"
          >
            {historyExpanded ? 'Ocultar histórico' : `Histórico (${calls.length})`}
          </button>
          <button
            type="button"
            onClick={() => void loadCallData()}
            title="Atualizar chamadas Uazapi"
            className="p-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3 h-3 ${loadingCalls ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {activeCall && activeCall.status === 'initiated' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-emerald-950 truncate dark:text-emerald-300">
                Chamada {activeCall.callType === 'video' ? 'de Vídeo' : 'de Voz'} ativa ·{' '}
                <span className="font-mono">{activeCall.toNumber}</span>
              </div>
              <div className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300">
                Duração: {formatCallDurationClock(elapsedSeconds)} · Operador:{' '}
                {activeCall.initiatedByName || 'Coordenação'}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={terminating}
            onClick={() => void handleTerminateCall()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            {terminating ? 'Encerrando...' : 'Encerrar Ligação'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
          <div className="sm:col-span-4">
            <input
              type="text"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="DDD + Telefone (ex: 5511999999999)"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="sm:col-span-4">
            <select
              value={selectedInstanceId}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              aria-label="Instância Uazapi para ligação"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {instances.length === 0 ? (
                <option value="">
                  {envConfigured ? 'Instância Uazapi padrão (.env)' : 'Instância padrão Uazapi'}
                </option>
              ) : (
                instances.map((inst) => (
                  <option key={inst.uazapiInstanceId || inst.id} value={inst.uazapiInstanceId}>
                    {inst.label || inst.uazapiInstanceId} ({inst.isConnected ? 'Conectada' : 'Desconectada'})
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="sm:col-span-4 flex items-center gap-1.5">
            <button
              type="button"
              disabled={dialing || !phoneInput.trim()}
              onClick={() => void handleStartCall(false)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Phone className="w-3.5 h-3.5 shrink-0" />
              {dialing ? 'Discando...' : 'Ligar Voz'}
            </button>
            <button
              type="button"
              disabled={dialing || !phoneInput.trim()}
              onClick={() => void handleStartCall(true)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              title="Iniciar chamada de vídeo via Uazapi"
            >
              <Video className="w-3.5 h-3.5 text-blue-700 shrink-0 dark:text-blue-300" />
              Vídeo
            </button>
          </div>
        </div>
      )}

      {callFeedback && (
        <div
          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium border ${
            callFeedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          {callFeedback.text}
        </div>
      )}

      {historyExpanded && (
        <div className="border-t border-slate-200 pt-2 space-y-1.5 dark:border-slate-700">
          {calls.length === 0 ? (
            <div className="text-[11px] text-slate-500 py-1 dark:text-slate-400">
              Nenhuma ligação Uazapi registrada para este cliente ainda.
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
              {calls.map((c) => (
                <div key={c.id} className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                      {c.callType === 'video' ? (
                        <Video className="w-3 h-3 text-blue-700 shrink-0 dark:text-blue-300" />
                      ) : (
                        <Phone className="w-3 h-3 text-emerald-700 shrink-0 dark:text-emerald-300" />
                      )}
                      <span className="font-mono">{c.toNumber}</span>
                      <span
                        className={`font-mono text-[10px] uppercase px-1.5 py-0.5 rounded ${
                          c.status === 'failed'
                            ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/70'
                            : c.status === 'ended'
                            ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70'
                        }`}
                      >
                        {c.status === 'initiated'
                          ? 'Iniciada'
                          : c.status === 'ended'
                          ? 'Encerrada'
                          : c.status === 'failed'
                          ? 'Falha'
                          : c.status}
                      </span>
                    </div>
                    {c.errorDetail && (
                      <div className="text-[10px] text-red-700 truncate dark:text-red-300">{c.errorDetail}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    <div>
                      {Number(c.durationSeconds || 0) > 0
                        ? formatCallDurationClock(Number(c.durationSeconds || 0))
                        : '—'}{' '}
                      · {c.initiatedByName || 'Operador'}
                    </div>
                    <div>{formatDateTimeBR(c.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// 5. MODAL FICHA DO CLIENTE / ADMISSÃO (FIDEDIGNA AO NEGOCIADO - 5 ABAS)
// -----------------------------------------------------------------------------
export const AdmissionDetailModal: React.FC<{
  admission: Admission | null;
  clients: Client[];
  collaborators: CollaboratorItem[];
  units: Unit[];
  banks: BankItem[];
  modalities: ModalityItem[];
  seriesList: SeriesItem[];
  documents: DocumentObject[];
  recalcScenarios: RecalcScenario[];
  negotiations?: Negotiation[];
  titleSettlements?: TitleSettlement[];
  allReceberTitles?: FinancialTitle[];
  clientAdmissions?: Admission[];
  whatsappThreads?: WhatsappThread[];
  whatsappMessages?: WhatsappMessage[];
  gotalkChannels?: GotalkChannelPublic[];
  gotalkHsmTemplates?: GotalkHsmTemplate[];
  onSelectAdmission?: (adm: Admission) => void;
  onMessageSent?: () => Promise<void>;
  onClose: () => void;
}> = ({
  admission,
  clients,
  collaborators,
  units,
  banks,
  modalities,
  seriesList,
  documents,
  recalcScenarios,
  negotiations = [],
  titleSettlements = [],
  allReceberTitles = [],
  clientAdmissions = [],
  whatsappThreads = [],
  whatsappMessages = [],
  gotalkChannels = [],
  gotalkHsmTemplates = [],
  onSelectAdmission,
  onMessageSent,
  onClose,
}) => {
  const [tab, setTab] = useState<'identificacao' | 'financeiro' | 'documentos' | 'whatsapp' | 'auditoria'>('identificacao');
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState('');
  const [selectedHsmId, setSelectedHsmId] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [previewDoc, setPreviewDoc] = useState<DocumentObject | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalError, setLegalError] = useState('');
  const [legalData, setLegalData] = useState<{
    legalScan?: {
      performed: boolean;
      lastUpdate: string | null;
      found: boolean;
      processNumber: string | null;
      courtName: string | null;
      lastMovement: string | null;
      allProcesses: Array<{
        id: number;
        numeroProcesso: string;
        tribunal: string;
        classe: string;
        status: string;
        hasSearchSeizure: boolean;
        vehicleSeized: boolean;
        ultimaMovimentacao: string | null;
        lastMovementAt: string | null;
      }>;
    };
    critiques?: Array<{
      id: string;
      round: number;
      author: string;
      reason: string;
      createdAt: string;
      commercialResponse?: string;
      respondedBy?: string;
      respondedAt?: string;
    }>;
  } | null>(null);

  useEffect(() => {
    if (!admission) return;
    setTab('identificacao');
    setSelectedThreadId(null);
    setReplyText('');
    setMsgFeedback('');
    setSelectedHsmId('');
    setDocSearch('');
    setPreviewDoc(null);
    setLegalData(null);
    setLegalError('');
  }, [admission?.id]);

  useEffect(() => {
    if (!admission || tab !== 'auditoria' || legalData) return;
    setLegalLoading(true);
    setLegalError('');
    apiFetch<typeof legalData>(`/api/admissions/${admission.id}/legal-scan`)
      .then((res) => setLegalData(res))
      .catch((err) => setLegalError(err instanceof Error ? err.message : 'Erro ao carregar histórico jurídico.'))
      .finally(() => setLegalLoading(false));
  }, [admission, tab, legalData]);

  if (!admission) return null;

  const clientResp = clients.find((c) => c.id === admission.clientId);
  const clientTitular = admission.assetOwnerId
    ? clients.find((c) => c.id === admission.assetOwnerId)
    : undefined;
  const unitObj = units.find((u) => u.id === admission.unitId);
  const bankObj = banks.find(
    (b) => b.name.toLowerCase() === (admission.bankName || '').toLowerCase()
  );
  const modalityObj = modalities.find(
    (m) =>
      m.description.toLowerCase() === (admission.modality || '').toLowerCase() ||
      m.type.toLowerCase() === (admission.debtType || '').toLowerCase()
  );
  const seriesObj = seriesList.find((s) => s.sigla === admission.series);
  const collabObj = collaborators.find(
    (c) =>
      c.userId === admission.consultantId ||
      c.name.toLowerCase() === (admission.consultantName || '').toLowerCase()
  );

  const admDocs = documents
    .filter((d) => !d.deletedAt && d.admissionId === admission.id)
    .filter((d) =>
      !docSearch.trim()
        ? true
        : (d.fileName + ' ' + d.docCategory).toLowerCase().includes(docSearch.toLowerCase())
    );

  const admScenarios = recalcScenarios.filter((s) => s.admissionId === admission.id);
  const scenarioCols = admission.scenariosJson || [];
  const admNegotiations = negotiations.filter(
    (n) => n.admissionId === admission.id || (n.clientId === admission.clientId && !n.admissionId)
  );
  const admTitles = allReceberTitles.filter(
    (t) =>
      t.admissionId === admission.id &&
      String(t.titleType || 'PADRAO').toUpperCase() === 'PADRAO' &&
      String(t.status || '').toUpperCase() !== 'CANCELADO'
  );
  const admTitleIds = new Set(admTitles.map((t) => t.id));
  const admSettlements = titleSettlements.filter((s) => admTitleIds.has(s.titleId));
  const admAddendums = documents.filter(
    (d) => !d.deletedAt && d.admissionId === admission.id && d.docCategory === 'aditivo'
  );

  const totalContractedCents =
    Number(admission.serviceFeeCents || 0) +
    Number(admission.serviceMgmtCents || 0) +
    Number(admission.serviceInitialCents || 0) +
    Number(admission.serviceAdditionCents || 0) -
    Number(admission.serviceDiscountCents || 0);

  const totalIssuedCents = admTitles.reduce(
    (s, t) => s + Number(t.originalValueCents || t.amountCents || 0),
    0
  );
  const totalOpenCents = admTitles
    .filter((t) => String(t.status || '').toUpperCase() !== 'PAGO')
    .reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0);
  const totalSettledCents =
    admSettlements.length > 0
      ? admSettlements.reduce((s, st) => s + Number(st.amountCents || 0), 0)
      : admTitles
          .filter((t) => String(t.status || '').toUpperCase() === 'PAGO')
          .reduce((s, t) => s + Number(t.originalValueCents || t.amountCents || 0), 0);

  const diffContractedIssued = totalIssuedCents - totalContractedCents;
  const contractAligned =
    totalContractedCents > 0 && admTitles.length > 0 && Math.abs(diffContractedIssued) <= 100;

  const admClientPhoneDigits = (clientResp?.whatsapp || clientResp?.phone || '').replace(/\D/g, '').slice(-8);
  const admClientThreads = whatsappThreads.filter(
    (th) =>
      th.clientId === admission.clientId ||
      (admClientPhoneDigits.length >= 8 && th.contactPhone.replace(/\D/g, '').endsWith(admClientPhoneDigits))
  );
  const admActiveThread =
    (selectedThreadId ? admClientThreads.find((t) => t.id === selectedThreadId) : undefined) ||
    admClientThreads[0] ||
    null;
  const admActiveThreadMessages = admActiveThread
    ? whatsappMessages.filter((m) => m.threadId === admActiveThread.id)
    : [];

  const handleAdmSendWhatsapp = async () => {
    if (!replyText.trim() || !admActiveThread) return;
    setSendingMsg(true);
    setMsgFeedback('');
    try {
      await apiFetch(`/api/whatsapp/threads/${admActiveThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: replyText.trim(),
          contentType: 'text',
          direction: 'outbound',
        }),
      });
      setReplyText('');
      setMsgFeedback('Mensagem enviada e registrada no histórico.');
      if (onMessageSent) await onMessageSent();
    } catch (err) {
      setMsgFeedback(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleAdmSendHsm = async () => {
    if (!selectedHsmId || !admActiveThread) return;
    setSendingMsg(true);
    setMsgFeedback('');
    try {
      await apiFetch(`/api/whatsapp/threads/${admActiveThread.id}/send-hsm`, {
        method: 'POST',
        body: JSON.stringify({
          templateId: Number(selectedHsmId),
          channelDbId: gotalkChannels.find((c) => c.isActive)?.id,
          variables: { '1': clientResp?.fullName || '' },
        }),
      });
      setMsgFeedback('Notificação ativa HSM enviada.');
      if (onMessageSent) await onMessageSent();
    } catch (err) {
      setMsgFeedback(err instanceof Error ? err.message : 'Erro ao disparar HSM.');
    } finally {
      setSendingMsg(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
              <h3 className="font-display text-base font-bold text-slate-900 truncate dark:text-slate-100">
                Ficha do Cliente · {admission.protocolCode}
              </h3>
              <span className="font-mono text-[11px] font-bold uppercase text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 dark:text-slate-200 dark:border-slate-700">
                {admission.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate dark:text-slate-400">
              {clientResp?.fullName || `Cliente #${admission.clientId}`} · Contrato{' '}
              <span className="font-mono">{admission.contractNumber || '—'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {clientAdmissions.length > 1 && onSelectAdmission && (
              <select
                value={String(admission.id)}
                onChange={(e) => {
                  const next = clientAdmissions.find((a) => String(a.id) === e.target.value);
                  if (next) onSelectAdmission(next);
                }}
                aria-label="Selecionar contrato do cliente"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {clientAdmissions.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.contractNumber || a.protocolCode} ({a.status})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar ficha"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 5 Tabs */}
        <div className="px-5 pt-2 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-1 dark:border-slate-700 dark:bg-slate-800/70">
          {[
            { id: 'identificacao', label: 'Identificação' },
            { id: 'financeiro', label: `Negociado & Financeiro (${admTitles.length})` },
            { id: 'documentos', label: `Documentos (${admDocs.length})` },
            { id: 'whatsapp', label: `WhatsApp (${admClientThreads.length})` },
            { id: 'auditoria', label: 'Auditoria' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-slate-900 text-slate-900 bg-white rounded-t-lg dark:border-emerald-500 dark:text-slate-100 dark:bg-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-5 text-xs">
          {tab === 'identificacao' && (
            <>
              <div>
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                  Identificação do Processo
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3.5 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-800/60">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Cliente (Responsável)</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {clientResp?.fullName || `#${admission.clientId}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Contrato</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {admission.contractNumber || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Data Admissão</div>
                    <div className="font-mono text-slate-800 dark:text-slate-100">
                      {formatDateBR(admission.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Status</div>
                    <div className="font-mono font-bold text-slate-800 uppercase dark:text-slate-100">
                      {admission.status}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Série</div>
                    <div className="font-mono text-slate-800 dark:text-slate-100">
                      {seriesObj?.sigla || admission.series || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Colaborador</div>
                    <div className="text-slate-800 dark:text-slate-100">
                      {collabObj?.name || admission.consultantName || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Indicação</div>
                    <div className="text-slate-800 dark:text-slate-100">
                      {admission.indicationSource || admission.indicationOther || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Origem</div>
                    <div className="text-slate-800 dark:text-slate-100">{admission.origin || '—'}</div>
                  </div>
                  {unitObj && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Unidade</div>
                      <div className="text-slate-800 font-medium dark:text-slate-100">
                        {unitObj.code} · {unitObj.name}
                      </div>
                    </div>
                  )}
                  {admission.notes && (
                    <div className="col-span-2 sm:col-span-4 bg-white rounded border border-slate-200 p-2.5 text-slate-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
                      <strong>Observações do Contrato:</strong> {admission.notes}
                    </div>
                  )}
                </div>
              </div>

              {clientResp && (
                <div>
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                    Dados do Responsável
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">CPF / CNPJ</div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {clientResp.cpfCnpj || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">RG</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">{clientResp.rg || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Data Nasc.</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">{clientResp.birthDate || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Estado Civil / Profissão</div>
                      <div className="text-slate-800 dark:text-slate-100">
                        {[clientResp.maritalStatus, clientResp.profession].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Telefone / WhatsApp</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">
                        {clientResp.whatsapp || clientResp.phone || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Telefone 2</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">
                        {clientResp.secondaryPhone || '—'}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">E-mail</div>
                      <div className={clientResp.email ? 'text-slate-800 dark:text-slate-100' : 'text-red-600 font-medium dark:text-red-400'}>
                        {clientResp.email || 'Não informado'}
                      </div>
                    </div>
                    {(clientResp.address || clientResp.city) && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Endereço Completo</div>
                        <div className="text-slate-800 dark:text-slate-100">
                          {[
                            clientResp.address,
                            clientResp.addressNumber,
                            clientResp.complement,
                            clientResp.neighborhood,
                            clientResp.city,
                            clientResp.state,
                            clientResp.zipCode,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </div>
                      </div>
                    )}
                    {clientResp.notes && (
                      <div className="col-span-2 sm:col-span-4 bg-slate-50 rounded p-2 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                        <strong>Anotações:</strong> {clientResp.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {clientTitular && clientTitular.id !== clientResp?.id && (
                <div>
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                    Dados do Titular
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Nome</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{clientTitular.fullName}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">CPF/CNPJ</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">{clientTitular.cpfCnpj || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Telefone</div>
                      <div className="font-mono text-slate-800 dark:text-slate-100">{clientTitular.phone || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">E-mail</div>
                      <div className="text-slate-800 dark:text-slate-100">{clientTitular.email || '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {(admission.vehicleBrand || admission.vehiclePlate || admission.vehicleInfo) && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Dados do Veículo
                    </h4>
                    {admission.isElectricVehicle && (
                      <span className="font-mono text-[10px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 rounded dark:text-emerald-300 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                        ELÉTRICO
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
                    {admission.vehicleBrand && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Marca</div>
                        <div className="text-slate-900 font-medium dark:text-slate-100">{admission.vehicleBrand}</div>
                      </div>
                    )}
                    {admission.vehicleModel && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Modelo</div>
                        <div className="text-slate-900 font-medium dark:text-slate-100">{admission.vehicleModel}</div>
                      </div>
                    )}
                    {admission.vehicleYear && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Ano</div>
                        <div className="font-mono text-slate-800 dark:text-slate-100">{admission.vehicleYear}</div>
                      </div>
                    )}
                    {admission.vehiclePlate && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Placa</div>
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{admission.vehiclePlate}</div>
                      </div>
                    )}
                    {admission.vehicleColor && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Cor</div>
                        <div className="text-slate-800 dark:text-slate-100">{admission.vehicleColor}</div>
                      </div>
                    )}
                    {admission.vehicleChassis && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Chassi</div>
                        <div className="font-mono text-slate-800 dark:text-slate-100">{admission.vehicleChassis}</div>
                      </div>
                    )}
                    {admission.vehicleRenavam && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Renavam</div>
                        <div className="font-mono text-slate-800 dark:text-slate-100">{admission.vehicleRenavam}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'financeiro' && (
            <>
              {/* CONFERÊNCIA FIDEDIGNA DO NEGOCIADO (Contrato × Títulos × Baixas) */}
              <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-3 dark:border-slate-600 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                  <div>
                    <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                      Conferência Fidedigna do Negociado (Contrato × Contas a Receber)
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Valores exatos contratados na admissão comparados aos títulos emitidos e baixas registradas.
                    </p>
                  </div>
                  {admTitles.length === 0 ? (
                    <span className="font-mono text-[11px] font-bold text-amber-800 dark:text-amber-300">
                      Sem títulos vinculados ao contrato
                    </span>
                  ) : contractAligned ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      CONFERE COM O CONTRATADO
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-blue-700 dark:text-blue-300">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      DIFERENÇA DE {formatBRL(Math.abs(diffContractedIssued))}
                      {admAddendums.length > 0 ? ' (Aditivo)' : ''}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3 dark:bg-slate-800/70 dark:border-slate-700">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Honorários / Serviço</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatBRL(admission.serviceFeeCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Gestão / Admin.</div>
                    <div className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-100">
                      {formatBRL(admission.serviceMgmtCents || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Taxa Inicial / Entrada</div>
                    <div className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-100">
                      {formatBRL(admission.serviceInitialCents || admission.initialInstallmentCents || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Descontos / Acréscimos</div>
                    <div className="font-mono text-slate-800 tabular-nums dark:text-slate-100">
                      -{formatBRL(admission.serviceDiscountCents || 0)} / +{formatBRL(admission.serviceAdditionCents || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Negociado Contrato</div>
                    <div className="font-mono font-bold text-blue-700 tabular-nums dark:text-blue-300">
                      {formatBRL(totalContractedCents)} ({admission.installmentsCount || 1}x)
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Emitido (Títulos)</div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatBRL(totalIssuedCents)} ({admTitles.length} tít.)
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Recebido / Baixado</div>
                    <div className="font-mono font-bold text-emerald-800 tabular-nums dark:text-emerald-300">
                      {formatBRL(totalSettledCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Saldo em Aberto</div>
                    <div className="font-mono font-bold text-red-700 tabular-nums dark:text-red-300">
                      {formatBRL(totalOpenCents)}
                    </div>
                  </div>
                </div>

                {admAddendums.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                    <strong>Aditivo(s) Contratual(is):</strong> {admAddendums.length} documento(s) de aditivo anexado(s) na pasta do cliente (
                    {admAddendums.map((d) => d.fileName).join(', ')}).
                  </div>
                )}

                {admTitles.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-700">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="py-2 px-3">Parcela / Doc</th>
                          <th className="py-2 px-3">Vencimento</th>
                          <th className="py-2 px-3 text-right">Valor Orig.</th>
                          <th className="py-2 px-3 text-right">Saldo</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {admTitles.map((t) => {
                          const stU = String(t.status || 'ABERTO').toUpperCase();
                          return (
                            <tr key={t.id}>
                              <td className="py-1.5 px-3 font-mono font-semibold text-slate-800 dark:text-slate-100">
                                {t.documentNumber || t.titleCode} ({t.installmentNumber}/{t.totalInstallments})
                              </td>
                              <td className="py-1.5 px-3 font-mono text-slate-600 tabular-nums dark:text-slate-300">
                                {formatDueDateLocalBR(t.dueDate)}
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                                {formatBRL(t.originalValueCents || t.amountCents)}
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono font-semibold tabular-nums">
                                {formatBRL(stU === 'PAGO' ? 0 : t.currentBalanceCents ?? t.amountCents)}
                              </td>
                              <td
                                className={`py-1.5 px-3 font-mono font-bold ${
                                  stU === 'PAGO'
                                    ? 'text-emerald-800 dark:text-emerald-300'
                                    : stU === 'PARCIAL'
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : 'text-slate-700 dark:text-slate-200'
                                }`}
                              >
                                {translateTitleStatus(t.status)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {admNegotiations.length > 0 && (
                <div>
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                    Mesa de Negociação Bancária Vinculada ({admNegotiations.length})
                  </h4>
                  <div className="space-y-2">
                    {admNegotiations.map((neg) => (
                      <div key={neg.id} className="rounded-lg border border-slate-200 p-3 space-y-1.5 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {neg.bankName} · Status:{' '}
                            <span className="font-mono uppercase text-blue-700 dark:text-blue-300">{neg.status}</span>
                          </span>
                          <span className="font-mono text-[11px] text-emerald-800 font-bold tabular-nums dark:text-emerald-300">
                            Redução atual {neg.currentReductionPct}% (Meta {neg.targetReductionPct}%) · Economia est.{' '}
                            {formatBRL(neg.estimatedSavingsCents)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3.5 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/60">
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Banco</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {bankObj?.name || admission.bankName || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Modalidade</div>
                  <div className="text-slate-800 dark:text-slate-100">
                    {modalityObj?.description || admission.modality || admission.debtType || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Valor Financiado</div>
                  <div className="font-mono font-bold text-blue-700 tabular-nums dark:text-blue-300">
                    {formatBRL(admission.financedAmountCents || admission.debtAmountCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Valor Parcela Atual</div>
                  <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatBRL(admission.currentInstallmentCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Parcelas</div>
                  <div className="font-mono text-slate-800 dark:text-slate-100">{admission.debtTotalInstallments ?? 0}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Pagas / Em Atraso</div>
                  <div className="font-mono text-slate-800 dark:text-slate-100">
                    {admission.debtPaidInstallments ?? 0} / {admission.debtOverdueInstallments ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Dia Vencimento</div>
                  <div className="font-mono text-slate-800 dark:text-slate-100">Dia {admission.debtDueDay ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Tipo Pagamento</div>
                  <div className="text-slate-800 uppercase dark:text-slate-100">{admission.paymentType || '—'}</div>
                </div>
              </div>

              {bankObj?.services && bankObj.services.length > 0 && (
                <div>
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                    Serviços / Percentuais de Negociação ({bankObj.name})
                  </h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-700">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="py-2 px-3">Serviço</th>
                          <th className="py-2 px-3">% Negociação</th>
                          <th className="py-2 px-3 text-right">Sobre Valor Financiado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {bankObj.services.map((srv, i) => {
                          const pct = parseFloat(srv.negotiationPercent || '0') || 0;
                          const base = admission.financedAmountCents || admission.debtAmountCents || 0;
                          const estCents = Math.round((base * pct) / 100);
                          return (
                            <tr key={srv.id ?? i}>
                              <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">{srv.name}</td>
                              <td className="py-2 px-3 font-mono text-slate-600 tabular-nums dark:text-slate-300">{pct}%</td>
                              <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                                {estCents > 0 ? formatBRL(estCents) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(scenarioCols.length > 0 || admScenarios.length > 0) && (
                <div>
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                    Cenários de Recálculo
                  </h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-700">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="py-2 px-3">Cenário</th>
                          <th className="py-2 px-3 text-right">Dívida Orig.</th>
                          <th className="py-2 px-3 text-right">Nova Dívida</th>
                          <th className="py-2 px-3 text-right">Economia</th>
                          <th className="py-2 px-3 text-right">Parcelas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {scenarioCols.map((sc) => (
                          <tr key={sc.id}>
                            <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">{sc.name}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {formatBRL(sc.originalDebtCents)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {formatBRL(sc.recalcDebtCents)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                              {formatBRL(sc.savingsCents)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {sc.installmentsToPay}x
                            </td>
                          </tr>
                        ))}
                        {scenarioCols.length === 0 &&
                          admScenarios.map((sc) => (
                            <tr key={sc.id}>
                              <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-100">
                                Taxa {sc.bacenAvgRateMonthlyPct}% a.m.
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {formatBRL(sc.originalInstallmentCents * sc.installmentsTotal)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {formatBRL(sc.fairInstallmentCents * sc.installmentsTotal)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                                {formatBRL(sc.projectedSavingsCents)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {sc.installmentsTotal}x
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'documentos' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Filtrar documentos da ficha..."
                  className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <span className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                  {admDocs.length} registro(s) · Somente leitura
                </span>
              </div>

              {admDocs.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg dark:text-slate-400 dark:border-slate-700">
                  Nenhum documento anexado nesta ficha.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg dark:divide-slate-800 dark:border-slate-700">
                  {admDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate dark:text-slate-100">{doc.fileName}</div>
                        <div className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                          Categoria: {doc.docCategory} · {formatBytes(doc.sizeBytes)} ·{' '}
                          {formatDateBR(doc.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewDoc((prev) => (prev?.id === doc.id ? null : doc))}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Ver
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadAuthenticatedDocument(doc)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {previewDoc && (
                <AuthenticatedBucketViewer
                  doc={previewDoc}
                  heightClass="h-72"
                  onClose={() => setPreviewDoc(null)}
                />
              )}
            </div>
          )}

          {tab === 'whatsapp' && (
            <div className="space-y-3">
              <UazapiCallPanel
                client={clientResp || null}
                thread={admActiveThread}
                onCallLogged={onMessageSent}
              />

              {!admActiveThread ? (
                <div className="py-10 text-center text-slate-500 border border-dashed border-slate-200 rounded-lg px-4 dark:text-slate-400 dark:border-slate-700">
                  Nenhuma conversa GoTalk ou Uazapi registrada para o telefone deste cliente ainda. Você pode iniciar uma ligação via Uazapi acima.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate dark:text-slate-100">
                        {admActiveThread.contactName || clientResp?.fullName || `#${admission.clientId}`}{' '}
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          ({admActiveThread.contactPhone})
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        Provedor: <strong className="text-slate-800 dark:text-slate-100">{admActiveThread.provider.toUpperCase()}</strong>
                        {admActiveThread.operatorName ? ` · Operador ${admActiveThread.operatorName}` : ''}
                        {admActiveThread.uazapiInstanceId ? ` · Instância ${admActiveThread.uazapiInstanceId}` : ''}
                      </div>
                    </div>

                    {admClientThreads.length > 1 && (
                      <select
                        value={String(admActiveThread.id)}
                        onChange={(e) => setSelectedThreadId(Number(e.target.value))}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {admClientThreads.map((th) => (
                          <option key={th.id} value={String(th.id)}>
                            {th.provider.toUpperCase()} · {th.operatorName || 'Sem op.'} (
                            {formatDateBR(th.updatedAt)})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="border border-slate-200 rounded-lg p-3 h-72 overflow-y-auto space-y-2.5 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/60">
                    {admActiveThreadMessages.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 dark:text-slate-400">
                        Sem mensagens registradas nesta conversa.
                      </div>
                    ) : (
                      admActiveThreadMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-lg px-3 py-2 max-w-[85%] ${
                            m.direction === 'outbound'
                              ? 'ml-auto bg-slate-900 text-white dark:bg-emerald-600'
                              : 'bg-white border border-slate-200 text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'
                          }`}
                        >
                          <div className="text-[10px] opacity-75 font-mono mb-0.5 flex items-center justify-between gap-2">
                            <span>
                              {m.senderName || m.operatorName || (m.direction === 'outbound' ? 'Operador' : 'Cliente')}
                            </span>
                            <span>{formatDateTimeBR(m.createdAt)}</span>
                          </div>
                          {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                          {m.iviAudioTranscript && (
                            <div
                              className={`mt-1.5 rounded px-2 py-1 text-[11px] ${
                                m.direction === 'outbound'
                                  ? 'bg-slate-800 text-slate-200'
                                  : 'bg-blue-50 text-blue-900 border border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/70'
                              }`}
                            >
                              <strong>Transcrição Ivi:</strong> {m.iviAudioTranscript}
                            </div>
                          )}
                          {m.attachmentName && (
                            <div className="mt-1 text-[10px] font-mono opacity-80">
                              Anexo: {m.attachmentName}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {msgFeedback && (
                    <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{msgFeedback}</div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Enviar mensagem para o cliente..."
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
                    />
                    <button
                      type="button"
                      disabled={sendingMsg || !replyText.trim()}
                      onClick={() => void handleAdmSendWhatsapp()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Enviar
                    </button>
                  </div>

                  {gotalkHsmTemplates.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <select
                        value={selectedHsmId}
                        onChange={(e) => setSelectedHsmId(e.target.value)}
                        className="flex-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">Selecionar Template HSM (Ativo)...</option>
                        {gotalkHsmTemplates.map((t) => (
                          <option key={t.id} value={String(t.id)}>
                            {t.templateName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={sendingMsg || !selectedHsmId}
                        onClick={() => void handleAdmSendHsm()}
                        className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Disparar HSM
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'auditoria' && (
            <div className="space-y-4">
              {legalLoading ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  Carregando histórico jurídico e auditoria...
                </div>
              ) : legalError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                  {legalError}
                </div>
              ) : (
                <>
                  <div>
                    <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                      Consulta Jurídica Registrada (Histórico Escavador)
                    </h4>
                    {!legalData?.legalScan?.found ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                        Nenhuma ocorrência jurídica histórica vinculada a esta ficha.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {legalData.legalScan.allProcesses.map((p) => (
                          <div key={p.id} className="rounded-lg border border-slate-200 p-3 space-y-1 dark:border-slate-700">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {p.numeroProcesso}
                              </span>
                              <span className="font-mono text-[11px] uppercase font-bold text-slate-700 dark:text-slate-200">
                                {p.tribunal} · {p.status}
                              </span>
                            </div>
                            {p.ultimaMovimentacao && (
                              <p className="text-slate-600 dark:text-slate-300">{p.ultimaMovimentacao}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 dark:text-slate-400">
                      Rounds de Auditoria ({(legalData?.critiques || []).length})
                    </h4>
                    {(legalData?.critiques || []).length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                        Nenhum round de auditoria registrado.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(legalData?.critiques || []).map((c) => (
                          <div key={c.id} className="rounded-lg border border-slate-200 p-3 space-y-1 dark:border-slate-700">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="font-bold text-slate-800 dark:text-slate-100">
                                Round #{c.round} · {c.author}
                              </span>
                              <span className="font-mono">{formatDateTimeBR(c.createdAt)}</span>
                            </div>
                            <p className="text-slate-800 dark:text-slate-100">{c.reason}</p>
                            {c.commercialResponse && (
                              <p className="text-emerald-800 bg-emerald-50 rounded p-2 dark:text-emerald-300 dark:bg-emerald-950/50">
                                <strong>Resposta Comercial ({c.respondedBy}):</strong>{' '}
                                {c.commercialResponse}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Somente visualização · Dados fidedignos ao negociado
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 6. MODAL DADOS DO CLIENTE + WHATSAPP (3 COLUNAS) + ATENDIMENTOS
// -----------------------------------------------------------------------------
interface ClientDetailResponse {
  admissionsDetail: Array<{
    admissionId: number;
    contractNumber: string;
    protocolCode: string;
    status: string;
    addendumsCount: number;
    hasAddendum: boolean;
    latestAddendumDate: string | null;
    addendums: DocumentObject[];
    parcelas: FinancialTitle[];
  }>;
  allClientTitles: FinancialTitle[];
}

export const ClientDetailModal: React.FC<{
  client: Client | null;
  initialTab?: 'dados' | 'whatsapp' | 'atendimentos';
  initialCollaboratorId?: number | null;
  initialAdmissionId?: number | null;
  admissions: Admission[];
  portfolioTitles: FinancialTitle[];
  allReceberTitles?: FinancialTitle[];
  collaborators: CollaboratorItem[];
  users?: Array<{
    id: number;
    name: string;
    email?: string;
    role: string;
    points: number;
    whatsappPhone?: string;
  }>;
  documents: DocumentObject[];
  recalcScenarios: RecalcScenario[];
  gotalkEnabled: boolean;
  whatsappThreads: WhatsappThread[];
  whatsappMessages: WhatsappMessage[];
  gotalkChannels: GotalkChannelPublic[];
  gotalkOperators?: GotalkOperatorPublic[];
  gotalkHsmTemplates: GotalkHsmTemplate[];
  onClose: () => void;
  onOpenAdmission: (adm: Admission) => void;
  onMessageSent: () => Promise<void>;
}> = ({
  client,
  initialTab = 'dados',
  initialCollaboratorId = null,
  initialAdmissionId = null,
  admissions,
  portfolioTitles,
  allReceberTitles,
  collaborators,
  users = [],
  documents,
  gotalkEnabled,
  whatsappThreads,
  whatsappMessages,
  gotalkChannels,
  gotalkOperators = [],
  gotalkHsmTemplates,
  onClose,
  onOpenAdmission,
  onMessageSent,
}) => {
  const [tab, setTab] = useState<'dados' | 'whatsapp' | 'atendimentos'>(initialTab);
  const [showBlockReason, setShowBlockReason] = useState(false);
  const [detailData, setDetailData] = useState<ClientDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState('');
  const [selectedHsmId, setSelectedHsmId] = useState('');
  const [attendanceFilterScope, setAttendanceFilterScope] = useState<'client' | 'all'>('client');
  const [attendanceCollabFilter, setAttendanceCollabFilter] = useState<string>(
    initialCollaboratorId ? String(initialCollaboratorId) : ''
  );

  // WhatsApp 3-Colunas: Anexos do Cliente (Bucket) + Resumo Ivi
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [previewBucketDoc, setPreviewBucketDoc] = useState<DocumentObject | null>(null);
  const [iviSummaryCache, setIviSummaryCache] = useState<Record<string, IviWhatsappSummaryPayload>>({});
  const [iviSummaryLoading, setIviSummaryLoading] = useState(false);
  const [iviSummaryError, setIviSummaryError] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, client?.id]);

  useEffect(() => {
    setAttendanceCollabFilter(initialCollaboratorId ? String(initialCollaboratorId) : '');
  }, [initialCollaboratorId]);

  useEffect(() => {
    if (!client) return;
    setShowBlockReason(false);
    setMsgFeedback('');
    setSelectedThreadId(null);
    setAttachmentsOpen(false);
    setPreviewBucketDoc(null);
    setIviSummaryError('');
    if (client.status === 'suspenso' || client.status === 'cancelado') {
      playBlockedClientAlertTone();
    }
    setLoadingDetail(true);
    apiFetch<ClientDetailResponse>(`/api/admissions/client-detail/${client.id}`)
      .then((res) => setDetailData(res))
      .catch(() => setDetailData(null))
      .finally(() => setLoadingDetail(false));
  }, [client?.id]);

  const clientAdmissions = useMemo(() => {
    if (!client) return [];
    return admissions
      .filter((a) => a.clientId === client.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [admissions, client]);

  const primaryAdmission = useMemo(() => {
    if (clientAdmissions.length === 0) return null;
    if (initialAdmissionId) {
      const exact = clientAdmissions.find((a) => a.id === initialAdmissionId);
      if (exact) return exact;
    }
    const eligible = clientAdmissions.find((a) =>
      ['auditada', 'aprovada', 'finalizada', 'concluido'].includes(String(a.status || '').toLowerCase())
    );
    return eligible || clientAdmissions[0];
  }, [clientAdmissions, initialAdmissionId]);

  const clientBucketDocs = useMemo(() => {
    if (!client) return [];
    return documents
      .filter((d) => !d.deletedAt && d.clientId === client.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [documents, client]);

  const clientPortfolioTitles = useMemo(() => {
    if (!client) return [];
    const base = allReceberTitles && allReceberTitles.length > 0 ? allReceberTitles : portfolioTitles;
    return base.filter((t) => t.clientId === client.id && String(t.status || '').toUpperCase() !== 'CANCELADO');
  }, [portfolioTitles, allReceberTitles, client]);

  const clientThreads = useMemo(() => {
    if (!client) return [];
    const phoneDigits = (client.whatsapp || client.phone || '').replace(/\D/g, '').slice(-8);
    return whatsappThreads.filter(
      (th) =>
        th.clientId === client.id ||
        (phoneDigits.length >= 8 && th.contactPhone.replace(/\D/g, '').endsWith(phoneDigits))
    );
  }, [whatsappThreads, client]);

  const activeThread = useMemo(() => {
    if (clientThreads.length === 0) return null;
    if (selectedThreadId) {
      const found = clientThreads.find((t) => t.id === selectedThreadId);
      if (found) return found;
    }
    return clientThreads[0];
  }, [clientThreads, selectedThreadId]);

  const activeThreadMessages = useMemo(() => {
    if (!activeThread) return [];
    return whatsappMessages.filter((m) => m.threadId === activeThread.id);
  }, [whatsappMessages, activeThread]);

  const matchedOperatorInfo = useMemo(() => {
    const opName = activeThread?.operatorName || '';
    const opUserId = activeThread?.assignedOperatorId || null;

    const userMatch =
      (opUserId ? users.find((u) => u.id === opUserId) : undefined) ||
      (opName ? users.find((u) => u.name.toLowerCase() === opName.toLowerCase()) : undefined);

    const collabMatch =
      (initialCollaboratorId ? collaborators.find((c) => c.id === initialCollaboratorId) : undefined) ||
      (userMatch ? collaborators.find((c) => c.userId === userMatch.id) : undefined) ||
      (opName ? collaborators.find((c) => c.name.toLowerCase() === opName.toLowerCase()) : undefined);

    const gotalkMatch =
      (collabMatch ? gotalkOperators.find((g) => g.collaboratorId === collabMatch.id) : undefined) ||
      (opName ? gotalkOperators.find((g) => (g.name || '').toLowerCase() === opName.toLowerCase()) : undefined);

    if (!userMatch && !collabMatch && !gotalkMatch && !opName) return null;
    return {
      name: collabMatch?.name || userMatch?.name || gotalkMatch?.name || opName || 'Operador',
      role: collabMatch?.jobTitle || userMatch?.role || 'Consultor de Cobrança',
      email: collabMatch?.email || userMatch?.email || gotalkMatch?.email || '',
      phone: collabMatch?.phone || userMatch?.whatsappPhone || gotalkMatch?.phone || '',
      department: activeThread?.department || 'Cobrança',
      points: userMatch?.points ?? null,
    };
  }, [activeThread, users, collaborators, gotalkOperators, initialCollaboratorId]);

  const summaryCacheKey = client ? `${client.id}-${activeThread?.id || 0}` : '';
  const currentIviSummary = summaryCacheKey ? iviSummaryCache[summaryCacheKey] : undefined;

  const fetchIviWhatsappSummary = useCallback(
    async (force = false) => {
      if (!client) return;
      const key = `${client.id}-${activeThread?.id || 0}`;
      if (!force && iviSummaryCache[key]) return;
      setIviSummaryLoading(true);
      setIviSummaryError('');
      try {
        const res = await apiFetch<IviWhatsappSummaryPayload>(
          '/api/collection/coordinator/whatsapp-summary',
          {
            method: 'POST',
            body: JSON.stringify({
              clientId: client.id,
              threadId: activeThread?.id,
            }),
          }
        );
        setIviSummaryCache((prev) => ({ ...prev, [key]: res }));
      } catch (err) {
        setIviSummaryError(
          err instanceof Error ? err.message : 'Erro ao consultar resumo da Ivi.'
        );
      } finally {
        setIviSummaryLoading(false);
      }
    },
    [client, activeThread?.id, iviSummaryCache]
  );

  useEffect(() => {
    if (tab === 'whatsapp' && client && !currentIviSummary && !iviSummaryLoading) {
      void fetchIviWhatsappSummary(false);
    }
  }, [tab, client, currentIviSummary, iviSummaryLoading, fetchIviWhatsappSummary]);

  const filteredAttendances = useMemo(() => {
    const base = attendanceFilterScope === 'client' ? clientThreads : whatsappThreads;
    if (!attendanceCollabFilter) return base;
    const collabObj = collaborators.find((c) => String(c.id) === attendanceCollabFilter);
    return base.filter((th) => {
      if (collabObj?.userId && th.assignedOperatorId === collabObj.userId) return true;
      if (collabObj && (th.operatorName || '').toLowerCase() === collabObj.name.toLowerCase())
        return true;
      return false;
    });
  }, [attendanceFilterScope, clientThreads, whatsappThreads, attendanceCollabFilter, collaborators]);

  const handleSendWhatsapp = async () => {
    if (!replyText.trim() || !activeThread) return;
    setSendingMsg(true);
    setMsgFeedback('');
    try {
      await apiFetch(`/api/whatsapp/threads/${activeThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: replyText.trim(),
          contentType: 'text',
          direction: 'outbound',
        }),
      });
      setReplyText('');
      setMsgFeedback('Mensagem enviada e registrada no histórico.');
      await onMessageSent();
    } catch (err) {
      setMsgFeedback(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleSendHsm = async () => {
    if (!selectedHsmId || !activeThread) return;
    setSendingMsg(true);
    setMsgFeedback('');
    try {
      await apiFetch(`/api/whatsapp/threads/${activeThread.id}/send-hsm`, {
        method: 'POST',
        body: JSON.stringify({
          templateId: Number(selectedHsmId),
          channelDbId: gotalkChannels.find((c) => c.isActive)?.id,
          variables: { '1': client?.fullName || '' },
        }),
      });
      setMsgFeedback('Notificação ativa HSM enviada.');
      await onMessageSent();
    } catch (err) {
      setMsgFeedback(err instanceof Error ? err.message : 'Erro ao disparar HSM.');
    } finally {
      setSendingMsg(false);
    }
  };

  if (!client) return null;

  const isBlocked = client.status === 'suspenso' || client.status === 'cancelado';
  const groupedAdmissionIds = new Set((detailData?.admissionsDetail || []).map((a) => a.admissionId));
  const standaloneTitles = clientPortfolioTitles.filter(
    (t) => !t.admissionId || !groupedAdmissionIds.has(t.admissionId)
  );

  const clientOpenCents = clientPortfolioTitles
    .filter((t) => String(t.status || '').toUpperCase() !== 'PAGO')
    .reduce((s, t) => s + Number(t.currentBalanceCents ?? t.amountCents ?? 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className={`w-full ${
          tab === 'whatsapp' ? 'max-w-6xl' : 'max-w-4xl'
        } rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-all dark:border-slate-700 dark:bg-slate-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-slate-900 truncate flex items-center gap-2 dark:text-slate-100">
              <User className="w-4 h-4 text-slate-700 shrink-0 dark:text-slate-200" />
              {client.fullName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dados do Cliente · Ficha fidedigna ao negociado · WhatsApp & GoTalk/Uazapi
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {primaryAdmission && (
              <button
                type="button"
                onClick={() => onOpenAdmission(primaryAdmission)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <FileText className="w-3.5 h-3.5" />
                Ficha do Cliente
                {primaryAdmission.contractNumber ? ` (${primaryAdmission.contractNumber})` : ''}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar cliente"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Abas */}
        <div className="px-5 pt-2 border-b border-slate-200 bg-slate-50 flex gap-1 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={() => setTab('dados')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
              tab === 'dados'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-lg dark:border-emerald-500 dark:text-slate-100 dark:bg-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Dados ({clientPortfolioTitles.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('whatsapp')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
              tab === 'whatsapp'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-lg dark:border-emerald-500 dark:text-slate-100 dark:bg-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            WhatsApp ({clientThreads.length})
          </button>
          {(gotalkEnabled || clientThreads.length > 0) && (
            <button
              type="button"
              onClick={() => setTab('atendimentos')}
              className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                tab === 'atendimentos'
                  ? 'border-slate-900 text-slate-900 bg-white rounded-t-lg dark:border-emerald-500 dark:text-slate-100 dark:bg-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Atendimentos ({filteredAttendances.length})
            </button>
          )}
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-5 text-xs">
          {tab === 'dados' && (
            <>
              {isBlocked && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 space-y-1.5 dark:border-red-800/70 dark:bg-red-950/50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-red-900 dark:text-red-300">
                      <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 dark:text-red-300" />
                      <span>
                        Cliente {client.status.toUpperCase()} · {client.fullName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBlockReason((p) => !p)}
                      className="text-xs font-semibold text-red-800 underline dark:text-red-300"
                    >
                      {showBlockReason ? 'Ocultar motivo' : 'Ver motivo'}
                    </button>
                  </div>
                  {showBlockReason && (
                    <div className="text-red-800 bg-white/80 rounded p-2 border border-red-100 dark:text-red-300 dark:bg-slate-900/95 dark:border-red-800/70">
                      <strong>Causa registrada:</strong>{' '}
                      {client.suspensionReason || client.cancelledReason || 'Sem motivo registrado.'}
                    </div>
                  )}
                </div>
              )}

              {/* Dados Cadastrais */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-800/60">
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Nome / Razão Social</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{client.fullName || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">CPF / CNPJ</div>
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{client.cpfCnpj || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Telefone / WhatsApp</div>
                  <div className="font-mono text-slate-800 dark:text-slate-100">
                    {client.whatsapp || client.phone || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">E-mail</div>
                  <div className="text-slate-800 dark:text-slate-100">{client.email || '—'}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Endereço</div>
                  <div className="text-slate-800 dark:text-slate-100">
                    {[client.address, client.city, client.state].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </div>

              {/* Títulos do Cliente */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Títulos do Cliente ({clientPortfolioTitles.length})
                  </h4>
                  {loadingDetail && (
                    <span className="text-[11px] text-slate-400 font-mono dark:text-slate-400">
                      carregando fichas... / carregando aditivos...
                    </span>
                  )}
                </div>

                {(detailData?.admissionsDetail || [])
                  .filter((grp) => grp.parcelas.length > 0)
                  .map((grp) => (
                    <div
                      key={grp.admissionId}
                      className="rounded-lg border border-slate-200 overflow-hidden dark:border-slate-700"
                    >
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 dark:bg-slate-800/70 dark:border-slate-700">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Ficha:{' '}
                          <span className="font-mono">
                            {grp.contractNumber || grp.protocolCode || 'Sem contrato'}
                          </span>
                        </span>
                        {grp.hasAddendum && (
                          <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                            Possui Aditivo Contratual ({grp.addendumsCount} · último{' '}
                            {formatDateBR(grp.latestAddendumDate)})
                          </span>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {grp.parcelas.map((p) => {
                          const stU = String(p.status || 'ABERTO').toUpperCase();
                          return (
                            <div
                              key={p.id}
                              className="px-3.5 py-2 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                  {p.documentNumber || p.titleCode}
                                </span>{' '}
                                <span className="text-slate-500 dark:text-slate-400">
                                  · {p.description || 'Parcela'} · Venc. {formatDueDateLocalBR(p.dueDate)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                                <span
                                  className={
                                    stU === 'PAGO'
                                      ? 'font-bold text-emerald-800 dark:text-emerald-300'
                                      : stU === 'PARCIAL'
                                      ? 'font-bold text-blue-700 dark:text-blue-300'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }
                                >
                                  {translateTitleStatus(p.status)}
                                </span>
                                <span className="font-bold text-slate-900 dark:text-slate-100">
                                  {formatBRL(stU === 'PAGO' ? 0 : p.currentBalanceCents ?? p.amountCents)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                {standaloneTitles.length > 0 && (
                  <div className="rounded-lg border border-slate-200 overflow-hidden dark:border-slate-700">
                    <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">
                      Títulos Avulsos / Sem Ficha Vinculada
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {standaloneTitles.map((p) => {
                        const stU = String(p.status || 'ABERTO').toUpperCase();
                        return (
                          <div
                            key={p.id}
                            className="px-3.5 py-2 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {p.documentNumber || p.titleCode}
                              </span>{' '}
                              <span className="text-slate-500 dark:text-slate-400">
                                · {p.description} · Venc. {formatDueDateLocalBR(p.dueDate)}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                              <span
                                className={
                                  stU === 'PAGO'
                                    ? 'font-bold text-emerald-800 dark:text-emerald-300'
                                    : stU === 'PARCIAL'
                                    ? 'font-bold text-blue-700 dark:text-blue-300'
                                    : 'text-slate-600 dark:text-slate-300'
                                }
                              >
                                {translateTitleStatus(p.status)}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-slate-100">
                                {formatBRL(stU === 'PAGO' ? 0 : p.currentBalanceCents ?? p.amountCents)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Admissões / Contratos */}
              <div className="space-y-2.5">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Admissões / Contratos ({clientAdmissions.length})
                </h4>
                {clientAdmissions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Nenhuma ficha de admissão vinculada a este cliente.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {clientAdmissions.map((adm) => {
                      const admDetail = detailData?.admissionsDetail.find(
                        (d) => d.admissionId === adm.id
                      );
                      const admStatusUpper = String(adm.status || '').toUpperCase();
                      const statusColor = ['APROVADA', 'FINALIZADA', 'CONCLUIDO', 'AUDITADA'].includes(
                        admStatusUpper
                      )
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : admStatusUpper === 'REPROVADA'
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-amber-700';
                      return (
                        <div
                          key={adm.id}
                          className="rounded-lg border border-slate-200 p-3.5 space-y-2 bg-white dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                Contrato{' '}
                                <span className="font-mono">{adm.contractNumber || adm.protocolCode}</span>
                              </div>
                              <div className={`font-mono text-[11px] font-bold uppercase ${statusColor}`}>
                                {adm.status}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onOpenAdmission(adm)}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                              <Eye className="w-3 h-3" />
                              Ver Ficha
                            </button>
                          </div>
                          {admDetail?.hasAddendum && (
                            <div className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                              Aditivo Contratual ({admDetail.addendumsCount}) ·{' '}
                              {formatDateBR(admDetail.latestAddendumDate)}
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-100 dark:text-slate-300 dark:border-slate-800">
                            <div>
                              <span className="block text-slate-400 dark:text-slate-400">Parcelas</span>
                              <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                                {adm.debtPaidInstallments ?? 0}/{adm.debtTotalInstallments ?? 0}
                              </span>
                            </div>
                            <div>
                              <span className="block text-slate-400 dark:text-slate-400">Negociado</span>
                              <span className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-100">
                                {formatBRL(
                                  adm.serviceFeeCents || adm.financedAmountCents || adm.debtAmountCents
                                )}
                              </span>
                            </div>
                            <div>
                              <span className="block text-slate-400 dark:text-slate-400">Venc.</span>
                              <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                                Dia {adm.debtDueDay ?? '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ABA WHATSAPP EM 3 COLUNAS: Esquerda (Cliente + Anexos) | Centro (GoTalk/Uazapi) | Direita (Operador + Resumo Ivi) */}
          {tab === 'whatsapp' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* CONTAINER ESTREITO ESQUERDO: Dados do Cliente + Botão Visualizar Anexos */}
                <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="border-b border-slate-200 pb-2 dark:border-slate-700">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Cliente em Atendimento
                    </div>
                    <div className="font-display text-sm font-bold text-slate-900 mt-0.5 dark:text-slate-100">
                      {client.fullName}
                    </div>
                    <div className="font-mono text-[11px] text-slate-600 mt-0.5 dark:text-slate-300">
                      {client.cpfCnpj || 'CPF/CNPJ não informado'}
                    </div>
                  </div>

                  <div className="space-y-2 text-[11px]">
                    <div>
                      <span className="text-slate-500 block dark:text-slate-400">Telefone / WhatsApp</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {client.whatsapp || client.phone || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block dark:text-slate-400">E-mail</span>
                      <span className="text-slate-800 break-all dark:text-slate-100">{client.email || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block dark:text-slate-400">Cidade / UF</span>
                      <span className="text-slate-800 dark:text-slate-100">
                        {[client.city, client.state].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block dark:text-slate-400">Status Cadastro</span>
                      <span
                        className={`font-mono font-bold uppercase ${
                          isBlocked ? 'text-red-700 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'
                        }`}
                      >
                        {client.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block dark:text-slate-400">Saldo Aberto na Cobrança</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {formatBRL(clientOpenCents)}
                      </span>
                    </div>
                    {primaryAdmission && (
                      <div>
                        <span className="text-slate-500 block dark:text-slate-400">Contrato Principal</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                          {primaryAdmission.contractNumber || primaryAdmission.protocolCode}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200 space-y-2 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setAttachmentsOpen((prev) => !prev)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-blue-700 shrink-0 dark:text-blue-300" />
                      Visualizar Anexos ({clientBucketDocs.length})
                    </button>

                    {primaryAdmission && (
                      <button
                        type="button"
                        onClick={() => onOpenAdmission(primaryAdmission)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <FileText className="w-3 h-3" />
                        Abrir Ficha do Cliente
                      </button>
                    )}
                  </div>

                  {attachmentsOpen && (
                    <div className="pt-2 border-t border-slate-200 space-y-2 dark:border-slate-700">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                        Arquivos no Bucket da Invicta ({clientBucketDocs.length})
                      </div>
                      {clientBucketDocs.length === 0 ? (
                        <div className="text-[11px] text-slate-500 py-2 dark:text-slate-400">
                          Nenhum anexo encontrado para este cliente.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
                          {clientBucketDocs.map((doc) => (
                            <div key={doc.id} className="p-2 space-y-1">
                              <div className="text-[11px] font-semibold text-slate-900 truncate dark:text-slate-100">
                                {doc.fileName}
                              </div>
                              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                <span>{doc.docCategory}</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewBucketDoc((p) => (p?.id === doc.id ? null : doc))
                                    }
                                    className="text-blue-700 font-bold hover:underline dark:text-blue-300"
                                  >
                                    Ver
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void downloadAuthenticatedDocument(doc)}
                                    className="text-slate-700 hover:underline dark:text-slate-200"
                                  >
                                    Baixar
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* CONTAINER CENTRAL MAIOR: Ligações Uazapi + Conversas ocorridas via GoTalk e/ou Uazapi */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
                  {previewBucketDoc && (
                    <AuthenticatedBucketViewer
                      doc={previewBucketDoc}
                      heightClass="h-60"
                      onClose={() => setPreviewBucketDoc(null)}
                    />
                  )}

                  <UazapiCallPanel
                    client={client}
                    thread={activeThread}
                    onCallLogged={onMessageSent}
                  />

                  {!activeThread ? (
                    <div className="py-12 text-center text-slate-500 border border-dashed border-slate-200 rounded-lg px-4 dark:text-slate-400 dark:border-slate-700">
                      Nenhuma conversa GoTalk ou Uazapi registrada para o telefone deste cliente ainda. Você pode iniciar uma ligação via Uazapi acima.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate dark:text-slate-100">
                            {activeThread.contactName || client.fullName}{' '}
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              ({activeThread.contactPhone})
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            Provedor ativo: <strong className="text-slate-800 dark:text-slate-100">{activeThread.provider.toUpperCase()}</strong>
                            {activeThread.uazapiInstanceId ? ` · Instância ${activeThread.uazapiInstanceId}` : ''}
                            {activeThread.gotalkAttendanceId ? ` · Atend. ${activeThread.gotalkAttendanceId}` : ''}
                          </div>
                        </div>

                        {clientThreads.length > 1 && (
                          <select
                            value={String(activeThread.id)}
                            onChange={(e) => setSelectedThreadId(Number(e.target.value))}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          >
                            {clientThreads.map((th) => (
                              <option key={th.id} value={String(th.id)}>
                                {th.provider.toUpperCase()} · {th.operatorName || 'Sem op.'} (
                                {formatDateBR(th.updatedAt)})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="border border-slate-200 rounded-lg p-3 h-80 overflow-y-auto space-y-2.5 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/60">
                        {activeThreadMessages.length === 0 ? (
                          <div className="text-center text-slate-400 py-10 dark:text-slate-400">
                            Sem mensagens registradas nesta conversa.
                          </div>
                        ) : (
                          activeThreadMessages.map((m) => (
                            <div
                              key={m.id}
                              className={`rounded-lg px-3 py-2 max-w-[85%] ${
                                m.direction === 'outbound'
                                  ? 'ml-auto bg-slate-900 text-white dark:bg-emerald-600'
                                  : 'bg-white border border-slate-200 text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'
                              }`}
                            >
                              <div className="text-[10px] opacity-75 font-mono mb-0.5 flex items-center justify-between gap-2">
                                <span>
                                  {m.senderName || m.operatorName || (m.direction === 'outbound' ? 'Operador' : 'Cliente')}
                                </span>
                                <span>{formatDateTimeBR(m.createdAt)}</span>
                              </div>
                              {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                              {m.iviAudioTranscript && (
                                <div
                                  className={`mt-1.5 rounded px-2 py-1 text-[11px] ${
                                    m.direction === 'outbound'
                                      ? 'bg-slate-800 text-slate-200'
                                      : 'bg-blue-50 text-blue-900 border border-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/70'
                                  }`}
                                >
                                  <strong>Transcrição Ivi:</strong> {m.iviAudioTranscript}
                                </div>
                              )}
                              {m.attachmentName && (
                                <div className="mt-1 text-[10px] font-mono opacity-80">
                                  Anexo: {m.attachmentName}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {msgFeedback && (
                        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{msgFeedback}</div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Enviar mensagem para o cliente..."
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
                        />
                        <button
                          type="button"
                          disabled={sendingMsg || !replyText.trim()}
                          onClick={() => void handleSendWhatsapp()}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Enviar
                        </button>
                      </div>

                      {gotalkHsmTemplates.length > 0 && (
                        <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <select
                            value={selectedHsmId}
                            onChange={(e) => setSelectedHsmId(e.target.value)}
                            className="flex-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          >
                            <option value="">Selecionar Template HSM (Ativo)...</option>
                            {gotalkHsmTemplates.map((t) => (
                              <option key={t.id} value={String(t.id)}>
                                {t.templateName}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={sendingMsg || !selectedHsmId}
                            onClick={() => void handleSendHsm()}
                            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            Disparar HSM
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* CONTAINER ESTREITO DIREITO: Dados do Operador + Resumo da Ivi */}
                <div className="lg:col-span-3 space-y-3">
                  {/* Card do Operador Responsável */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Operador do Atendimento
                    </div>
                    {matchedOperatorInfo ? (
                      <div className="space-y-1.5 text-[11px]">
                        <div className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                          {matchedOperatorInfo.name}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">{matchedOperatorInfo.role}</div>
                        <div className="text-slate-600 dark:text-slate-300">
                          Depto: <strong className="text-slate-800 dark:text-slate-100">{matchedOperatorInfo.department}</strong>
                        </div>
                        {matchedOperatorInfo.phone && (
                          <div className="font-mono text-slate-700 dark:text-slate-200">{matchedOperatorInfo.phone}</div>
                        )}
                        {matchedOperatorInfo.email && (
                          <div className="text-slate-600 break-all dark:text-slate-300">{matchedOperatorInfo.email}</div>
                        )}
                        {matchedOperatorInfo.points !== null && (
                          <div className="pt-1 border-t border-slate-200 font-mono font-bold text-blue-700 dark:border-slate-700 dark:text-blue-300">
                            {matchedOperatorInfo.points.toLocaleString('pt-BR')} pts no Ranking
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Atendimento sem operador atribuído nesta conversa.
                      </div>
                    )}
                  </div>

                  {/* Card Resumo da Ivi */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                      <div className="flex items-center gap-1.5 font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                        <Bot className="w-4 h-4 text-blue-700 shrink-0 dark:text-blue-300" />
                        Resumo da Ivi
                      </div>
                      <button
                        type="button"
                        disabled={iviSummaryLoading}
                        onClick={() => void fetchIviWhatsappSummary(true)}
                        title="Atualizar resumo da Ivi"
                        className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <RefreshCw className={`w-3 h-3 ${iviSummaryLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {iviSummaryLoading && !currentIviSummary ? (
                      <div className="py-4 text-[11px] text-slate-500 dark:text-slate-400">
                        Ivi analisando as conversas GoTalk/Uazapi...
                      </div>
                    ) : iviSummaryError ? (
                      <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2 dark:text-red-300 dark:bg-red-950/50 dark:border-red-800/70">
                        {iviSummaryError}
                      </div>
                    ) : currentIviSummary ? (
                      <div className="space-y-2.5 text-[11px]">
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          <span>Sentimento: <strong className="text-slate-800 dark:text-slate-100">{currentIviSummary.sentiment}</strong></span>
                          <span>{formatDateTimeBR(currentIviSummary.analyzedAt)}</span>
                        </div>
                        <p className="text-slate-800 leading-relaxed dark:text-slate-100">{currentIviSummary.summary}</p>
                        {currentIviSummary.commitments.length > 0 && (
                          <div className="space-y-1">
                            <div className="font-bold text-slate-700 dark:text-slate-200">Compromissos / Sinais:</div>
                            <ul className="list-disc pl-4 space-y-0.5 text-slate-600 dark:text-slate-300">
                              {currentIviSummary.commitments.map((c, idx) => (
                                <li key={idx}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-2 text-blue-950 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
                          <span className="font-bold block text-[10px] uppercase">Próxima Ação Sugerida</span>
                          {currentIviSummary.recommendedNextStep}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Clique em atualizar para a Ivi resumir esta conversa.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'atendimentos' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterScope('client')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                      attendanceFilterScope === 'client'
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-emerald-600 dark:border-emerald-500'
                        : 'bg-white text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceFilterScope('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                      attendanceFilterScope === 'all'
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-emerald-600 dark:border-emerald-500'
                        : 'bg-white text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Todos
                  </button>
                </div>
                <select
                  value={attendanceCollabFilter}
                  onChange={(e) => setAttendanceCollabFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Todos os atendentes</option>
                  {collaborators.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {filteredAttendances.length === 0 ? (
                <div className="py-10 text-center text-slate-500 border border-dashed border-slate-200 rounded-lg dark:text-slate-400 dark:border-slate-700">
                  Nenhum atendimento encontrado para o filtro selecionado.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg dark:divide-slate-800 dark:border-slate-700">
                  {filteredAttendances.map((th) => (
                    <div
                      key={th.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {th.contactName || th.contactPhone || 'Contato desconhecido'} ·{' '}
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {th.provider.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">
                          Operador: {th.operatorName || 'Sem operador'} ·{' '}
                          {th.lastMessagePreview || 'Sem mensagens'}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0 dark:text-slate-400">
                        {formatDateTimeBR(th.updatedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 7. MODAL ESPELHAMENTO SILENCIOSO DA TELA DO OPERADOR (SOMENTE LEITURA)
// -----------------------------------------------------------------------------
export const OperatorShadowModal: React.FC<{
  collaboratorId: number | null;
  collaborators: CollaboratorItem[];
  onChangeCollaborator: (id: number) => void;
  onInspectClient?: (clientId: number) => void;
  onClose: () => void;
}> = ({ collaboratorId, collaborators, onChangeCollaborator, onInspectClient, onClose }) => {
  const [mirror, setMirror] = useState<OperatorMirrorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedTitleId, setSelectedTitleId] = useState<number | null>(null);

  const loadMirror = useCallback(async (cId: number) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await apiFetch<OperatorMirrorPayload>(
        `/api/collection/coordinator/operator-mirror/${cId}`
      );
      setMirror(data);
      setSelectedTitleId(data.queue[0]?.titleId ?? null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao espelhar tela do operador.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!collaboratorId) return;
    void loadMirror(collaboratorId);
  }, [collaboratorId, loadMirror]);

  if (!collaboratorId) return null;

  const activeItem =
    mirror?.queue.find((q) => q.titleId === selectedTitleId) || mirror?.queue[0] || null;
  const activeNotes = (mirror?.notes || []).filter(
    (n) =>
      activeItem &&
      (n.titleId === activeItem.titleId || n.clientId === activeItem.clientId)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-emerald-600">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-emerald-400 shrink-0" />
              <h3 className="font-display text-base font-bold truncate">
                Espelhamento Silencioso da Tela do Operador
              </h3>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
              Modo Somente Leitura — o operador não recebe notificação nem registro de inspeção
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={String(collaboratorId)}
              onChange={(e) => onChangeCollaborator(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white dark:text-slate-100"
            >
              {collaborators.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadMirror(collaboratorId)}
              title="Atualizar espelho"
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar espelhamento"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {loading && !mirror ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              Carregando visão em tempo real do operador...
            </div>
          ) : mirror ? (
            <>
              {/* Indicadores do Operador */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Operador</div>
                  <div className="font-bold text-slate-900 truncate dark:text-slate-100">{mirror.collaborator.name}</div>
                  <div className="text-[11px] font-mono text-blue-700 dark:text-blue-300">
                    {mirror.linkedUser
                      ? `#${mirror.linkedUser.rankPosition} · ${mirror.linkedUser.points} pts`
                      : 'Sem usuário'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Na Fila (Aberto)</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {mirror.metrics.totalAssignedCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Vencidos</div>
                  <div className="font-mono text-base font-bold text-red-700 tabular-nums dark:text-red-300">
                    {mirror.metrics.overdueCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Saldo em Carteira</div>
                  <div className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatBRL(mirror.metrics.openBalanceCents)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Recuperado</div>
                  <div className="font-mono text-sm font-bold text-emerald-800 tabular-nums dark:text-emerald-300">
                    {formatBRL(mirror.metrics.recoveredCents)} ({mirror.metrics.paidCount})
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Anotações / Canc.</div>
                  <div className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {mirror.metrics.notesCount} / {mirror.metrics.cancelRequestsCount}
                  </div>
                </div>
              </div>

              {/* Visão Espelhada 2-Colunas */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Coluna Esquerda: Fila Priorizada do Operador */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 overflow-hidden bg-white dark:border-slate-700 dark:bg-slate-900">
                  <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between dark:bg-slate-800/70 dark:border-slate-700">
                    <span className="font-display font-bold text-slate-800 dark:text-slate-100">
                      Fila Priorizada do Operador ({mirror.queue.length})
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">Atraso + Saldo</span>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {mirror.queue.length === 0 ? (
                      <div className="py-12 text-center text-slate-500 dark:text-slate-400">
                        Nenhum título atribuído a este operador.
                      </div>
                    ) : (
                      mirror.queue.map((item) => {
                        const isSel = activeItem?.titleId === item.titleId;
                        const stUpper = String(item.status || '').toUpperCase();
                        return (
                          <button
                            key={item.titleId}
                            type="button"
                            onClick={() => setSelectedTitleId(item.titleId)}
                            className={`w-full text-left px-3.5 py-2.5 transition-colors space-y-1 ${
                              isSel ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'hover:bg-slate-50 text-slate-900 dark:hover:bg-slate-800 dark:text-slate-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold truncate">{item.clientName}</span>
                              <span
                                className={`font-mono font-bold tabular-nums shrink-0 ${
                                  isSel
                                    ? 'text-emerald-300'
                                    : stUpper === 'PAGO'
                                    ? 'text-emerald-800 dark:text-emerald-300'
                                    : stUpper === 'PARCIAL'
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {formatBRL(
                                  stUpper === 'PAGO' ? item.amountCents : item.currentBalanceCents
                                )}
                              </span>
                            </div>
                            <div
                              className={`flex items-center justify-between text-[11px] font-mono ${
                                isSel ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              <span>
                                {item.documentNumber} · Venc. {formatDueDateLocalBR(item.dueDate)}
                              </span>
                              <span>
                                {stUpper === 'PAGO'
                                  ? 'Recebimento Total'
                                  : item.agingDays > 0
                                  ? `${item.agingDays}d atraso`
                                  : 'Em dia'}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Coluna Direita: Tela de Atendimento Atual do Operador */}
                <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
                  {!activeItem ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                      Selecione um título na fila ao lado para inspecionar o andamento.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div>
                          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                            {activeItem.clientName}
                          </h4>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {activeItem.clientCpfCnpj || '—'} · UF {activeItem.stateCode} · Doc.{' '}
                            {activeItem.documentNumber}
                          </div>
                        </div>
                        {onInspectClient && (
                          <button
                            type="button"
                            onClick={() => onInspectClient(activeItem.clientId)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Abrir Dados do Cliente
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                        <div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">Vencimento</div>
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {formatDueDateLocalBR(activeItem.dueDate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">Valor Original</div>
                          <div className="font-mono font-semibold text-blue-700 tabular-nums dark:text-blue-300">
                            {formatBRL(activeItem.amountCents)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">Saldo Atual</div>
                          <div className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            {formatBRL(activeItem.currentBalanceCents)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">Status Título</div>
                          <div
                            className={`font-mono font-bold ${
                              String(activeItem.status).toUpperCase() === 'PAGO'
                                ? 'text-emerald-800 dark:text-emerald-300'
                                : String(activeItem.status).toUpperCase() === 'PARCIAL'
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-slate-800 dark:text-slate-100'
                            }`}
                          >
                            {translateTitleStatus(activeItem.status)}
                          </div>
                        </div>
                      </div>

                      {activeItem.conversationSummary && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1 dark:border-slate-700 dark:bg-slate-800/60">
                          <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 dark:text-slate-200">
                            <Sparkles className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                            Resumo Registrado no Caso
                          </div>
                          <p className="text-slate-700 whitespace-pre-wrap dark:text-slate-200">
                            {activeItem.conversationSummary}
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="font-display text-xs font-bold text-slate-800 dark:text-slate-100">
                          Anotações & Tratativas do Operador ({activeNotes.length})
                        </div>
                        {activeNotes.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            O operador ainda não registrou notas para este cliente/título.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto">
                            {activeNotes.map((n) => (
                              <div
                                key={n.id}
                                className="rounded-lg border border-slate-200 p-3 space-y-1 bg-white dark:border-slate-700 dark:bg-slate-900"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                  <span className="font-bold text-slate-900 dark:text-slate-100">
                                    {n.channel.toUpperCase()} · {n.negotiationStatus}
                                  </span>
                                  <span className="font-mono text-slate-500 dark:text-slate-400">
                                    {n.contactDate} {n.contactTime} · {n.collaboratorName}
                                  </span>
                                </div>
                                {n.note && <p className="text-slate-700 dark:text-slate-200">{n.note}</p>}
                                {n.cancelRequest && (
                                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900 text-[11px] dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                                    <strong>Solicitação de Cancelamento:</strong>{' '}
                                    {n.cancelRequest.notes || 'Registrada pelo operador'}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
          <span>
            Espelhamento passivo de leitura · Nenhuma alteração pode ser enviada desta visualização
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
