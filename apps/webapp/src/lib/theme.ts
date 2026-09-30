import { resolveBrand } from '@church/shared';
import { webApp } from './telegram';

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Mixes `b` into `a` by `t` (0–1); returns #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Applies a theme (church or environment) to CSS variables and Telegram's own header. */
export function applyBrand(value: string | null | undefined): void {
  const brand = resolveBrand(value);
  const root = document.documentElement.style;
  root.setProperty('--brand', brand.light);
  root.setProperty('--brand-dark', brand.dark);
  root.setProperty('--brand-partner', brand.partner);

  const tg = webApp();
  const base = tg?.themeParams?.secondary_bg_color;
  if (!tg || !base) return;
  const dark = tg.colorScheme === 'dark';
  // Match the top of the glow so Telegram's header blends into the page.
  const header = mixHex(base, brand.light, dark ? 0.3 : 0.2);
  try {
    tg.setHeaderColor(header as `#${string}`);
    tg.setBackgroundColor(base as `#${string}`);
  } catch {
    // Older Telegram clients only accept theme keys; the default still looks fine.
  }
}
