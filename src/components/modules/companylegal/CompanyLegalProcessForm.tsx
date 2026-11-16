import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Eye,
  FileText,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  Paperclip,
  Plus,
  Printer,
  Redo2,
  Search,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  Client,
  CollaboratorItem,
  CompanyLegalProcess,
  CompanyProcessAttachment,
  CompanyProcessRiskLevel,
  CompanyProcessStatus,
  CompanyProcessType,
  FormTemplateItem,
  Unit,
} from '../../../types.ts';
import { getAuthToken } from '../../../lib/api.ts';
import {
  buildPrintableHtmlDocument,
  replaceTemplateVariables,
  sanitizeTemplateHtml,
} from '../../../lib/formTemplateRenderer.ts';
import { applyThemeToHtmlDocument, useTheme } from '../../../lib/theme.tsx';
import {
  DossierDocumentPreviewModal,
  FullFreeAreaDocumentShell,
} from '../../DossierDocumentViewer.tsx';
import { useFormTemplates } from '../../FormTemplateButton.tsx';
import {
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
} from '../../../lib/portalBrandingCache.ts';
import { CompanyLegalSharedPartnerDocs } from './CompanyLegalSharedPartnerDocs.tsx';
import {
  buildCompanyLegalMergeContext,
  getUnitDisplayName,
  PROCESS_STATUSES,
  PROCESS_TYPES,
  RISK_BADGE_MAP,
  RISK_LEVELS,
} from './shared.ts';

interface CompanyLegalProcessFormProps {
  process: CompanyLegalProcess | null;
  units: Unit[];
  clients: Client[];
  collaborators: CollaboratorItem[];
  currentUser: AuthUser;
  saving: boolean;
  onSave: (payload: CompanyLegalProcess) => Promise<void>;
  onClose: () => void;
}

type FormTab = 'GERAL' | 'PARTES' | 'FINANCEIRO' | 'NOTAS' | 'ANEXOS';
type ActiveEditorSection = 'HEADER' | 'BODY' | 'FOOTER';

export const CompanyLegalProcessForm: React.FC<CompanyLegalProcessFormProps> = ({
  process,
  units,
  clients,
  collaborators,
  currentUser,
  saving,
  onSave,
  onClose,
}) => {
  const isEditing = Boolean(process && process.id && Number(process.id) > 0);
  const { templates: modalTemplates } = useFormTemplates('jur_processos');

  const [activeTab, setActiveTab] = useState<FormTab>('GERAL');
  const [formError, setFormError] = useState('');

  // Form state
  const [processNumber, setProcessNumber] = useState(process?.processNumber || '');
  const [court, setCourt] = useState(process?.court || '');
  const [jurisdiction, setJurisdiction] = useState(process?.jurisdiction || '');
  const [type, setType] = useState<CompanyProcessType>((process?.type as CompanyProcessType) || 'CÍVEL');
  const [role, setRole] = useState<'AUTOR' | 'RÉU' | 'TERCEIRO'>(
    (process?.role as 'AUTOR' | 'RÉU' | 'TERCEIRO') || 'RÉU'
  );
  const [status, setStatus] = useState<CompanyProcessStatus>(
    (process?.status as CompanyProcessStatus) || 'ATIVO'
  );
  const [subject, setSubject] = useState(process?.subject || '');
  const [unitId, setUnitId] = useState<number | ''>(process?.unitId ?? '');
  const [distributionDate, setDistributionDate] = useState(
    process?.distributionDate || new Date().toISOString().slice(0, 10)
  );

  // Partes
  const [opposingParty, setOpposingParty] = useState(process?.opposingParty || '');
  const [opposingPartyDocument, setOpposingPartyDocument] = useState(process?.opposingPartyDocument || '');
  const [opposingPartyLawyer, setOpposingPartyLawyer] = useState(process?.opposingPartyLawyer || '');
  const [opposingPartyLawyerOAB, setOpposingPartyLawyerOAB] = useState(process?.opposingPartyLawyerOAB || '');
  const [partnerId, setPartnerId] = useState<number | null>(process?.partnerId ?? null);
  const [partnerSearch, setPartnerSearch] = useState(() => {
    if (!process?.partnerId) return '';
    const c = clients.find((cl) => cl.id === process.partnerId);
    return c ? c.fullName : '';
  });
  const [partnerDropdownOpen, setPartnerDropdownOpen] = useState(false);
  const partnerPickerRef = useRef<HTMLDivElement | null>(null);

  const [responsibleLawyer, setResponsibleLawyer] = useState(process?.responsibleLawyer || '');
  const [responsibleLawyerOAB, setResponsibleLawyerOAB] = useState(process?.responsibleLawyerOAB || '');

  // Financeiro
  const [causeValue, setCauseValue] = useState(process?.causeValue || '');
  const [provisionValue, setProvisionValue] = useState(process?.provisionValue || '');
  const [riskLevel, setRiskLevel] = useState<CompanyProcessRiskLevel>(
    (process?.riskLevel as CompanyProcessRiskLevel) || 'MEDIO'
  );

  // Notas / A4 Editor
  const [notesHeader, setNotesHeader] = useState(process?.notesHeader || '');
  const [notesBody, setNotesBody] = useState(process?.notes || '<p></p>');
  const [notesFooter, setNotesFooter] = useState(process?.notesFooter || '');
  const [showHeader, setShowHeader] = useState(Boolean(process?.notesHeader?.trim()));
  const [showFooter, setShowFooter] = useState(Boolean(process?.notesFooter?.trim()));
  const [activeSection, setActiveSection] = useState<ActiveEditorSection>('BODY');
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);

  const headerEditorRef = useRef<HTMLDivElement | null>(null);
  const bodyEditorRef = useRef<HTMLDivElement | null>(null);
  const footerEditorRef = useRef<HTMLDivElement | null>(null);

  // Template selector inside Notas
  const [selectedTplId, setSelectedTplId] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [selectedTplObj, setSelectedTplObj] = useState<FormTemplateItem | null>(null);

  // Anexos locais
  const [attachments, setAttachments] = useState<CompanyProcessAttachment[]>(process?.attachments || []);
  const [attTitleInput, setAttTitleInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (partnerPickerRef.current && !partnerPickerRef.current.contains(e.target as Node)) {
        setPartnerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Sync contentEditable when switching into NOTAS tab or toggling HTML source mode
  useEffect(() => {
    if (activeTab === 'NOTAS' && !htmlSourceMode) {
      if (headerEditorRef.current && showHeader) {
        headerEditorRef.current.innerHTML = notesHeader || '';
      }
      if (bodyEditorRef.current) {
        bodyEditorRef.current.innerHTML = notesBody || '<p></p>';
      }
      if (footerEditorRef.current && showFooter) {
        footerEditorRef.current.innerHTML = notesFooter || '';
      }
    }
  }, [activeTab, htmlSourceMode, showHeader, showFooter]);

  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return clients.slice(0, 10);
    return clients
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          String(c.cpfCnpj || '').toLowerCase().includes(q) ||
          String(c.phone || '').toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [clients, partnerSearch]);

  const selectedPartnerObj = useMemo(
    () => (partnerId ? clients.find((c) => c.id === partnerId) || null : null),
    [clients, partnerId]
  );

  // Filter Advogado Invicta collaborators (preserving any already-saved lawyer name)
  const lawyerCollaborators = useMemo(() => {
    const exactInvicta = collaborators.filter(
      (c) => String(c.jobTitle || '').trim().toLowerCase() === 'advogado invicta'
    );
    if (exactInvicta.length > 0) return exactInvicta;
    return collaborators.filter((c) => String(c.jobTitle || '').toLowerCase().includes('advogado'));
  }, [collaborators]);

  const getCurrentEditorEl = (): HTMLDivElement | null => {
    if (activeSection === 'HEADER') return headerEditorRef.current;
    if (activeSection === 'FOOTER') return footerEditorRef.current;
    return bodyEditorRef.current;
  };

  const syncEditorToState = () => {
    if (headerEditorRef.current) setNotesHeader(headerEditorRef.current.innerHTML);
    if (bodyEditorRef.current) setNotesBody(bodyEditorRef.current.innerHTML);
    if (footerEditorRef.current) setNotesFooter(footerEditorRef.current.innerHTML);
  };

  const execEditorCmd = (cmd: string, value?: string) => {
    const target = getCurrentEditorEl();
    if (target) target.focus();
    document.execCommand(cmd, false, value);
    syncEditorToState();
  };

  const currentFormSnapshot = (): Partial<CompanyLegalProcess> => ({
    ...(process || {}),
    processNumber,
    court,
    jurisdiction,
    type,
    role,
    status,
    subject,
    unitId: unitId ? Number(unitId) : null,
    distributionDate,
    opposingParty,
    opposingPartyDocument,
    opposingPartyLawyer,
    opposingPartyLawyerOAB,
    partnerId,
    responsibleLawyer,
    responsibleLawyerOAB,
    causeValue,
    provisionValue,
    riskLevel,
  });

  const handleSelectPrintTemplate = (tplId: string) => {
    setSelectedTplId(tplId);
    if (!tplId) {
      setSelectedTplObj(null);
      setPreviewHtml('');
      return;
    }
    const tpl = modalTemplates.find((t) => String(t.id) === String(tplId)) || null;
    setSelectedTplObj(tpl);
    if (!tpl) {
      setPreviewHtml('');
      return;
    }
    const ctx = buildCompanyLegalMergeContext(
      currentFormSnapshot(),
      clients,
      units,
      currentUser.name
    );
    const merged = [
      replaceTemplateVariables(tpl.header || '', ctx),
      replaceTemplateVariables(tpl.content || '', ctx),
      replaceTemplateVariables(tpl.footer || '', ctx),
    ]
      .filter(Boolean)
      .join('<hr/>');
    setPreviewHtml(merged);
  };

  const { theme } = useTheme();
  const [tplPreviewModal, setTplPreviewModal] = useState<{ title: string; html: string } | null>(null);
  const tplPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewAtt, setPreviewAtt] = useState<{
    att: CompanyProcessAttachment;
    blobUrl: string;
  } | null>(null);

  const handlePrintSelectedTemplate = () => {
    if (!selectedTplObj || !previewHtml) return;
    const ctx = buildCompanyLegalMergeContext(
      currentFormSnapshot(),
      clients,
      units,
      currentUser.name
    );
    const branding = getCachedPortalBranding();
    const htmlDoc = buildPrintableHtmlDocument({
      title: selectedTplObj.name,
      headerHtml: sanitizeTemplateHtml(replaceTemplateVariables(selectedTplObj.header || '', ctx)),
      bodyHtml: sanitizeTemplateHtml(replaceTemplateVariables(selectedTplObj.content || '', ctx)),
      footerHtml: sanitizeTemplateHtml(replaceTemplateVariables(selectedTplObj.footer || '', ctx)),
      companyLogoDataUrl: branding?.logoDataUrl,
      companyName: branding?.companyName,
      logoDarkBackdrop: getCachedLogoNeedsDarkBackdrop(),
    });
    setTplPreviewModal({ title: selectedTplObj.name, html: htmlDoc });
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Arquivo excede o limite de 5MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const newAtt: CompanyProcessAttachment = {
        id: `att-${Date.now()}`,
        title: attTitleInput.trim() || file.name,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        fileData: dataUrl,
        createdAt: new Date().toISOString(),
      };
      setAttachments((prev) => [...prev, newAtt]);
      setAttTitleInput('');
      setFormError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const handleViewAttachment = async (att: CompanyProcessAttachment) => {
    if (att.fileData) {
      setPreviewAtt({ att, blobUrl: att.fileData });
      return;
    }
    if (att.fileUrl) {
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
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!processNumber.trim()) {
      setActiveTab('GERAL');
      setFormError('Informe o Número do Processo (CNJ) para salvar.');
      return;
    }
    setFormError('');

    const finalHeader =
      !htmlSourceMode && headerEditorRef.current && showHeader
        ? headerEditorRef.current.innerHTML
        : notesHeader;
    const finalBody =
      !htmlSourceMode && bodyEditorRef.current
        ? bodyEditorRef.current.innerHTML
        : notesBody;
    const finalFooter =
      !htmlSourceMode && footerEditorRef.current && showFooter
        ? footerEditorRef.current.innerHTML
        : notesFooter;

    const cleanBody = finalBody === '<p></p>' || finalBody === '<p><br></p>' ? '' : finalBody;

    const payload: CompanyLegalProcess = {
      id: isEditing ? Number(process!.id) : 0,
      unitId: unitId ? Number(unitId) : null,
      processNumber: processNumber.trim(),
      court: court.trim(),
      jurisdiction: jurisdiction.trim(),
      type,
      role,
      opposingParty: opposingParty.trim(),
      opposingPartyDocument: opposingPartyDocument.trim(),
      opposingPartyLawyer: opposingPartyLawyer.trim(),
      opposingPartyLawyerOAB: opposingPartyLawyerOAB.trim(),
      partnerId,
      clientId: partnerId,
      admissionId: process?.admissionId ?? null,
      clientName: selectedPartnerObj?.fullName || process?.clientName || '',
      contractNumber: process?.contractNumber || '',
      responsibleLawyer: responsibleLawyer.trim(),
      responsibleLawyerOAB: responsibleLawyerOAB.trim(),
      status,
      subject: subject.trim(),
      causeValue: causeValue.trim(),
      provisionValue: provisionValue.trim(),
      riskLevel,
      distributionDate,
      lastMovementDate: process?.lastMovementDate || '',
      notes: cleanBody,
      notesHeader: finalHeader,
      notesFooter: finalFooter,
      tags: process?.tags || [],
      movements: process?.movements || [],
      deadlines: process?.deadlines || [],
      hearings: process?.hearings || [],
      attachments,
      createdAt: process?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await onSave(payload);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar processo.');
    }
  };

  const TABS: Array<{ id: FormTab; label: string; count?: number }> = [
    { id: 'GERAL', label: 'Dados Gerais' },
    { id: 'PARTES', label: 'Partes' },
    { id: 'FINANCEIRO', label: 'Financeiro' },
    { id: 'NOTAS', label: 'Notas / Anotações' },
    { id: 'ANEXOS', label: 'Anexos', count: attachments.length },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 dark:bg-slate-950/80"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Editar Processo' : 'Novo Processo'}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-6xl h-[92vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden dark:border-slate-700 dark:bg-slate-900"
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {isEditing ? `Editar Processo · ${process?.processNumber}` : 'Novo Processo'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Cadastro jurídico da empresa com histórico auditável e anexos protegidos
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 5 Tabs */}
        <div className="px-5 pt-2 border-b border-slate-200 bg-white flex items-center gap-1 overflow-x-auto shrink-0 dark:border-slate-700 dark:bg-slate-900">
          {TABS.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  syncEditorToState();
                  setActiveTab(t.id);
                }}
                className={`px-3.5 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  active
                    ? 'border-slate-900 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span>{t.label}</span>
                {typeof t.count === 'number' && t.count > 0 && (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {formError && (
          <div className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shrink-0 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            {formError}
          </div>
        )}

        {/* Scrollable Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB 1: DADOS GERAIS */}
          {activeTab === 'GERAL' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Nº do Processo (CNJ) *</label>
                <input
                  type="text"
                  value={processNumber}
                  onChange={(e) => setProcessNumber(e.target.value)}
                  placeholder="0000000-00.0000.0.00.0000"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Vara</label>
                <input
                  type="text"
                  value={court}
                  onChange={(e) => setCourt(e.target.value)}
                  placeholder="Ex: 3ª Vara Cível"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Comarca / Jurisdição</label>
                <input
                  type="text"
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="Ex: São Paulo / SP"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Tipo</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as CompanyProcessType)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {PROCESS_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CompanyProcessStatus)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {PROCESS_STATUSES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Unidade</label>
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {getUnitDisplayName(u)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Assunto</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Objeto principal da ação judicial..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Data de Distribuição</label>
                <input
                  type="date"
                  value={distributionDate}
                  onChange={(e) => setDistributionDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {/* TAB 2: PARTES */}
          {activeTab === 'PARTES' && (
            <div className="space-y-5 text-xs">
              <div className="space-y-2">
                <label className="font-semibold text-slate-700 block dark:text-slate-200">Papel da Empresa</label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { value: 'AUTOR', label: 'Autor' },
                    { value: 'RÉU', label: 'Réu' },
                    { value: 'TERCEIRO', label: 'Terceiro Interessado' },
                  ].map((r) => (
                    <label
                      key={r.value}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 cursor-pointer font-semibold ${
                        role === r.value
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="companyRole"
                        value={r.value}
                        checked={role === r.value}
                        onChange={() => setRole(r.value as 'AUTOR' | 'RÉU' | 'TERCEIRO')}
                        className="sr-only"
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Nome da Parte Adversa</label>
                  <input
                    type="text"
                    value={opposingParty}
                    onChange={(e) => setOpposingParty(e.target.value)}
                    placeholder="Nome completo ou Razão Social"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Documento (CPF/CNPJ)</label>
                  <input
                    type="text"
                    value={opposingPartyDocument}
                    onChange={(e) => setOpposingPartyDocument(e.target.value)}
                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Nome do Advogado da Parte Adversa</label>
                  <input
                    type="text"
                    value={opposingPartyLawyer}
                    onChange={(e) => setOpposingPartyLawyer(e.target.value)}
                    placeholder="Dr(a). ..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">OAB da Parte Adversa</label>
                  <input
                    type="text"
                    value={opposingPartyLawyerOAB}
                    onChange={(e) => setOpposingPartyLawyerOAB(e.target.value)}
                    placeholder="Ex: SP 123456"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>
              </div>

              {/* Parceiro Vinculado */}
              <div ref={partnerPickerRef} className="space-y-2 relative">
                <label className="font-semibold text-slate-700 block dark:text-slate-200">
                  Parceiro / Cliente Vinculado (Opcional)
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                  <input
                    type="text"
                    value={partnerSearch}
                    onFocus={() => setPartnerDropdownOpen(true)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPartnerSearch(val);
                      setPartnerDropdownOpen(true);
                      if (selectedPartnerObj && val !== selectedPartnerObj.fullName) {
                        setPartnerId(null);
                      }
                    }}
                    placeholder="Buscar cliente/parceiro por nome, CPF/CNPJ ou telefone..."
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-8 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                  {(partnerSearch || partnerId) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPartnerId(null);
                        setPartnerSearch('');
                      }}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      title="Desvincular parceiro"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {partnerDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:divide-slate-800">
                    {filteredPartners.length === 0 ? (
                      <div className="px-3 py-3 text-slate-400 dark:text-slate-400">Nenhum parceiro encontrado</div>
                    ) : (
                      filteredPartners.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setPartnerId(c.id);
                            setPartnerSearch(c.fullName);
                            setPartnerDropdownOpen(false);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 dark:hover:bg-slate-800"
                        >
                          <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{c.fullName}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {c.cpfCnpj} {c.phone ? `· ${c.phone}` : ''}
                            </div>
                          </div>
                          {partnerId === c.id && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Selecionado</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}

                {selectedPartnerObj && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 flex items-center gap-3 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                    <div className="w-8 h-8 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center shrink-0">
                      {selectedPartnerObj.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 truncate dark:text-slate-100">{selectedPartnerObj.fullName}</div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                        {selectedPartnerObj.cpfCnpj} · {selectedPartnerObj.phone || 'Sem telefone'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Advogado Responsável */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Advogado Responsável</label>
                  <select
                    value={responsibleLawyer}
                    onChange={(e) => setResponsibleLawyer(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selecione o advogado responsável...</option>
                    {responsibleLawyer &&
                      !lawyerCollaborators.some((c) => c.name === responsibleLawyer) && (
                        <option value={responsibleLawyer}>{responsibleLawyer}</option>
                      )}
                    {lawyerCollaborators.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} ({c.jobTitle})
                      </option>
                    ))}
                  </select>
                  {lawyerCollaborators.length === 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Nenhum colaborador com cargo &quot;Advogado Invicta&quot; encontrado em Cadastros Comuns.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">OAB do Responsável</label>
                  <input
                    type="text"
                    value={responsibleLawyerOAB}
                    onChange={(e) => setResponsibleLawyerOAB(e.target.value)}
                    placeholder="Ex: PE 45678"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: FINANCEIRO */}
          {activeTab === 'FINANCEIRO' && (
            <div className="space-y-5 text-xs max-w-3xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Valor da Causa (R$)</label>
                  <input
                    type="text"
                    value={causeValue}
                    onChange={(e) => setCauseValue(e.target.value)}
                    placeholder="Ex: 50.000,00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">Valor Provisionado (R$)</label>
                  <input
                    type="text"
                    value={provisionValue}
                    onChange={(e) => setProvisionValue(e.target.value)}
                    placeholder="Ex: 15.000,00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="font-semibold text-slate-700 block dark:text-slate-200">Nível de Risco</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {RISK_LEVELS.map((lvl) => {
                    const selected = riskLevel === lvl.value;
                    const meta = RISK_BADGE_MAP[lvl.value];
                    return (
                      <button
                        key={lvl.value}
                        type="button"
                        onClick={() => setRiskLevel(lvl.value)}
                        className={`rounded-xl border px-3 py-3 text-center font-bold transition-all ${
                          selected
                            ? meta.activeBoxClass
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        {lvl.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: NOTAS / ANOTAÇÕES (Editor A4) */}
          {activeTab === 'NOTAS' && (
            <div className="space-y-3 text-xs">
              {/* Top Controls: Sections + Print Template Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-wrap items-center gap-1.5">
                  {!showHeader && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowHeader(true);
                        setActiveSection('HEADER');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                    >
                      <Plus className="w-3.5 h-3.5" /> Cabeçalho
                    </button>
                  )}
                  {!showFooter && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowFooter(true);
                        setActiveSection('FOOTER');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                    >
                      <Plus className="w-3.5 h-3.5" /> Rodapé
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      syncEditorToState();
                      setHtmlSourceMode((v) => !v);
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold ${
                      htmlSourceMode
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" /> {htmlSourceMode ? 'Modo Visual' : 'Código HTML'}
                  </button>
                </div>

                {/* Formulário de Impressão (contexto modal) */}
                {modalTemplates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    <select
                      value={selectedTplId}
                      onChange={(e) => handleSelectPrintTemplate(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Selecione um formulário...</option>
                      {modalTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </option>
                      ))}
                    </select>
                    {previewHtml && (
                      <>
                        <button
                          type="button"
                          onClick={handlePrintSelectedTemplate}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700"
                        >
                          <Printer className="w-3.5 h-3.5" /> Imprimir
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTplId('');
                            setSelectedTplObj(null);
                            setPreviewHtml('');
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Limpar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Formatting Toolbar */}
              {!htmlSourceMode && (
                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => execEditorCmd('undo')} title="Desfazer" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('redo')} title="Refazer" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="h-4 w-px bg-slate-200 mx-1 dark:bg-slate-700" />
                  <select
                    onChange={(e) => e.target.value && execEditorCmd('fontName', e.target.value)}
                    defaultValue="Times New Roman"
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                  </select>
                  <select
                    onChange={(e) => e.target.value && execEditorCmd('fontSize', e.target.value)}
                    defaultValue="3"
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="2">10pt</option>
                    <option value="3">12pt</option>
                    <option value="4">14pt</option>
                    <option value="5">18pt</option>
                    <option value="6">24pt</option>
                  </select>
                  <span className="h-4 w-px bg-slate-200 mx-1 dark:bg-slate-700" />
                  <button type="button" onClick={() => execEditorCmd('bold')} title="Negrito" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('italic')} title="Itálico" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('underline')} title="Sublinhado" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Underline className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('strikeThrough')} title="Tachado" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Strikethrough className="w-3.5 h-3.5" />
                  </button>
                  <span className="h-4 w-px bg-slate-200 mx-1 dark:bg-slate-700" />
                  <button type="button" onClick={() => execEditorCmd('justifyLeft')} title="Alinhar à esquerda" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <AlignLeft className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('justifyCenter')} title="Centralizar" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <AlignCenter className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('justifyRight')} title="Alinhar à direita" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <AlignRight className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('justifyFull')} title="Justificar" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <AlignJustify className="w-3.5 h-3.5" />
                  </button>
                  <span className="h-4 w-px bg-slate-200 mx-1 dark:bg-slate-700" />
                  <button type="button" onClick={() => execEditorCmd('insertUnorderedList')} title="Lista" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('insertOrderedList')} title="Lista numerada" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('indent')} title="Aumentar recuo" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Indent className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => execEditorCmd('outdent')} title="Diminuir recuo" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Outdent className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* A4 Visual Page */}
              <div className="bg-slate-100 rounded-xl p-4 flex justify-center dark:bg-slate-800">
                <div className="w-full max-w-[210mm] bg-white border border-slate-300 shadow-sm rounded-lg overflow-hidden space-y-2 p-4 dark:bg-slate-900 dark:border-slate-600">
                  {/* Header Section (Blue) */}
                  {showHeader && (
                    <div
                      className={`rounded-lg border p-2.5 transition-colors ${
                        activeSection === 'HEADER' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-blue-200 dark:border-blue-800/70'
                      }`}
                      onClick={() => setActiveSection('HEADER')}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300">Cabeçalho</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowHeader(false);
                            setActiveSection('BODY');
                          }}
                          className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          title="Ocultar cabeçalho"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {htmlSourceMode ? (
                        <textarea
                          rows={4}
                          value={notesHeader}
                          onChange={(e) => setNotesHeader(e.target.value)}
                          className="w-full font-mono text-xs border border-slate-200 rounded p-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      ) : (
                        <div
                          ref={headerEditorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={() => headerEditorRef.current && setNotesHeader(headerEditorRef.current.innerHTML)}
                          style={{ fontFamily: '"Times New Roman", serif', minHeight: '100px' }}
                          className="outline-none text-sm text-slate-900 leading-relaxed dark:text-slate-100"
                        />
                      )}
                    </div>
                  )}

                  {/* Body Section (Emerald) */}
                  <div
                    className={`rounded-lg border p-3 transition-colors ${
                      activeSection === 'BODY' ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-emerald-200 dark:border-emerald-800/70'
                    }`}
                    onClick={() => setActiveSection('BODY')}
                  >
                    <div className="mb-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                      Corpo das Notas / Parecer
                    </div>
                    {htmlSourceMode ? (
                      <textarea
                        rows={16}
                        value={notesBody}
                        onChange={(e) => setNotesBody(e.target.value)}
                        className="w-full font-mono text-xs border border-slate-200 rounded p-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    ) : (
                      <div
                        ref={bodyEditorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={() => bodyEditorRef.current && setNotesBody(bodyEditorRef.current.innerHTML)}
                        style={{ fontFamily: '"Times New Roman", serif', minHeight: '360px' }}
                        className="outline-none text-sm text-slate-900 leading-relaxed dark:text-slate-100"
                      />
                    )}
                  </div>

                  {/* Footer Section (Amber) */}
                  {showFooter && (
                    <div
                      className={`rounded-lg border p-2.5 transition-colors ${
                        activeSection === 'FOOTER' ? 'border-amber-500 ring-2 ring-amber-100' : 'border-amber-200 dark:border-amber-800/70'
                      }`}
                      onClick={() => setActiveSection('FOOTER')}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">Rodapé</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowFooter(false);
                            setActiveSection('BODY');
                          }}
                          className="text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          title="Ocultar rodapé"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {htmlSourceMode ? (
                        <textarea
                          rows={3}
                          value={notesFooter}
                          onChange={(e) => setNotesFooter(e.target.value)}
                          className="w-full font-mono text-xs border border-slate-200 rounded p-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      ) : (
                        <div
                          ref={footerEditorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={() => footerEditorRef.current && setNotesFooter(footerEditorRef.current.innerHTML)}
                          style={{ fontFamily: '"Times New Roman", serif', minHeight: '90px' }}
                          className="outline-none text-sm text-slate-900 leading-relaxed dark:text-slate-100"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: ANEXOS */}
          {activeTab === 'ANEXOS' && (
            <div className="space-y-5">
              {/* Shared Partner Docs Panel */}
              {partnerId && selectedPartnerObj && (
                <CompanyLegalSharedPartnerDocs
                  clientId={partnerId}
                  clientName={selectedPartnerObj.fullName}
                  isAdmin={currentUser.role === 'admin'}
                />
              )}

              {/* Local Process Attachments */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
                      <Paperclip className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Adicionar Documento ao Processo
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Arquivos salvos de forma criptografada no Bucket da Invicta (máx. 5MB por arquivo)
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={attTitleInput}
                    onChange={(e) => setAttTitleInput(e.target.value)}
                    placeholder="Ex: Petição Inicial, Contestação, Procuração..."
                    className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none dark:border-slate-600"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.bmp,.xls,.xlsx,.txt"
                    onChange={handleLocalFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Upload className="w-3.5 h-3.5" /> Selecionar Arquivo
                  </button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                        <th className="px-3 py-2">Título</th>
                        <th className="px-3 py-2">Arquivo</th>
                        <th className="px-3 py-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {attachments.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-slate-400 dark:text-slate-400">
                            Nenhum documento anexado
                          </td>
                        </tr>
                      ) : (
                        attachments.map((att) => (
                          <tr
                            key={String(att.id)}
                            onDoubleClick={() => void handleViewAttachment(att)}
                            className="hover:bg-slate-50 cursor-pointer dark:hover:bg-slate-800"
                          >
                            <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">{att.title}</td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{att.fileName}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                              <button
                                type="button"
                                onClick={() => void handleViewAttachment(att)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Eye className="w-3 h-3" /> Visualizar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                                }
                                className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                              >
                                <Trash2 className="w-3 h-3" /> Excluir
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {saving ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Cadastrar Processo'}
          </button>
        </div>
      </form>

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

      <FullFreeAreaDocumentShell
        open={Boolean(tplPreviewModal)}
        title={tplPreviewModal?.title || ''}
        subtitle="Modelo / Peça Jurídica A4"
        onClose={() => setTplPreviewModal(null)}
        toolbarExtras={
          <button
            type="button"
            onClick={() => tplPreviewIframeRef.current?.contentWindow?.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir Agora
          </button>
        }
      >
        {tplPreviewModal && (
          <iframe
            ref={tplPreviewIframeRef}
            title={tplPreviewModal.title}
            srcDoc={applyThemeToHtmlDocument(tplPreviewModal.html, theme)}
            className="w-full h-full border-0 bg-white dark:bg-slate-950"
          />
        )}
      </FullFreeAreaDocumentShell>
    </div>
  );
};
