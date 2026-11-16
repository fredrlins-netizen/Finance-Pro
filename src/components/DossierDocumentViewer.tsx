import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Contrast,
  Download,
  FileText,
  Moon,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAutoCollapseSidebar, useTheme } from '../lib/theme.tsx';

interface ThemedDocumentContentProps {
  fileName: string;
  mimeType?: string;
  blobUrl: string;
  loading?: boolean;
  errorMsg?: string;
  zoomPct?: number;
  adaptPdfToTheme?: boolean;
  heightClass?: string;
  onDownload?: () => void;
}

export const ThemedDocumentContent: React.FC<ThemedDocumentContentProps> = ({
  fileName,
  mimeType = '',
  blobUrl,
  loading = false,
  errorMsg = '',
  zoomPct,
  adaptPdfToTheme = true,
  heightClass = 'h-full',
  onDownload,
}) => {
  const { isDark } = useTheme();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();

  const isImage =
    lowerMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName);
  const isAudio =
    lowerMime.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|opus|aac)$/i.test(lowerName);
  const isVideo =
    lowerMime.startsWith('video/') ||
    /\.(mp4|webm|mov)$/i.test(lowerName);
  const isPdf =
    lowerMime === 'application/pdf' ||
    lowerName.endsWith('.pdf');
  const isText =
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    /\.(txt|csv|log|json|md|xml)$/i.test(lowerName);

  useEffect(() => {
    if (!blobUrl || !isText || loading || errorMsg) {
      setTextContent(null);
      return;
    }
    let active = true;
    setTextLoading(true);
    fetch(blobUrl)
      .then((r) => r.text())
      .then((txt) => {
        if (active) setTextContent(txt);
      })
      .catch(() => {
        if (active) setTextContent(null);
      })
      .finally(() => {
        if (active) setTextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [blobUrl, isText, loading, errorMsg]);

  if (loading || textLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full py-12 text-xs text-slate-500 dark:text-slate-400">
        Descriptografando objeto do Bucket da Invicta...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-6 text-center space-y-3 text-xs text-red-700 dark:text-red-300">
        <p>{errorMsg}</p>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar para leitura local
          </button>
        )}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Nenhum conteúdo disponível para visualização.
      </div>
    );
  }

  if (isImage) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4 overflow-auto bg-white dark:bg-slate-950">
        <img
          src={blobUrl}
          alt={fileName}
          style={zoomPct ? { width: `${zoomPct}%`, maxWidth: 'none' } : undefined}
          className={`${zoomPct ? '' : 'max-h-full max-w-full'} rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 object-contain shadow-sm`}
        />
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 bg-white dark:bg-slate-950">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{fileName}</div>
        <audio controls src={blobUrl} className="w-full max-w-lg" />
      </div>
    );
  }

  if (isVideo) {
    return (
      <video
        controls
        src={blobUrl}
        className={`w-full ${heightClass} bg-black object-contain`}
      />
    );
  }

  if (isText && textContent !== null) {
    return (
      <pre
        className={`w-full ${heightClass} overflow-auto bg-white dark:bg-slate-950 p-5 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words`}
      >
        {textContent}
      </pre>
    );
  }

  if (isPdf || lowerMime === 'text/html') {
    const applyDarkFilter = isPdf && isDark && adaptPdfToTheme;
    return (
      <iframe
        title={fileName}
        src={blobUrl}
        className={`w-full ${heightClass} border-0 bg-white transition-[filter] duration-200 dark:bg-slate-900 ${
          applyDarkFilter ? 'fp-doc-pdf-themed' : ''
        }`}
      />
    );
  }

  return (
    <div className="p-6 text-center space-y-3 text-xs text-slate-600 dark:text-slate-300">
      <FileText className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
      <p>
        Pré-visualização inline indisponível para{' '}
        <span className="font-mono">{mimeType || 'arquivo binário'}</span>.
      </p>
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
        >
          <Download className="w-4 h-4" />
          Baixar do Bucket
        </button>
      )}
    </div>
  );
};

interface FullFreeAreaDocumentShellProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  toolbarExtras?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Container que colapsa automaticamente o menu lateral enquanto aberto
 * e ocupa TODA a área livre da tela (abaixo da barra superior e ao lado do menu colapsado),
 * respeitando fielmente o tema Dark / White do painel principal.
 */
export const FullFreeAreaDocumentShell: React.FC<FullFreeAreaDocumentShellProps> = ({
  open,
  title,
  subtitle,
  onClose,
  toolbarExtras,
  children,
}) => {
  const { isDark, toggleTheme } = useTheme();
  useAutoCollapseSidebar(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed top-14 left-0 lg:left-14 right-0 bottom-0 z-[70] flex flex-col bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {toolbarExtras}

          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Alternar documento e painel para Modo Claro (White)' : 'Alternar documento e painel para Modo Escuro (Dark)'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            {isDark ? (
              <>
                <Moon className="w-3.5 h-3.5 text-emerald-400" />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>White</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar visualização"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full h-full bg-white dark:bg-slate-950 overflow-hidden flex items-center justify-center">
        {children}
      </div>
    </div>
  );
};

interface DossierDocumentPreviewModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  mimeType?: string;
  blobUrl: string;
  loading?: boolean;
  errorMsg?: string;
  onDownload?: () => void;
  onClose: () => void;
}

export const DossierDocumentPreviewModal: React.FC<DossierDocumentPreviewModalProps> = ({
  open,
  title,
  subtitle,
  mimeType = '',
  blobUrl,
  loading = false,
  errorMsg = '',
  onDownload,
  onClose,
}) => {
  const { isDark } = useTheme();
  const [adaptPdfToTheme, setAdaptPdfToTheme] = useState(true);
  const [zoomPct, setZoomPct] = useState<number | undefined>(undefined);

  useEffect(() => {
    setZoomPct(undefined);
    setAdaptPdfToTheme(true);
  }, [title, blobUrl]);

  const lowerMime = mimeType.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const isPdf = lowerMime === 'application/pdf' || lowerTitle.endsWith('.pdf');
  const isImage =
    lowerMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerTitle);

  return (
    <FullFreeAreaDocumentShell
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      toolbarExtras={
        <>
          {isImage && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1">
              <button
                type="button"
                aria-label="Reduzir zoom"
                onClick={() => setZoomPct((z) => Math.max(40, (z ?? 100) - 20))}
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 px-1 tabular-nums">
                {zoomPct ? `${zoomPct}%` : 'Ajustar'}
              </span>
              <button
                type="button"
                aria-label="Aumentar zoom"
                onClick={() => setZoomPct((z) => Math.min(250, (z ?? 100) + 20))}
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {isPdf && isDark && (
            <button
              type="button"
              onClick={() => setAdaptPdfToTheme((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                adaptPdfToTheme
                  ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title="Alternar folha do PDF entre Tema Escuro e Original"
            >
              <Contrast className="w-3.5 h-3.5" />
              {adaptPdfToTheme ? 'PDF no Tema Escuro' : 'PDF Original'}
            </button>
          )}

          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar
            </button>
          )}
        </>
      }
    >
      <ThemedDocumentContent
        fileName={title}
        mimeType={mimeType}
        blobUrl={blobUrl}
        loading={loading}
        errorMsg={errorMsg}
        zoomPct={isImage ? zoomPct : undefined}
        adaptPdfToTheme={adaptPdfToTheme}
        heightClass="h-full"
        onDownload={onDownload}
      />
    </FullFreeAreaDocumentShell>
  );
};
