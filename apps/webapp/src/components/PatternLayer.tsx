import { useEffect, useState } from 'react';
import { patternBackground, resolveTextColor, type PatternConfig } from '@church/shared';

const dataUrlCache = new Map<string, string>();

/** The logo as a data: URL — an SVG background can't load other URLs itself. */
export function useDataUrl(url: string | null | undefined): string | null {
  const [, setLoaded] = useState(0);
  const cached = url ? (dataUrlCache.get(url) ?? null) : null;
  useEffect(() => {
    if (!url || dataUrlCache.has(url)) return;
    let alive = true;
    void fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          }),
      )
      .then((d) => {
        dataUrlCache.set(url, d);
        if (alive) setLoaded((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return cached;
}

/**
 * A ministry's icon repeated over its colours, plus an optional darken/lighten veil.
 * The layer is larger than its parent and rotated, so a tilted pattern still covers
 * the corners. Parent: relative + overflow-hidden.
 */
export function PatternLayer({
  pattern,
  logoUrl,
}: {
  pattern: PatternConfig | null | undefined;
  logoUrl?: string | null;
}) {
  const logoData = useDataUrl(pattern?.kind === 'logo' ? logoUrl : null);
  if (!pattern) return null;
  const bg = patternBackground(pattern, logoData);
  const shade = pattern.shade ?? 0;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bg && (
        <span
          className="absolute left-1/2 top-1/2"
          style={{
            width: '260%',
            height: '260%',
            transform: `translate(-50%, -50%) rotate(${pattern.angle}deg)`,
            backgroundImage: bg.image,
            backgroundSize: bg.size,
            backgroundRepeat: 'repeat',
            backgroundPosition: 'center',
            opacity: pattern.opacity,
          }}
        />
      )}
      {shade !== 0 && (
        <span
          className="absolute inset-0"
          style={{ background: shade < 0 ? `rgba(0,0,0,${-shade})` : `rgba(255,255,255,${shade})` }}
        />
      )}
    </span>
  );
}

/**
 * Style for text on a ministry's coloured block: the chosen colour, with a soft shadow
 * when a pattern sits behind it.
 */
export function onBrandStyle(textColor: string | null | undefined, patterned: boolean) {
  const color = resolveTextColor(textColor);
  const darkText = textColor === 'dark' || (textColor?.startsWith('#') && isLight(color));
  return {
    style: {
      color,
      '--on-brand': color,
      textShadow: patterned
        ? darkText
          ? '0 1px 2px rgba(255,255,255,0.55)'
          : '0 1px 3px rgba(0,0,0,0.45)'
        : undefined,
    } as React.CSSProperties,
    className: 'on-brand',
  };
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
