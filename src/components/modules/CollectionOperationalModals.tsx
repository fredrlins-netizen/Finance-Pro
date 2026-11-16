import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  Calculator,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  MessageSquare,
  Paperclip,
  PauseCircle,
  Phone,
  Send,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBRL,
  formatBytes,
  formatDateBR,
  formatDateTimeBR,
  getAuthToken,
} from '../../lib/api.ts';
import {
  Admission,
  Client,
  CollaboratorItem,
  CollectionCancelRequestInfo,
  CollectionCase,
  CollectionDebtSnapshot,
  CollectionNote,
  CollectionNoteAttachment,
  DocumentObject,
  FinancialTitle,
  TitleSettlement,
  WhatsappThread,
} from '../../types.ts';
import {
  AuthenticatedBucketViewer,
  computeAgingDays,
  ConfirmDeleteModal,
  formatDueDateLocalBR,
  toIsoDateInput,
  translateTitleStatus,
  UazapiCallPanel,
} from './CollectionCoordinatorModalViews.tsx';

export const NEGOTIATION_STATUS_LABELS: Record<string, string> = {
  AGUARDANDO_CONTATO: 'Aguardando Contato',
  ENCAMINHOU_BOLETO: 'Encaminhou Boleto',
  RECUSA_DIVIDA: 'Recusa Dívida',
  FECHADA: 'Negociação Fechada',
  OUTROS: 'Outros',
  SOLICITA_CANCELAMENTO: 'Solicita Cancelamento',
};

export const CHANNEL_LABELS: Record<string, string> = {
  TELEFONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  PRESENCIAL: 'Presencial',
  OUTROS: 'Outros',
};

export function formatNegotiationStatusLabel(status: string | undefined, otherDetail?: string): string {
  const key = String(status || 'AGUARDANDO_CONTATO').toUpperCase();
  const base = NEGOTIATION_STATUS_LABELS[key] || status || 'Aguardando Contato';
  if (key === 'OUTROS' && otherDetail?.trim()) {
    return `${base}: ${otherDetail.trim()}`;
  }
  return base;
}

export function formatChannelLabel(channel: string | undefined): string {
  const key = String(channel || 'TELEFONE').toUpperCase();
  return CHANNEL_LABELS[key] || channel || 'Telefone';
}

export function parseCurrencyInputToCents(raw: string): number {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return 0;
  const normalized = trimmed.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export interface TitleFinancialBreakdown {
  originalCents: number;
  interestCents: number;
  fineCents: number;
  discountCents: number;
  updatedCents: number;
  receivedCents: number;
  balanceCents: number;
}

export function computeTitleFinancialBreakdown(
  title: FinancialTitle,
  settledByTitleMap: Map<number, number>
): TitleFinancialBreakdown {
  const st = String(title.status || 'ABERTO').trim().toUpperCase();
  const originalCents = Math.max(0, Number(title.originalValueCents || title.amountCents || 0));
  const interestCents = Math.max(0, Number(title.interestCents || 0));
  const fineCents = Math.max(0, Number(title.fineCents || 0));
  const discountCents = Math.max(0, Number(title.discountCents || 0));
  const updatedCents = Math.max(0, originalCents + interestCents + fineCents - discountCents);

  const explicitSettled = settledByTitleMap.get(title.id) || 0;
  let receivedCents = explicitSettled;
  if (st === 'PAGO' && receivedCents <= 0) {
    receivedCents = updatedCents > 0 ? updatedCents : originalCents;
  } else if (st === 'PARCIAL' && receivedCents <= 0 && title.currentBalanceCents != null) {
    receivedCents = Math.max(0, updatedCents - Number(title.currentBalanceCents));
  }

  const balanceCents =
    st === 'PAGO' || st === 'CANCELADO' || st === 'AGRUPADO' || st === 'FATURA_GERADA'
      ? 0
      : title.currentBalanceCents != null
      ? Math.max(0, Number(title.currentBalanceCents))
      : Math.max(0, updatedCents - receivedCents);

  return {
    originalCents,
    interestCents,
    fineCents,
    discountCents,
    updatedCents,
    receivedCents,
    balanceCents,
  };
}

async function downloadAuthenticatedUri(uri: string, fileName: string) {
  const token = getAuthToken();
  const resp = await fetch(uri, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error('Não foi possível baixar o arquivo.');
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

// =============================================================================
// 1. SUBMODAL: SOLICITAÇÃO DE CANCELAMENTO (Seleção de Ficha / Contrato)
// =============================================================================
export const CancelRequestSubmodal: React.FC<{
  open: boolean;
  client: Client;
  admissions: Admission[];
  initialValue?: CollectionCancelRequestInfo | null;
  defaultContract?: string;
  onConfirm: (payload: CollectionCancelRequestInfo) => void;
  onCancel: () => void;
}> = ({
  open,
  client,
  admissions,
  initialValue,
  defaultContract = '',
  onConfirm,
  onCancel,
}) => {
  const todayIso = useMemo(() => toIsoDateInput(new Date()), []);
  const clientAdmissions = useMemo(
    () => admissions.filter((a) => a.clientId === client.id),
    [admissions, client.id]
  );

  const [selectedAdmissionId, setSelectedAdmissionId] = useState<number | null>(null);
  const [manualContract, setManualContract] = useState('');
  const [requestDate, setRequestDate] = useState(todayIso);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setRequestDate(initialValue?.requestDate || todayIso);
    setNotes(initialValue?.notes || '');
    if (initialValue?.admissionId) {
      setSelectedAdmissionId(initialValue.admissionId);
      setManualContract(initialValue.admissionContract || '');
    } else if (clientAdmissions.length === 1) {
      setSelectedAdmissionId(clientAdmissions[0].id);
      setManualContract(
        clientAdmissions[0].contractNumber || clientAdmissions[0].protocolCode || ''
      );
    } else {
      setSelectedAdmissionId(null);
      setManualContract(initialValue?.admissionContract || defaultContract || '');
    }
  }, [open, initialValue, todayIso, clientAdmissions, defaultContract]);

  if (!open) return null;

  const canConfirm =
    Boolean(requestDate) &&
    (clientAdmissions.length > 0 ? selectedAdmissionId !== null : Boolean(manualContract.trim()));

  const handleConfirm = () => {
    if (!canConfirm) return;
    const chosenAdm = clientAdmissions.find((a) => a.id === selectedAdmissionId) || null;
    onConfirm({
      requestDate,
      admissionId: chosenAdm ? chosenAdm.id : null,
      admissionContract: chosenAdm
        ? `${chosenAdm.protocolCode} · Contrato ${chosenAdm.contractNumber}`
        : manualContract.trim(),
      notes: notes.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Solicitação de Cancelamento à Coordenação
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cliente: <strong className="text-slate-800">{client.fullName}</strong> · CPF/CNPJ{' '}
              <span className="font-mono tabular-nums">{client.cpfCnpj}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {clientAdmissions.length > 0
                ? 'Selecione a Ficha de Admissão / Contrato *'
                : 'Número do Contrato / Referência *'}
            </label>

            {clientAdmissions.length > 0 ? (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {clientAdmissions.map((adm) => {
                  const isSelected = selectedAdmissionId === adm.id;
                  return (
                    <label
                      key={adm.id}
                      className={`flex items-start gap-3 px-3.5 py-2.5 cursor-pointer text-xs transition-colors ${
                        isSelected ? 'bg-slate-900/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="cancel_admission_id"
                        checked={isSelected}
                        onChange={() => setSelectedAdmissionId(adm.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            Ficha {adm.protocolCode} · Contrato {adm.contractNumber}
                          </span>
                          <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                            {formatBRL(adm.serviceFeeCents || adm.debtAmountCents || 0)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {adm.bankName} · {adm.modality} · Status: {adm.status}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={manualContract}
                onChange={(e) => setManualContract(e.target.value)}
                placeholder="Informe o protocolo ou contrato referência..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data da Solicitação *
              </label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Ao registrar o contato, a Coordenação e a Gerência receberão notificação automática em tempo real.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observações Gerais do Cancelamento
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo relatado pelo cliente, tentativa de retenção realizada, condições pendentes..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            Confirmar Vínculo da Solicitação
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 2. MODAL 3 COLUNAS: SIMULAÇÃO & NEGOCIAÇÃO + CONTATO + HISTÓRICO DO TÍTULO
// =============================================================================
export const CollectionContactModal: React.FC<{
  open: boolean;
  title: FinancialTitle | null;
  client: Client | undefined;
  admissions: Admission[];
  collaborators: CollaboratorItem[];
  documents: DocumentObject[];
  notes: CollectionNote[];
  settledByTitleMap: Map<number, number>;
  whatsappThreads: WhatsappThread[];
  defaultCollaboratorId?: number | null;
  onClose: () => void;
  onOpenClientWhatsapp: (clientId: number) => void;
  onSaved: (toastMessage: string) => Promise<void>;
}> = ({
  open,
  title,
  client,
  admissions,
  collaborators,
  documents,
  notes,
  settledByTitleMap,
  whatsappThreads,
  defaultCollaboratorId = null,
  onClose,
  onOpenClientWhatsapp,
  onSaved,
}) => {
  const [simInterestInput, setSimInterestInput] = useState('0.00');
  const [simFineInput, setSimFineInput] = useState('0.00');
  const [simDiscountInput, setSimDiscountInput] = useState('0.00');
  const [simDueDate, setSimDueDate] = useState('');
  const [applyingTitle, setApplyingTitle] = useState(false);

  const [channel, setChannel] = useState('TELEFONE');
  const [negotiationStatus, setNegotiationStatus] = useState('AGUARDANDO_CONTATO');
  const [prevNegotiationStatus, setPrevNegotiationStatus] = useState('AGUARDANDO_CONTATO');
  const [otherStatusDetail, setOtherStatusDetail] = useState('');
  const [nextContactDate, setNextContactDate] = useState('');
  const [noteText, setNoteText] = useState('');
  const [cancelRequestInfo, setCancelRequestInfo] = useState<CollectionCancelRequestInfo | null>(null);
  const [cancelSubmodalOpen, setCancelSubmodalOpen] = useState(false);

  const [pendingAttachments, setPendingAttachments] = useState<CollectionNoteAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalFeedback, setModalFeedback] = useState('');

  const [showAllClientNotes, setShowAllClientNotes] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [editNoteChannel, setEditNoteChannel] = useState('TELEFONE');
  const [editNoteStatus, setEditNoteStatus] = useState('AGUARDANDO_CONTATO');
  const [editNoteOtherDetail, setEditNoteOtherDetail] = useState('');
  const [editNoteNextDate, setEditNoteNextDate] = useState('');
  const [deletingNote, setDeletingNote] = useState<CollectionNote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentObject | null>(null);

  useEffect(() => {
    if (!open || !title) return;
    setSimInterestInput((Number(title.interestCents || 0) / 100).toFixed(2));
    setSimFineInput((Number(title.fineCents || 0) / 100).toFixed(2));
    setSimDiscountInput((Number(title.discountCents || 0) / 100).toFixed(2));
    setSimDueDate(toIsoDateInput(title.dueDate));
    setChannel('TELEFONE');
    setNegotiationStatus('AGUARDANDO_CONTATO');
    setPrevNegotiationStatus('AGUARDANDO_CONTATO');
    setOtherStatusDetail('');
    setNextContactDate('');
    setNoteText('');
    setCancelRequestInfo(null);
    setCancelSubmodalOpen(false);
    setPendingAttachments([]);
    setModalError('');
    setModalFeedback('');
    setEditingNoteId(null);
    setDeletingNote(null);
    setPreviewDoc(null);
  }, [open, title]);

  const docMap = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);

  const currentBreakdown = useMemo(() => {
    if (!title) {
      return {
        originalCents: 0,
        interestCents: 0,
        fineCents: 0,
        discountCents: 0,
        updatedCents: 0,
        receivedCents: 0,
        balanceCents: 0,
      };
    }
    return computeTitleFinancialBreakdown(title, settledByTitleMap);
  }, [title, settledByTitleMap]);

  const simulated = useMemo(() => {
    const interestCents = parseCurrencyInputToCents(simInterestInput);
    const fineCents = parseCurrencyInputToCents(simFineInput);
    const discountCents = parseCurrencyInputToCents(simDiscountInput);
    const updatedCents = Math.max(
      0,
      currentBreakdown.originalCents + interestCents + fineCents - discountCents
    );
    const balanceCents = Math.max(0, updatedCents - currentBreakdown.receivedCents);
    const diffCents = balanceCents - currentBreakdown.balanceCents;
    return {
      interestCents,
      fineCents,
      discountCents,
      updatedCents,
      balanceCents,
      diffCents,
    };
  }, [simInterestInput, simFineInput, simDiscountInput, currentBreakdown]);

  const clientThread = useMemo(() => {
    if (!client) return null;
    const digits = (client.whatsapp || client.phone || '').replace(/\D/g, '').slice(-8);
    return (
      whatsappThreads.find(
        (th) =>
          th.clientId === client.id ||
          (digits.length >= 8 && th.contactPhone.replace(/\D/g, '').endsWith(digits))
      ) || null
    );
  }, [client, whatsappThreads]);

  const historyNotes = useMemo(() => {
    if (!title || !client) return [];
    if (showAllClientNotes) {
      return notes.filter((n) => n.clientId === client.id);
    }
    return notes.filter((n) => n.titleId === title.id);
  }, [notes, title, client, showAllClientNotes]);

  if (!open || !title || !client) return null;

  const normStatus = String(title.status || 'ABERTO').trim().toUpperCase();
  const isFinalTitle = ['PAGO', 'CANCELADO', 'AGRUPADO', 'FATURA_GERADA'].includes(normStatus);
  const isBlockedClient = client.status === 'suspenso' || client.status === 'cancelado';

  const handleStatusSelect = (nextVal: string) => {
    if (nextVal === 'SOLICITA_CANCELAMENTO') {
      setPrevNegotiationStatus(negotiationStatus);
      setNegotiationStatus(nextVal);
      setCancelSubmodalOpen(true);
    } else {
      setNegotiationStatus(nextVal);
      setCancelRequestInfo(null);
    }
  };

  const handleApplySimulationToTitle = async () => {
    if (isFinalTitle || isBlockedClient) return;
    if (!simDueDate) {
      setModalError('Informe uma data de vencimento válida para aplicar ao título.');
      return;
    }
    setApplyingTitle(true);
    setModalError('');
    setModalFeedback('');
    try {
      await apiFetch(`/api/financial-titles/${title.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          titleScope: 'RECEBER',
          documentNumber: (title.documentNumber || title.titleCode || `TIT-${title.id}`).trim(),
          description: (
            title.description ||
            title.documentNumber ||
            title.titleCode ||
            `Título #${title.id}`
          ).trim(),
          dueDate: simDueDate,
          interestCents: simulated.interestCents,
          fineCents: simulated.fineCents,
          discountCents: simulated.discountCents,
          amountCents: simulated.updatedCents,
        }),
      });
      const msg = `Simulação aplicada ao título ${title.documentNumber || title.titleCode}: novo saldo ${formatBRL(
        simulated.balanceCents
      )}.`;
      setModalFeedback(msg);
      await onSaved(msg);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao aplicar simulação ao título.');
    } finally {
      setApplyingTitle(false);
    }
  };

  const handleUploadNoteAttachment = async (file: File) => {
    setUploadingAttachment(true);
    setModalError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('clientId', String(client.id));
      if (title.admissionId) {
        formData.append('admissionId', String(title.admissionId));
      }
      formData.append('docCategory', 'comprovante');

      const token = getAuthToken();
      const resp = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = (await resp.json()) as { document?: DocumentObject; error?: string };
      if (!resp.ok || !json.document) {
        throw new Error(json.error || 'Falha ao enviar anexo ao Bucket da Invicta.');
      }
      const doc = json.document;
      setPendingAttachments((prev) => [
        ...prev,
        {
          id: `doc-${doc.id}`,
          name: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          documentId: doc.id,
          storageUri: doc.storageUri || `/api/documents/${doc.id}/download`,
        },
      ]);
      await onSaved(`Anexo "${doc.fileName}" armazenado no Bucket da Invicta.`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao anexar arquivo.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) {
      setModalError('A descrição da nota/tratativa é obrigatória.');
      return;
    }
    if (negotiationStatus === 'OUTROS' && !otherStatusDetail.trim()) {
      setModalError('Especifique o detalhe do status "Outros".');
      return;
    }
    if (negotiationStatus === 'SOLICITA_CANCELAMENTO' && !cancelRequestInfo) {
      setCancelSubmodalOpen(true);
      return;
    }

    setSavingNote(true);
    setModalError('');
    setModalFeedback('');
    try {
      const debtSnapshot: CollectionDebtSnapshot = {
        originalCents: currentBreakdown.originalCents,
        interestCents: simulated.interestCents,
        fineCents: simulated.fineCents,
        discountCents: simulated.discountCents,
        balanceCents: simulated.balanceCents,
      };

      const effectiveCollabId = title.assignedCollaboratorId || defaultCollaboratorId || null;
      const res = await apiFetch<{
        note: CollectionNote;
        appointmentCreated?: boolean;
        appointmentError?: string | null;
        notificationsSentCount?: number;
      }>('/api/collection-notes', {
        method: 'POST',
        body: JSON.stringify({
          titleId: title.id,
          clientId: client.id,
          collaboratorId: effectiveCollabId,
          channel,
          negotiationStatus,
          otherStatusDetail: negotiationStatus === 'OUTROS' ? otherStatusDetail.trim() : '',
          nextContactDate:
            negotiationStatus === 'SOLICITA_CANCELAMENTO' ? '' : nextContactDate.trim(),
          note: noteText.trim(),
          debtSnapshotJson: debtSnapshot,
          attachmentsJson: pendingAttachments,
          cancelRequest:
            negotiationStatus === 'SOLICITA_CANCELAMENTO' ? cancelRequestInfo : null,
        }),
      });

      let feedbackMsg = 'Contato registrado com sucesso.';
      if (negotiationStatus === 'SOLICITA_CANCELAMENTO') {
        feedbackMsg = `Solicitação de cancelamento enviada à Coordenação (${
          res.notificationsSentCount || 1
        } notificação(ões) disparada(s)).`;
      } else if (nextContactDate) {
        if (res.appointmentCreated) {
          feedbackMsg = `Contato registrado e retorno agendado automaticamente para ${formatDueDateLocalBR(
            nextContactDate
          )}.`;
        } else if (res.appointmentError) {
          feedbackMsg = `Contato registrado, porém o agendamento retornou aviso: ${res.appointmentError}`;
        }
      }

      setNoteText('');
      setOtherStatusDetail('');
      setNextContactDate('');
      setPendingAttachments([]);
      if (negotiationStatus === 'SOLICITA_CANCELAMENTO') {
        setNegotiationStatus('AGUARDANDO_CONTATO');
        setCancelRequestInfo(null);
      }
      setModalFeedback(feedbackMsg);
      await onSaved(feedbackMsg);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao registrar contato.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveEditedNote = async (noteId: number) => {
    if (!editNoteText.trim()) {
      setModalError('O texto da nota não pode ficar vazio.');
      return;
    }
    if (editNoteStatus === 'OUTROS' && !editNoteOtherDetail.trim()) {
      setModalError('Informe o detalhe do status "Outros".');
      return;
    }
    setSavingNote(true);
    setModalError('');
    try {
      await apiFetch(`/api/collection-notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({
          channel: editNoteChannel,
          negotiationStatus: editNoteStatus,
          otherStatusDetail: editNoteStatus === 'OUTROS' ? editNoteOtherDetail.trim() : '',
          nextContactDate: editNoteNextDate,
          note: editNoteText.trim(),
        }),
      });
      setEditingNoteId(null);
      setModalFeedback('Nota atualizada no histórico.');
      await onSaved('Nota de cobrança atualizada.');
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao atualizar nota.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleConfirmDeleteNote = async () => {
    if (!deletingNote) return;
    setDeleteBusy(true);
    setModalError('');
    try {
      await apiFetch(`/api/collection-notes/${deletingNote.id}`, { method: 'DELETE' });
      setDeletingNote(null);
      setModalFeedback('Nota excluída do histórico.');
      await onSaved('Nota de cobrança excluída.');
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao excluir nota.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const assignedCollab = title.assignedCollaboratorId
    ? collaborators.find((c) => c.id === title.assignedCollaboratorId)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-5">
      <div className="w-full max-w-7xl max-h-[92vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-slate-50/70">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-slate-900 truncate">
              Negociação, Contato & Histórico — {client.fullName}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-mono tabular-nums">
              <span>CPF/CNPJ {client.cpfCnpj}</span>
              <span>·</span>
              <span>Doc {title.documentNumber || title.titleCode}</span>
              <span>·</span>
              <span>Venc. {formatDueDateLocalBR(title.dueDate)}</span>
              <span>·</span>
              <span>{translateTitleStatus(title.status)}</span>
              {assignedCollab && (
                <>
                  <span>·</span>
                  <span>Resp: {assignedCollab.name}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenClientWhatsapp(client.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
              WhatsApp 3-Colunas
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(modalError || modalFeedback) && (
          <div className="px-5 pt-3">
            {modalError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-800">
                {modalError}
              </div>
            )}
            {modalFeedback && !modalError && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900">
                {modalFeedback}
              </div>
            )}
          </div>
        )}

        {/* 3 Columns Body */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* COLUNA 1: SIMULAÇÃO & NEGOCIAÇÃO */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-4 space-y-3.5 flex flex-col justify-between">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-slate-600" />
                  Simulação & Negociação
                </h3>
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {computeAgingDays(title.dueDate) > 0
                    ? `${computeAgingDays(title.dueDate)}d atraso`
                    : 'A vencer'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Valor Original</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatBRL(currentBreakdown.originalCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Recebido (Baixas Reais)</span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatBRL(currentBreakdown.receivedCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Saldo Atual no Banco</span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatBRL(currentBreakdown.balanceCents)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Juros (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={simInterestInput}
                    onChange={(e) => setSimInterestInput(e.target.value)}
                    disabled={isFinalTitle || isBlockedClient}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Multa (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={simFineInput}
                    onChange={(e) => setSimFineInput(e.target.value)}
                    disabled={isFinalTitle || isBlockedClient}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Desconto Concedido (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={simDiscountInput}
                    onChange={(e) => setSimDiscountInput(e.target.value)}
                    disabled={isFinalTitle || isBlockedClient}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Vencimento Acordado
                  </label>
                  <input
                    type="date"
                    value={simDueDate}
                    onChange={(e) => setSimDueDate(e.target.value)}
                    disabled={isFinalTitle || isBlockedClient}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Valor Atualizado Simulado</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatBRL(simulated.updatedCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200/80 pt-1.5">
                  <span className="font-semibold text-slate-900">Novo Saldo Devedor</span>
                  <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {formatBRL(simulated.balanceCents)}
                  </span>
                </div>
                {simulated.diffCents !== 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Diferença vs. Saldo Atual</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        simulated.diffCents < 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {simulated.diffCents > 0 ? '+' : ''}
                      {formatBRL(simulated.diffCents)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 space-y-2">
              {(isFinalTitle || isBlockedClient) && (
                <p className="text-[11px] text-amber-800">
                  {isBlockedClient
                    ? `Cliente com status ${client.status.toUpperCase()}: edição financeira bloqueada.`
                    : `Título com status ${translateTitleStatus(title.status)}: edição bloqueada.`}
                </p>
              )}
              <button
                type="button"
                disabled={applyingTitle || isFinalTitle || isBlockedClient}
                onClick={() => void handleApplySimulationToTitle()}
                className="w-full rounded-lg border border-slate-900 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-900 hover:text-white transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {applyingTitle ? 'Gravando no Título...' : 'Aplicar Alterações ao Título'}
              </button>
            </div>
          </div>

          {/* COLUNA 2: FORMULÁRIO DE CONTATO + INTEGRAÇÃO TELEFONE/UAZAPI/AGENDA */}
          <form
            onSubmit={handleSaveContact}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-4 space-y-3 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-600" />
                  Registrar Contato
                </h3>
                <span className="text-[11px] text-slate-500">Grava snapshot da dívida</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Canal *
                  </label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="TELEFONE">Telefone</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="PRESENCIAL">Presencial</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Status da Negociação *
                  </label>
                  <select
                    value={negotiationStatus}
                    onChange={(e) => handleStatusSelect(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="AGUARDANDO_CONTATO">Aguardando Contato</option>
                    <option value="ENCAMINHOU_BOLETO">Encaminhou Boleto</option>
                    <option value="RECUSA_DIVIDA">Recusa Dívida</option>
                    <option value="FECHADA">Negociação Fechada</option>
                    <option value="OUTROS">Outros</option>
                    <option value="SOLICITA_CANCELAMENTO">Solicita Cancelamento</option>
                  </select>
                </div>
              </div>

              {(channel === 'TELEFONE' || channel === 'WHATSAPP') && (
                <div className="space-y-2">
                  <UazapiCallPanel client={client} thread={clientThread} />
                </div>
              )}

              {negotiationStatus === 'OUTROS' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Especificar Status (Outros) *
                  </label>
                  <input
                    type="text"
                    required
                    value={otherStatusDetail}
                    onChange={(e) => setOtherStatusDetail(e.target.value)}
                    placeholder="Descreva o status específico..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              )}

              {negotiationStatus === 'SOLICITA_CANCELAMENTO' && cancelRequestInfo && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-950">
                      Vínculo de Cancelamento Selecionado
                    </span>
                    <button
                      type="button"
                      onClick={() => setCancelSubmodalOpen(true)}
                      className="text-[11px] font-semibold text-amber-900 underline"
                    >
                      Alterar
                    </button>
                  </div>
                  <div className="text-[11px] text-amber-900 font-mono">
                    {cancelRequestInfo.admissionContract || 'Sem contrato'} · Solicitação:{' '}
                    {formatDueDateLocalBR(cancelRequestInfo.requestDate)}
                  </div>
                </div>
              )}

              {negotiationStatus !== 'SOLICITA_CANCELAMENTO' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Próximo Contato (cria agendamento real na Agenda)
                  </label>
                  <input
                    type="date"
                    value={nextContactDate}
                    onChange={(e) => setNextContactDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Nota / Tratativa Realizada *
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const clip = await navigator.clipboard.readText();
                        if (clip) setNoteText((p) => (p ? `${p}\n${clip}` : clip));
                      } catch {
                        // clipboard permission denied
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    Colar
                  </button>
                </div>
                <textarea
                  rows={4}
                  required
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Descreva os termos acordados, objeções, previsão de pagamento ou tratativa..."
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Anexos (Bucket da Invicta)
                  </span>
                  <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 cursor-pointer">
                    <Paperclip className="w-3 h-3" />
                    {uploadingAttachment ? 'Enviando...' : 'Anexar arquivo'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploadingAttachment}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadNoteAttachment(f);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
                {pendingAttachments.length > 0 && (
                  <div className="space-y-1">
                    {pendingAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px]"
                      >
                        <span className="truncate text-slate-800">{att.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAttachments((prev) => prev.filter((x) => x.id !== att.id))
                          }
                          className="text-slate-400 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingNote || uploadingAttachment || !noteText.trim()}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              {savingNote ? 'Salvando Contato...' : 'Salvar Contato & Integrações'}
            </button>
          </form>

          {/* COLUNA 3: HISTÓRICO DE CONTATOS (Duplo clique para editar + Excluir + Preview Anexo) */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-4 space-y-3 flex flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-bold text-slate-900 tabular-nums">
                Histórico ({historyNotes.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowAllClientNotes((p) => !p)}
                className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 whitespace-nowrap"
              >
                {showAllClientNotes ? 'Apenas deste título' : 'Ver todos do cliente'}
              </button>
            </div>

            {previewDoc && (
              <AuthenticatedBucketViewer
                doc={previewDoc}
                heightClass="h-48"
                onClose={() => setPreviewDoc(null)}
              />
            )}

            <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[520px] pr-0.5">
              {historyNotes.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  Nenhum contato registrado {showAllClientNotes ? 'para este cliente' : 'neste título'}.
                  <p className="mt-1 text-[11px] text-slate-400">
                    Dica: duplo clique em uma nota permite editá-la diretamente.
                  </p>
                </div>
              ) : (
                historyNotes.map((n) => {
                  const isEditing = editingNoteId === n.id;
                  const attachments = Array.isArray(n.attachmentsJson) ? n.attachmentsJson : [];
                  return (
                    <div
                      key={n.id}
                      onDoubleClick={() => {
                        setEditingNoteId(n.id);
                        setEditNoteChannel(n.channel || 'TELEFONE');
                        setEditNoteStatus(n.negotiationStatus || 'AGUARDANDO_CONTATO');
                        setEditNoteOtherDetail(n.otherStatusDetail || '');
                        setEditNoteNextDate(n.nextContactDate || '');
                        setEditNoteText(n.note || '');
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 text-xs space-y-1.5 hover:border-slate-300 transition-colors"
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={editNoteChannel}
                              onChange={(e) => setEditNoteChannel(e.target.value)}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                            >
                              <option value="TELEFONE">Telefone</option>
                              <option value="WHATSAPP">WhatsApp</option>
                              <option value="EMAIL">E-mail</option>
                              <option value="PRESENCIAL">Presencial</option>
                              <option value="OUTROS">Outros</option>
                            </select>
                            <select
                              value={editNoteStatus}
                              onChange={(e) => setEditNoteStatus(e.target.value)}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                            >
                              <option value="AGUARDANDO_CONTATO">Aguardando Contato</option>
                              <option value="ENCAMINHOU_BOLETO">Encaminhou Boleto</option>
                              <option value="RECUSA_DIVIDA">Recusa Dívida</option>
                              <option value="FECHADA">Negociação Fechada</option>
                              <option value="OUTROS">Outros</option>
                              <option value="SOLICITA_CANCELAMENTO">Solicita Cancelamento</option>
                            </select>
                          </div>
                          {editNoteStatus === 'OUTROS' && (
                            <input
                              type="text"
                              value={editNoteOtherDetail}
                              onChange={(e) => setEditNoteOtherDetail(e.target.value)}
                              placeholder="Detalhe do status Outros..."
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                            />
                          )}
                          <input
                            type="date"
                            value={editNoteNextDate}
                            onChange={(e) => setEditNoteNextDate(e.target.value)}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono"
                          />
                          <textarea
                            rows={3}
                            value={editNoteText}
                            onChange={(e) => setEditNoteText(e.target.value)}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={savingNote}
                              onClick={() => void handleSaveEditedNote(n.id)}
                              className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[11px] text-slate-500">
                              <strong className="text-slate-800">{n.collaboratorName || 'Equipe'}</strong>
                              <span> · {formatChannelLabel(n.channel)} · </span>
                              <span className="font-medium text-slate-700">
                                {formatNegotiationStatusLabel(n.negotiationStatus, n.otherStatusDetail)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                title="Editar contato"
                                onClick={() => {
                                  setEditingNoteId(n.id);
                                  setEditNoteChannel(n.channel || 'TELEFONE');
                                  setEditNoteStatus(n.negotiationStatus || 'AGUARDANDO_CONTATO');
                                  setEditNoteOtherDetail(n.otherStatusDetail || '');
                                  setEditNoteNextDate(n.nextContactDate || '');
                                  setEditNoteText(n.note || '');
                                }}
                                className="p-1 text-slate-400 hover:text-slate-800"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                title="Excluir contato"
                                onClick={() => setDeletingNote(n)}
                                className="p-1 text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                            {n.note}
                          </p>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-slate-500 tabular-nums">
                            <span>{formatDateTimeBR(n.createdAt)}</span>
                            {n.nextContactDate && (
                              <span className="text-slate-700 font-semibold">
                                · Próx. contato: {formatDueDateLocalBR(n.nextContactDate)}
                              </span>
                            )}
                          </div>

                          {n.debtSnapshotJson && (
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums pt-1 border-t border-slate-200/70">
                              Snapshot: Orig {formatBRL(n.debtSnapshotJson.originalCents)} · Desc{' '}
                              {formatBRL(n.debtSnapshotJson.discountCents)} · Saldo{' '}
                              <strong className="text-slate-800">
                                {formatBRL(n.debtSnapshotJson.balanceCents)}
                              </strong>
                            </div>
                          )}

                          {n.cancelRequest && (
                            <div className="text-[11px] text-amber-900 pt-1 border-t border-amber-200/70">
                              Solicitação Cancelamento: {n.cancelRequest.admissionContract || 'Contrato'} ·{' '}
                              {formatDueDateLocalBR(n.cancelRequest.requestDate)}
                            </div>
                          )}

                          {attachments.length > 0 && (
                            <div className="pt-1.5 border-t border-slate-200/70 flex flex-wrap gap-1.5">
                              {attachments.map((att) => {
                                const linkedDoc = att.documentId ? docMap.get(att.documentId) : undefined;
                                const downloadUri =
                                  att.storageUri ||
                                  (att.documentId ? `/api/documents/${att.documentId}/download` : '');
                                return (
                                  <div
                                    key={att.id}
                                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                                  >
                                    <Paperclip className="w-3 h-3 text-slate-400" />
                                    <span className="truncate max-w-[130px] text-slate-700">
                                      {att.name}
                                    </span>
                                    {linkedDoc && (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewDoc(linkedDoc)}
                                        className="font-semibold text-slate-700 hover:text-slate-950"
                                      >
                                        Ver
                                      </button>
                                    )}
                                    {downloadUri && (
                                      <button
                                        type="button"
                                        onClick={() => void downloadAuthenticatedUri(downloadUri, att.name)}
                                        className="font-semibold text-slate-600 hover:text-slate-900"
                                      >
                                        Baixar
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <CancelRequestSubmodal
        open={cancelSubmodalOpen}
        client={client}
        admissions={admissions}
        initialValue={cancelRequestInfo}
        defaultContract={title.contractNumber || title.documentNumber || ''}
        onConfirm={(payload) => {
          setCancelRequestInfo(payload);
          setCancelSubmodalOpen(false);
          if (!noteText.trim() && payload.notes) {
            setNoteText(payload.notes);
          }
        }}
        onCancel={() => {
          setCancelSubmodalOpen(false);
          if (!cancelRequestInfo) {
            setNegotiationStatus(prevNegotiationStatus || 'AGUARDANDO_CONTATO');
          }
        }}
      />

      <ConfirmDeleteModal
        open={Boolean(deletingNote)}
        title="Excluir Contato do Histórico"
        message="Deseja remover permanentemente esta nota de contato? A exclusão ficará registrada no log de auditoria."
        busy={deleteBusy}
        onCancel={() => setDeletingNote(null)}
        onConfirm={handleConfirmDeleteNote}
      />
    </div>
  );
};

// =============================================================================
// 3. PAINEL LATERAL DO TÍTULO (Duplo Clique na Linha da Grade — Cap. 04)
// =============================================================================
export const CollectionSidePanel: React.FC<{
  title: FinancialTitle;
  client: Client;
  allClientTitles: FinancialTitle[];
  admissions: Admission[];
  documents: DocumentObject[];
  notes: CollectionNote[];
  cases: CollectionCase[];
  categories: Array<{ id: number; name: string; providerCode: string }>;
  settledByTitleMap: Map<number, number>;
  canVerFicha: boolean;
  canExcluirDoc: boolean;
  onSelectTitle: (t: FinancialTitle) => void;
  onOpenContactModal: (t: FinancialTitle) => void;
  onOpenClientModal: (clientId: number, tab: 'dados' | 'whatsapp' | 'atendimentos') => void;
  onOpenAdmissionModal: (adm: Admission) => void;
  onClose: () => void;
  onReload: (toastMsg?: string) => Promise<void>;
}> = ({
  title,
  client,
  allClientTitles,
  admissions,
  documents,
  notes,
  cases,
  categories,
  settledByTitleMap,
  canVerFicha,
  canExcluirDoc,
  onSelectTitle,
  onOpenContactModal,
  onOpenClientModal,
  onOpenAdmissionModal,
  onClose,
  onReload,
}) => {
  const [showCancelledTitles, setShowCancelledTitles] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    categories[0] ? String(categories[0].id) : ''
  );
  const [busyAction, setBusyAction] = useState(false);
  const [panelError, setPanelError] = useState('');

  // Status Restrito / Jurídico & Escavador
  const [riskOpen, setRiskOpen] = useState(false);
  const [statusReason, setStatusReason] = useState('');
  const [cancelFutureTitles, setCancelFutureTitles] = useState(true);

  // Documentos Armazenados (Bucket da Invicta) — busca 300ms + paginação 25/pág + checkboxes
  const [docSearchInput, setDocSearchInput] = useState('');
  const [debouncedDocSearch, setDebouncedDocSearch] = useState('');
  const [docPage, setDocPage] = useState(1);
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [docCategoryUpload, setDocCategoryUpload] = useState('comprovante');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentObject | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<DocumentObject | null>(null);
  const [deleteDocBusy, setDeleteDocBusy] = useState(false);

  useEffect(() => {
    if (!selectedCategoryId && categories[0]) {
      setSelectedCategoryId(String(categories[0].id));
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedDocSearch(docSearchInput.trim().toLowerCase());
      setDocPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [docSearchInput]);

  const clientAdmissions = useMemo(
    () => admissions.filter((a) => a.clientId === client.id),
    [admissions, client.id]
  );

  const cancelledCount = useMemo(
    () =>
      allClientTitles.filter((t) => String(t.status || '').trim().toUpperCase() === 'CANCELADO')
        .length,
    [allClientTitles]
  );

  const visibleClientTitles = useMemo(() => {
    return allClientTitles.filter((t) => {
      if (String(t.titleType || 'PADRAO').toUpperCase() !== 'PADRAO') return false;
      const st = String(t.status || '').trim().toUpperCase();
      if (!showCancelledTitles && st === 'CANCELADO') return false;
      return true;
    });
  }, [allClientTitles, showCancelledTitles]);

  const clientNotes = useMemo(
    () => notes.filter((n) => n.clientId === client.id),
    [notes, client.id]
  );

  const clientDocs = useMemo(() => {
    return documents
      .filter((d) => !d.deletedAt && d.clientId === client.id)
      .filter((d) => {
        if (!debouncedDocSearch) return true;
        return (
          d.fileName.toLowerCase().includes(debouncedDocSearch) ||
          d.docCategory.toLowerCase().includes(debouncedDocSearch) ||
          (d.uploadedBy || '').toLowerCase().includes(debouncedDocSearch)
        );
      });
  }, [documents, client.id, debouncedDocSearch]);

  const DOCS_PER_PAGE = 25;
  const totalDocPages = Math.max(1, Math.ceil(clientDocs.length / DOCS_PER_PAGE));
  const pagedDocs = useMemo(() => {
    const start = (docPage - 1) * DOCS_PER_PAGE;
    return clientDocs.slice(start, start + DOCS_PER_PAGE);
  }, [clientDocs, docPage]);

  const activeCase = useMemo(
    () => cases.find((c) => c.titleId === title.id) || null,
    [cases, title.id]
  );

  const breakdown = useMemo(
    () => computeTitleFinancialBreakdown(title, settledByTitleMap),
    [title, settledByTitleMap]
  );

  const isPaid = String(title.status || '').trim().toUpperCase() === 'PAGO';

  const handleSettle = async () => {
    setBusyAction(true);
    setPanelError('');
    try {
      let targetCaseId = activeCase?.id ?? null;
      if (!targetCaseId) {
        const ensured = await apiFetch<{ case: CollectionCase }>(
          `/api/collection/titles/${title.id}/ensure-case`,
          { method: 'POST' }
        );
        targetCaseId = ensured.case.id;
      }
      const res = await apiFetch<{ pointsAwarded: number }>(
        `/api/collection/cases/${targetCaseId}/settle`,
        {
          method: 'POST',
          body: JSON.stringify({ categoryId: Number(selectedCategoryId) || undefined }),
        }
      );
      await onReload(
        `Baixa confirmada no título ${title.documentNumber || title.titleCode}! +${
          res.pointsAwarded
        } pontos creditados.`
      );
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Erro ao baixar pagamento.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleClientStatusChange = async (target: 'suspenso' | 'cancelado' | 'ativo') => {
    if ((target === 'suspenso' || target === 'cancelado') && !statusReason.trim()) {
      setPanelError('Informe a causa obrigatória para suspender ou cancelar o cliente.');
      return;
    }
    setBusyAction(true);
    setPanelError('');
    try {
      const res = await apiFetch<{
        affectedProcessesCount?: number;
        escavadorActionSummary?: string;
      }>(`/api/collection/clients/${client.id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status: target,
          reason:
            statusReason.trim() ||
            (target === 'ativo' ? 'Retorno ao status normal registrado em Cobrança.' : ''),
          cancelFutureTitles: target === 'cancelado' ? cancelFutureTitles : false,
        }),
      });
      setStatusReason('');
      setRiskOpen(false);
      await onReload(
        res.escavadorActionSummary ||
          `Status do cliente alterado para ${target.toUpperCase()} (${
            res.affectedProcessesCount ?? 0
          } processo(s) sincronizado(s)).`
      );
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Erro ao atualizar status do cliente.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUploadBucketDoc = async (file: File) => {
    setUploadingDoc(true);
    setPanelError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('clientId', String(client.id));
      if (title.admissionId) {
        formData.append('admissionId', String(title.admissionId));
      }
      formData.append('docCategory', docCategoryUpload);

      const token = getAuthToken();
      const resp = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = (await resp.json()) as { document?: DocumentObject; error?: string };
      if (!resp.ok || !json.document) {
        throw new Error(json.error || 'Erro ao enviar arquivo ao Bucket da Invicta.');
      }
      await onReload(`Documento "${json.document.fileName}" salvo no Bucket da Invicta.`);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Erro no upload do documento.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    setDeleteDocBusy(true);
    setPanelError('');
    try {
      await apiFetch(`/api/documents/${deletingDoc.id}`, { method: 'DELETE' });
      if (previewDoc?.id === deletingDoc.id) setPreviewDoc(null);
      setSelectedDocIds((prev) => prev.filter((id) => id !== deletingDoc.id));
      setDeletingDoc(null);
      await onReload('Documento removido do Bucket da Invicta.');
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Erro ao excluir documento.');
    } finally {
      setDeleteDocBusy(false);
    }
  };

  const allPageSelected =
    pagedDocs.length > 0 && pagedDocs.every((d) => selectedDocIds.includes(d.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col max-h-[820px]">
      {/* Cabeçalho do Painel Lateral */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3.5 bg-slate-50/70">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-slate-900 truncate">
            {client.fullName}
          </h3>
          <p className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            CPF/CNPJ {client.cpfCnpj} · UF {client.state || 'N/I'} · {client.status.toUpperCase()}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenClientModal(client.id, 'whatsapp')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            WhatsApp
          </button>
          <button
            type="button"
            onClick={() => onOpenClientModal(client.id, 'dados')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            <User className="w-3.5 h-3.5 text-slate-500" />
            Cliente
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {panelError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {panelError}
          </div>
        )}

        {/* Resumo do Título Selecionado + Botão 3 Colunas */}
        <div className="rounded-lg border border-slate-200 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-900 font-mono tabular-nums">
              Doc {title.documentNumber || title.titleCode} · Venc. {formatDueDateLocalBR(title.dueDate)}
            </span>
            <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
              {formatBRL(breakdown.balanceCents)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 font-mono tabular-nums">
            <span>Orig: {formatBRL(breakdown.originalCents)}</span>
            <span>·</span>
            <span>Rec: {formatBRL(breakdown.receivedCents)}</span>
            <span>·</span>
            <span>{translateTitleStatus(title.status)}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenContactModal(title)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Calculator className="w-3.5 h-3.5" />
              Simular & Registrar Contato ({notes.filter((n) => n.titleId === title.id).length})
            </button>
          </div>
        </div>

        {/* Baixa Rápida (+25 pts) */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
          <div className="text-xs font-bold text-emerald-950">
            Baixar Pagamento & Creditar Ranking (+25 pts)
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busyAction || isPaid}
              onClick={() => void handleSettle()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-45 whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isPaid ? 'Liquidado' : 'Confirmar Baixa'}
            </button>
          </div>
        </div>

        {/* Fichas de Admissão Vinculadas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900">
              Fichas de Admissão ({clientAdmissions.length})
            </h4>
          </div>
          {clientAdmissions.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma ficha de admissão cadastrada para este cliente.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {clientAdmissions.map((adm) => (
                <div
                  key={adm.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {adm.protocolCode} · Contrato {adm.contractNumber}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {adm.bankName} · {adm.modality} · {adm.status}
                    </div>
                  </div>
                  {canVerFicha && (
                    <button
                      type="button"
                      onClick={() => onOpenAdmissionModal(adm)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <FileText className="w-3 h-3" />
                      Ver Ficha
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Títulos do Cliente (com Ver Cancelados) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 tabular-nums">
              Títulos do Cliente ({visibleClientTitles.length})
            </h4>
            {cancelledCount > 0 && (
              <button
                type="button"
                onClick={() => setShowCancelledTitles((p) => !p)}
                className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 whitespace-nowrap"
              >
                {showCancelledTitles
                  ? 'Ocultar Cancelados'
                  : `Ver Cancelados (${cancelledCount})`}
              </button>
            )}
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {visibleClientTitles.map((t) => {
              const b = computeTitleFinancialBreakdown(t, settledByTitleMap);
              const selected = t.id === title.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTitle(t)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                    selected ? 'bg-slate-900/5 font-semibold' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-mono text-slate-900 truncate block">
                      {t.documentNumber || t.titleCode} · Venc. {formatDueDateLocalBR(t.dueDate)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {translateTitleStatus(t.status)}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-900 tabular-nums shrink-0">
                    {formatBRL(b.balanceCents)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Últimas Tratativas do Cliente */}
        {clientNotes.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-slate-900 tabular-nums">
              Últimos Contatos ({clientNotes.length})
            </h4>
            <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
              {clientNotes.slice(0, 6).map((n) => (
                <div key={n.id} className="px-3 py-2 text-[11px] space-y-0.5">
                  <div className="flex items-center justify-between text-slate-500 font-mono tabular-nums">
                    <span>
                      {n.collaboratorName} · {formatChannelLabel(n.channel)}
                    </span>
                    <span>{formatDateBR(n.createdAt)}</span>
                  </div>
                  <div className="text-slate-800 line-clamp-2">{n.note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documentos Armazenados (Bucket da Invicta) */}
        <div className="space-y-2.5 pt-1 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 tabular-nums">
              <FolderOpen className="w-3.5 h-3.5 text-slate-600" />
              Documentos Armazenados ({clientDocs.length})
            </h4>
            <div className="flex items-center gap-1.5">
              <select
                value={docCategoryUpload}
                onChange={(e) => setDocCategoryUpload(e.target.value)}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
              >
                <option value="comprovante">Comprovante</option>
                <option value="aditivo">Aditivo</option>
                <option value="contrato">Contrato</option>
                <option value="pessoal">Pessoal</option>
                <option value="termo_cancelamento">Termo Cancelamento</option>
              </select>
              <label className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap">
                <Upload className="w-3 h-3" />
                {uploadingDoc ? 'Enviando...' : 'Anexar'}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploadingDoc}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadBucketDoc(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          <input
            type="text"
            value={docSearchInput}
            onChange={(e) => setDocSearchInput(e.target.value)}
            placeholder="Filtrar documentos por nome, categoria ou autor..."
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          />

          {previewDoc && (
            <AuthenticatedBucketViewer
              doc={previewDoc}
              heightClass="h-56"
              onClose={() => setPreviewDoc(null)}
            />
          )}

          {pagedDocs.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 rounded-lg border border-slate-200">
              Nenhum documento armazenado para este filtro.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-[11px] text-slate-600">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDocIds((prev) => [
                          ...new Set([...prev, ...pagedDocs.map((d) => d.id)]),
                        ]);
                      } else {
                        const pageSet = new Set(pagedDocs.map((d) => d.id));
                        setSelectedDocIds((prev) => prev.filter((id) => !pageSet.has(id)));
                      }
                    }}
                  />
                  <span>Selecionar página ({selectedDocIds.length} marcado(s))</span>
                </label>
                {selectedDocIds.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      for (const docId of selectedDocIds) {
                        const doc = clientDocs.find((d) => d.id === docId);
                        if (doc) {
                          const uri = doc.storageUri?.startsWith('/api/')
                            ? doc.storageUri
                            : `/api/documents/${doc.id}/download`;
                          await downloadAuthenticatedUri(uri, doc.fileName);
                        }
                      }
                    }}
                    className="font-semibold text-slate-800 hover:underline"
                  >
                    Baixar selecionados
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {pagedDocs.map((doc) => {
                  const checked = selectedDocIds.includes(doc.id);
                  const uri = doc.storageUri?.startsWith('/api/')
                    ? doc.storageUri
                    : `/api/documents/${doc.id}/download`;
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDocIds((prev) => [...prev, doc.id]);
                            } else {
                              setSelectedDocIds((prev) => prev.filter((id) => id !== doc.id));
                            }
                          }}
                        />
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 truncate block">
                            {doc.fileName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {doc.docCategory} · {formatBytes(doc.sizeBytes)} ·{' '}
                            {formatDateBR(doc.createdAt)}
                          </span>
                        </div>
                      </label>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Visualizar no Bucket"
                          onClick={() => setPreviewDoc(doc)}
                          className="p-1 text-slate-500 hover:text-slate-900"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Baixar arquivo"
                          onClick={() => void downloadAuthenticatedUri(uri, doc.fileName)}
                          className="p-1 text-slate-500 hover:text-slate-900"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {canExcluirDoc && (
                          <button
                            type="button"
                            title="Excluir arquivo"
                            onClick={() => setDeletingDoc(doc)}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalDocPages > 1 && (
                <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 border-t border-slate-200 text-[11px] font-mono tabular-nums">
                  <span>
                    Pág. {docPage}/{totalDocPages}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={docPage <= 1}
                      onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={docPage >= totalDocPages}
                      onClick={() => setDocPage((p) => Math.min(totalDocPages, p + 1))}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 disabled:opacity-40"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suspensão / Cancelamento / Reativação Integrada ao Jurídico & Escavador */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setRiskOpen((p) => !p)}
            className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-800 hover:bg-slate-100/70"
          >
            <span>
              {client.status === 'suspenso' || client.status === 'cancelado'
                ? `Status Restrito (${client.status.toUpperCase()}) · Reativar ou Ajustar`
                : 'Suspender ou Cancelar Cliente (Sincronia Jurídico & Escavador)'}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                riskOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          {riskOpen && (
            <div className="p-3 border-t border-slate-200 space-y-2.5 bg-white">
              <input
                type="text"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Informe a causa obrigatória (gravada no Jurídico e Escavador)..."
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelFutureTitles}
                  onChange={(e) => setCancelFutureTitles(e.target.checked)}
                />
                Ao cancelar cliente, cancelar também parcelas futuras em aberto
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(client.status === 'suspenso' || client.status === 'cancelado') && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleClientStatusChange('ativo')}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reativar Cliente
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleClientStatusChange('suspenso')}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-45"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  Suspender
                </button>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleClientStatusChange('cancelado')}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-45"
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  Cancelar Cliente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDeleteModal
        open={Boolean(deletingDoc)}
        title="Excluir Documento do Bucket da Invicta"
        message={
          deletingDoc
            ? `Remover "${deletingDoc.fileName}" do Bucket da Invicta? Esta operação ficará registrada na auditoria.`
            : ''
        }
        busy={deleteDocBusy}
        onCancel={() => setDeletingDoc(null)}
        onConfirm={handleConfirmDeleteDoc}
      />
    </div>
  );
};
