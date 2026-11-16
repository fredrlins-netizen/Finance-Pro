import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Edit3,
  FileCheck2,
  FileText,
  Gavel,
  Paperclip,
  Plus,
  Scale,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Client,
  CollaboratorItem,
  CompanyLegalProcess,
  CompanyProcessAttachment,
  CompanyProcessDeadline,
  CompanyProcessHearing,
  CompanyProcessMovement,
  Unit,
} from '../../../types.ts';
import { getAuthToken } from '../../../lib/api.ts';
import { FormTemplateButton } from '../../FormTemplateButton.tsx';
import { DossierDocumentPreviewModal } from '../../DossierDocumentViewer.tsx';
import {
  buildCompanyLegalMergeContext,
  DEADLINE_TYPES,
  formatDateBR,
  getUnitDisplayName,
  HEARING_TYPES,
  MOVEMENT_TYPES,
  RISK_BADGE_MAP,
  sanitizeLegalHtml,
  STATUS_BADGE_MAP,
} from './shared.ts';

interface CompanyLegalProcessDetailProps {
  process: CompanyLegalProcess;
  units: Unit[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  currentUserName: string;
  onBack: () => void;
  onUpdateProcess: (updated: CompanyLegalProcess) => Promise<void>;
  onToast: (msg: string) => void;
}

export const CompanyLegalProcessDetail: React.FC<CompanyLegalProcessDetailProps> = ({
  process,
  units,
  clients,
  collaborators,
  currentUserName,
  onBack,
  onUpdateProcess,
  onToast,
}) => {
  // Inline Movement form
  const [showMovForm, setShowMovForm] = useState(false);
  const [editingMovId, setEditingMovId] = useState<string | number | null>(null);
  const [movDate, setMovDate] = useState(new Date().toISOString().slice(0, 10));
  const [movType, setMovType] = useState<CompanyProcessMovement['type']>('DESPACHO');
  const [movDesc, setMovDesc] = useState('');
  const [movSource, setMovSource] = useState('');

  // Inline Deadline form
  const [showDlForm, setShowDlForm] = useState(false);
  const [dlDesc, setDlDesc] = useState('');
  const [dlDueDate, setDlDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dlType, setDlType] = useState<CompanyProcessDeadline['type']>('OUTRO');
  const [dlRespId, setDlRespId] = useState<number | ''>('');

  // Inline Hearing form
  const [showHrForm, setShowHrForm] = useState(false);
  const [hrDate, setHrDate] = useState(new Date().toISOString().slice(0, 10));
  const [hrTime, setHrTime] = useState('09:00');
  const [hrType, setHrType] = useState<CompanyProcessHearing['type']>('INICIAL');
  const [hrLocation, setHrLocation] = useState('');

  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{
    kind: 'mov' | 'dl' | 'hr';
    id: string | number;
    label: string;
  } | null>(null);

  const unitObj = useMemo(
    () => (process.unitId ? units.find((u) => u.id === process.unitId) : undefined),
    [process.unitId, units]
  );
  const partnerObj = useMemo(
    () => (process.partnerId ? clients.find((c) => c.id === process.partnerId) : undefined),
    [process.partnerId, clients]
  );

  const sortedMovements = useMemo(
    () => [...(process.movements || [])].sort((a, b) => b.date.localeCompare(a.date)),
    [process.movements]
  );

  const statusMeta = STATUS_BADGE_MAP[process.status] || STATUS_BADGE_MAP.ATIVO;
  const riskMeta = RISK_BADGE_MAP[process.riskLevel] || RISK_BADGE_MAP.MEDIO;

  const openAddMovement = () => {
    setEditingMovId(null);
    setMovDate(new Date().toISOString().slice(0, 10));
    setMovType('DESPACHO');
    setMovDesc('');
    setMovSource('');
    setShowMovForm(true);
  };

  const openEditMovement = (m: CompanyProcessMovement) => {
    setEditingMovId(m.id);
    setMovDate(m.date || new Date().toISOString().slice(0, 10));
    setMovType(m.type || 'DESPACHO');
    setMovDesc(m.description || '');
    setMovSource(m.source || '');
    setShowMovForm(true);
  };

  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveDate = movDate || new Date().toISOString().slice(0, 10);
    setBusy(true);
    try {
      const current = process.movements || [];
      const nextMovs =
        editingMovId !== null
          ? current.map((m) =>
              m.id === editingMovId
                ? { ...m, date: effectiveDate, type: movType, description: movDesc, source: movSource }
                : m
            )
          : [
              {
                id: `mov-${Date.now()}`,
                date: effectiveDate,
                type: movType,
                description: movDesc,
                source: movSource,
              },
              ...current,
            ];
      const maxDate = nextMovs.reduce(
        (acc, m) => (m.date && m.date > acc ? m.date : acc),
        effectiveDate
      );
      await onUpdateProcess({
        ...process,
        movements: nextMovs,
        lastMovementDate: maxDate,
      });
      setShowMovForm(false);
      setEditingMovId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleAddDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dlDesc.trim() || !dlDueDate) return;
    setBusy(true);
    try {
      const next: CompanyProcessDeadline[] = [
        ...(process.deadlines || []),
        {
          id: `dl-${Date.now()}`,
          processId: process.id,
          type: dlType,
          description: dlDesc.trim(),
          dueDate: dlDueDate,
          status: 'PENDENTE',
          responsibleId: dlRespId ? Number(dlRespId) : null,
        },
      ];
      await onUpdateProcess({ ...process, deadlines: next });
      setShowDlForm(false);
      setDlDesc('');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteDeadline = async (dlId: string | number) => {
    setBusy(true);
    try {
      const next = (process.deadlines || []).map((d) =>
        d.id === dlId ? { ...d, status: 'CUMPRIDO' as const } : d
      );
      await onUpdateProcess({ ...process, deadlines: next });
    } finally {
      setBusy(false);
    }
  };

  const handleAddHearing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hrDate || !hrTime) return;
    setBusy(true);
    try {
      const next: CompanyProcessHearing[] = [
        ...(process.hearings || []),
        {
          id: `hr-${Date.now()}`,
          processId: process.id,
          type: hrType,
          date: hrDate,
          time: hrTime,
          location: hrLocation.trim() || undefined,
          status: 'AGENDADA',
        },
      ];
      await onUpdateProcess({ ...process, hearings: next });
      setShowHrForm(false);
      setHrLocation('');
    } finally {
      setBusy(false);
    }
  };

  const executeConfirmRemove = async () => {
    if (!confirmRemove) return;
    setBusy(true);
    try {
      if (confirmRemove.kind === 'mov') {
        const next = (process.movements || []).filter((m) => m.id !== confirmRemove.id);
        const maxDate = next.reduce((acc, m) => (m.date && m.date > acc ? m.date : acc), '');
        await onUpdateProcess({ ...process, movements: next, lastMovementDate: maxDate });
      } else if (confirmRemove.kind === 'dl') {
        const next = (process.deadlines || []).filter((d) => d.id !== confirmRemove.id);
        await onUpdateProcess({ ...process, deadlines: next });
      } else {
        const next = (process.hearings || []).filter((h) => h.id !== confirmRemove.id);
        await onUpdateProcess({ ...process, hearings: next });
      }
      setConfirmRemove(null);
    } finally {
      setBusy(false);
    }
  };

  const [previewAtt, setPreviewAtt] = useState<{
    att: CompanyProcessAttachment;
    blobUrl: string;
  } | null>(null);

  const handleOpenAttachment = async (att: CompanyProcessAttachment) => {
    if (att.fileData) {
      setPreviewAtt({ att, blobUrl: att.fileData });
      return;
    }
    if (!att.fileUrl) return;
    const token = getAuthToken();
    const resp = await fetch(`${att.fileUrl}?preview=1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    setPreviewAtt((prev) => {
      if (prev?.blobUrl && prev.blobUrl.startsWith('blob:')) URL.revokeObjectURL(prev.blobUrl);
      return { att, blobUrl: url };
    });
  };

  const getMovementIcon = (t: string) => {
    if (t === 'SENTENCA') return <Gavel className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
    if (t === 'DECISAO') return <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
    if (t === 'PETICAO') return <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
    if (t === 'CERTIDAO') return <FileCheck2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
    if (t === 'AUDIENCIA') return <CalendarClock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />;
    return <ScrollText className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />;
  };

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar à Lista
        </button>

        <FormTemplateButton
          menuId="jur_processos"
          label="Gerar Documento"
          getContext={() => buildCompanyLegalMergeContext(process, clients, units, currentUserName)}
          onError={(msg) => onToast(msg)}
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="space-y-1">
            <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{process.processNumber}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              {process.court || '-'} — {process.jurisdiction || '-'}
            </div>
            {process.subject && <div className="text-xs font-medium text-slate-800 dark:text-slate-100">{process.subject}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
              {unitObj ? getUnitDisplayName(unitObj) : '-'}
            </span>
            <span className={`rounded border px-2 py-1 text-[11px] font-semibold ${statusMeta.badgeClass}`}>
              {statusMeta.label}
            </span>
            <span className={`rounded border px-2 py-1 text-[11px] font-bold ${riskMeta.badgeClass}`}>
              Risco: {riskMeta.label}
            </span>
            <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {process.role}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Tipo</div>
            <div className="font-semibold text-slate-800 mt-0.5 dark:text-slate-100">{process.type}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Parte Adversa</div>
            <div className="font-semibold text-slate-800 mt-0.5 dark:text-slate-100">{process.opposingParty || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Advogado Responsável</div>
            <div className="font-semibold text-slate-800 mt-0.5 dark:text-slate-100">{process.responsibleLawyer || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Distribuição</div>
            <div className="font-semibold text-slate-800 mt-0.5 tabular-nums dark:text-slate-100">
              {formatDateBR(process.distributionDate)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Valor da Causa</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              {process.causeValue ? `R$ ${process.causeValue}` : '-'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-400">Provisionado</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              {process.provisionValue ? `R$ ${process.provisionValue}` : '-'}
            </div>
          </div>
        </div>

        {partnerObj && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 flex items-center gap-3 text-xs dark:border-emerald-800/70 dark:bg-emerald-950/50">
            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center shrink-0">
              {partnerObj.fullName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 dark:text-slate-100">{partnerObj.fullName}</span>
                <span className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-800/70 dark:bg-slate-900 dark:text-emerald-300">
                  Parceiro Vinculado
                </span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                {partnerObj.cpfCnpj} · {partnerObj.phone || 'Sem telefone'} · {partnerObj.email || 'Sem e-mail'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline Delete Confirmation */}
      {confirmRemove && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-red-800/70 dark:bg-red-950/50">
          <span className="font-semibold text-red-800 dark:text-red-300">{confirmRemove.label}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void executeConfirmRemove()}
              className="rounded-lg bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-700"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* 2-Column Content: Movimentações (Left) + Prazos/Audiências (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Movimentações */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider dark:text-slate-100">
              Movimentações ({sortedMovements.length})
            </h3>
            <button
              type="button"
              onClick={openAddMovement}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </button>
          </div>

          {showMovForm && (
            <form onSubmit={handleSaveMovement} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Data</label>
                  <input
                    type="date"
                    value={movDate}
                    onChange={(e) => setMovDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Tipo</label>
                  <select
                    value={movType}
                    onChange={(e) => setMovType(e.target.value as CompanyProcessMovement['type'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {MOVEMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Descrição</label>
                <textarea
                  rows={2}
                  value={movDesc}
                  onChange={(e) => setMovDesc(e.target.value)}
                  placeholder="Teor da movimentação..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Fonte</label>
                <input
                  type="text"
                  value={movSource}
                  onChange={(e) => setMovSource(e.target.value)}
                  placeholder="Ex: Diário Oficial / PJe"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowMovForm(false);
                    setEditingMovId(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {editingMovId !== null ? 'Salvar' : 'Adicionar'}
                </button>
              </div>
            </form>
          )}

          {sortedMovements.length === 0 ? (
            <div className="py-8 text-center text-slate-400 dark:text-slate-400">Nenhuma movimentação registrada.</div>
          ) : (
            <div className="space-y-2.5">
              {sortedMovements.map((m) => (
                <div
                  key={String(m.id)}
                  className="group rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-colors space-y-1 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {getMovementIcon(m.type)}
                      <span className="font-mono font-bold text-slate-700 tabular-nums dark:text-slate-200">
                        {formatDateBR(m.date)}
                      </span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                        {m.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => openEditMovement(m)}
                        title="Editar"
                        className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmRemove({
                            kind: 'mov',
                            id: m.id,
                            label: 'Excluir esta movimentação?',
                          })
                        }
                        title="Excluir"
                        className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/60"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-slate-800 leading-relaxed whitespace-pre-wrap dark:text-slate-100">{m.description}</p>
                  {m.source && <div className="text-[11px] text-slate-400 dark:text-slate-400">Fonte: {m.source}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Prazos & Audiências */}
        <div className="space-y-4">
          {/* Prazos */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 uppercase tracking-wider dark:text-slate-100">
                Prazos ({process.deadlines?.length || 0})
              </h3>
              <button
                type="button"
                onClick={() => setShowDlForm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" /> Prazo
              </button>
            </div>

            {showDlForm && (
              <form onSubmit={handleAddDeadline} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
                <input
                  type="text"
                  required
                  value={dlDesc}
                  onChange={(e) => setDlDesc(e.target.value)}
                  placeholder="Descrição do prazo..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={dlDueDate}
                    onChange={(e) => setDlDueDate(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <select
                    value={dlType}
                    onChange={(e) => setDlType(e.target.value as CompanyProcessDeadline['type'])}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {DEADLINE_TYPES.map((dt) => (
                      <option key={dt} value={dt}>
                        {dt}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dlRespId}
                    onChange={(e) => setDlRespId(e.target.value ? Number(e.target.value) : '')}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Responsável...</option>
                    {collaborators.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDlForm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white dark:bg-emerald-600"
                  >
                    Adicionar
                  </button>
                </div>
              </form>
            )}

            {(process.deadlines || []).length === 0 ? (
              <div className="py-4 text-center text-slate-400 dark:text-slate-400">Nenhum prazo cadastrado.</div>
            ) : (
              <div className="space-y-2">
                {(process.deadlines || []).map((dl) => {
                  const respName = dl.responsibleId
                    ? collaborators.find((c) => c.id === dl.responsibleId)?.name
                    : null;
                  return (
                    <div
                      key={String(dl.id)}
                      className="rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 dark:border-slate-700"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 truncate dark:text-slate-100">{dl.description}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatDateBR(dl.dueDate)} · {dl.type} {respName ? `· ${respName}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {dl.status === 'PENDENTE' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleCompleteDeadline(dl.id)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                          >
                            <Check className="w-3 h-3" /> Cumprido
                          </button>
                        ) : (
                          <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {dl.status}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmRemove({ kind: 'dl', id: dl.id, label: 'Excluir este prazo?' })
                          }
                          className="p-1 text-red-500 hover:bg-red-50 rounded dark:hover:bg-red-950/60"
                          title="Excluir prazo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Audiências */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 uppercase tracking-wider dark:text-slate-100">
                Audiências ({process.hearings?.length || 0})
              </h3>
              <button
                type="button"
                onClick={() => setShowHrForm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" /> Audiência
              </button>
            </div>

            {showHrForm && (
              <form onSubmit={handleAddHearing} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={hrDate}
                    onChange={(e) => setHrDate(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="time"
                    required
                    value={hrTime}
                    onChange={(e) => setHrTime(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <select
                    value={hrType}
                    onChange={(e) => setHrType(e.target.value as CompanyProcessHearing['type'])}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {HEARING_TYPES.map((ht) => (
                      <option key={ht} value={ht}>
                        {ht}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={hrLocation}
                  onChange={(e) => setHrLocation(e.target.value)}
                  placeholder="Ex: Fórum Central, Sala 301"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHrForm(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white dark:bg-emerald-600"
                  >
                    Adicionar
                  </button>
                </div>
              </form>
            )}

            {(process.hearings || []).length === 0 ? (
              <div className="py-4 text-center text-slate-400 dark:text-slate-400">Nenhuma audiência agendada.</div>
            ) : (
              <div className="space-y-2">
                {(process.hearings || []).map((hr) => (
                  <div
                    key={String(hr.id)}
                    className="rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 dark:border-slate-700"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">
                        {formatDateBR(hr.date)} às {hr.time} · {hr.type}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{hr.location || 'Local não informado'}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
                        {hr.status}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmRemove({ kind: 'hr', id: hr.id, label: 'Excluir esta audiência?' })
                        }
                        className="p-1 text-red-500 hover:bg-red-50 rounded dark:hover:bg-red-950/60"
                        title="Excluir audiência"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notas / Observações */}
      {process.notes && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Notas / Observações</h3>
          <div
            className="prose prose-sm max-w-none text-slate-800 dark:text-slate-100"
            dangerouslySetInnerHTML={{ __html: sanitizeLegalHtml(process.notes) }}
          />
        </div>
      )}

      {/* Anexos do Processo */}
      {(process.attachments || []).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 dark:text-slate-200">
            <Paperclip className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Anexos do Processo ({process.attachments!.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {process.attachments!.map((att) => (
              <button
                key={String(att.id)}
                type="button"
                onClick={() => void handleOpenAttachment(att)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>{att.title || att.fileName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <DossierDocumentPreviewModal
        open={Boolean(previewAtt)}
        title={previewAtt?.att.title || previewAtt?.att.fileName || ''}
        subtitle={previewAtt?.att.fileName}
        mimeType={previewAtt?.att.mimeType || ''}
        blobUrl={previewAtt?.blobUrl || ''}
        onClose={() => {
          if (previewAtt?.blobUrl && previewAtt.blobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewAtt.blobUrl);
          }
          setPreviewAtt(null);
        }}
      />
    </div>
  );
};
