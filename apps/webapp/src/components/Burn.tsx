import type { CSSProperties, ReactNode } from 'react';
import type { EventSummary, PostDesign } from '@church/shared';
import { isLiveWindow, useNowSecond } from '../lib/live';
import { useT } from '../lib/i18n';

export const BURN_STYLES = [
  'flame',
  'glow',
  'pulse',
  'orbit',
  'neon',
  'sparks',
  'electric',
  'shimmer',
  'off',
] as const;
export type BurnStyle = Exclude<(typeof BURN_STYLES)[number], 'off'>;
/** Styles drawn as a coloured ring with a glow (any colour, gradient or rainbow). */
const RING_STYLES: readonly BurnStyle[] = ['neon', 'sparks', 'electric', 'shimmer'];
export const BURN_COLORS = ['#ff7a18', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

/** How the event's outline burns now, or null: it isn't near, is over, cancelled or switched off. */
export function burnOf(
  e: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status' | 'design'>,
  now = Date.now(),
): { style: BurnStyle; color: string } | null {
  const d: Partial<PostDesign> = e.design ?? {};
  const style = d.burnStyle ?? 'flame';
  if (style === 'off' || e.status === 'cancelled') return null;
  const left = Date.parse(e.startsAt) - now;
  // The outline keeps burning while the event is live.
  if (left <= 0 ? !isLiveWindow(e.startsAt, e.endsAt, now) : left >= (d.burnDays ?? 3) * 864e5)
    return null;
  return { style, color: d.burnColor ?? '#ff7a18' };
}

/** Wraps an event's card: its outline burns when the event is near. */
export function BurnFrame({
  e,
  radius = 16,
  className = '',
  children,
}: {
  e: Pick<EventSummary, 'startsAt' | 'endsAt' | 'status' | 'design'>;
  /** Corner radius of what it wraps, so the fire follows the shape. */
  radius?: number | string;
  className?: string;
  children: ReactNode;
}) {
  useNowSecond();
  const b = burnOf(e);
  if (!b) return <div className={className}>{children}</div>;
  const paint = burnPaint(b.color, b.style);
  return (
    <div
      className={`burn burn-${b.style} ${paint.className} ${className}`}
      style={{ ...paint.style, borderRadius: radius } as CSSProperties}
    >
      {children}
      <BurnFx style={b.style} />
    </div>
  );
}

/** Where the sparks fly off and the lightning crackles along the outline (% across). */
const SPARKS = [8, 19, 31, 44, 57, 68, 79, 91, 25, 63];

/**
 * What some outline styles add on top of the ring: sparks flying up off the edges,
 * lightning arcs crackling along it, or a glint running round it. Nothing for the rest.
 */
export function BurnFx({ style }: { style: string }) {
  if (style === 'sparks')
    return (
      <span aria-hidden="true" className="burn-fx">
        {SPARKS.map((x, i) => (
          <i
            key={i}
            className="spark"
            style={{
              left: `${x}%`,
              top: i % 3 === 2 ? '100%' : '0',
              animationDelay: `${-i * 0.37}s`,
            }}
          />
        ))}
      </span>
    );
  if (style === 'electric')
    return (
      <span aria-hidden="true" className="burn-fx">
        <i className="arc a0" />
        <i className="arc a1" />
        <i className="arc a2" />
      </span>
    );
  if (style === 'shimmer')
    return (
      <span aria-hidden="true" className="burn-fx">
        <span className="glint-ring">
          <i />
        </span>
      </span>
    );
  return null;
}

const RAINBOW =
  'conic-gradient(from 0deg, #ff3b3b, #ffb02e, #ffe14d, #3ddc84, #2ec5ff, #7a5cff, #ff4fd8, #ff3b3b)';

/** Parses "grad:#a,#b" into its two colours. */
export const burnGradient = (c: string): [string, string] | null => {
  const m = /^grad:(#[0-9a-f]{6}),(#[0-9a-f]{6})$/i.exec(c);
  return m ? [m[1]!, m[2]!] : null;
};

/**
 * How a burn colour is drawn: one colour goes into the glow; rainbow and two-colour
 * gradients become a ring in those colours with a glow of the same (rainbow turns round).
 */
export function burnPaint(
  color: string,
  style?: string,
): { className: string; style: CSSProperties } {
  const grad = burnGradient(color);
  const ring = RING_STYLES.includes(style as BurnStyle);
  if (color === 'rainbow')
    return {
      className: 'burn-ring burn-rainbow',
      style: {
        '--burn': '#ff4d4d',
        '--burn-c1': '#ff3b3b',
        '--burn-c2': '#2ec5ff',
        '--burn-grad': RAINBOW,
      } as CSSProperties,
    };
  if (grad)
    return {
      className: 'burn-ring',
      style: {
        '--burn': grad[0],
        '--burn-c1': grad[0],
        '--burn-c2': grad[1],
        '--burn-grad': `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
      } as CSSProperties,
    };
  return {
    className: ring ? 'burn-ring' : '',
    style: {
      '--burn': color,
      '--burn-c1': color,
      '--burn-c2': `color-mix(in srgb, ${color} 60%, #fff)`,
      '--burn-grad': `linear-gradient(${color}, ${color})`,
    } as CSSProperties,
  };
}

/** The fire's colour: ready colours, any colour, a gradient of two, or rainbow. */
export function BurnColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const t = useT();
  const grad = burnGradient(value);
  const ring = (on: boolean) =>
    `h-8 w-8 rounded-full ring-1 ring-black/10 transition active:scale-90 ${
      on ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
    }`;
  const own = value.startsWith('#') && !BURN_COLORS.includes(value);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {BURN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onChange(c)}
            className={ring(value === c)}
            style={{ background: c }}
          />
        ))}
        {/* Any colour. */}
        <label
          className={`relative cursor-pointer overflow-hidden ${ring(own)}`}
          style={{
            background: own
              ? value
              : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
          }}
          aria-label={t.events.burnAnyColor}
        >
          <input
            type="color"
            value={own ? value : '#ff7a18'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange('rainbow')}
          className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold text-white shadow-sm transition active:scale-95 ${
            value === 'rainbow' ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
          }`}
          style={{
            background: 'linear-gradient(90deg,#ff3b3b,#ffb02e,#3ddc84,#2ec5ff,#7a5cff,#ff4fd8)',
          }}
        >
          🌈 {t.events.burnRainbow}
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(grad ? value : `grad:${value.startsWith('#') ? value : '#ff7a18'},#a855f7`)
          }
          className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold text-white shadow-sm transition active:scale-95 ${
            grad ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
          }`}
          style={{
            background: grad
              ? `linear-gradient(90deg, ${grad[0]}, ${grad[1]})`
              : 'linear-gradient(90deg,#ff7a18,#a855f7)',
          }}
        >
          {t.events.burnGradient}
        </button>
        {/* The gradient's two colours, each any colour. */}
        {grad &&
          grad.map((c, i) => (
            <label
              key={i}
              className={`relative cursor-pointer overflow-hidden ${ring(false)}`}
              style={{ background: c }}
            >
              <input
                type="color"
                value={c}
                onChange={(e) =>
                  onChange(
                    `grad:${i === 0 ? e.target.value : grad[0]},${i === 1 ? e.target.value : grad[1]}`,
                  )
                }
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          ))}
      </div>
    </div>
  );
}
