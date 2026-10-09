import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  fontFamily,
  type LayerShape,
  type LayerStyle,
  type MotionLayer,
  type PosterFrame,
  type PosterLayer,
  type PosterTemplate,
  type PosterTexts,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useEffectQuality, useUnlimited, watchOffscreen } from '../lib/perf';
import { freeCanvas } from '../lib/poster';
import { LivingLayer, LivingLayers } from './ui';

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
  tpl: Pick<PosterTemplate, 'background' | 'layers'> & { frame?: PosterFrame | null };
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
      {tpl.frame && <Frame frame={tpl.frame} />}
      {children}
    </div>
  );
}

/** A CSS mask stretched over the whole box. */
function maskOf(image: string): CSSProperties {
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  };
}

/**
 * Fades a box out over `pct` % at two sides (left and right, or top and bottom). Soft
 * edges all round are two boxes inside each other, one each way: combined masks
 * (mask-composite) are dropped by the picture drawing of posters.
 */
const feather = (pct: number, down = false) =>
  maskOf(
    `linear-gradient(to ${down ? 'bottom' : 'right'}, transparent, #000 ${pct}%, #000 ${100 - pct}%, transparent)`,
  );

/** The top-and-bottom half of a soft rectangular edge (see edgeLook), round `children`. */
function SoftY({
  shape,
  soft,
  children,
}: {
  shape: LayerShape | null | undefined;
  soft: number | null | undefined;
  children: ReactNode;
}) {
  const s = soft ?? 0;
  if (s <= 0 || shape === 'circle' || shape === 'oval') return <>{children}</>;
  return (
    <span className="absolute inset-0" style={feather(s * 50, true)} data-edge-part="">
      {children}
    </span>
  );
}

/**
 * A layer's outline and edges: rounded corners (`corner`), a circle or an oval filling the
 * box, and soft edges fading out (0 sharp … 1 from the middle). A soft rectangle fades
 * left and right here, and top and bottom in a SoftY inside it.
 */
function edgeLook(
  shape: LayerShape | null | undefined,
  soft: number | null | undefined,
  corner: string,
): CSSProperties {
  const s = soft ?? 0;
  if (shape === 'circle' || shape === 'oval') {
    const kind = shape === 'circle' ? 'circle closest-side' : 'closest-side';
    // A hair of fading keeps even a sharp edge smooth (no stairs).
    const inner = Math.max(0, 99 - s * 99);
    return maskOf(`radial-gradient(${kind}, #000 ${inner}%, transparent 100%)`);
  }
  const round: CSSProperties =
    shape === 'rounded' ? { borderRadius: corner, clipPath: `inset(0 round ${corner})` } : {};
  return s > 0 ? { ...round, ...feather(s * 50) } : round;
}

/**
 * The same outline as plain data on the element: a recording draws these masks itself
 * (exactly, and faster than having the browser draw the CSS once more).
 */
function edgeMark(shape: LayerShape | null | undefined, soft: number | null | undefined) {
  const s = soft ?? 0;
  return (shape && shape !== 'rect') || s > 0
    ? { 'data-edge': shape ?? 'rect', 'data-soft': s }
    : {};
}

/**
 * Where an effect layer sits: the whole poster, or (moved or resized by finger in the
 * editor) a box with its centre at x/y and its size in % of the poster.
 */
export function effectBox(layer: Extract<PosterLayer, { type: 'effect' }>): CSSProperties {
  const w = layer.w ?? 100;
  const h = layer.h ?? 100;
  const x = layer.x ?? 50;
  const y = layer.y ?? 50;
  if (w === 100 && h === 100 && x === 50 && y === 50) return { inset: 0 };
  return { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, translate: '-50% -50%' };
}

/** Photoshop-like layer styles as CSS: shadow, glow, stroke and bevel (for pictures). */
function pictureFilter(s: LayerStyle | null | undefined): string | undefined {
  if (!s) return undefined;
  const parts: string[] = [];
  if (s.stroke && s.strokeWidth) {
    // Hard shadows all round the shape make an outline that follows its transparency;
    // eight directions (not four) keep it smooth round curves and corners.
    const w = s.strokeWidth * 0.18;
    const d = w * Math.SQRT1_2;
    for (const [x, y] of [
      [w, 0],
      [-w, 0],
      [0, w],
      [0, -w],
      [d, d],
      [-d, d],
      [d, -d],
      [-d, -d],
    ] as const)
      parts.push(`drop-shadow(${x.toFixed(2)}cqmin ${y.toFixed(2)}cqmin 0 ${s.stroke})`);
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
  // Which layer a finger touches in the editor (PosterGestures).
  const mark = { 'data-layer-id': layer.id };
  if (layer.type === 'effect')
    return (
      <span
        className="absolute"
        style={{
          ...effectBox(layer),
          ...look,
          ...(layer.fade ? edgeLook('rect', layer.fade * 0.6, '') : {}),
        }}
        {...(layer.fade ? edgeMark('rect', layer.fade * 0.6) : {})}
        {...mark}
      >
        <SoftY shape="rect" soft={layer.fade ? layer.fade * 0.6 : 0}>
          <LivingLayer kind={layer.kind} tune={layer.tune} image={picture} />
        </SoftY>
      </span>
    );
  if (layer.type === 'fill') return <Fill layer={layer} look={look} mark={mark} />;
  const at: CSSProperties = {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    translate: '-50% -50%',
    ...(layer.rotate ? { rotate: `${layer.rotate}deg` } : {}),
  };
  if (layer.type === 'image')
    return layer.url ? <Picture layer={layer} look={look} mark={mark} /> : null;
  const words = layer.source === 'custom' ? layer.text : (texts[layer.source] ?? layer.text);
  if (!words) return null;
  const type: CSSProperties = {
    fontSize: `${(layer.size / 4).toFixed(2)}cqmin`,
    fontFamily: fontFamily(layer.font) ?? undefined,
    fontWeight: layer.weight ?? 900,
    color: layer.color ?? '#ffffff',
    textAlign: layer.align ?? 'center',
    textTransform: layer.upper ? 'uppercase' : undefined,
    ...textEffects(layer.style),
  };
  const effects = (layer.effects ?? []).filter((e) => e.kind !== 'off');
  if (effects.length === 0)
    return (
      <span
        className="absolute w-max max-w-[92%] whitespace-pre-line leading-[1.05]"
        style={{ ...at, ...look, ...type }}
        {...mark}
      >
        {words}
      </span>
    );
  // The words first, their effects after them: a recording draws them in that order too.
  if (layer.fxIn === 'around')
    return (
      <span className="absolute w-max max-w-[92%]" style={{ ...at, ...look }} {...mark}>
        <span className="relative block whitespace-pre-line leading-[1.05]" style={type}>
          {words}
        </span>
        <span
          className="absolute"
          style={{ inset: '-45% -15%', ...edgeLook('oval', 0.6, '') }}
          {...edgeMark('oval', 0.6)}
        >
          <LivingLayers layers={effects} />
        </span>
      </span>
    );
  return (
    <LetterEffects
      words={words}
      upper={!!layer.upper}
      effects={effects}
      at={{ ...at, ...look }}
      type={type}
      id={layer.id}
    />
  );
}

/** Splits words into lines no wider than `max` (own line breaks kept), as the page would. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * Words with effects inside their letters only (smoke in the letters, sparkles on them):
 * the letters are drawn once as a picture and used as the effects' mask. The lines are
 * broken here (not by the page) so the words and the mask line up exactly.
 */
function LetterEffects({
  words,
  upper,
  effects,
  at,
  type,
  id,
}: {
  words: string;
  upper: boolean;
  effects: MotionLayer[];
  at: CSSProperties;
  type: CSSProperties;
  id: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const text = upper ? words.toUpperCase() : words;
  const fontKey = `${String(type.fontFamily)}|${String(type.fontWeight)}|${String(type.fontSize)}`;
  const stroke = String(type.WebkitTextStroke ?? '');

  // Where the lines break, for the poster's width (again when it changes size).
  useEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent?.parentElement ?? el?.parentElement?.parentElement;
    if (!el || !box) return;
    let stop = false;
    const measure = async () => {
      const cs = getComputedStyle(el);
      const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      await document.fonts?.load(font).catch(() => undefined);
      if (stop) return;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = font;
      const next = wrapLines(ctx, text, box.clientWidth * 0.92);
      freeCanvas(c);
      setLines((prev) => (prev && prev.join('\n') === next.join('\n') ? prev : next));
    };
    void measure();
    const ro = new ResizeObserver(() => void measure());
    ro.observe(box);
    return () => {
      stop = true;
      ro.disconnect();
    };
  }, [text, fontKey]);

  // The letters as a picture of the words' own size: white where the letters are.
  useEffect(() => {
    const el = ref.current;
    if (!el || !lines) return;
    let stop = false;
    void (async () => {
      const cs = getComputedStyle(el);
      const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      await document.fonts?.load(font).catch(() => undefined);
      if (stop) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      const px = Number.parseFloat(cs.fontSize);
      const lh = Number.parseFloat(cs.lineHeight) || px * 1.05;
      const k = 2;
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * k);
      c.height = Math.ceil(h * k);
      const ctx = c.getContext('2d')!;
      ctx.scale(k, k);
      ctx.font = font;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      ctx.lineJoin = 'round';
      const outline = Number.parseFloat(cs.getPropertyValue('-webkit-text-stroke-width')) || 0;
      ctx.lineWidth = outline;
      const m = ctx.measureText('Hg');
      const ascent = m.fontBoundingBoxAscent || px * 0.8;
      const descent = m.fontBoundingBoxDescent || px * 0.2;
      const align = cs.textAlign;
      lines.forEach((line, i) => {
        const lw = ctx.measureText(line).width;
        const x =
          align === 'left' || align === 'start' ? 0 : align === 'right' ? w - lw : (w - lw) / 2;
        // The page puts each line's letters in the middle of its line height.
        const y = i * lh + (lh - (ascent + descent)) / 2 + ascent;
        if (outline) ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
      });
      const url = c.toDataURL('image/png');
      freeCanvas(c);
      if (!stop) setMask(url);
    })();
    return () => {
      stop = true;
    };
  }, [lines, fontKey, stroke]);

  return (
    // No width limit here: the lines are already broken to fit, and a word too long for the
    // poster stays centred with its effects on it.
    <span className="absolute w-max" style={at} data-layer-id={id}>
      <span
        ref={ref}
        className={`relative block w-max leading-[1.05] ${lines ? 'whitespace-pre' : 'max-w-[92cqw] whitespace-pre-line'}`}
        style={type}
      >
        {lines ? lines.join('\n') : words}
      </span>
      {mask && (
        <span className="absolute inset-0" style={maskOf(`url("${mask}")`)}>
          <LivingLayers layers={effects} />
        </span>
      )}
    </span>
  );
}

/** A colour layer's paint: one colour, a straight gradient or one from the middle. */
function paintOf(
  paint: 'color' | 'linear' | 'radial' | 'conic',
  colors: string[],
  angle: number,
): string {
  const list = colors.length > 1 ? colors : [colors[0]!, colors[0]!];
  if (paint === 'color') return colors[0]!;
  if (paint === 'radial') return `radial-gradient(circle at 50% 50%, ${list.join(', ')})`;
  if (paint === 'conic')
    return `conic-gradient(from ${angle}deg, ${[...list, list[0]].join(', ')})`;
  return `linear-gradient(${angle}deg, ${list.join(', ')})`;
}

/**
 * A colour or gradient layer: a box anywhere on the poster with its own shape and soft
 * edges, effects of its own, and (gradients) colours that slide, turn or breathe. The still
 * paint is always there (the bot's still picture shows it); the movement is a layer over it.
 */
function Fill({
  layer,
  look,
  mark,
}: {
  layer: Extract<PosterLayer, { type: 'fill' }>;
  look: CSSProperties;
  mark: Record<string, string>;
}) {
  const corner = `${(Math.min(layer.w, layer.h) * 0.12).toFixed(2)}cqmin`;
  const effects = (layer.effects ?? []).filter((e) => e.kind !== 'off');
  const moves = layer.move && layer.move !== 'none' && layer.colors.length > 1;
  return (
    <span
      className="absolute overflow-hidden"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.w}%`,
        height: `${layer.h}%`,
        translate: '-50% -50%',
        ...(layer.rotate ? { rotate: `${layer.rotate}deg` } : {}),
        ...look,
        ...edgeLook(layer.shape, layer.soft, corner),
      }}
      {...edgeMark(layer.shape, layer.soft)}
      {...mark}
    >
      <SoftY shape={layer.shape} soft={layer.soft}>
        <span
          className="absolute inset-0"
          style={{ background: paintOf(layer.paint, layer.colors, layer.angle) }}
        />
        {moves && <FillMotion layer={layer} />}
        <LivingLayers layers={effects} />
      </SoftY>
    </span>
  );
}

/** Base times of the colour movements (seconds), divided by the layer's speed. */
const FILL_SECONDS = { flow: 8, spin: 14, pulse: 5 } as const;

function FillMotion({ layer }: { layer: Extract<PosterLayer, { type: 'fill' }> }) {
  const clip = useRef<HTMLSpanElement>(null);
  const quality = useEffectQuality();
  const unlimited = useUnlimited();
  useEffect(
    () => (clip.current ? watchOffscreen(clip.current, !unlimited) : undefined),
    [quality, unlimited],
  );
  if (quality === 'still' || !layer.move || layer.move === 'none') return null;
  const time = {
    animationDuration: `${(FILL_SECONDS[layer.move] / (layer.speed ?? 1)).toFixed(2)}s`,
  };
  const list = layer.colors;
  return (
    <span ref={clip} aria-hidden="true" className="living-clip">
      {layer.move === 'flow' ? (
        // A strip of the colours twice over slides by one round: seamless. Turned to the
        // gradient's angle and larger than the box so no corner shows.
        <span className="absolute" style={{ inset: '-60%', rotate: `${layer.angle - 90}deg` }}>
          <i
            className="fill-flow"
            style={{
              ...time,
              backgroundImage: `linear-gradient(90deg, ${[...list, list[0]].join(', ')})`,
              backgroundSize: '50% 100%',
            }}
          />
        </span>
      ) : layer.move === 'spin' ? (
        <i
          className="fill-spin"
          style={{
            ...time,
            inset: '-60%',
            background: paintOf(layer.paint === 'radial' ? 'conic' : 'linear', list, layer.angle),
          }}
        />
      ) : (
        // Breathing: the colours the other way round fade in and out.
        <i
          className="fill-pulse"
          style={{
            ...time,
            background: paintOf(
              layer.paint === 'color' ? 'linear' : layer.paint,
              [...list].reverse(),
              layer.angle,
            ),
          }}
        />
      )}
    </span>
  );
}

/** The poster's frame: a line (or two) round it, with rounded corners and a glow. */
function Frame({ frame }: { frame: PosterFrame }) {
  const line = (inset: number, width: number) => (
    <span
      className="pointer-events-none absolute"
      style={{
        inset: `${inset}cqmin`,
        border: `${width}cqmin solid ${frame.color}`,
        borderRadius: `${frame.radius}cqmin`,
        ...(frame.glow
          ? { boxShadow: `0 0 2.5cqmin ${frame.glow}, inset 0 0 2.5cqmin ${frame.glow}` }
          : {}),
      }}
    />
  );
  return (
    <>
      {line(frame.inset, frame.width)}
      {frame.double && line(frame.inset + frame.width * 2.5, Math.max(0.2, frame.width * 0.45))}
    </>
  );
}

/**
 * A picture layer: a box with the picture's own shape, the picture in it and its effects
 * over it (photo effects change copies of the same picture, so they line up exactly). A
 * cut-out keeps its effects inside its outline (masked by its own transparency). "cover"
 * fills the whole poster like a background photo: x/y pick the part kept in view.
 */
function Picture({
  layer,
  look,
  mark,
}: {
  layer: Extract<PosterLayer, { type: 'image' }>;
  look: CSSProperties;
  mark: Record<string, string>;
}) {
  const url = layer.url!;
  const effects = (layer.effects ?? []).filter((e) => e.kind !== 'off');
  const ratio = layer.ratio ?? null;
  const masked = !!layer.cutout && effects.length > 0;
  const inner = (
    <span
      className="absolute inset-0"
      style={
        masked
          ? {
              maskImage: `url("${url}")`,
              WebkitMaskImage: `url("${url}")`,
              maskSize: '100% 100%',
              WebkitMaskSize: '100% 100%',
            }
          : undefined
      }
    >
      <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <LivingLayers layers={effects} image={url} />
    </span>
  );
  const turn = layer.rotate ? { rotate: `${layer.rotate}deg` } : {};
  if (layer.fit === 'cover') {
    const zoom = Math.max(1, layer.size / 100);
    const fx = Math.min(100, Math.max(0, layer.x)) / 100;
    const fy = Math.min(100, Math.max(0, layer.y)) / 100;
    // The box is the picture's shape, just big enough to cover the poster (times the zoom);
    // x/y slide it so that part of the picture stays in view, whatever the poster's shape.
    const w = ratio ? `calc(max(100cqw, ${ratio} * 100cqh) * ${zoom})` : `${zoom * 100}cqw`;
    const h = ratio ? `calc(max(100cqh, 100cqw / ${ratio}) * ${zoom})` : `${zoom * 100}cqh`;
    return (
      <span
        className="absolute inset-0"
        style={{ ...look, filter: pictureFilter(layer.style) }}
        {...mark}
      >
        <span
          className="absolute inset-0 overflow-hidden"
          style={edgeLook(layer.shape, layer.soft, '6cqmin')}
          {...edgeMark(layer.shape, layer.soft)}
        >
          <SoftY shape={layer.shape} soft={layer.soft}>
            <span
              className="absolute"
              style={{
                width: w,
                height: h,
                left: `calc((100cqw - ${w}) * ${fx})`,
                top: `calc((100cqh - ${h}) * ${fy})`,
                ...turn,
              }}
            >
              {inner}
            </span>
          </SoftY>
        </span>
      </span>
    );
  }
  // The outline (rounded, circle, soft) is inside the styles: an outline or glow follows it.
  const edges = edgeLook(layer.shape, layer.soft, `${(layer.size * 0.12).toFixed(2)}cqmin`);
  return (
    <span
      className="absolute"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        translate: '-50% -50%',
        ...turn,
        ...look,
        width: `${layer.size}cqmin`,
        filter: pictureFilter(layer.style),
      }}
      {...mark}
    >
      {ratio ? (
        <span
          className="relative block"
          style={{ aspectRatio: ratio, ...edges }}
          {...edgeMark(layer.shape, layer.soft)}
        >
          <SoftY shape={layer.shape} soft={layer.soft}>
            {inner}
          </SoftY>
        </span>
      ) : (
        // Older layers without a known shape: the picture sets the height.
        <span className="relative block" style={edges} {...edgeMark(layer.shape, layer.soft)}>
          <img src={url} alt="" className="invisible block w-full" />
          <SoftY shape={layer.shape} soft={layer.soft}>
            {inner}
          </SoftY>
        </span>
      )}
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
