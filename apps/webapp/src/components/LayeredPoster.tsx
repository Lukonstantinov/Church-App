import type { CSSProperties, ReactNode } from 'react';
import {
  fontFamily,
  type LayerStyle,
  type PosterLayer,
  type PosterTemplate,
  type PosterTexts,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { LivingLayer } from './ui';

/**
 * A poster template drawn inside any box — the poster, a home tile, an event's cover or
 * screen. The box measures itself (container units): a layer's place is its centre in %
 * of the box and its size in % of the box's smaller side, so the same design fits a tall
 * poster and a wide tile. Layers are stacked in order, front last; an effect layer moves
 * over everything below it and under everything above it.
 */
export function LayeredPoster({
  tpl,
  texts,
  coverUrl,
  className = '',
  fill,
  children,
}: {
  tpl: Pick<PosterTemplate, 'background' | 'layers'>;
  /** Covers its (positioned) parent instead of taking its own size. */
  fill?: boolean;
  texts: PosterTexts;
  /** The event's own cover photo (for a "cover" background and the effects that use the picture). */
  coverUrl?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const bg = tpl.background;
  const photo = bg.type === 'photo' ? bg.url : bg.type === 'cover' ? coverUrl : null;
  const paint =
    bg.type === 'color'
      ? bg.colors[0]
      : `linear-gradient(${bg.angle}deg, ${(bg.colors.length > 1 ? bg.colors : [...bg.colors, bg.colors[0]]).join(', ')})`;
  return (
    <div
      className={`layered-poster ${fill ? 'absolute inset-0' : 'relative'} isolate overflow-hidden ${className}`}
      style={{ background: paint }}
    >
      {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {photo && bg.dim ? (
        <span className="absolute inset-0" style={{ background: `rgba(0,0,0,${bg.dim})` }} />
      ) : null}
      {tpl.layers.map((l) =>
        l.hidden ? null : <Layer key={l.id} layer={l} texts={texts} picture={photo} />,
      )}
      {children}
    </div>
  );
}

/** Photoshop-like layer styles as CSS: shadow, glow, stroke and bevel (for pictures). */
function pictureFilter(s: LayerStyle | null | undefined): string | undefined {
  if (!s) return undefined;
  const parts: string[] = [];
  if (s.stroke && s.strokeWidth) {
    // Four hard shadows around the shape make an outline that follows its transparency.
    const w = `${(s.strokeWidth * 0.18).toFixed(2)}cqmin`;
    parts.push(
      `drop-shadow(${w} 0 0 ${s.stroke})`,
      `drop-shadow(-${w} 0 0 ${s.stroke})`,
      `drop-shadow(0 ${w} 0 ${s.stroke})`,
      `drop-shadow(0 -${w} 0 ${s.stroke})`,
    );
  }
  if (s.bevel)
    parts.push(
      'drop-shadow(-0.3cqmin -0.3cqmin 0 rgba(255,255,255,0.55))',
      'drop-shadow(0.35cqmin 0.35cqmin 0 rgba(0,0,0,0.45))',
    );
  if (s.glow) parts.push(`drop-shadow(0 0 2.2cqmin ${s.glow})`);
  if (s.shadow) parts.push(`drop-shadow(0 1cqmin 2cqmin rgba(0,0,0,${s.shadow}))`);
  return parts.length ? parts.join(' ') : undefined;
}

/** The same styles for text. */
function textEffects(s: LayerStyle | null | undefined): CSSProperties {
  if (!s) return {};
  const shadows: string[] = [];
  if (s.bevel)
    shadows.push(
      '-0.25cqmin -0.25cqmin 0 rgba(255,255,255,0.5)',
      '0.3cqmin 0.3cqmin 0 rgba(0,0,0,0.45)',
    );
  if (s.glow) shadows.push(`0 0 2cqmin ${s.glow}`, `0 0 4cqmin ${s.glow}`);
  if (s.shadow) shadows.push(`0 0.8cqmin 2cqmin rgba(0,0,0,${s.shadow})`);
  return {
    ...(shadows.length ? { textShadow: shadows.join(', ') } : {}),
    ...(s.stroke && s.strokeWidth
      ? {
          WebkitTextStroke: `${(s.strokeWidth * 0.12).toFixed(2)}cqmin ${s.stroke}`,
          paintOrder: 'stroke fill',
        }
      : {}),
  };
}

function Layer({
  layer,
  texts,
  picture,
}: {
  layer: PosterLayer;
  texts: PosterTexts;
  picture: string | null | undefined;
}) {
  const look: CSSProperties = {
    ...(layer.opacity != null && layer.opacity < 1 ? { opacity: layer.opacity } : {}),
    ...(layer.blend && layer.blend !== 'normal' ? { mixBlendMode: layer.blend } : {}),
  };
  if (layer.type === 'effect')
    return (
      <span className="absolute inset-0" style={look}>
        <LivingLayer kind={layer.kind} tune={layer.tune} image={picture} />
      </span>
    );
  const at: CSSProperties = {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    translate: '-50% -50%',
    ...(layer.rotate ? { rotate: `${layer.rotate}deg` } : {}),
  };
  if (layer.type === 'image')
    return layer.url ? (
      <img
        src={layer.url}
        alt=""
        className="absolute max-w-none"
        style={{
          ...at,
          ...look,
          width: `${layer.size}cqmin`,
          filter: pictureFilter(layer.style),
        }}
      />
    ) : null;
  const words = layer.source === 'custom' ? layer.text : (texts[layer.source] ?? layer.text);
  if (!words) return null;
  return (
    <span
      className="absolute w-max max-w-[92%] whitespace-pre-line leading-[1.05]"
      style={{
        ...at,
        ...look,
        fontSize: `${(layer.size / 4).toFixed(2)}cqmin`,
        fontFamily: fontFamily(layer.font) ?? undefined,
        fontWeight: layer.weight ?? 900,
        color: layer.color ?? '#ffffff',
        textAlign: layer.align ?? 'center',
        textTransform: layer.upper ? 'uppercase' : undefined,
        ...textEffects(layer.style),
      }}
    >
      {words}
    </span>
  );
}

/** What a poster's texts say for an event or meeting: its title, day, time, place, topic. */
export function usePosterTexts() {
  const f = useFmt();
  return (x: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    location?: string | null;
    topic?: string | null;
  }): PosterTexts => ({
    title: x.title,
    date: f.weekdayDayMonth(x.startsAt),
    time: x.endsAt ? f.timeRange(x.startsAt, x.endsAt) : f.time(x.startsAt),
    place: x.location ?? null,
    topic: x.topic ?? null,
  });
}
