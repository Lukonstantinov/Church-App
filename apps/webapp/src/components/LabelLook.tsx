import type { CSSProperties, ReactNode } from 'react';
import type { LabelLook, LabelRef } from '@church/shared';

const RAINBOW = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

const rgb = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return [v >> 16, (v >> 8) & 255, v & 255] as const;
};
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((x) =>
      Math.round(Math.max(0, Math.min(255, x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** Mix a colour towards white (amount > 0) or black (amount < 0). */
export const shade = (hex: string, amount: number) => {
  const [r, g, b] = rgb(hex);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex(r + (to - r) * k, g + (to - g) * k, b + (to - b) * k);
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** The colours of a look, in order (one for plain fills). */
export function lookColors(l: Pick<LabelLook, 'color' | 'color2' | 'colors' | 'style'>): string[] {
  if (l.style === 'rainbow') return RAINBOW;
  if (l.style === 'gradient') {
    const list = l.colors?.length ? l.colors : l.color2 ? [l.color, l.color2] : [l.color];
    return list.length > 1 ? list : [l.color, shade(l.color, 0.45)];
  }
  return [l.color];
}

/**
 * A gradient that ends where it starts, drawn twice as wide as the chip: sliding it by
 * exactly one length loops without a seam, so the colours flow endlessly.
 */
const loop = (colors: string[], angle = 90) =>
  `linear-gradient(${angle}deg, ${[...colors, colors[0]].join(', ')})`;

/** How the chip itself is painted for a look. */
export function lookPaint(l: LabelLook): { style: CSSProperties; flows: boolean } {
  const colors = lookColors(l);
  const c = l.color;
  switch (l.style) {
    case 'gradient':
    case 'rainbow': {
      const avg = colors.reduce((s, x) => s + luminance(x), 0) / colors.length;
      return {
        style: {
          backgroundImage: loop(colors),
          backgroundSize: '200% 100%',
          color: l.style === 'rainbow' || avg <= 170 ? '#ffffff' : '#111827',
          textShadow: l.style === 'rainbow' ? '0 1px 2px rgba(0,0,0,0.45)' : undefined,
        },
        flows: true,
      };
    }
    case 'metal':
      return {
        style: {
          backgroundImage: loop([shade(c, -0.35), c, shade(c, 0.6), c], 110),
          backgroundSize: '200% 100%',
          color: luminance(c) > 150 ? '#111827' : '#ffffff',
          boxShadow: `inset 0 1px 0 ${shade(c, 0.7)}, inset 0 -1px 0 ${shade(c, -0.4)}`,
          textShadow: '0 1px 0 rgba(0,0,0,0.25)',
        },
        flows: true,
      };
    case 'neon':
      return {
        style: {
          background: '#0d0d16',
          color: shade(c, 0.35),
          border: `1px solid ${c}`,
          boxShadow: `0 0 6px ${c}, inset 0 0 6px ${c}66`,
          textShadow: `0 0 6px ${c}`,
        },
        flows: false,
      };
    case 'glass':
      return {
        style: {
          background: `${c}2e`,
          color: luminance(c) > 170 ? shade(c, -0.55) : shade(c, -0.15),
          border: `1px solid ${c}73`,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        },
        flows: false,
      };
    case 'outline':
      return {
        style: {
          background: 'transparent',
          color: luminance(c) > 170 ? shade(c, -0.45) : c,
          border: `1.5px solid ${c}`,
        },
        flows: false,
      };
    default:
      return {
        style: { background: c, color: luminance(c) > 170 ? '#111827' : '#ffffff' },
        flows: false,
      };
  }
}

const textClass = (l: Pick<LabelLook, 'font' | 'caps' | 'italic'>) =>
  [
    l.font !== 'default' ? `lk-font-${l.font}` : '',
    l.caps ? 'uppercase tracking-wide' : '',
    l.italic ? 'italic' : '',
  ].join(' ');

/** The animation class of a look (flowing fills always drift; "flow" makes it quick). */
function motionClass(l: LabelLook, flows: boolean) {
  const out: string[] = [];
  if (flows) out.push(l.animation === 'flow' ? 'lk-flow lk-fast' : 'lk-flow');
  if (l.animation !== 'none' && l.animation !== 'flow' && l.animation !== 'sparkle')
    out.push(`label-${l.animation}`);
  return out.join(' ');
}

/** One label (or a position drawn like one): fill, pattern, font and its own animation. */
export function LabelChip({
  label,
  small,
}: {
  label: { name: string } & LabelLook;
  small?: boolean;
}) {
  const { style, flows } = lookPaint(label);
  return (
    <span
      className={`relative isolate inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full font-semibold ${
        small ? 'px-1.5 py-px text-[11px]' : 'px-2.5 py-0.5 text-[12px]'
      } ${motionClass(label, flows)} ${textClass(label)}`}
      style={{ '--label-color': label.color, ...style } as CSSProperties}
    >
      {label.texture !== 'none' && (
        <span aria-hidden="true" className={`lk-tex lk-tex-${label.texture}`} />
      )}
      {label.animation === 'sparkle' && <span aria-hidden="true" className="lk-sparkles" />}
      {label.emoji && <span className="relative">{label.emoji}</span>}
      <span className="relative truncate">{label.name}</span>
    </span>
  );
}

/** A name drawn in a look: the colours fill the letters and move like the label. */
export function StyledName({
  look,
  children,
  className = '',
}: {
  look: LabelLook;
  children: ReactNode;
  className?: string;
}) {
  const colors = lookColors(look);
  const c = look.color;
  let style: CSSProperties;
  let flows = false;
  if (look.style === 'neon') {
    style = { color: shade(c, 0.25), textShadow: `0 0 6px ${c}, 0 0 12px ${c}88` };
  } else if (look.style === 'metal' || colors.length > 1) {
    flows = true;
    style = {
      backgroundImage:
        look.style === 'metal' ? loop([shade(c, -0.4), c, shade(c, 0.55), c], 110) : loop(colors),
      backgroundSize: '200% 100%',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
    };
  } else {
    style = { color: luminance(c) > 185 ? shade(c, -0.35) : c };
  }
  const motion = motionClass(look, flows)
    // A name doesn't pulse its outline; keep it to colour and gentle movement.
    .replace('label-glow', '');
  return (
    <span className={`${className} ${motion} ${textClass(look)}`} style={style}>
      {children}
    </span>
  );
}

/** The look a person's name takes: their first label that styles names, else their position's. */
export function nameLookOf(
  labels: readonly LabelRef[] | undefined,
  positionLook: LabelLook | null | undefined,
): LabelLook | null {
  return labels?.find((l) => l.nameStyle) ?? (positionLook?.nameStyle ? positionLook : null);
}

/** A person's name: in their label's look when one styles names, else red for administrators. */
export function PersonName({
  name,
  labels,
  positionLook,
  isAdmin,
  className = '',
}: {
  name: string;
  labels?: readonly LabelRef[];
  positionLook?: LabelLook | null;
  isAdmin?: boolean;
  className?: string;
}) {
  const look = nameLookOf(labels, positionLook);
  if (look)
    return (
      <StyledName look={look} className={className}>
        {name}
      </StyledName>
    );
  return <span className={`${className} ${isAdmin ? 'admin-name' : ''}`}>{name}</span>;
}
