import type { PortalBrandingConfig } from '../types.ts';
import { getStoredTheme, subscribeTheme, type ThemeMode } from './theme.tsx';

export const DEFAULT_PORTAL_BRANDING_CLIENT: PortalBrandingConfig = {
  companyName: 'FinancePro Assessoria',
  primaryColor: '#0F172A',
  textColor: '#FFFFFF',
  logoDataUrl: '',
  marketingHeadline: 'Governança Bancária, Revisional & Recuperação de Ativos',
  marketingDescription:
    'Plataforma corporativa integrada para negociação de passivos veiculares e bancários, auditoria documental, acompanhamento processual e régua inteligente.',
  loginLeftBg: '#0F172A',
  loginLeftText: '#F8FAFC',
  loginBackgroundImageUrl: '',
  loginRightBg: '#FFFFFF',
  loginRightText: '#0F172A',
  sidebarBg: '#FFFFFF',
  sidebarText: '#334155',
  headerBg: '#FFFFFF',
  headerText: '#0F172A',
  canvasBg: '#F8FAFC',
  canvasBackgroundImageUrl: '',
};

export function normalizeHexColor(raw: string | undefined | null, fallback: string): string {
  const s = String(raw || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(s)) return s;
  if (/^#[0-9A-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (/^[0-9A-F]{6}$/.test(s)) return `#${s}`;
  return fallback.toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const norm = normalizeHexColor(hex, '');
  if (!norm) return null;
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function hexToRgba(hex: string, alpha: number, fallback: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function adjustHexBrightness(hex: string, delta: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(rgb.r + delta);
  const g = clamp(rgb.g + delta);
  const b = clamp(rgb.b + delta);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function isColorCustomized(val: string | undefined, lightDefault: string): boolean {
  if (!val) return false;
  const norm = normalizeHexColor(val, lightDefault);
  return norm !== lightDefault.toUpperCase();
}

function resolveColorToken(
  val: string | undefined,
  lightDefault: string,
  darkDefault: string,
  themeMode: ThemeMode
): string {
  const normalized = normalizeHexColor(val, lightDefault);
  if (isColorCustomized(normalized, lightDefault)) {
    return normalized;
  }
  return themeMode === 'dark' ? darkDefault : lightDefault;
}

export function applyPortalBrandingThemeToDom(
  branding: PortalBrandingConfig | null,
  themeOverride?: ThemeMode
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const themeMode = themeOverride ?? getStoredTheme();
  const isDark = themeMode === 'dark';
  const cfg = branding || DEFAULT_PORTAL_BRANDING_CLIENT;

  const primary = resolveColorToken(cfg.primaryColor, '#0F172A', '#059669', themeMode);
  const primaryHover = isDark && !isColorCustomized(cfg.primaryColor, '#0F172A')
    ? '#10B981'
    : adjustHexBrightness(primary, isDark ? 16 : -14);
  const primaryText = resolveColorToken(cfg.textColor, '#FFFFFF', '#FFFFFF', themeMode);

  const loginLeftBg = resolveColorToken(cfg.loginLeftBg, '#0F172A', '#020617', themeMode);
  const loginLeftText = resolveColorToken(cfg.loginLeftText, '#F8FAFC', '#F8FAFC', themeMode);
  const loginRightBg = resolveColorToken(cfg.loginRightBg, '#FFFFFF', '#0F172A', themeMode);
  const loginRightText = resolveColorToken(cfg.loginRightText, '#0F172A', '#F1F5F9', themeMode);

  const sidebarBg = resolveColorToken(cfg.sidebarBg, '#FFFFFF', '#0F172A', themeMode);
  const sidebarText = resolveColorToken(cfg.sidebarText, '#334155', '#E2E8F0', themeMode);
  const headerBg = resolveColorToken(cfg.headerBg, '#FFFFFF', '#0F172A', themeMode);
  const headerText = resolveColorToken(cfg.headerText, '#0F172A', '#F1F5F9', themeMode);
  const canvasBg = resolveColorToken(cfg.canvasBg, '#F8FAFC', '#020617', themeMode);

  root.style.setProperty('--fp-primary', primary);
  root.style.setProperty('--fp-primary-hover', primaryHover);
  root.style.setProperty('--fp-primary-text', primaryText);

  root.style.setProperty('--fp-login-left-bg', loginLeftBg);
  root.style.setProperty('--fp-login-left-text', loginLeftText);
  root.style.setProperty('--fp-login-left-muted', hexToRgba(loginLeftText, 0.78, '#CBD5E1'));
  root.style.setProperty('--fp-login-left-border', hexToRgba(loginLeftText, 0.16, '#1E293B'));

  root.style.setProperty('--fp-login-right-bg', loginRightBg);
  root.style.setProperty('--fp-login-right-text', loginRightText);
  root.style.setProperty('--fp-login-right-muted', hexToRgba(loginRightText, 0.72, '#64748B'));

  root.style.setProperty('--fp-sidebar-bg', sidebarBg);
  root.style.setProperty('--fp-sidebar-text', sidebarText);
  root.style.setProperty('--fp-sidebar-muted', hexToRgba(sidebarText, 0.65, '#94A3B8'));
  root.style.setProperty('--fp-sidebar-hover', hexToRgba(sidebarText, 0.09, 'rgba(148,163,184,0.12)'));
  root.style.setProperty('--fp-sidebar-border', hexToRgba(sidebarText, 0.16, '#E2E8F0'));

  root.style.setProperty('--fp-header-bg', headerBg);
  root.style.setProperty('--fp-header-text', headerText);
  root.style.setProperty('--fp-header-muted', hexToRgba(headerText, 0.68, '#64748B'));
  root.style.setProperty('--fp-header-border', hexToRgba(headerText, 0.14, '#E2E8F0'));

  root.style.setProperty('--fp-canvas-bg', canvasBg);
}

let cachedBranding: PortalBrandingConfig | null = null;
let cachedNeedsDarkBackdrop = false;
let inspectedLogoUrl = '';
let inflightPromise: Promise<PortalBrandingConfig | null> | null = null;
let themeSubscribed = false;

type BrandingListener = (branding: PortalBrandingConfig | null, darkBackdrop: boolean) => void;
const listeners = new Set<BrandingListener>();

if (typeof window !== 'undefined' && !themeSubscribed) {
  themeSubscribed = true;
  applyPortalBrandingThemeToDom(null);
  subscribeTheme((nextTheme) => {
    applyPortalBrandingThemeToDom(cachedBranding, nextTheme);
  });
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(cachedBranding, cachedNeedsDarkBackdrop);
    } catch {
      // ignore listener errors
    }
  }
}

function inspectLogoContrast(logoDataUrl: string) {
  const trimmed = String(logoDataUrl || '').trim();
  if (!trimmed) {
    inspectedLogoUrl = '';
    cachedNeedsDarkBackdrop = false;
    return;
  }
  if (trimmed === inspectedLogoUrl) return;
  inspectedLogoUrl = trimmed;

  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    cachedNeedsDarkBackdrop = false;
    return;
  }

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let opaqueCount = 0;
        let transparentCount = 0;
        let weightedLuma = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 28) {
            transparentCount += 1;
            continue;
          }
          opaqueCount += 1;
          // Perceptual relative luminance (0..255)
          weightedLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }

        if (opaqueCount === 0) {
          cachedNeedsDarkBackdrop = false;
        } else {
          const avgLuma = weightedLuma / opaqueCount;
          const hasTransparentBg = transparentCount > size * size * 0.08;
          // Bright / gold / white-highlight transparent PNG logos need dark framing on light surfaces
          cachedNeedsDarkBackdrop = hasTransparentBg && avgLuma >= 145;
        }
        notifyListeners();
      } catch {
        // Cross-origin tainted canvas fallback
        cachedNeedsDarkBackdrop = false;
      }
    };
    img.onerror = () => {
      cachedNeedsDarkBackdrop = false;
    };
    img.src = trimmed;
  } catch {
    cachedNeedsDarkBackdrop = false;
  }
}

export function getCachedPortalBranding(): PortalBrandingConfig | null {
  return cachedBranding;
}

export function getCachedLogoNeedsDarkBackdrop(): boolean {
  return cachedNeedsDarkBackdrop;
}

export function setCachedPortalBranding(branding: PortalBrandingConfig | null): void {
  cachedBranding = branding;
  applyPortalBrandingThemeToDom(branding);
  if (branding?.logoDataUrl) {
    inspectLogoContrast(branding.logoDataUrl);
  } else {
    inspectedLogoUrl = '';
    cachedNeedsDarkBackdrop = false;
  }
  notifyListeners();
}

export async function ensurePortalBrandingLoaded(
  forceRefresh = false
): Promise<PortalBrandingConfig | null> {
  if (cachedBranding && !forceRefresh) {
    applyPortalBrandingThemeToDom(cachedBranding);
    if (cachedBranding.logoDataUrl) inspectLogoContrast(cachedBranding.logoDataUrl);
    return cachedBranding;
  }
  if (inflightPromise && !forceRefresh) {
    return inflightPromise;
  }
  if (typeof fetch === 'undefined') {
    return cachedBranding;
  }

  inflightPromise = fetch('/api/public/portal-branding')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { branding?: PortalBrandingConfig } | null) => {
      if (d?.branding) {
        setCachedPortalBranding(d.branding);
        return d.branding;
      }
      return cachedBranding;
    })
    .catch(() => cachedBranding)
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

export function subscribePortalBranding(listener: BrandingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
