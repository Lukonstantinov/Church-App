import { useId } from 'react';
import type { MeetingMotion } from '@church/shared';

/**
 * Photo effects in the spirit of Photoshop's: smoke and clouds, ice creeping over the
 * screen, cracked glass, light leaks, 35 mm film, RGB split, oil painting, gloss and
 * inflated holographic foil. Textures are drawn once (SVG noise and lighting filters as
 * pictures) and then only moved or faded, so the graphics chip does the work; with the
 * picture under them (`image`, an event's cover) RGB split and oil painting change the
 * picture itself.
 */
export const PHOTO_EFFECTS: readonly MeetingMotion[] = [
  'smoke',
  'frost',
  'crack',
  'lightleak',
  'film',
  'rgb',
  'oil',
  'gloss',
  'foil',
  'vignette',
  'duotone',
  'photofilter',
  'crossprocess',
  'hdr',
  'halftone',
  'lensflare',
  'grunge',
  'tiltshift',
  'motionblur',
];

/** An SVG drawing as a CSS picture. */
const svg = (body: string, w = 300, h = 300, extra = '') =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' ${extra}>${body}</svg>`,
  )}")`;

/** A colour as the 0…1 red, green and blue an SVG colour matrix takes. */
function rgb01(hex: string | null | undefined, fallback: [number, number, number]) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback.map((v) => v.toFixed(2));
  return [1, 3, 5].map((i) => (Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(2));
}

/** Soft cloud texture (white, or the chosen colour): fractal noise with see-through holes. */
const cloud = (sharp: number, color?: string | null) => {
  const [r, g, b] = rgb01(color, [1, 1, 1]);
  return svg(
    `<filter id='c' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.011' numOctaves='4' seed='3'/><feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${(1.4 + sharp * 2.2).toFixed(2)} 0 0 0 ${(-0.45 - sharp * 0.9).toFixed(2)}'/></filter><rect width='100%' height='100%' filter='url(#c)'/>`,
    400,
    400,
  );
};

/** Grey film / TV grain. */
const GRAIN = svg(
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/>`,
  160,
  160,
);

/** Frost: fine crystals (sharp noise) in icy white-blue, or the chosen colour. */
const frost = (color?: string | null) => {
  const [r, g, b] = rgb01(color, [0.86, 0.94, 1]);
  return svg(
    `<filter id='f'><feTurbulence type='turbulence' baseFrequency='0.045' numOctaves='4' seed='9'/><feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  2.6 0 0 0 -0.35'/></filter><rect width='100%' height='100%' filter='url(#f)'/>`,
    300,
    300,
  );
};

/** Crumpled metal for the foil: noise lit from the top left gives the crinkles. */
const crinkle = (sharp: number) =>
  svg(
    `<filter id='k'><feTurbulence type='fractalNoise' baseFrequency='${(0.012 + sharp * 0.03).toFixed(3)}' numOctaves='3' seed='5' result='t'/><feDiffuseLighting in='t' lighting-color='white' surfaceScale='${(4 + sharp * 6).toFixed(1)}'><feDistantLight azimuth='225' elevation='42'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(#k)'/>`,
    360,
    360,
  );

/** Cracked glass: lines from a point of impact with a few rings, light over a dark edge. */
const cracks = (weight: number, color?: string | null) => {
  const lines = [
    'M270 92 L318 70 L352 58 L400 30',
    'M270 92 L330 108 L372 128 L400 150',
    'M270 92 L296 140 L318 190 L332 240',
    'M270 92 L236 150 L214 200 L196 240',
    'M270 92 L210 120 L150 150 L112 172 L0 206',
    'M270 92 L200 82 L120 92 L60 70 L0 82',
    'M270 92 L238 52 L214 22 L198 0',
    'M270 92 L282 40 L292 0',
    'M150 150 L132 112 L120 92',
    'M318 190 L362 182 L400 196',
    'M214 22 L160 30 L120 12',
  ];
  const rings =
    'M250 84 L262 72 L284 74 L292 92 L282 110 L262 112 L248 100 Z M236 70 L262 56 L298 62 L312 92 L300 122 L262 130 L232 112 Z';
  const w = (1.1 * weight).toFixed(2);
  const path = (d: string, stroke: string, width: string, dy = 0) =>
    `<path d='${d}' fill='none' stroke='${stroke}' stroke-width='${width}' stroke-linejoin='bevel' transform='translate(0 ${dy})'/>`;
  const all = [...lines, rings].join(' ');
  return svg(
    path(all, 'rgba(0,0,0,0.45)', w, 1) + path(all, color ?? 'rgba(255,255,255,0.85)', w),
    400,
    240,
    "viewBox='0 0 400 240' preserveAspectRatio='xMidYMid slice'",
  );
};

export function PhotoEffect({
  kind,
  image,
  density,
  weight,
  sharp,
  color,
}: {
  kind: MeetingMotion;
  image?: string | null;
  density: number;
  weight: number;
  sharp: number | null;
  /** The chosen colour (smoke, frost, cracks…; others read it as --p-color). */
  color?: string | null;
}) {
  const id = `fx${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const photo = image ? { backgroundImage: `url("${image}")` } : undefined;
  switch (kind) {
    case 'smoke': {
      const n = Math.min(6, Math.max(2, Math.round(4 * density)));
      const tex = cloud(sharp ?? 0.3, color);
      return (
        <span className="fx fx-smoke">
          {Array.from({ length: n }, (_, i) => (
            <i
              key={i}
              className={`p${i % 4}`}
              style={{
                backgroundImage: tex,
                left: `${((i * 37) % 80) - 30}%`,
                animationDelay: `${-i * 4.3}s`,
              }}
            />
          ))}
        </span>
      );
    }
    case 'frost': {
      // How far the ice creeps in from the edges.
      const clear = Math.max(5, 52 - weight * 22);
      const mask = `radial-gradient(ellipse at center, transparent ${clear}%, #000 ${clear + 34}%)`;
      return (
        <span className="fx fx-frost" style={{ WebkitMaskImage: mask, maskImage: mask }}>
          <i className="ice" style={{ backgroundImage: frost(color) }} />
          <i className="glint" />
        </span>
      );
    }
    case 'crack':
      return (
        <span className="fx fx-crack">
          <i className="lines" style={{ backgroundImage: cracks(weight, color) }} />
          <i className="glint" />
        </span>
      );
    case 'lightleak': {
      const n = Math.min(5, Math.max(2, Math.round(3 * density)));
      const end = 72 - (sharp ?? 0) * 30;
      const colors = ['#ff7a2f', '#ff3d7f', '#ffd36b', '#ff9a3d', '#c45cff'];
      return (
        <span className="fx fx-leak">
          {Array.from({ length: n }, (_, i) => (
            <i
              key={i}
              className={`l${i % 3}`}
              style={{
                background: `radial-gradient(circle, ${i === 0 ? 'var(--p-color, ' + colors[0] + ')' : colors[i]} 0%, transparent ${end}%)`,
                left: `${[-25, 55, 10, 70, -10][i]}%`,
                top: `${[-30, 40, 55, -40, 10][i]}%`,
              }}
            />
          ))}
          <i className="streak" />
        </span>
      );
    }
    case 'film':
      return (
        <span className="fx fx-film">
          <i className="fade" />
          <i
            className="grain"
            style={{ backgroundImage: GRAIN, ...(weight !== 1 ? { scale: weight } : {}) }}
          />
          <i className="scratch s0" />
          <i className="scratch s1" />
          <i className="dust" />
          <i className="vignette" />
        </span>
      );
    case 'rgb': {
      const shift = 4 * weight;
      const fill = photo ?? {
        backgroundImage:
          'linear-gradient(135deg, color-mix(in srgb, var(--live-a) 70%, #fff), var(--live-c))',
      };
      return (
        <span className={`fx fx-rgb ${image ? 'has-image' : ''}`}>
          <i className="red" style={{ ...fill, translate: `${-shift}px 0` }} />
          <i className="cyan" style={{ ...fill, translate: `${shift}px 0` }} />
        </span>
      );
    }
    case 'oil':
      return (
        <span className="fx fx-oil">
          <svg width="0" height="0" className="absolute">
            {/* Brush strokes: the picture pushed around by noise, then its colours spread. */}
            <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.03 0.06" numOctaves="2" seed="2" />
              <feDisplacementMap in="SourceGraphic" scale={7 * weight} />
              <feMorphology operator="dilate" radius={1.2 * weight} />
            </filter>
          </svg>
          {image && <i className="paint" style={{ ...photo, filter: `url(#${id})` }} />}
          <i
            className="canvas"
            style={{
              backgroundImage: svg(
                `<filter id='o'><feTurbulence type='fractalNoise' baseFrequency='0.04 0.32' numOctaves='3' seed='8'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#o)'/>`,
                200,
                200,
              ),
            }}
          />
          <i className="sheen" />
        </span>
      );
    case 'gloss':
      return (
        <span className="fx fx-gloss">
          <i className="top" />
          <i className="band" />
          <i className="rim" />
        </span>
      );
    case 'foil':
      return (
        <span className="fx fx-foil">
          <i className="iris" />
          <i className="crinkle" style={{ backgroundImage: crinkle(sharp ?? 0.4) }} />
          <i className="puff" />
        </span>
      );
    // ---------- Colour and processing ----------
    case 'vignette': {
      const clear = Math.max(10, 62 - weight * 22);
      return (
        <span
          className="fx"
          style={{
            background: `radial-gradient(ellipse at center, transparent ${clear}%, color-mix(in srgb, ${color ?? '#000'} 75%, transparent) 100%)`,
          }}
        />
      );
    }
    case 'duotone':
      // The picture in two colours: its shadows in one, its lights in the other.
      return (
        <span className="fx fx-duo">
          {image && <i className="pic" style={photo} />}
          <i className="dark" />
          <i className="light" />
        </span>
      );
    case 'photofilter':
      return <span className="fx fx-filter" />;
    case 'crossprocess':
      return (
        <span className="fx fx-cross">
          {image && <i className="pic" style={photo} />}
          <i className="tint" />
        </span>
      );
    case 'hdr':
      return (
        <span className="fx fx-hdr">
          {image && <i className="pic" style={photo} />}
          <i className="glow" />
        </span>
      );
    case 'halftone':
      return (
        <span
          className="fx fx-halftone"
          style={{ backgroundSize: `${(6 * weight).toFixed(1)}px ${(6 * weight).toFixed(1)}px` }}
        />
      );
    case 'lensflare':
      return (
        <span className="fx fx-flare" style={weight !== 1 ? { scale: weight } : undefined}>
          <i className="core" />
          <i className="rays" />
          <i className="ghost g0" />
          <i className="ghost g1" />
          <i className="ghost g2" />
        </span>
      );
    case 'grunge':
      return (
        <span
          className="fx fx-grunge"
          style={{
            backgroundImage: svg(
              `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${(0.03 / weight).toFixed(3)} ${(0.09 / weight).toFixed(3)}' numOctaves='4' seed='11'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 -2.4 1.25'/></filter><rect width='100%' height='100%' filter='url(#g)'/>`,
              360,
              360,
            ),
          }}
        />
      );
    case 'tiltshift':
      // Lens blur: sharp across the middle, softly out of focus above and below.
      return (
        <span className="fx fx-tilt">
          {image && (
            <i className="pic" style={{ ...photo, filter: `blur(${(4 * weight).toFixed(1)}px)` }} />
          )}
        </span>
      );
    case 'motionblur':
      return (
        <span className="fx fx-motion">
          <svg width="0" height="0" className="absolute">
            {/* Blurred only sideways: things look like they rush past. */}
            <filter id={id} x="-10%" y="0" width="120%" height="100%">
              <feGaussianBlur stdDeviation={`${(10 * weight).toFixed(1)} 0`} />
            </filter>
          </svg>
          {image && <i className="pic" style={{ ...photo, filter: `url(#${id})` }} />}
          <i className="streak" />
        </span>
      );
    default:
      return null;
  }
}
