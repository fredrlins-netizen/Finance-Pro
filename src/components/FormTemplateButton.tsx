import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Printer, X } from 'lucide-react';
import { apiFetch, getAuthToken } from '../lib/api.ts';
import {
  buildTemplateVariableMap,
  openPrintWindow,
  replaceTemplateVariables,
  type FormMergeContext,
} from '../lib/formTemplateRenderer.ts';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
} from '../lib/portalBrandingCache.ts';
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

      const res = openPrintWindow({
        title: tpl.name,
        headerHtml,
        bodyHtml,
        footerHtml,
        companyLogoDataUrl: activeBranding?.logoDataUrl,
        companyName: activeBranding?.companyName,
        logoDarkBackdrop: getCachedLogoNeedsDarkBackdrop(),
      });

      if (!res.opened) {
        setFallbackDoc({ title: tpl.name, html: res.htmlDocument });
      }
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vars, fileName: tpl.name }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Falha ao gerar arquivo .docx.');
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
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap'
          }
          title={single.description || single.name}
        >
          <FileText className="w-3.5 h-3.5 text-blue-600" />
          {single.name}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            className ||
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap'
          }
        >
          <FileText className="w-3.5 h-3.5 text-blue-600" />
          {label} ({templates.length})
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-72 rounded-xl border border-slate-200 bg-white shadow-xl py-1.5 text-xs">
          <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Modelos A4 Vinculados
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
            {templates.map((tpl) => (
              <div key={tpl.id} className="px-3 py-2 hover:bg-slate-50 space-y-1">
                <div className="font-semibold text-slate-800">{tpl.name}</div>
                {tpl.description && (
                  <div className="text-[11px] text-slate-500 line-clamp-2">{tpl.description}</div>
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
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <Download className="w-3 h-3 text-emerald-600" />
                      {busyId === tpl.id ? 'Gerando...' : '.DOCX'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fallbackDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-5xl h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-slate-50">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-sm font-bold text-slate-900">{fallbackDoc.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fallbackIframeRef.current?.contentWindow?.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir Agora
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([fallbackDoc.html], { type: 'text/html;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${fallbackDoc.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
                    a.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Baixar HTML A4
                </button>
                <button
                  type="button"
                  onClick={() => setFallbackDoc(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-200 p-3">
              <iframe
                ref={fallbackIframeRef}
                title={fallbackDoc.title}
                srcDoc={fallbackDoc.html}
                className="w-full h-full rounded-lg border border-slate-300 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
