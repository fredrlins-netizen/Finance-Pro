import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Edit3,
  Eye,
  FileText,
  FileUp,
  Image as ImageIcon,
  Indent,
  Italic,
  Layers,
  Link2,
  List,
  ListOrdered,
  Outdent,
  PanelBottomClose,
  PanelBottomOpen,
  PanelTopClose,
  PanelTopOpen,
  Plus,
  Printer,
  Redo2,
  Save,
  Scissors,
  Search,
  Sparkles,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Variable,
  X,
} from 'lucide-react';
import { apiFetch, getActiveUnitHeader, getAuthToken, parseJsonResponse } from '../../../lib/api.ts';
import {
  FORM_CONTEXT_REGISTRY,
  FORM_VARIABLE_CATEGORIES,
  TOTAL_FORM_VARIABLES,
} from '../../../lib/formTemplateCatalog.ts';
import {
  buildPrintableHtmlDocument,
  replaceTemplateVariables,
  sanitizeTemplateHtml,
  type FormMergeContext,
} from '../../../lib/formTemplateRenderer.ts';
import { applyThemeToHtmlDocument, useTheme } from '../../../lib/theme.tsx';
import {
  ensurePortalBrandingLoaded,
  getCachedLogoNeedsDarkBackdrop,
  getCachedPortalBranding,
  setCachedPortalBranding,
  subscribePortalBranding,
} from '../../../lib/portalBrandingCache.ts';
import type { FormTemplateItem, PortalBrandingConfig } from '../../../types.ts';
import { ConfirmDeleteModal } from '../CollectionCoordinatorModalViews.tsx';

type ActiveZone = 'header' | 'body' | 'footer';
type SidebarTab = 'variables' | 'routines';

interface FormTemplatesResponse {
  items: FormTemplateItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ContextDataPayload {
  clients: Array<Record<string, any>>;
  admissions: Array<Record<string, any>>;
  legalProcesses: Array<Record<string, any>>;
  collaborators: Array<Record<string, any>>;
  banks: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
  modalities: Array<Record<string, any>>;
  products: Array<Record<string, any>>;
  services: Array<Record<string, any>>;
  bankAccounts: Array<Record<string, any>>;
  documentTypes: Array<Record<string, any>>;
  bearers: Array<Record<string, any>>;
  chartOfAccounts: Array<Record<string, any>>;
  departments: Array<Record<string, any>>;
  series: Array<Record<string, any>>;
}

interface FormTemplatesManagerContainerProps {
  wsTick?: number;
  branding?: PortalBrandingConfig | null;
  onTemplatesCountChange?: (count: number) => void;
  onNotify?: (msg: string) => void;
}

export const FormTemplatesManagerContainer: React.FC<FormTemplatesManagerContainerProps> = ({
  wsTick,
  branding,
  onTemplatesCountChange,
  onNotify,
}) => {
  const [cachedBranding, setCachedBrandingState] = useState<PortalBrandingConfig | null>(() =>
    getCachedPortalBranding()
  );
  const [darkBackdrop, setDarkBackdrop] = useState<boolean>(() =>
    getCachedLogoNeedsDarkBackdrop()
  );

  useEffect(() => {
    if (branding) {
      setCachedPortalBranding(branding);
    } else {
      void ensurePortalBrandingLoaded();
    }
    return subscribePortalBranding((nextB, nextDark) => {
      setCachedBrandingState(nextB);
      setDarkBackdrop(nextDark);
    });
  }, [branding]);

  const activeBranding = branding || cachedBranding;
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [items, setItems] = useState<FormTemplateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [headerHtml, setHeaderHtml] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [footerHtml, setFooterHtml] = useState('');
  const [showHeader, setShowHeader] = useState(false);
  const [showFooter, setShowFooter] = useState(false);
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [docxTemplate, setDocxTemplate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);
  const [editorError, setEditorError] = useState('');

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('variables');
  const [varSearch, setVarSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    cliente: true,
    admissao: true,
    geral: true,
  });

  // Rich editor state
  const [activeZone, setActiveZone] = useState<ActiveZone>('body');
  const headerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<{ zone: ActiveZone; range: Range } | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);

  // Selected image & popovers
  const [selectedImgEl, setSelectedImgEl] = useState<HTMLImageElement | null>(null);
  const [imgToolbarOpen, setImgToolbarOpen] = useState(false);
  const [tablePopoverOpen, setTablePopoverOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkText, setLinkText] = useState('');

  // Code source modal
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalZone, setCodeModalZone] = useState<ActiveZone>('body');
  const [codeDraft, setCodeDraft] = useState('');

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<FormTemplateItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Selected template & modal presentation options
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [modalOptionsTarget, setModalOptionsTarget] = useState<
    { mode: 'list'; item: FormTemplateItem } | { mode: 'editor' } | null
  >(null);
  const [draftModalMenuIds, setDraftModalMenuIds] = useState<string[]>([]);
  const [modalOnlyFilter, setModalOnlyFilter] = useState(false);
  const [modalRoutineSearch, setModalRoutineSearch] = useState('');
  const [savingModalOptions, setSavingModalOptions] = useState(false);
  const [modalOptionsError, setModalOptionsError] = useState('');

  // Live test & print fallback preview modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewHtmlDoc, setPreviewHtmlDoc] = useState('');
  const [previewTitle, setPreviewTitle] = useState('Pré-visualização A4');
  const [contextData, setContextData] = useState<ContextDataPayload | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedAdmissionId, setSelectedAdmissionId] = useState('');
  const [selectedProcessId, setSelectedProcessId] = useState('');

  const notify = useCallback(
    (msg: string) => {
      onNotify?.(msg);
    },
    [onNotify]
  );

  const loadList = useCallback(
    async (searchTerm = search) => {
      setLoading(true);
      setListError('');
      try {
        const qs = new URLSearchParams({ page: '1', limit: '200' });
        if (searchTerm.trim()) qs.set('search', searchTerm.trim());
        const res = await apiFetch<FormTemplatesResponse>(`/api/form-templates?${qs.toString()}`);
        const loaded = res.items || [];
        setItems(loaded);
        setTotal(res.total || 0);
        setSelectedTemplateId((curr) =>
          curr && loaded.some((it) => it.id === curr) ? curr : loaded[0]?.id ?? null
        );
        if (!searchTerm.trim()) {
          onTemplatesCountChange?.(res.total || 0);
        }
      } catch (err) {
        setListError(err instanceof Error ? err.message : 'Falha ao carregar modelos A4.');
      } finally {
        setLoading(false);
      }
    },
    [search, onTemplatesCountChange]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadList(search);
    }, 220);
    return () => window.clearTimeout(t);
  }, [search, wsTick, loadList]);

  // Sync DOM refs when opening editor or toggling code/zones
  const syncEditorDom = useCallback((h: string, b: string, f: string) => {
    window.requestAnimationFrame(() => {
      if (headerRef.current && headerRef.current.innerHTML !== h) headerRef.current.innerHTML = h;
      if (bodyRef.current && bodyRef.current.innerHTML !== b) bodyRef.current.innerHTML = b;
      if (footerRef.current && footerRef.current.innerHTML !== f) footerRef.current.innerHTML = f;
    });
  }, []);

  const openNewEditor = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setHeaderHtml('');
    setBodyHtml('<p><br/></p>');
    setFooterHtml('');
    setShowHeader(false);
    setShowFooter(false);
    setMenuIds([]);
    setDocxTemplate(null);
    setEditorError('');
    setActiveZone('body');
    setSelectedImgEl(null);
    setViewMode('editor');
    syncEditorDom('', '<p><br/></p>', '');
  };

  const openEditEditor = (tpl: FormTemplateItem) => {
    setEditingId(tpl.id);
    setName(tpl.name || '');
    setDescription(tpl.description || '');
    const h = tpl.header || '';
    const b = tpl.content || '<p><br/></p>';
    const f = tpl.footer || '';
    setHeaderHtml(h);
    setBodyHtml(b);
    setFooterHtml(f);
    setShowHeader(Boolean(h.trim()));
    setShowFooter(Boolean(f.trim()));
    setMenuIds(Array.isArray(tpl.menuIds) ? tpl.menuIds : []);
    setDocxTemplate(tpl.docxTemplate ?? null);
    setEditorError('');
    setActiveZone('body');
    setSelectedImgEl(null);
    setViewMode('editor');
    syncEditorDom(h, b, f);
  };

  const getZoneRef = (zone: ActiveZone) => {
    if (zone === 'header') return headerRef.current;
    if (zone === 'footer') return footerRef.current;
    return bodyRef.current;
  };

  const readCurrentZoneHtml = useCallback(() => {
    const nextHeader = showHeader ? headerRef.current?.innerHTML ?? headerHtml : '';
    const nextBody = bodyRef.current?.innerHTML ?? bodyHtml;
    const nextFooter = showFooter ? footerRef.current?.innerHTML ?? footerHtml : '';
    return { nextHeader, nextBody, nextFooter };
  }, [showHeader, showFooter, headerHtml, bodyHtml, footerHtml]);

  const handleZoneBlurOrKey = (zone: ActiveZone) => {
    const el = getZoneRef(zone);
    if (!el) return;
    if (zone === 'header') setHeaderHtml(el.innerHTML);
    else if (zone === 'footer') setFooterHtml(el.innerHTML);
    else setBodyHtml(el.innerHTML);

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) {
        savedRangeRef.current = { zone, range: r.cloneRange() };
      }
    }
  };

  const execEditorCommand = (cmd: string, value?: string) => {
    const el = getZoneRef(activeZone) || bodyRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current && savedRangeRef.current.zone === activeZone && sel) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current.range);
      } catch {
        // ignore stale range
      }
    }
    document.execCommand(cmd, false, value);
    handleZoneBlurOrKey(activeZone);
  };

  const insertHtmlAtCursor = (htmlSnippet: string) => {
    const el = getZoneRef(activeZone) || bodyRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      if (savedRangeRef.current && savedRangeRef.current.zone === activeZone) {
        try {
          sel.removeAllRanges();
          sel.addRange(savedRangeRef.current.range);
        } catch {
          // ignore
        }
      }
      if (sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const temp = document.createElement('div');
        temp.innerHTML = htmlSnippet;
        const frag = document.createDocumentFragment();
        let lastNode: Node | null = null;
        while (temp.firstChild) {
          lastNode = frag.appendChild(temp.firstChild);
        }
        range.insertNode(frag);
        if (lastNode) {
          const newRange = document.createRange();
          newRange.setStartAfter(lastNode);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          savedRangeRef.current = { zone: activeZone, range: newRange.cloneRange() };
        }
      } else {
        el.innerHTML += htmlSnippet;
      }
    } else {
      el.innerHTML += htmlSnippet;
    }
    handleZoneBlurOrKey(activeZone);
  };

  const handleInsertVariable = (token: string) => {
    insertHtmlAtCursor(`<span class="fp-var-token">${token}</span>`);
    notify(`Variável ${token} inserida no ${activeZone === 'header' ? 'Cabeçalho' : activeZone === 'footer' ? 'Rodapé' : 'Corpo'}.`);
  };

  const handleInsertPageBreak = () => {
    insertHtmlAtCursor(
      `<div data-pagebreak="true" style="page-break-after: always; border-top: 2px dashed #94a3b8; margin: 14px 0; padding-top: 4px; text-align: center; font-size: 11px; color: #64748b; user-select: none;">— Quebra de Página A4 —</div><p><br/></p>`
    );
  };

  const handleInsertTable = () => {
    const rows = Math.max(1, Math.min(20, tableRows));
    const cols = Math.max(1, Math.min(10, tableCols));
    let html = `<table style="width:100%; border-collapse: collapse; margin: 8px 0;" border="1"><tbody>`;
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += `<td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${r === 0 ? `Coluna ${c + 1}` : '&nbsp;'}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br/></p>';
    insertHtmlAtCursor(html);
    setTablePopoverOpen(false);
  };

  const handleInsertLink = () => {
    const cleanUrl = linkUrl.trim();
    if (!cleanUrl) return;
    const label = (linkText || cleanUrl).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    insertHtmlAtCursor(`<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    setLinkPopoverOpen(false);
    setLinkUrl('https://');
    setLinkText('');
  };

  const handleUploadInlineImage = (file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      setEditorError('Imagem muito grande para o documento HTML (máx. 4 MiB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl) {
        insertHtmlAtCursor(
          `<img src="${dataUrl}" alt="${file.name.replace(/"/g, '')}" class="img-center" style="max-width: 220px; height: auto;" />`
        );
      }
    };
    reader.readAsDataURL(file);
  };

  const applyImagePositionMode = (
    mode: 'img-behind-text' | 'img-front-text' | 'img-float-left' | 'img-float-right' | 'img-center' | 'inline'
  ) => {
    if (!selectedImgEl) return;
    selectedImgEl.classList.remove(
      'img-behind-text',
      'img-front-text',
      'img-float-left',
      'img-float-right',
      'img-center'
    );
    if (mode !== 'inline') {
      selectedImgEl.classList.add(mode);
    }
    if (mode === 'img-behind-text' || mode === 'img-front-text') {
      if (!selectedImgEl.style.left) selectedImgEl.style.left = '20px';
      if (!selectedImgEl.style.top) selectedImgEl.style.top = '20px';
      selectedImgEl.style.position = 'absolute';
    } else {
      selectedImgEl.style.position = '';
      selectedImgEl.style.left = '';
      selectedImgEl.style.top = '';
    }
    handleZoneBlurOrKey(activeZone);
  };

  const nudgeSelectedImage = (dx: number, dy: number) => {
    if (!selectedImgEl) return;
    const curLeft = parseInt(selectedImgEl.style.left || '0', 10) || 0;
    const curTop = parseInt(selectedImgEl.style.top || '0', 10) || 0;
    selectedImgEl.style.position = 'absolute';
    selectedImgEl.style.left = `${curLeft + dx}px`;
    selectedImgEl.style.top = `${curTop + dy}px`;
    handleZoneBlurOrKey(activeZone);
  };

  const handleSaveTemplate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setEditorError('O nome do formulário é obrigatório.');
      return;
    }
    if (trimmedName.length > 255) {
      setEditorError('O nome deve ter no máximo 255 caracteres.');
      return;
    }

    setSaving(true);
    setEditorError('');
    try {
      const { nextHeader, nextBody, nextFooter } = readCurrentZoneHtml();
      const payload = {
        name: trimmedName,
        description: description.trim(),
        header: nextHeader,
        content: nextBody,
        footer: nextFooter,
        menuIds,
        docxTemplate,
      };

      if (editingId) {
        const res = await apiFetch<{ item: FormTemplateItem }>(`/api/form-templates/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setItems((prev) => prev.map((it) => (it.id === res.item.id ? res.item : it)));
        notify('Formulário atualizado com sucesso.');
      } else {
        const res = await apiFetch<{ item: FormTemplateItem }>('/api/form-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setEditingId(res.item.id);
        setItems((prev) => [res.item, ...prev]);
        notify('Formulário criado e salvo no banco de dados.');
      }
      setViewMode('list');
      void loadList(search);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Erro ao salvar modelo.');
    } finally {
      setSaving(false);
    }
  }, [name, description, menuIds, docxTemplate, editingId, readCurrentZoneHtml, notify, loadList, search]);

  // Ref for Ctrl+Enter / Cmd+Enter without stale closures
  const saveRef = useRef(handleSaveTemplate);
  useEffect(() => {
    saveRef.current = handleSaveTemplate;
  }, [handleSaveTemplate]);

  useEffect(() => {
    if (viewMode !== 'editor') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode]);

  const handleImportDocx = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
      setEditorError('Arquivos .doc antigos não são suportados. Salve como .docx e tente novamente.');
      return;
    }
    setImportingDocx(true);
    setEditorError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getAuthToken();
      const resp = await fetch('/api/form-templates/import-docx', {
        method: 'POST',
        headers: {
          'x-unit-id': String(getActiveUnitHeader()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      const json = await parseJsonResponse<{
        html?: string;
        docxTemplate?: string;
        warnings?: string[];
        error?: string;
      }>(resp, 'Falha ao importar .docx');

      const importedHtml = json.html || '<p></p>';
      setBodyHtml(importedHtml);
      setDocxTemplate(json.docxTemplate || null);
      if (bodyRef.current) bodyRef.current.innerHTML = importedHtml;
      if (!name.trim()) {
        setName(file.name.replace(/\.docx$/i, '').slice(0, 255));
      }
      notify('Documento .docx convertido para HTML e layout original anexado para exportação Word.');
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Erro ao importar arquivo Word (.docx).');
    } finally {
      setImportingDocx(false);
      if (docxInputRef.current) docxInputRef.current.value = '';
    }
  };

  const { theme } = useTheme();

  const handlePrintRawOrRendered = (title: string, header: string, body: string, footer: string) => {
    const htmlDocument = buildPrintableHtmlDocument({
      title,
      headerHtml: header,
      bodyHtml: body,
      footerHtml: footer,
      companyLogoDataUrl: activeBranding?.logoDataUrl,
      companyName: activeBranding?.companyName,
      logoDarkBackdrop: darkBackdrop,
    });
    setPreviewTitle(title);
    setPreviewHtmlDoc(htmlDocument);
    setPreviewModalOpen(true);
  };

  const handleOpenLiveTestPreview = async () => {
    setPreviewTitle(`Teste de Preenchimento · ${name || 'Novo Modelo'}`);
    setPreviewModalOpen(true);
    setLoadingContext(true);
    try {
      const ctxRes = await apiFetch<ContextDataPayload>('/api/form-templates/context-data');
      setContextData(ctxRes);
      const firstClientId = ctxRes.clients[0]?.id ? String(ctxRes.clients[0].id) : '';
      const firstAdmId = ctxRes.admissions[0]?.id ? String(ctxRes.admissions[0].id) : '';
      const firstProcId = ctxRes.legalProcesses[0]?.id ? String(ctxRes.legalProcesses[0].id) : '';
      setSelectedClientId((p) => p || firstClientId);
      setSelectedAdmissionId((p) => p || firstAdmId);
      setSelectedProcessId((p) => p || firstProcId);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Erro ao carregar dados reais para teste.');
    } finally {
      setLoadingContext(false);
    }
  };

  // Recompute live merged A4 HTML whenever selected entity in preview modal changes
  useEffect(() => {
    if (!previewModalOpen || !contextData) return;
    const { nextHeader, nextBody, nextFooter } = readCurrentZoneHtml();
    const adm = contextData.admissions.find((a) => String(a.id) === selectedAdmissionId) || contextData.admissions[0];
    const client =
      contextData.clients.find((c) => String(c.id) === selectedClientId) ||
      (adm ? contextData.clients.find((c) => c.id === adm.clientId) : contextData.clients[0]);
    const proc =
      contextData.legalProcesses.find((p) => String(p.id) === selectedProcessId) || contextData.legalProcesses[0];
    const emp =
      contextData.units.find((u) => u.id === (adm?.unitId || client?.unitId)) || contextData.units[0];
    const col = contextData.collaborators.find((c) => c.id === adm?.consultantId) || contextData.collaborators[0];
    const bank =
      contextData.banks.find((b) => String(b.name || '').toLowerCase() === String(adm?.bankName || '').toLowerCase()) ||
      contextData.banks[0];

    const mergeCtx: FormMergeContext = {
      client,
      titular: adm?.assetOwnerId ? contextData.clients.find((c) => c.id === adm.assetOwnerId) || client : client,
      admission: adm,
      legalProcess: proc,
      company: emp,
      collaborator: col,
      bank,
      modality: contextData.modalities[0],
      product: contextData.products[0],
      service: contextData.services[0],
      bankAccount: contextData.bankAccounts[0],
      documentType: contextData.documentTypes[0],
      bearer: contextData.bearers[0],
      chartOfAccount: contextData.chartOfAccounts[0],
      department: contextData.departments[0],
      series: contextData.series[0],
    };

    const rendered = buildPrintableHtmlDocument({
      title: name || 'Pré-visualização A4',
      headerHtml: replaceTemplateVariables(nextHeader, mergeCtx),
      bodyHtml: replaceTemplateVariables(nextBody, mergeCtx),
      footerHtml: replaceTemplateVariables(nextFooter, mergeCtx),
      companyLogoDataUrl: activeBranding?.logoDataUrl,
      companyName: activeBranding?.companyName,
      logoDarkBackdrop: darkBackdrop,
    });
    setPreviewHtmlDoc(rendered);
  }, [
    previewModalOpen,
    contextData,
    selectedClientId,
    selectedAdmissionId,
    selectedProcessId,
    name,
    activeBranding,
    darkBackdrop,
    readCurrentZoneHtml,
  ]);

  const handleDuplicate = async (tpl: FormTemplateItem) => {
    try {
      const res = await apiFetch<{ item: FormTemplateItem }>(`/api/form-templates/${tpl.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setItems((prev) => [res.item, ...prev]);
      notify(`Cópia "${res.item.name}" criada com sucesso.`);
      void loadList(search);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Erro ao duplicar modelo.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/form-templates/${deleteTarget.id}`, { method: 'DELETE' });
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      setItems((prev) => prev.filter((it) => it.id !== deletedId));
      setTotal((t) => Math.max(0, t - 1));
      notify('Formulário excluído com sucesso.');
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Erro ao excluir modelo.');
    } finally {
      setDeleting(false);
    }
  };

  const activeRoutinePrefixes = useMemo(() => {
    if (menuIds.length === 0) return null;
    const set = new Set<string>(['geral', 'titular', 'recalculo']);
    for (const r of FORM_CONTEXT_REGISTRY) {
      if (menuIds.includes(r.menuId)) {
        r.availableVariablePrefixes.forEach((p) => set.add(p));
      }
    }
    return set;
  }, [menuIds]);

  const filteredVariableCategories = useMemo(() => {
    const q = varSearch.trim().toLowerCase();
    return FORM_VARIABLE_CATEGORIES.map((cat) => {
      if (!q) return cat;
      const catMatches = cat.category.toLowerCase().includes(q);
      const matchedItems = catMatches
        ? cat.items
        : cat.items.filter(
            (i) => i.label.toLowerCase().includes(q) || i.token.toLowerCase().includes(q)
          );
      return { ...cat, items: matchedItems };
    }).filter((cat) => cat.items.length > 0);
  }, [varSearch]);

  const routinesByModule = useMemo(() => {
    const groups = new Map<string, typeof FORM_CONTEXT_REGISTRY>();
    for (const r of FORM_CONTEXT_REGISTRY) {
      if (!groups.has(r.module)) groups.set(r.module, []);
      groups.get(r.module)!.push(r);
    }
    return Array.from(groups.entries());
  }, []);

  const selectedTemplate = useMemo(
    () => items.find((it) => it.id === selectedTemplateId) || null,
    [items, selectedTemplateId]
  );

  const openModalOptionsForItem = (tpl: FormTemplateItem) => {
    setSelectedTemplateId(tpl.id);
    setDraftModalMenuIds(Array.isArray(tpl.menuIds) ? [...tpl.menuIds] : []);
    setModalOnlyFilter(false);
    setModalRoutineSearch('');
    setModalOptionsError('');
    setModalOptionsTarget({ mode: 'list', item: tpl });
  };

  const openModalOptionsFromEditor = () => {
    setDraftModalMenuIds([...menuIds]);
    setModalOnlyFilter(false);
    setModalRoutineSearch('');
    setModalOptionsError('');
    setModalOptionsTarget({ mode: 'editor' });
  };

  const handleSaveModalOptions = async () => {
    if (!modalOptionsTarget) return;
    if (modalOptionsTarget.mode === 'editor') {
      setMenuIds(Array.from(new Set(draftModalMenuIds)));
      if (editingId) {
        setSavingModalOptions(true);
        setModalOptionsError('');
        try {
          const res = await apiFetch<{ item: FormTemplateItem }>(`/api/form-templates/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify({ menuIds: Array.from(new Set(draftModalMenuIds)) }),
          });
          setItems((prev) => prev.map((it) => (it.id === res.item.id ? res.item : it)));
          notify(`Opções modais atualizadas (${draftModalMenuIds.length} rotina(s)).`);
          setModalOptionsTarget(null);
        } catch (err) {
          setModalOptionsError(err instanceof Error ? err.message : 'Erro ao salvar opções modais.');
        } finally {
          setSavingModalOptions(false);
        }
      } else {
        notify(`Opções modais aplicadas ao rascunho (${draftModalMenuIds.length} rotina(s)). Salve o modelo para persistir.`);
        setModalOptionsTarget(null);
      }
      return;
    }

    setSavingModalOptions(true);
    setModalOptionsError('');
    try {
      const uniqueMenus = Array.from(new Set(draftModalMenuIds));
      const res = await apiFetch<{ item: FormTemplateItem }>(
        `/api/form-templates/${modalOptionsTarget.item.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ menuIds: uniqueMenus }),
        }
      );
      setItems((prev) => prev.map((it) => (it.id === res.item.id ? res.item : it)));
      setModalOptionsTarget(null);
      notify(`Opções modais de "${res.item.name}" atualizadas (${uniqueMenus.length} rotina(s)).`);
    } catch (err) {
      setModalOptionsError(err instanceof Error ? err.message : 'Erro ao atualizar opções modais.');
    } finally {
      setSavingModalOptions(false);
    }
  };

  const filteredModalRoutinesByModule = useMemo(() => {
    const q = modalRoutineSearch.trim().toLowerCase();
    return routinesByModule
      .map(([modName, list]) => {
        const filtered = list.filter((r) => {
          if (modalOnlyFilter && !r.targetTypes.includes('modal')) return false;
          if (!q) return true;
          return (
            r.label.toLowerCase().includes(q) ||
            r.module.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q)
          );
        });
        return [modName, filtered] as const;
      })
      .filter(([, list]) => list.length > 0);
  }, [routinesByModule, modalOnlyFilter, modalRoutineSearch]);

  const modalOptionsDialog = modalOptionsTarget ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      onClick={() => !savingModalOptions && setModalOptionsTarget(null)}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[88vh] dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800/70">
          <div>
            <div className="flex items-center gap-2">
              <AppWindow className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Opções Modais · Apresentação e Uso do Formulário
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
              Modelo:{' '}
              <strong className="text-slate-800 dark:text-slate-100">
                {modalOptionsTarget.mode === 'list'
                  ? modalOptionsTarget.item.name
                  : name.trim() || 'Novo Modelo A4'}
              </strong>{' '}
              · Defina em quais modais e telas operacionais este formulário deverá aparecer.
            </p>
          </div>
          <button
            type="button"
            disabled={savingModalOptions}
            onClick={() => setModalOptionsTarget(null)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-white px-5 py-3 flex flex-wrap items-center justify-between gap-2.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2 dark:text-slate-400" />
            <input
              type="text"
              value={modalRoutineSearch}
              onChange={(e) => setModalRoutineSearch(e.target.value)}
              placeholder="Filtrar tela ou módulo..."
              className="w-full rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none dark:text-slate-200">
            <input
              type="checkbox"
              checked={modalOnlyFilter}
              onChange={(e) => setModalOnlyFilter(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 dark:border-slate-600 dark:text-blue-400"
            />
            Somente telas com Modal
          </label>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setDraftModalMenuIds(
                  FORM_CONTEXT_REGISTRY.filter((r) => r.targetTypes.includes('modal')).map(
                    (r) => r.menuId
                  )
                )
              }
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
            >
              Marcar Todas c/ Modal
            </button>
            <button
              type="button"
              onClick={() =>
                setDraftModalMenuIds(FORM_CONTEXT_REGISTRY.map((r) => r.menuId))
              }
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Marcar Todas
            </button>
            <button
              type="button"
              onClick={() => setDraftModalMenuIds([])}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Limpar
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {modalOptionsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
              {modalOptionsError}
            </div>
          )}

          {filteredModalRoutinesByModule.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhuma rotina encontrada para o filtro informado.
            </div>
          ) : (
            filteredModalRoutinesByModule.map(([modName, list]) => (
              <div key={modName} className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                  {modName}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {list.map((r) => {
                    const checked = draftModalMenuIds.includes(r.menuId);
                    return (
                      <label
                        key={r.menuId}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors ${
                          checked
                            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/50'
                            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDraftModalMenuIds((prev) => Array.from(new Set([...prev, r.menuId])));
                            } else {
                              setDraftModalMenuIds((prev) => prev.filter((id) => id !== r.menuId));
                            }
                          }}
                          className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:text-blue-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{r.label}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              {r.targetTypes.includes('modal') && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                                  Modal
                                </span>
                              )}
                              {r.targetTypes.includes('grid') && (
                                <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                                  Grid
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug dark:text-slate-400">
                            {r.description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/70">
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <strong>{draftModalMenuIds.length}</strong> de {FORM_CONTEXT_REGISTRY.length} rotina(s) marcada(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={savingModalOptions}
              onClick={() => setModalOptionsTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={savingModalOptions}
              onClick={() => void handleSaveModalOptions()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {savingModalOptions ? 'Salvando...' : 'Confirmar Opções Modais'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const formatDateTimeBR = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  // =========================================================================
  // MODO EDITOR A4 + BARRA LATERAL RETRÁTIL (VARIÁVEIS & ROTINAS)
  // =========================================================================
  if (viewMode === 'editor') {
    return (
      <div className="space-y-4">
        {/* Top Action Bar */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editingId ? 'Editar Modelo A4' : 'Novo Modelo de Documento A4'}
                </h2>
                <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-blue-700 dark:bg-blue-950/50 dark:border-blue-800/70 dark:text-blue-300">
                  A4 · 210×297mm
                </span>
                {docxTemplate && (
                  <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300">
                    DOCX Embutido
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Atalho rápido: <span className="font-mono">Ctrl+Enter</span> para salvar
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={docxInputRef}
              type="file"
              accept=".docx,.doc"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportDocx(f);
              }}
            />
            <button
              type="button"
              disabled={importingDocx}
              onClick={() => docxInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <FileUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              {importingDocx ? 'Convertendo DOCX...' : 'Importar DOCX'}
            </button>

            <button
              type="button"
              onClick={() => void handleOpenLiveTestPreview()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Testar Preenchimento
            </button>

            <button
              type="button"
              onClick={openModalOptionsFromEditor}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
            >
              <AppWindow className="w-3.5 h-3.5" />
              Opções Modais ({menuIds.length})
            </button>

            <button
              type="button"
              onClick={() => {
                const { nextHeader, nextBody, nextFooter } = readCurrentZoneHtml();
                handlePrintRawOrRendered(name || 'Documento A4', nextHeader, nextBody, nextFooter);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </button>

            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveTemplate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Salvando...' : 'Salvar Modelo'}
            </button>
          </div>
        </div>

        {editorError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            <span>{editorError}</span>
            <button type="button" onClick={() => setEditorError('')} className="text-red-500 hover:text-red-800 dark:hover:text-red-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Metadata Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Nome do Formulário *</label>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400">{name.length}/255</span>
            </div>
            <input
              type="text"
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Contrato de Prestação de Serviços / Folha de Rosto"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição Curta</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Finalidade do modelo para identificação rápida no catálogo e rotinas"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Main Workspace: Rich A4 Sheet (Left) + Collapsible Sidebar (Right) */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* Left: Rich Toolbar + A4 Sheet Canvas */}
          <div className="flex-1 min-w-0 w-full space-y-3">
            {/* Rich Formatting Toolbar */}
            <div className="rounded-xl border border-slate-200 bg-white p-2 flex flex-wrap items-center gap-1 sticky top-2 z-20 shadow-xs dark:border-slate-700 dark:bg-slate-900">
              <span
                className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider mr-1 ${
                  activeZone === 'header'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                    : activeZone === 'footer'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                }`}
              >
                {activeZone === 'header' ? 'Cabeçalho' : activeZone === 'footer' ? 'Rodapé' : 'Corpo'}
              </span>

              <button
                type="button"
                title="Desfazer"
                onClick={() => execEditorCommand('undo')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Refazer"
                onClick={() => execEditorCommand('redo')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              <select
                aria-label="Bloco"
                defaultValue="P"
                onChange={(e) => execEditorCommand('formatBlock', e.target.value)}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
              >
                <option value="P">Parágrafo</option>
                <option value="H1">Título 1</option>
                <option value="H2">Título 2</option>
                <option value="H3">Título 3</option>
              </select>

              <select
                aria-label="Fonte"
                defaultValue="Times New Roman"
                onChange={(e) => execEditorCommand('fontName', e.target.value)}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
              >
                <option value="Times New Roman">Times New Roman</option>
                <option value="Arial">Arial</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
                <option value="Courier New">Courier New</option>
              </select>

              <select
                aria-label="Tamanho"
                defaultValue="3"
                onChange={(e) => execEditorCommand('fontSize', e.target.value)}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
              >
                <option value="1">10px</option>
                <option value="2">13px</option>
                <option value="3">16px</option>
                <option value="4">18px</option>
                <option value="5">24px</option>
                <option value="6">32px</option>
              </select>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              <button
                type="button"
                title="Negrito"
                onClick={() => execEditorCommand('bold')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Itálico"
                onClick={() => execEditorCommand('italic')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Sublinhado"
                onClick={() => execEditorCommand('underline')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Underline className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Tachado"
                onClick={() => execEditorCommand('strikeThrough')}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <Strikethrough className="w-3.5 h-3.5" />
              </button>

              <label title="Cor do texto" className="inline-flex items-center px-1 cursor-pointer">
                <span className="text-[11px] font-bold text-slate-700 mr-0.5 dark:text-slate-200">A</span>
                <input
                  type="color"
                  defaultValue="#0f172a"
                  onChange={(e) => execEditorCommand('foreColor', e.target.value)}
                  className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                />
              </label>

              <label title="Cor de destaque" className="inline-flex items-center px-1 cursor-pointer">
                <span className="text-[10px] font-bold bg-amber-200 text-slate-800 px-1 rounded mr-0.5 dark:text-slate-100">ab</span>
                <input
                  type="color"
                  defaultValue="#fef08a"
                  onChange={(e) => execEditorCommand('hiliteColor', e.target.value)}
                  className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                />
              </label>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              <button type="button" title="Alinhar à esquerda" onClick={() => execEditorCommand('justifyLeft')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Centralizar" onClick={() => execEditorCommand('justifyCenter')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Alinhar à direita" onClick={() => execEditorCommand('justifyRight')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <AlignRight className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Justificar" onClick={() => execEditorCommand('justifyFull')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <AlignJustify className="w-3.5 h-3.5" />
              </button>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              <button type="button" title="Lista com marcadores" onClick={() => execEditorCommand('insertUnorderedList')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <List className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Lista numerada" onClick={() => execEditorCommand('insertOrderedList')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <ListOrdered className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Diminuir recuo" onClick={() => execEditorCommand('outdent')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <Outdent className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Aumentar recuo" onClick={() => execEditorCommand('indent')} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
                <Indent className="w-3.5 h-3.5" />
              </button>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              {/* Table Popover */}
              <div className="relative">
                <button
                  type="button"
                  title="Inserir tabela"
                  onClick={() => {
                    setTablePopoverOpen((v) => !v);
                    setLinkPopoverOpen(false);
                    setImgToolbarOpen(false);
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                >
                  <Table2 className="w-3.5 h-3.5" />
                </button>
                {tablePopoverOpen && (
                  <div className="absolute left-0 top-full mt-1 z-30 w-52 rounded-lg border border-slate-200 bg-white p-3 shadow-lg space-y-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Inserir Tabela</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-slate-600 dark:text-slate-300">
                        Linhas
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={tableRows}
                          onChange={(e) => setTableRows(Number(e.target.value) || 2)}
                          className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 dark:border-slate-700"
                        />
                      </label>
                      <label className="text-[11px] text-slate-600 dark:text-slate-300">
                        Colunas
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={tableCols}
                          onChange={(e) => setTableCols(Number(e.target.value) || 2)}
                          className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 dark:border-slate-700"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setTablePopoverOpen(false)} className="px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Fechar
                      </button>
                      <button type="button" onClick={handleInsertTable} className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                        Inserir
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Link Popover */}
              <div className="relative">
                <button
                  type="button"
                  title="Inserir link"
                  onClick={() => {
                    setLinkPopoverOpen((v) => !v);
                    setTablePopoverOpen(false);
                    setImgToolbarOpen(false);
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                >
                  <Link2 className="w-3.5 h-3.5" />
                </button>
                {linkPopoverOpen && (
                  <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg space-y-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Inserir Link</div>
                    <input
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <input
                      type="text"
                      value={linkText}
                      onChange={(e) => setLinkText(e.target.value)}
                      placeholder="Texto exibido (opcional)"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setLinkPopoverOpen(false)} className="px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Fechar
                      </button>
                      <button type="button" onClick={handleInsertLink} className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                        Inserir
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Upload Image */}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadInlineImage(f);
                  if (imgInputRef.current) imgInputRef.current.value = '';
                }}
              />
              <button
                type="button"
                title="Inserir imagem / logo"
                onClick={() => imgInputRef.current?.click()}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>

              {/* Image Position Menu (imageposition) */}
              <div className="relative">
                <button
                  type="button"
                  title="Posicionamento da imagem selecionada"
                  onClick={() => setImgToolbarOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                    selectedImgEl ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/70' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Posição Img
                  <ChevronDown className="w-3 h-3" />
                </button>
                {imgToolbarOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg space-y-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                    {!selectedImgEl ? (
                      <div className="p-2 text-[11px] text-slate-500 dark:text-slate-400">
                        Clique sobre uma imagem dentro do documento A4 para posicioná-la.
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => applyImagePositionMode('img-behind-text')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Atrás do texto</button>
                        <button type="button" onClick={() => applyImagePositionMode('img-front-text')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Na frente do texto</button>
                        <button type="button" onClick={() => applyImagePositionMode('img-float-left')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Alinhado à esquerda</button>
                        <button type="button" onClick={() => applyImagePositionMode('img-float-right')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Alinhado à direita</button>
                        <button type="button" onClick={() => applyImagePositionMode('img-center')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Centralizado</button>
                        <button type="button" onClick={() => applyImagePositionMode('inline')} className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Em linha com o texto</button>
                        <div className="border-t border-slate-100 pt-1.5 flex items-center justify-between px-1 dark:border-slate-800">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">Mover 5px:</span>
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => nudgeSelectedImage(-5, 0)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft className="w-3 h-3" /></button>
                            <button type="button" onClick={() => nudgeSelectedImage(0, -5)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowUp className="w-3 h-3" /></button>
                            <button type="button" onClick={() => nudgeSelectedImage(0, 5)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowDown className="w-3 h-3" /></button>
                            <button type="button" onClick={() => nudgeSelectedImage(5, 0)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowRight className="w-3 h-3" /></button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <span className="h-4 w-px bg-slate-200 mx-0.5 dark:bg-slate-700" />

              <button
                type="button"
                title="Quebra de página A4"
                onClick={handleInsertPageBreak}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Quebra Pág.</span>
              </button>

              <button
                type="button"
                title="Editar código fonte HTML da zona ativa"
                onClick={() => {
                  const { nextHeader, nextBody, nextFooter } = readCurrentZoneHtml();
                  setCodeModalZone(activeZone);
                  setCodeDraft(
                    activeZone === 'header' ? nextHeader : activeZone === 'footer' ? nextFooter : nextBody
                  );
                  setCodeModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">HTML</span>
              </button>
            </div>

            {/* A4 Sheet Canvas */}
            <div className="rounded-xl border border-slate-200 bg-slate-200/70 p-4 sm:p-6 overflow-x-auto dark:border-slate-700">
              {/* Toggle Optional Header / Footer Controls */}
              <div className="mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 max-w-[210mm]">
                <button
                  type="button"
                  onClick={() => {
                    const next = !showHeader;
                    setShowHeader(next);
                    if (next) {
                      setActiveZone('header');
                      window.requestAnimationFrame(() => {
                        if (headerRef.current) headerRef.current.innerHTML = headerHtml;
                      });
                    } else if (activeZone === 'header') {
                      setActiveZone('body');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800/70 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/60"
                >
                  {showHeader ? <PanelTopClose className="w-3.5 h-3.5" /> : <PanelTopOpen className="w-3.5 h-3.5" />}
                  {showHeader ? 'Ocultar Cabeçalho' : '+ Adicionar Cabeçalho'}
                </button>

                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Folha A4 · Clique na zona desejada antes de inserir variáveis
                </span>

                <button
                  type="button"
                  onClick={() => {
                    const next = !showFooter;
                    setShowFooter(next);
                    if (next) {
                      setActiveZone('footer');
                      window.requestAnimationFrame(() => {
                        if (footerRef.current) footerRef.current.innerHTML = footerHtml;
                      });
                    } else if (activeZone === 'footer') {
                      setActiveZone('body');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-800/70 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
                >
                  {showFooter ? <PanelBottomClose className="w-3.5 h-3.5" /> : <PanelBottomOpen className="w-3.5 h-3.5" />}
                  {showFooter ? 'Ocultar Rodapé' : '+ Adicionar Rodapé'}
                </button>
              </div>

              {/* Physical A4 Page Container */}
              <div
                className="mx-auto bg-white shadow-lg border border-slate-300 flex flex-col justify-between dark:bg-slate-900 dark:border-slate-600"
                style={{
                  width: '210mm',
                  minHeight: '297mm',
                  padding: '12mm 15mm',
                  fontFamily: "'Times New Roman', Times, serif",
                  fontSize: '16px',
                  lineHeight: 1.45,
                }}
              >
                {/* Header Editable Zone */}
                {showHeader && (
                  <div className="mb-4">
                    <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-blue-600 mb-1 dark:text-blue-400">
                      Cabeçalho (repete em todas as páginas)
                    </div>
                    <div
                      ref={headerRef}
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={() => setActiveZone('header')}
                      onBlur={() => handleZoneBlurOrKey('header')}
                      onKeyUp={() => handleZoneBlurOrKey('header')}
                      onMouseUp={() => handleZoneBlurOrKey('header')}
                      onClick={(e) => {
                        if ((e.target as HTMLElement)?.tagName === 'IMG') {
                          setSelectedImgEl(e.target as HTMLImageElement);
                        } else {
                          setSelectedImgEl(null);
                        }
                      }}
                      className={`min-h-[54px] rounded p-2 outline-none border transition-colors ${
                        activeZone === 'header'
                          ? 'border-blue-500 ring-2 ring-blue-100'
                          : 'border-dashed border-slate-300 dark:border-slate-600'
                      }`}
                    />
                  </div>
                )}

                {/* Main Body Editable Zone */}
                <div className="flex-1 flex flex-col">
                  <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-emerald-600 mb-1 dark:text-emerald-400">
                    Corpo do Documento A4
                  </div>
                  <div
                    ref={bodyRef}
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={() => setActiveZone('body')}
                    onBlur={() => handleZoneBlurOrKey('body')}
                    onKeyUp={() => handleZoneBlurOrKey('body')}
                    onMouseUp={() => handleZoneBlurOrKey('body')}
                    onClick={(e) => {
                      if ((e.target as HTMLElement)?.tagName === 'IMG') {
                        setSelectedImgEl(e.target as HTMLImageElement);
                      } else {
                        setSelectedImgEl(null);
                      }
                    }}
                    className={`flex-1 min-h-[210mm] rounded p-3 outline-none border transition-colors relative ${
                      activeZone === 'body'
                        ? 'border-emerald-500 ring-2 ring-emerald-100'
                        : 'border-dashed border-slate-300 dark:border-slate-600'
                    }`}
                  />
                </div>

                {/* Footer Editable Zone */}
                {showFooter && (
                  <div className="mt-4">
                    <div className="text-[10px] font-sans font-bold uppercase tracking-wider text-amber-600 mb-1 dark:text-amber-400">
                      Rodapé (repete em todas as páginas)
                    </div>
                    <div
                      ref={footerRef}
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={() => setActiveZone('footer')}
                      onBlur={() => handleZoneBlurOrKey('footer')}
                      onKeyUp={() => handleZoneBlurOrKey('footer')}
                      onMouseUp={() => handleZoneBlurOrKey('footer')}
                      onClick={(e) => {
                        if ((e.target as HTMLElement)?.tagName === 'IMG') {
                          setSelectedImgEl(e.target as HTMLImageElement);
                        } else {
                          setSelectedImgEl(null);
                        }
                      }}
                      className={`min-h-[48px] rounded p-2 outline-none border transition-colors text-[12px] ${
                        activeZone === 'footer'
                          ? 'border-amber-500 ring-2 ring-amber-100'
                          : 'border-dashed border-slate-300 dark:border-slate-600'
                      }`}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Collapsible Sidebar (Variables + Linked Routines) */}
          {sidebarOpen ? (
            <aside className="w-full lg:w-80 xl:w-96 shrink-0 rounded-xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-2 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSidebarTab('variables')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      sidebarTab === 'variables'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300'
                    }`}
                  >
                    <Variable className="w-3.5 h-3.5" />
                    Variáveis ({TOTAL_FORM_VARIABLES})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarTab('routines')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      sidebarTab === 'routines'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Rotinas ({menuIds.length}/{FORM_CONTEXT_REGISTRY.length})
                  </button>
                </div>
                <button
                  type="button"
                  title="Recolher painel lateral"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {sidebarTab === 'variables' && (
                <div className="p-3 space-y-2.5 max-h-[75vh] overflow-y-auto">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 dark:text-slate-400" />
                    <input
                      type="text"
                      value={varSearch}
                      onChange={(e) => setVarSearch(e.target.value)}
                      placeholder="Buscar variável (ex: placa, contrato, cpf)"
                      className="w-full rounded-lg border border-slate-200 pl-8 pr-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Clique em qualquer variável abaixo para inserir na posição do cursor.
                  </p>

                  <div className="space-y-1.5">
                    {filteredVariableCategories.map((cat) => {
                      const isExpanded = varSearch.trim() ? true : Boolean(expandedCats[cat.id]);
                      const isRoutineSuggested =
                        activeRoutinePrefixes === null || activeRoutinePrefixes.has(cat.prefix);

                      return (
                        <div key={cat.id} className="rounded-lg border border-slate-200 overflow-hidden dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCats((prev) => ({ ...prev, [cat.id]: !isExpanded }))
                            }
                            className="w-full flex items-center justify-between px-2.5 py-2 bg-slate-50 hover:bg-slate-100 text-left dark:bg-slate-800/70 dark:hover:bg-slate-800"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isRoutineSuggested ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                              />
                              <span className="text-xs font-semibold text-slate-800 truncate dark:text-slate-100">
                                {cat.category}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                {cat.items.length}
                              </span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 text-slate-500 transition-transform dark:text-slate-400 ${
                                  isExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                              {cat.items.map((item) => (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => handleInsertVariable(item.token)}
                                  className="w-full px-2.5 py-1.5 text-left hover:bg-blue-50 transition-colors flex items-center justify-between gap-2 dark:hover:bg-blue-950/60"
                                >
                                  <span className="text-[11px] text-slate-700 truncate dark:text-slate-200">{item.label}</span>
                                  <code className="text-[10px] font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded shrink-0 dark:text-blue-300 dark:bg-blue-950/50">
                                    {item.token}
                                  </code>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {sidebarTab === 'routines' && (
                <div className="p-3 space-y-3 max-h-[75vh] overflow-y-auto">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between text-xs dark:bg-slate-800/70 dark:border-slate-700">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Vínculo com Rotinas</span>
                    <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                      {menuIds.length} de {FORM_CONTEXT_REGISTRY.length} selecionadas
                    </span>
                  </div>

                  {routinesByModule.map(([modName, list]) => (
                    <div key={modName} className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 dark:text-slate-400">
                        {modName}
                      </div>
                      <div className="space-y-1">
                        {list.map((r) => {
                          const checked = menuIds.includes(r.menuId);
                          return (
                            <label
                              key={r.menuId}
                              className={`flex items-start gap-2.5 rounded-lg border p-2 cursor-pointer transition-colors ${
                                checked
                                  ? 'border-blue-300 bg-blue-50/50 dark:border-blue-800/70 dark:bg-blue-950/50'
                                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setMenuIds((prev) => Array.from(new Set([...prev, r.menuId])));
                                  } else {
                                    setMenuIds((prev) => prev.filter((id) => id !== r.menuId));
                                  }
                                }}
                                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:text-blue-400"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{r.label}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {r.targetTypes.includes('grid') && (
                                      <span className="rounded bg-slate-200/80 px-1 py-0.5 text-[9px] font-mono font-bold text-slate-700 dark:text-slate-200" title="Disponível no Grid">
                                        G
                                      </span>
                                    )}
                                    {r.targetTypes.includes('modal') && (
                                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-mono font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" title="Disponível no Modal">
                                        M
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug dark:text-slate-400">{r.description}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          ) : (
            <div className="w-11 shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 flex flex-col items-center gap-2 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                title="Expandir painel lateral"
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Variáveis"
                onClick={() => {
                  setSidebarTab('variables');
                  setSidebarOpen(true);
                }}
                className="p-2 rounded-lg hover:bg-blue-50 text-blue-700 flex flex-col items-center gap-0.5 dark:hover:bg-blue-950/60 dark:text-blue-300"
              >
                <Variable className="w-4 h-4" />
                <span className="text-[9px] font-bold">Var</span>
              </button>
              <button
                type="button"
                title="Rotinas"
                onClick={() => {
                  setSidebarTab('routines');
                  setSidebarOpen(true);
                }}
                className="p-2 rounded-lg hover:bg-blue-50 text-blue-700 flex flex-col items-center gap-0.5 dark:hover:bg-blue-950/60 dark:text-blue-300"
              >
                <Layers className="w-4 h-4" />
                <span className="text-[9px] font-bold">Rot</span>
              </button>
            </div>
          )}
        </div>

        {/* Code Source Modal */}
        {codeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
            <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl space-y-3 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5 dark:border-slate-700">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Editar Código Fonte HTML ·{' '}
                  {codeModalZone === 'header' ? 'Cabeçalho' : codeModalZone === 'footer' ? 'Rodapé' : 'Corpo'}
                </h3>
                <button
                  type="button"
                  onClick={() => setCodeModalOpen(false)}
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                rows={16}
                value={codeDraft}
                onChange={(e) => setCodeDraft(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-3 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCodeModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const sanitized = sanitizeTemplateHtml(codeDraft);
                    const el = getZoneRef(codeModalZone);
                    if (el) el.innerHTML = sanitized;
                    if (codeModalZone === 'header') setHeaderHtml(sanitized);
                    else if (codeModalZone === 'footer') setFooterHtml(sanitized);
                    else setBodyHtml(sanitized);
                    setCodeModalOpen(false);
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Aplicar HTML
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live Test & Print Fallback Modal */}
        {previewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
            <div className="w-full max-w-5xl h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{previewTitle}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => previewIframeRef.current?.contentWindow?.print()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Imprimir Agora
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([previewHtmlDoc], { type: 'text/html;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${(name || 'modelo_a4').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
                      a.click();
                      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Baixar HTML A4
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewModalOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {contextData && (
                <div className="border-b border-slate-200 bg-white px-5 py-2.5 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Cliente (Teste)</span>
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {contextData.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.fullName} ({c.cpfCnpj})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Admissão (Teste)</span>
                    <select
                      value={selectedAdmissionId}
                      onChange={(e) => setSelectedAdmissionId(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {contextData.admissions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.contractNumber || a.protocolCode} · {a.bankName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Processo Jurídico (Teste)</span>
                    <select
                      value={selectedProcessId}
                      onChange={(e) => setSelectedProcessId(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {contextData.legalProcesses.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.processNumber} · {p.courtName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="flex-1 bg-slate-200 dark:bg-slate-950 p-3 overflow-hidden">
                {loadingContext ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                    Carregando registros reais para preencher variáveis...
                  </div>
                ) : (
                  <iframe
                    ref={previewIframeRef}
                    title="Pré-visualização A4"
                    srcDoc={applyThemeToHtmlDocument(previewHtmlDoc, theme)}
                    className="w-full h-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {modalOptionsDialog}
      </div>
    );
  }

  // =========================================================================
  // MODO LISTA (CATÁLOGO DE MODELOS A4)
  // =========================================================================
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar modelo por nome ou descrição..."
            className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:text-slate-100 dark:bg-slate-950"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-slate-500 tabular-nums dark:text-slate-400">
            {total} modelo(s) A4
          </span>
          <button
            type="button"
            disabled={!selectedTemplate}
            onClick={() => {
              if (selectedTemplate) openModalOptionsForItem(selectedTemplate);
            }}
            title={
              selectedTemplate
                ? `Configurar modais de exibição para "${selectedTemplate.name}"`
                : 'Selecione um formulário na lista abaixo'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
          >
            <AppWindow className="w-4 h-4" />
            Opções Modais
            {selectedTemplate && (
              <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-mono text-white">
                {Array.isArray(selectedTemplate.menuIds) ? selectedTemplate.menuIds.length : 0}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={openNewEditor}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Novo Formulário
          </button>
        </div>
      </div>

      {selectedTemplate && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs dark:border-blue-800/70 dark:bg-blue-950/50">
          <span className="text-slate-700 truncate dark:text-slate-200">
            Formulário selecionado: <strong className="text-slate-900 dark:text-slate-100">{selectedTemplate.name}</strong>
          </span>
          <span className="text-[11px] font-mono text-blue-700 dark:text-blue-300">
            Apresentado em {(selectedTemplate.menuIds || []).length} rotina(s)/modal(ais)
          </span>
        </div>
      )}

      {listError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          {listError}
        </div>
      )}

      {/* List Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {loading && items.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Carregando modelos de documentos A4...
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Nenhum modelo A4 encontrado
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Crie um novo formulário ou importe um documento Word (.docx).
            </p>
            <button
              type="button"
              onClick={openNewEditor}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              Criar Primeiro Modelo
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[760px] text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                    <th className="px-4 py-3">Nome do Formulário</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3">Rotinas Vinculadas</th>
                    <th className="px-4 py-3">Última Atualização</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((tpl) => {
                    const linked = Array.isArray(tpl.menuIds) ? tpl.menuIds : [];
                    const isSelected = selectedTemplateId === tpl.id;
                    return (
                      <tr
                        key={tpl.id}
                        onClick={() => setSelectedTemplateId(tpl.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/70 dark:bg-blue-950/50' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800'
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="selected_form_template"
                              checked={isSelected}
                              onChange={() => setSelectedTemplateId(tpl.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                            />
                            <span>{tpl.name}</span>
                            {tpl.docxTemplate && (
                              <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 dark:bg-blue-950/50 dark:border-blue-800/70 dark:text-blue-300">
                                DOCX
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-xs truncate dark:text-slate-300">
                          {tpl.description || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {linked.length === 0 ? (
                              <span className="text-slate-400 dark:text-slate-400">Sem vínculo</span>
                            ) : (
                              <>
                                {linked.slice(0, 3).map((mid) => {
                                  const rot = FORM_CONTEXT_REGISTRY.find((r) => r.menuId === mid);
                                  return (
                                    <span
                                      key={mid}
                                      className="inline-flex items-center gap-1 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                                    >
                                      {rot?.label || mid}
                                    </span>
                                  );
                                })}
                                {linked.length > 3 && (
                                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                    +{linked.length - 3}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {formatDateTimeBR(tpl.updatedAt)}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openModalOptionsForItem(tpl)}
                              title="Opções Modais de Apresentação"
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                            >
                              <AppWindow className="w-3.5 h-3.5" />
                              Modais
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditEditor(tpl)}
                              title="Editar"
                              className="rounded-lg p-1.5 text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-950/60"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handlePrintRawOrRendered(
                                  tpl.name,
                                  tpl.header || '',
                                  tpl.content || '',
                                  tpl.footer || ''
                                )
                              }
                              title="Imprimir"
                              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDuplicate(tpl)}
                              title="Duplicar"
                              className="rounded-lg p-1.5 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-300 dark:hover:bg-emerald-950/60"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(tpl)}
                              title="Excluir"
                              className="rounded-lg p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
              {items.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`p-4 space-y-2 ${selectedTemplateId === tpl.id ? 'bg-blue-50/60 dark:bg-blue-950/50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{tpl.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{tpl.description || '—'}</div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400">
                      {formatDateTimeBR(tpl.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openModalOptionsForItem(tpl)}
                      className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
                    >
                      Opções Modais
                    </button>
                    <button type="button" onClick={() => openEditEditor(tpl)} className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                      Editar
                    </button>
                    <button type="button" onClick={() => void handleDuplicate(tpl)} className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                      Duplicar
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(tpl)} className="rounded border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:border-red-800/70 dark:text-red-300">
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Fallback Print Preview Modal (from list mode) */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-5xl h-[90vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{previewTitle}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => previewIframeRef.current?.contentWindow?.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir Agora
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([previewHtmlDoc], { type: 'text/html;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${(previewTitle || 'modelo_a4').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
                    a.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Baixar HTML A4
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-200 dark:bg-slate-950 p-3">
              <iframe
                ref={previewIframeRef}
                title="Impressão A4"
                srcDoc={applyThemeToHtmlDocument(previewHtmlDoc, theme)}
                className="w-full h-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
        </div>
      )}

      {modalOptionsDialog}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Excluir Modelo A4"
        message={
          deleteTarget
            ? `Deseja realmente excluir o modelo "${deleteTarget.name}"? Ele deixará de aparecer nas rotinas vinculadas.`
            : ''
        }
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
