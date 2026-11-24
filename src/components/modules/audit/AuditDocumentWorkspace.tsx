import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Contrast,
  Download,
  Eye,
  FileText,
  Loader2,
  Maximize2,
  ShieldAlert,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch, formatBytes, formatDateTimeBR, getAuthToken } from '../../../lib/api.ts';
import { useTheme } from '../../../lib/theme.tsx';
import { ProtectedDocumentViewerModal } from '../../common/ProtectedDocumentViewerModal.tsx';
import { ThemedDocumentContent } from '../../DossierDocumentViewer.tsx';
import { DocumentObject, IviDocumentInspectionResult } from '../../../types.ts';

interface AuditDocumentWorkspaceProps {
  admissionId: number;
  clientId: number;
  debtType: string;
  modality?: string;
  documents: DocumentObject[];
  selectedDocId?: number | null;
  onSelectDocId?: (docId: number | null) => void;
  onDocumentUploaded: () => Promise<void>;
  onUseAlertInCritique: (text: string) => void;
}

const DOC_CATEGORY_LABELS: Array<{ key: string; label: string; requiredAlways?: boolean; requiredVehicular?: boolean }> = [
  { key: 'pessoal', label: 'Documento Pessoal (RG/CNH)', requiredAlways: true },
  { key: 'residencia', label: 'Comprovante de Residência', requiredAlways: true },
  { key: 'contrato', label: 'Contrato / CCB Bancário', requiredAlways: true },
  { key: 'procuracao', label: 'Procuração Assinada', requiredAlways: true },
  { key: 'crlv', label: 'CRLV / Documento do Veículo', requiredVehicular: true },
  { key: 'ficha_admissao', label: 'Ficha de Admissão' },
  { key: 'comprovante', label: 'Comprovante / Complemento' },
];

export const AuditDocumentWorkspace: React.FC<AuditDocumentWorkspaceProps> = ({
  admissionId,
  clientId,
  debtType,
  modality,
  documents,
  selectedDocId: controlledSelectedDocId,
  onSelectDocId,
  onDocumentUploaded,
  onUseAlertInCritique,
}) => {
  const { isDark } = useTheme();
  const [adaptPdfToTheme, setAdaptPdfToTheme] = useState(true);
  const [internalSelectedDocId, setInternalSelectedDocId] = useState<number | null>(
    documents[0]?.id ?? null
  );
  const selectedDocId =
    controlledSelectedDocId !== undefined ? controlledSelectedDocId : internalSelectedDocId;

  const setSelectedDocId = useCallback(
    (nextId: number | null) => {
      if (controlledSelectedDocId === undefined) {
        setInternalSelectedDocId(nextId);
      }
      onSelectDocId?.(nextId);
    },
    [controlledSelectedDocId, onSelectDocId]
  );

  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [zoomPct, setZoomPct] = useState(100);
  const [fullViewDoc, setFullViewDoc] = useState<DocumentObject | null>(null);

  const [uploadCategory, setUploadCategory] = useState('comprovante');
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inspectingDocId, setInspectingDocId] = useState<number | null>(null);
  const [inspectionByDoc, setInspectionByDoc] = useState<Record<number, IviDocumentInspectionResult>>({});
  const [inspectError, setInspectError] = useState('');

  useEffect(() => {
    if (documents.length === 0) {
      if (selectedDocId !== null) setSelectedDocId(null);
      return;
    }
    if (!selectedDocId || !documents.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId, setSelectedDocId]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || null,
    [documents, selectedDocId]
  );

  // Load authenticated inline preview via Blob URL (zero window.open popups)
  useEffect(() => {
    let active = true;
    let currentBlobUrl = '';

    const loadPreview = async () => {
      if (!selectedDoc) {
        setPreviewUrl('');
        return;
      }
      const isPreviewable =
        selectedDoc.mimeType.startsWith('image/') ||
        selectedDoc.mimeType === 'application/pdf' ||
        selectedDoc.mimeType.startsWith('text/');

      if (!isPreviewable) {
        setPreviewUrl('');
        setPreviewError('');
        return;
      }

      setPreviewLoading(true);
      setPreviewError('');
      try {
        const token = getAuthToken();
        const res = await fetch(`/api/documents/${selectedDoc.id}/download?preview=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!active) return;
        currentBlobUrl = URL.createObjectURL(blob);
        setPreviewUrl(currentBlobUrl);
      } catch (err) {
        if (active) {
          setPreviewUrl('');
          setPreviewError(err instanceof Error ? err.message : 'Falha ao carregar pré-visualização.');
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      active = false;
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    };
  }, [selectedDoc]);

  const handleDownload = async (doc: DocumentObject) => {
    const token = getAuthToken();
    const res = await fetch(`/api/documents/${doc.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadFeedback('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('clientId', String(clientId));
      fd.append('admissionId', String(admissionId));
      fd.append('docCategory', uploadCategory);
      await apiFetch('/api/documents/upload', { method: 'POST', body: fd });
      setUploadFeedback(`Arquivo "${file.name}" armazenado no cofre desta admissão.`);
      await onDocumentUploaded();
    } catch (err) {
      setUploadFeedback(err instanceof Error ? err.message : 'Erro ao enviar arquivo.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIviInspectDoc = async (doc: DocumentObject) => {
    setInspectingDocId(doc.id);
    setInspectError('');
    setSelectedDocId(doc.id);
    try {
      const res = await apiFetch<{ inspection: IviDocumentInspectionResult }>(
        `/api/audit/${admissionId}/ivi-inspect-document`,
        {
          method: 'POST',
          body: JSON.stringify({ documentId: doc.id }),
        }
      );
      setInspectionByDoc((prev) => ({ ...prev, [doc.id]: res.inspection }));
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Erro na conferência documental pela Ivi.');
    } finally {
      setInspectingDocId(null);
    }
  };

  const isVehicular = `${debtType} ${modality || ''}`.toLowerCase().includes('veic');
  const completenessMatrix = useMemo(() => {
    const cats = new Set(documents.map((d) => String(d.docCategory || '').toLowerCase()));
    const names = documents.map((d) => d.fileName.toLowerCase()).join(' ');
    return DOC_CATEGORY_LABELS.filter(
      (c) => c.requiredAlways || (c.requiredVehicular && isVehicular)
    ).map((req) => {
      const found =
        cats.has(req.key) ||
        (req.key === 'pessoal' && /rg|cnh|cpf/.test(names)) ||
        (req.key === 'residencia' && /resid|enderec|luz|agua/.test(names)) ||
        (req.key === 'contrato' && /contrato|ccb|ficha/.test(names)) ||
        (req.key === 'procuracao' && /procur/.test(names)) ||
        (req.key === 'crlv' && /crlv|renavam|veic/.test(names));
      return { ...req, found };
    });
  }, [documents, isVehicular]);

  const activeInspection = selectedDoc ? inspectionByDoc[selectedDoc.id] : undefined;

  return (
    <div className="space-y-4">
      {/* Completeness Matrix + Direct Bucket Upload */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Conferência de Completude Documental
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Checklist automático dos anexos obrigatórios no cofre antes da aprovação e emissão de boletos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Categoria do documento para upload"
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 min-h-[40px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {DOC_CATEGORY_LABELS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={handleUpload}
              className="hidden"
              id={`audit-doc-upload-${admissionId}`}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap min-h-[40px] dark:border-slate-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Anexar Complemento no Cofre
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
          {completenessMatrix.map((item) => (
            <div
              key={item.key}
              className={`rounded-lg border px-3 py-2 text-xs flex items-center gap-2 ${
                item.found ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300' : 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300'
              }`}
            >
              {item.found ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 dark:text-amber-400" />
              )}
              <div className="min-w-0">
                <div className="font-semibold truncate">{item.label}</div>
                <div className="text-[11px] opacity-80">{item.found ? 'Localizado' : 'Não identificado'}</div>
              </div>
            </div>
          ))}
        </div>

        {uploadFeedback && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
            {uploadFeedback}
          </div>
        )}
      </div>

      {/* Split-Pane Side-by-Side Viewer & Document Queue */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Document List */}
        <div className="xl:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-900 dark:border-slate-800 dark:text-slate-100">
            <span>Documentos no Cofre ({documents.length})</span>
            <span className="font-normal text-slate-500 dark:text-slate-400">Clique para abrir ao lado</span>
          </div>

          {documents.length === 0 ? (
            <div className="p-8 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="font-semibold text-slate-800 dark:text-slate-100">Nenhum anexo localizado</div>
              <p>Anexe o RG/CNH, Contrato, Procuração ou CRLV acima ou devolva ao Comercial.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto dark:divide-slate-800">
              {documents.map((doc) => {
                const isSelected = selectedDocId === doc.id;
                const inspected = inspectionByDoc[doc.id];
                return (
                  <div
                    key={doc.id}
                    className={`p-3.5 transition-colors ${isSelected ? 'bg-blue-50/60 dark:bg-blue-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedDocId(doc.id)}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 break-all dark:text-slate-100">{doc.fileName}</span>
                        <span className="font-mono text-[11px] font-semibold text-blue-700 shrink-0 dark:text-blue-300">
                          {doc.docCategory}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono dark:text-slate-400">
                        <span>{formatBytes(doc.sizeBytes)}</span>
                        <span>·</span>
                        <span>{doc.uploadedBy}</span>
                        <span>·</span>
                        <span>{formatDateTimeBR(doc.createdAt)}</span>
                      </div>
                    </button>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {doc.effectivePermissions?.view !== false && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDocId(doc.id);
                            setFullViewDoc(doc);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 min-h-[34px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Visualizar
                        </button>
                      )}
                      {doc.effectivePermissions?.download !== false && (
                        <button
                          type="button"
                          onClick={() => handleDownload(doc)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 min-h-[34px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={inspectingDocId === doc.id}
                        onClick={() => handleIviInspectDoc(doc)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[34px] dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        {inspectingDocId === doc.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Bot className="w-3.5 h-3.5" />
                        )}
                        {inspected ? 'Reanalisar c/ Ivi' : 'Ivi: Conferir'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Inline Previewer + Ivi Document Extraction */}
        <div className="xl:col-span-7 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 dark:border-slate-800">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate dark:text-slate-100">
                  {selectedDoc ? selectedDoc.fileName : 'Pré-visualização de Documento'}
                </div>
                {selectedDoc && (
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {selectedDoc.mimeType} · {formatBytes(selectedDoc.sizeBytes)}
                  </div>
                )}
              </div>

              {selectedDoc && (
                <div className="flex items-center gap-1.5">
                  {isDark &&
                    (selectedDoc.mimeType === 'application/pdf' ||
                      selectedDoc.fileName.toLowerCase().endsWith('.pdf')) && (
                      <button
                        type="button"
                        onClick={() => setAdaptPdfToTheme((v) => !v)}
                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
                          adaptPdfToTheme
                            ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                            : 'border-slate-700 bg-slate-800 text-slate-200'
                        }`}
                      >
                        <Contrast className="w-3 h-3" />
                        {adaptPdfToTheme ? 'Tema Escuro' : 'Original'}
                      </button>
                    )}
                  {selectedDoc.mimeType.startsWith('image/') && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Reduzir zoom"
                        onClick={() => setZoomPct((z) => Math.max(50, z - 20))}
                        className="rounded border border-slate-200 dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono text-xs px-1.5 tabular-nums">{zoomPct}%</span>
                      <button
                        type="button"
                        aria-label="Aumentar zoom"
                        onClick={() => setZoomPct((z) => Math.min(200, z + 20))}
                        className="rounded border border-slate-200 dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setFullViewDoc(selectedDoc)}
                    title="Abrir documento ocupando toda a área livre da tela"
                    className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Maximize2 className="w-3 h-3" />
                    Tela Livre
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-100/70 dark:bg-slate-950 min-h-[340px] flex items-center justify-center p-3 overflow-auto">
              {!selectedDoc ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Selecione um documento ao lado para conferir sem precisar sair desta tela.
                </p>
              ) : (selectedDoc.mimeType === 'application/pdf' ||
                  selectedDoc.fileName.toLowerCase().endsWith('.pdf')) &&
                (selectedDoc.effectivePermissions?.download === false ||
                  selectedDoc.effectivePermissions?.print === false) ? (
                <div className="p-6 text-center space-y-3 text-xs">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    Este PDF possui restrição de download/impressão.
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Abra no Leitor Interno Protegido (renderização segura sem barra de exportação).
                  </p>
                  <button
                    type="button"
                    onClick={() => setFullViewDoc(selectedDoc)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Abrir Leitor Interno Protegido
                  </button>
                </div>
              ) : (
                <ThemedDocumentContent
                  fileName={selectedDoc.fileName}
                  mimeType={selectedDoc.mimeType}
                  blobUrl={previewUrl}
                  loading={previewLoading}
                  errorMsg={previewError}
                  zoomPct={selectedDoc.mimeType.startsWith('image/') ? zoomPct : undefined}
                  adaptPdfToTheme={adaptPdfToTheme}
                  heightClass="h-[380px]"
                  onDownload={
                    selectedDoc.effectivePermissions?.download !== false
                      ? () => handleDownload(selectedDoc)
                      : undefined
                  }
                />
              )}
            </div>
          </div>

          {inspectError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {inspectError}
            </div>
          )}

          {/* Ivi Document Inspection Results */}
          {activeInspection && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                  <Bot className="w-4 h-4 text-slate-900 dark:text-slate-100" />
                  <span>Leitura da Ivi · {activeInspection.documentDetected}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span
                    className={
                      activeInspection.legibility === 'LEGIVEL'
                        ? 'text-emerald-700 font-semibold dark:text-emerald-300'
                        : activeInspection.legibility === 'PARCIAL'
                        ? 'text-amber-700 font-semibold dark:text-amber-300'
                        : 'text-red-700 font-semibold dark:text-red-300'
                    }
                  >
                    Legibilidade: {activeInspection.legibility}
                  </span>
                  <span className="text-slate-300">|</span>
                  <span
                    className={
                      activeInspection.matchesDossier === 'CONFERE'
                        ? 'text-emerald-700 font-semibold dark:text-emerald-300'
                        : activeInspection.matchesDossier === 'DIVERGENCIA'
                        ? 'text-red-700 font-semibold dark:text-red-300'
                        : 'text-slate-600 font-semibold dark:text-slate-300'
                    }
                  >
                    Cruzamento: {activeInspection.matchesDossier}
                  </span>
                </div>
              </div>

              <p className="text-slate-700 leading-relaxed dark:text-slate-200">{activeInspection.summary}</p>

              {activeInspection.extractedFields.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Campo</th>
                        <th className="px-3 py-2">Identificado no Anexo</th>
                        <th className="px-3 py-2">Esperado na Ficha</th>
                        <th className="px-3 py-2 text-right">Conferência</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {activeInspection.extractedFields.map((f, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">{f.label}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{f.foundInDoc}</td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{f.expectedInDossier}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {f.match ? (
                              <span className="text-emerald-700 dark:text-emerald-300">Confere</span>
                            ) : (
                              <span className="text-red-700 dark:text-red-300">Divergente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeInspection.alerts.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                  {activeInspection.alerts.map((al, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5 dark:text-amber-300" />
                      <span>{al}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeInspection.suggestedCritiqueText && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onUseAlertInCritique(activeInspection.suggestedCritiqueText)}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    Copiar divergência para Devolução
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ProtectedDocumentViewerModal
        open={Boolean(fullViewDoc)}
        documentId={fullViewDoc?.id || null}
        fileName={fullViewDoc?.fileName || ''}
        mimeType={fullViewDoc?.mimeType || ''}
        subtitle={
          fullViewDoc
            ? `${fullViewDoc.unitFolderPath || fullViewDoc.folderPath || 'bucketdainvicta'} · ${formatBytes(fullViewDoc.sizeBytes)} · ${fullViewDoc.mimeType}`
            : ''
        }
        context="client_dossier"
        canPrint={fullViewDoc ? fullViewDoc.effectivePermissions?.print !== false : false}
        canDownload={fullViewDoc ? fullViewDoc.effectivePermissions?.download !== false : false}
        onClose={() => setFullViewDoc(null)}
      />
    </div>
  );
};
