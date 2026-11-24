import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Lock,
  Printer,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getActiveUnitHeader, getAuthToken } from '../../lib/api.ts';
import { FullFreeAreaDocumentShell } from '../DossierDocumentViewer.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ProtectedDocumentViewerModalProps {
  open: boolean;
  documentId: number | null;
  fileName: string;
  mimeType?: string;
  subtitle?: string;
  context?: 'unit_browser' | 'client_dossier' | 'direct';
  canPrint: boolean;
  canDownload: boolean;
  onClose: () => void;
}

const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const ProtectedDocumentViewerModal: React.FC<ProtectedDocumentViewerModalProps> = ({
  open,
  documentId,
  fileName,
  mimeType = '',
  subtitle,
  context = 'direct',
  canPrint,
  canDownload,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [blobUrl, setBlobUrl] = useState('');
  const [resolvedMime, setResolvedMime] = useState(mimeType);
  const [textPreview, setTextPreview] = useState<string | null>(null);

  // PDF Canvas State
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(2); // 1.25x default
  const [renderingPage, setRenderingPage] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const lowerMime = (resolvedMime || mimeType || '').toLowerCase();
  const lowerName = (fileName || '').toLowerCase();

  const fileKind = useMemo(() => {
    if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerMime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName)) return 'image';
    if (lowerMime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|opus|aac)$/i.test(lowerName)) return 'audio';
    if (lowerMime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(lowerName)) return 'video';
    if (
      lowerMime.startsWith('text/') ||
      lowerMime === 'application/json' ||
      /\.(txt|csv|log|json|md|xml)$/i.test(lowerName)
    ) {
      return 'text';
    }
    return 'binary';
  }, [lowerMime, lowerName]);

  // Keyboard & Print Guard when !canPrint
  useEffect(() => {
    if (!open || canPrint) return;
    const blockPrintShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        setActionMsg('Impressão bloqueada pelas permissões deste documento.');
      }
    };
    window.addEventListener('keydown', blockPrintShortcut, true);
    return () => window.removeEventListener('keydown', blockPrintShortcut, true);
  }, [open, canPrint]);

  // Load decrypted object bytes for internal preview
  useEffect(() => {
    if (!open || !documentId) {
      setRawBytes(null);
      setPdfDoc(null);
      setPdfPages(0);
      setCurrentPage(1);
      setTextPreview(null);
      setErrorMsg('');
      setActionMsg('');
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      return;
    }

    let cancelled = false;
    let createdUrl = '';

    const loadPreview = async () => {
      setLoading(true);
      setErrorMsg('');
      setActionMsg('');
      setPdfDoc(null);
      setPdfPages(0);
      setCurrentPage(1);
      setTextPreview(null);
      try {
        const token = getAuthToken();
        const res = await fetch(
          `/api/documents/${documentId}/download?preview=1&context=${encodeURIComponent(context)}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'x-unit-id': String(getActiveUnitHeader()),
            },
          }
        );
        if (!res.ok) {
          let err = `Acesso negado ou indisponível (${res.status}).`;
          try {
            const parsed = (await res.json()) as { error?: string };
            if (parsed.error) err = parsed.error;
          } catch {
            // keep default error
          }
          if (!cancelled) setErrorMsg(err);
          return;
        }

        const ct = res.headers.get('content-type') || mimeType || 'application/octet-stream';
        const arrBuf = await res.arrayBuffer();
        if (cancelled) return;

        const bytes = new Uint8Array(arrBuf);
        setResolvedMime(ct);
        setRawBytes(bytes);

        if (
          ct.startsWith('text/') ||
          ct === 'application/json' ||
          /\.(txt|csv|log|json|md|xml)$/i.test(fileName.toLowerCase())
        ) {
          const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          setTextPreview(decoded);
        }

        const blob = new Blob([bytes], { type: ct });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);

        if (ct.toLowerCase().includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
          const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
          const doc = await loadingTask.promise;
          if (cancelled) {
            await doc.cleanup();
            return;
          }
          setPdfDoc(doc);
          setPdfPages(doc.numPages);
          setCurrentPage(1);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Erro ao abrir leitor protegido.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, documentId, context, fileName, mimeType]);

  // Render active PDF page onto <canvas>
  useEffect(() => {
    if (!open || fileKind !== 'pdf' || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      setRenderingPage(true);
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled || !canvasRef.current) return;

        const scale = ZOOM_STEPS[zoomIndex] || 1.25;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch {
        // ignore cancelled render errors
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore cancel error
      }
    };
  }, [open, fileKind, pdfDoc, currentPage, zoomIndex]);

  const handleDownload = useCallback(async () => {
    if (!documentId || !canDownload) return;
    try {
      const token = getAuthToken();
      const res = await fetch(
        `/api/documents/${documentId}/download?context=${encodeURIComponent(context)}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-unit-id': String(getActiveUnitHeader()),
          },
        }
      );
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMsg(parsed.error || 'Download bloqueado.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || `documento_${documentId}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Erro ao baixar arquivo.');
    }
  }, [documentId, canDownload, context, fileName]);

  const handlePrint = useCallback(async () => {
    if (!documentId || !canPrint) return;
    try {
      const token = getAuthToken();
      // Registra auditoria de impressão e valida permissão no servidor
      const res = await fetch(
        `/api/documents/${documentId}/download?mode=print&context=${encodeURIComponent(context)}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-unit-id': String(getActiveUnitHeader()),
          },
        }
      );
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMsg(parsed.error || 'Impressão bloqueada no servidor.');
        return;
      }
      const printBlob = await res.blob();
      const printUrl = URL.createObjectURL(printBlob);
      const iframe = document.createElement('iframe');
      iframe.className = 'hidden';
      iframe.src = printUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
        window.setTimeout(() => {
          URL.revokeObjectURL(printUrl);
          iframe.remove();
        }, 60_000);
      };
      document.body.appendChild(iframe);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Erro ao preparar impressão.');
    }
  }, [documentId, canPrint, context]);

  const zoomWidthClass = useMemo(() => {
    const z = ZOOM_STEPS[zoomIndex] || 1.25;
    if (z <= 0.75) return 'max-w-lg';
    if (z <= 1) return 'max-w-2xl';
    if (z <= 1.25) return 'max-w-4xl';
    if (z <= 1.5) return 'max-w-5xl';
    return 'max-w-full';
  }, [zoomIndex]);

  return (
    <FullFreeAreaDocumentShell
      open={open}
      title={fileName || 'Documento'}
      subtitle={subtitle}
      onClose={onClose}
      toolbarExtras={
        <>
          {!canPrint && (
            <style>{`@media print { body * { visibility: hidden !important; display: none !important; } }`}</style>
          )}

          {fileKind === 'pdf' && pdfPages > 0 && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-0.5 disabled:opacity-40 hover:text-slate-900 dark:hover:text-white"
                title="Página anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono tabular-nums px-1 whitespace-nowrap">
                Pág. {currentPage}/{pdfPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= pdfPages}
                onClick={() => setCurrentPage((p) => Math.min(pdfPages, p + 1))}
                className="p-0.5 disabled:opacity-40 hover:text-slate-900 dark:hover:text-white"
                title="Próxima página"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {(fileKind === 'pdf' || fileKind === 'image') && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              <button
                type="button"
                disabled={zoomIndex <= 0}
                onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
                className="p-0.5 disabled:opacity-40"
                title="Reduzir zoom"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono tabular-nums px-1 whitespace-nowrap">
                {Math.round((ZOOM_STEPS[zoomIndex] || 1) * 100)}%
              </span>
              <button
                type="button"
                disabled={zoomIndex >= ZOOM_STEPS.length - 1}
                onClick={() => setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
                className="p-0.5 disabled:opacity-40"
                title="Aumentar zoom"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {(!canDownload || !canPrint) && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0">
              <Lock className="w-3 h-3" />
              Leitor Protegido
              {!canDownload && !canPrint
                ? ' · Sem Download/Impressão'
                : !canDownload
                ? ' · Sem Download'
                : ' · Sem Impressão'}
            </span>
          )}

          {canPrint && (
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </button>
          )}

          {canDownload && (
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar
            </button>
          )}
        </>
      }
    >
      <div
        onContextMenu={(e) => {
          if (!canDownload) e.preventDefault();
        }}
        className={`w-full h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 ${
          !canDownload && !canPrint ? 'select-none' : ''
        }`}
      >
        {actionMsg && (
          <div className="border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-2 text-xs font-medium text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              {actionMsg}
            </span>
            <button
              type="button"
              onClick={() => setActionMsg('')}
              className="text-[11px] font-semibold underline"
            >
              Fechar
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col items-center justify-start">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-slate-500 dark:text-slate-400">
              Carregando documento em memória protegida...
            </div>
          ) : errorMsg ? (
            <div className="my-auto max-w-md rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 p-6 text-center space-y-3 text-xs text-red-700 dark:text-red-300">
              <Lock className="w-7 h-7 mx-auto text-red-500" />
              <p className="font-semibold">{errorMsg}</p>
            </div>
          ) : fileKind === 'pdf' && pdfDoc ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="relative rounded-lg border border-slate-300 dark:border-slate-700 bg-white shadow-sm overflow-hidden">
                <canvas ref={canvasRef} className="block max-w-full h-auto" />
                {renderingPage && (
                  <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center text-xs font-medium text-slate-700 dark:text-slate-200">
                    Renderizando página {currentPage}...
                  </div>
                )}
              </div>
            </div>
          ) : fileKind === 'image' && blobUrl ? (
            <img
              src={blobUrl}
              alt={fileName}
              draggable={canDownload}
              className={`${zoomWidthClass} rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 object-contain shadow-sm`}
            />
          ) : fileKind === 'audio' && blobUrl ? (
            <div className="my-auto w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3 text-center">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{fileName}</div>
              <audio
                controls
                controlsList={canDownload ? undefined : 'nodownload'}
                src={blobUrl}
                className="w-full"
              />
            </div>
          ) : fileKind === 'video' && blobUrl ? (
            <video
              controls
              controlsList={canDownload ? undefined : 'nodownload'}
              src={blobUrl}
              className="max-h-full max-w-full rounded-lg bg-black"
            />
          ) : fileKind === 'text' && textPreview !== null ? (
            <pre className="w-full max-w-5xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words">
              {textPreview}
            </pre>
          ) : (
            <div className="my-auto max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <FileText className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="font-semibold text-slate-800 dark:text-slate-100">{fileName}</p>
              <p>
                Pré-visualização inline indisponível para{' '}
                <span className="font-mono">{resolvedMime || rawBytes?.length || 0}</span>.
              </p>
              {canDownload ? (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
                >
                  <Download className="w-4 h-4" />
                  Baixar Arquivo
                </button>
              ) : (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Seu perfil possui permissão apenas de visualização; o download deste formato está bloqueado.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </FullFreeAreaDocumentShell>
  );
};
