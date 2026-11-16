import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Printer, X } from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../lib/api.ts';
import {
  buildPrintableHtmlDocument,
  buildTemplateVariableMap,
  replaceTemplateVariables,
  type FormMergeContext,
} from '../lib/formTemplateRenderer.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
} from '../lib/portalBrandingCache.ts';
import { applyThemeToHtmlDocument, useTheme } from '../lib/theme.tsx';
import { FullFreeAreaDocumentShell } from './DossierDocumentViewer.tsx';
import type { FormTemplateItem } from '../types.ts';

export function useFormTemplates(menuId: string) {
  const [templates, setTemplates] = useState<FormTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<{ items: FormTemplateItem[] }>(`/api/form-templates/by-menu/${encodeURIComponent(menuId)}`)
      .then((res) => {
        if (active) setTemplates(Array.isArray(res.items) ? res.items : []);
      })
      .catch(() => {
        if (active) setTemplates([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [menuId]);

  return { templates, loading };
}

interface FormTemplateButtonProps {
  menuId: string;
  getContext: () => FormMergeContext;
  label?: string;
  className?: string;
  onAfterPrint?: (template: FormTemplateItem) => void;
  onError?: (message: string) => void;
}

export const FormTemplateButton: React.FC<FormTemplateButtonProps> = ({
  menuId,
  getContext,
  label = 'Modelos',
  className = '',
  onAfterPrint,
  onError,
}) => {
  const { theme } = useTheme();
  const { templates } = useFormTemplates(menuId);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fallbackDoc, setFallbackDoc] = useState<{ title: string; html: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fallbackIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    void ensurePortalBrandingLoaded();
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (templates.length === 0) return null;

  const handlePrintTemplate = async (tpl: FormTemplateItem) => {
    try {
      const activeBranding = getCachedPortalBranding() || (await ensurePortalBrandingLoaded());
      const ctx = getContext();
      const headerHtml = replaceTemplateVariables(tpl.header || '', ctx);
      const bodyHtml = replaceTemplateVariables(tpl.content || '', ctx);
      const footerHtml = replaceTemplateVariables(tpl.footer || '', ctx);

      const htmlDocument = buildPrintableHtmlDocument({
        title: tpl.name,
        headerHtml,
        bodyHtml,
        footerHtml,
        companyLogoDataUrl: activeBranding?.logoDataUrl,
        companyName: activeBranding?.companyName,
        logoDarkBackdrop: getCachedLogoNeedsDarkBackdrop(),
      });

      setFallbackDoc({ title: tpl.name, html: htmlDocument });
      setOpen(false);
      onAfterPrint?.(tpl);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Erro ao preparar modelo para impressão.');
    }
  };

  const handleDownloadDocx = async (tpl: FormTemplateItem) => {
    if (!tpl.docxTemplate) return;
    setBusyId(tpl.id);
    try {
      const ctx = getContext();
      const vars = buildTemplateVariableMap(ctx);
      const token = getAuthToken();
      const resp = await fetch(`/api/form-templates/${tpl.id}/render-docx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vars, fileName: tpl.name }),
      });
      if (!resp.ok) {
        await parseJsonResponse(resp, 'Falha ao gerar arquivo .docx.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tpl.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
      onAfterPrint?.(tpl);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Erro ao exportar .docx.');
    } finally {
      setBusyId(null);
    }
  };

  const single = templates.length === 1 ? templates[0] : null;

  return (
    <div ref={containerRef} className="relative inline-block">
      {single && !single.docxTemplate ? (
        <button
          type="button"
          onClick={() => handlePrintTemplate(single)}
          className={
            className ||
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          }
          title={single.description || single.name}
        >
          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          {single.name}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            className ||
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          }
        >
          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          {label} ({templates.length})
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-72 rounded-xl border border-slate-200 bg-white shadow-xl py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-400">
            Modelos A4 Vinculados
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {templates.map((tpl) => (
              <div key={tpl.id} className="px-3 py-2 hover:bg-slate-50 space-y-1 dark:hover:bg-slate-800">
                <div className="font-semibold text-slate-800 dark:text-slate-100">{tpl.name}</div>
                {tpl.description && (
                  <div className="text-[11px] text-slate-500 line-clamp-2 dark:text-slate-400">{tpl.description}</div>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handlePrintTemplate(tpl)}
                    className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                  >
                    <Printer className="w-3 h-3" />
                    Imprimir / Visualizar A4
                  </button>
                  {tpl.docxTemplate && (
                    <button
                      type="button"
                      disabled={busyId === tpl.id}
                      onClick={() => void handleDownloadDocx(tpl)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      {busyId === tpl.id ? 'Gerando...' : '.DOCX'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FullFreeAreaDocumentShell
        open={Boolean(fallbackDoc)}
        title={fallbackDoc?.title || ''}
        subtitle="Visualização de Documento A4"
        onClose={() => setFallbackDoc(null)}
        toolbarExtras={
          fallbackDoc && (
            <>
              <button
                type="button"
                onClick={() => fallbackIframeRef.current?.contentWindow?.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:hover:bg-emerald-500"
              >
                <Printer className="w-3.5 h-3.5" />
                Imprimir Agora
              </button>
              <button
                type="button"
                onClick={() => {
                  const themedHtml = applyThemeToHtmlDocument(fallbackDoc.html, theme);
                  const blob = new Blob([themedHtml], { type: 'text/html;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${fallbackDoc.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
                  a.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Baixar HTML A4
              </button>
            </>
          )
        }
      >
        {fallbackDoc && (
          <iframe
            ref={fallbackIframeRef}
            title={fallbackDoc.title}
            srcDoc={applyThemeToHtmlDocument(fallbackDoc.html, theme)}
            className="w-full h-full border-0 bg-white dark:bg-slate-950"
          />
        )}
      </FullFreeAreaDocumentShell>
    </div>
  );
};
