import type { CSSProperties } from 'react';
import {
  DEFAULT_PATTERN,
  resolveBrand,
  type AppBackground,
  type BackdropConfig,
  type PatternConfig,
} from '@church/shared';
import { PatternLayer } from './PatternLayer';

/** What a "theme" background is made of: the ministry's (or church's) own look. */
export interface BackdropLook {
  brandColor: string | null;
  pattern: PatternConfig | null;
  logoUrl: string | null;
  backdrop?: BackdropConfig | null;
  backdropUrl?: string | null;
}

/** #rrggbb plus an alpha 0..1. */
const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** The colours a background tints with. */
export function backgroundColors(bg: AppBackground, look: BackdropLook): string[] {
  if (bg.source === 'color' && bg.colors?.length) return bg.colors;
  const theme = resolveBrand(look.brandColor ?? 'blue');
  return [theme.light, theme.partner];
}

/** The pattern a "pattern" texture draws: the look's own, else its logo, else a cross. */
const patternOf = (look: BackdropLook): PatternConfig =>
  look.pattern ??
  (look.logoUrl
    ? { ...DEFAULT_PATTERN, kind: 'logo', value: '', size: 56, opacity: 0.2 }
    : DEFAULT_PATTERN);

/**
 * The app's background behind the cards: a tint in the ministry's (or chosen) colours,
 * optionally its photo and pattern, and a slow movement. Fixed behind everything; with
 * no setting the default soft background shows.
 */
export function AppBackdrop({
  bg,
  look,
  preview,
}: {
  bg: AppBackground | null | undefined;
  look: BackdropLook;
  /** Drawn inside a box (the settings preview) instead of behind the whole app. */
  preview?: boolean;
}) {
  if (!bg || bg.source === 'none') return null;
  const colors = backgroundColors(bg, look);
  const s = bg.strength;
  const [c1, c2 = colors[0]!, c3] = colors;
  const fill: CSSProperties = {
    backgroundImage: `linear-gradient(170deg, ${alpha(c1!, s)} 0%, ${alpha(c2, s * 0.75)} ${
      c3 ? '45%' : '60%'
    }, ${c3 ? alpha(c3, s * 0.6) : alpha(c2, s * 0.25)} 100%)`,
  };
  const photo = bg.source === 'theme' && look.backdropUrl ? look.backdropUrl : null;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none overflow-hidden ${preview ? 'absolute inset-0' : 'fixed inset-0 -z-[1]'}`}
    >
      {photo && (
        <img
          src={photo}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: Math.min(0.9, s * 0.8), filter: 'blur(2px) saturate(1.1)' }}
        />
      )}
      <div className={`absolute -inset-[20%] app-bg-${bg.animation}`} style={fill} />
      {bg.animation === 'aurora' && (
        <>
          <span
            className="app-bg-blob absolute h-[60vmax] w-[60vmax] rounded-full blur-3xl"
            style={{ background: alpha(c1!, s * 0.9), left: '-15%', top: '-10%' }}
          />
          <span
            className="app-bg-blob app-bg-blob-2 absolute h-[55vmax] w-[55vmax] rounded-full blur-3xl"
            style={{ background: alpha(c2, s * 0.8), right: '-20%', bottom: '-15%' }}
          />
        </>
      )}
      {bg.texture === 'pattern' ? (
        <span className="absolute inset-0" style={{ opacity: 0.15 + s * 0.45 }}>
          <PatternLayer pattern={patternOf(look)} logoUrl={look.logoUrl} />
        </span>
      ) : (
        bg.texture !== 'none' && (
          <span
            className={`absolute inset-0 app-tex app-tex-${bg.texture}`}
            style={{ color: c1, opacity: 0.16 + s * 0.2 }}
          />
        )
      )}
    </div>
  );
}
