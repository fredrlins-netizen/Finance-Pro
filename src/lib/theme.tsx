import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'fp_theme_mode';
const listeners = new Set<(theme: ThemeMode) => void>();

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#020617' : '#0F172A');
  }
}

export function setStoredTheme(theme: ThemeMode): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // ignore storage errors
  }
  applyThemeToDom(theme);
  listeners.forEach((fn) => fn(theme));
}

export function subscribeTheme(fn: (theme: ThemeMode) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (next: ThemeMode) => void;
  toggleTheme: () => void;
  sidebarCollapsed: boolean;
  hasOpenDossierDoc: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  acquireDocumentFocus: () => () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {},
  sidebarCollapsed: false,
  hasOpenDossierDoc: false,
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
  acquireDocumentFocus: () => () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const initial = getStoredTheme();
    applyThemeToDom(initial);
    return initial;
  });
  const [manualSidebarCollapsed, setManualSidebarCollapsed] = useState(false);
  const [openDocumentCount, setOpenDocumentCount] = useState(0);

  useEffect(() => {
    applyThemeToDom(theme);
    return subscribeTheme((next) => setThemeState(next));
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setStoredTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = getStoredTheme() === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setThemeState(next);
  }, []);

  const toggleSidebar = useCallback(() => {
    setManualSidebarCollapsed((prev) => !prev);
  }, []);

  const acquireDocumentFocus = useCallback(() => {
    setOpenDocumentCount((c) => c + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setOpenDocumentCount((c) => Math.max(0, c - 1));
    };
  }, []);

  const hasOpenDossierDoc = openDocumentCount > 0;
  const sidebarCollapsed = manualSidebarCollapsed || hasOpenDossierDoc;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        setTheme,
        toggleTheme,
        sidebarCollapsed,
        hasOpenDossierDoc,
        setSidebarCollapsed: setManualSidebarCollapsed,
        toggleSidebar,
        acquireDocumentFocus,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Colapsa automaticamente o menu lateral enquanto um documento do dossiê estiver aberto,
 * liberando toda a área livre da tela para o documento e restaurando ao fechar.
 */
export function useAutoCollapseSidebar(active: boolean): void {
  const { acquireDocumentFocus } = useTheme();
  useEffect(() => {
    if (!active) return;
    return acquireDocumentFocus();
  }, [active, acquireDocumentFocus]);
}

/**
 * Injeta folha de estilo adaptada ao tema selecionado (dark / white) em HTMLs de documentos A4 / Dossiê,
 * garantindo leitura em tela na mesma cor selecionada no sistema e mantendo papel branco ao imprimir (@media print).
 */
export function applyThemeToHtmlDocument(html: string, theme: ThemeMode): string {
  if (!html) return html;
  const cleaned = html.replace(/<style data-fp-doc-theme="true">[\s\S]*?<\/style>/gi, '');
  if (theme !== 'dark') {
    const lightMeta = '<style data-fp-doc-theme="true">html,body{color-scheme:light;}</style>';
    return /<\/head>/i.test(cleaned)
      ? cleaned.replace(/<\/head>/i, `${lightMeta}</head>`)
      : `${lightMeta}${cleaned}`;
  }

  const darkCss = `<style data-fp-doc-theme="true">
    @media screen {
      html, body {
        background: #020617 !important;
        color: #e2e8f0 !important;
        color-scheme: dark !important;
      }
      .sheet, .page, .doc-page, article, main {
        background: #0f172a !important;
        color: #f1f5f9 !important;
        border-color: #334155 !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55) !important;
      }
      .sheet *, .page *, .doc-page * {
        border-color: #334155;
      }
      h1, h2, h3, h4, h5, h6, strong, b, th {
        color: #f8fafc !important;
      }
      p, td, li, span, div, label {
        color: inherit;
      }
      table {
        border-color: #334155 !important;
      }
      th, tr[style*="background"], td[style*="background"] {
        background-color: #1e293b !important;
        color: #f1f5f9 !important;
      }
      a { color: #60a5fa !important; }
    }
    @media print {
      html, body, .sheet, .page, .doc-page {
        background: #ffffff !important;
        color: #0f172a !important;
        color-scheme: light !important;
      }
      h1, h2, h3, h4, h5, h6, strong, b, th, p, td, li {
        color: #0f172a !important;
      }
    }
  </style>`;

  if (/<\/head>/i.test(cleaned)) {
    return cleaned.replace(/<\/head>/i, `${darkCss}</head>`);
  }
  return `${darkCss}${cleaned}`;
}
