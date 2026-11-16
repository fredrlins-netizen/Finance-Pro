import type { PortalBrandingConfig } from '../types.ts';

let cachedBranding: PortalBrandingConfig | null = null;
let cachedNeedsDarkBackdrop = false;
let inspectedLogoUrl = '';
let inflightPromise: Promise<PortalBrandingConfig | null> | null = null;

type BrandingListener = (branding: PortalBrandingConfig | null, darkBackdrop: boolean) => void;
const listeners = new Set<BrandingListener>();

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
