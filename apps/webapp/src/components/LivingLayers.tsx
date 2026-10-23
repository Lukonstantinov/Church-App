import { useEffect, useRef, type CSSProperties } from 'react';
import { GPU_MOTIONS, type MeetingMotion, type MotionIcon, type MotionTune } from '@church/shared';
import { useEnv } from '../lib/env';
import { useEffectQuality, useUnlimited, watchOffscreen } from '../lib/perf';
import { GpuEffect } from './GpuEffect';
import { PHOTO_EFFECTS, PhotoEffect } from './PhotoEffects';
import { PARTICLES, SEASON_ITEMS, particleSpots, type Particle } from './particleData';
import { PARTICLE_KINDS, ParticleCanvas } from './ParticleCanvas';
import { builtIn } from './EffectSets';
import { useEffectTemplates } from '../lib/queries';
import { SHADER_KINDS, ShaderEffect, shaderParams, type ShaderKind } from './ShaderEffect';

/** Solid brand-gradient card for the one most important thing on a screen. */
/**
 * The moving wallpaper behind a card: colour and light (drift, aurora, silk, rays),
 * particles (stars, lights, embers, fireflies, bubbles, snow, confetti, star warp),
 * liquid (waves, drops, ripples), textures (lines, grid, grain) or icons (the logo, an
 * emoji or a picture rising, raining or circling). `tune` sets its speed, size, direction
 * and colour. Nothing for "off". Parent: relative + overflow-hidden.
 */
/**
 * Where a layer of an own effect is drawn and how it mixes (Effect studio): its box in % of
 * the block, and its blend mode — set on the layer's own clip, so a recording sees both.
 */
export function placeStyle(tune: MotionTune | null | undefined): CSSProperties | undefined {
  const box = tune?.box;
  const blend = tune?.blend && tune.blend !== 'normal' ? tune.blend : null;
  if (!box && !blend) return undefined;
  return {
    ...(box
      ? {
          inset: 'auto',
          left: `${box.x}%`,
          top: `${box.y}%`,
          width: `${box.w}%`,
          height: `${box.h}%`,
        }
      : {}),
    ...(blend ? { mixBlendMode: blend } : {}),
  };
}

/**
 * An own effect (`custom`, by `tune.ref`): the church's saved layers, read live — so a
 * change in the Effect studio shows wherever the effect is used. Its own speed and strength
 * scale the whole thing; its own box and blend place the whole thing. Gone (deleted, or
 * not loaded yet): nothing is drawn.
 */
function CustomEffect({
  tune,
  behind,
  icon,
  image,
  preview,
}: {
  tune?: MotionTune | null;
  behind?: boolean;
  icon?: MotionIcon | null;
  image?: string | null;
  preview?: boolean;
}) {
  const list = useEffectTemplates();
  const own = list.data?.find((x) => x.id === tune?.ref);
  if (!own) return null;
  const speed = tune?.speed ?? 1;
  const layers = builtIn(own.effects).map((l) => ({
    kind: l.kind,
    tune: speed === 1 ? l.tune : { ...l.tune, speed: Math.min(3, (l.tune?.speed ?? 1) * speed) },
  }));
  const strength = tune?.strength ?? 1;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        ...(behind ? { zIndex: -1 } : {}),
        ...(strength < 1 ? { opacity: strength } : {}),
        ...placeStyle(tune),
        borderRadius: 'inherit',
      }}
    >
      <LivingLayers layers={layers} icon={icon} image={image} preview={preview} />
    </span>
  );
}

/**
 * Several animations over one block: the particle ones share one canvas (one picture drawn
 * by one clock instead of a layer each), the others are drawn as layers of their own.
 */
export function LivingLayers({
  layers,
  behind,
  icon,
  image,
  preview,
}: {
  layers: readonly { kind: MeetingMotion; tune?: MotionTune | null }[];
  behind?: boolean;
  icon?: MotionIcon | null;
  image?: string | null;
  preview?: boolean;
}) {
  const quality = useEffectQuality();
  if (quality === 'still') return null;
  const shown = layers.filter((l) => l.kind !== 'off');
  // Particles share one canvas — unless a layer has its own place or blend (own effects):
  // then it is drawn on a canvas of its own.
  const shared = (l: (typeof shown)[number]) =>
    PARTICLE_KINDS.has(l.kind) && !l.tune?.box && !l.tune?.blend;
  const particles = shown.filter(shared);
  return (
    <>
      {shown
        .filter((l) => !shared(l))
        .map((l, i) => (
          <LivingLayer
            key={`${l.kind}${i}`}
            kind={l.kind}
            tune={l.tune}
            behind={behind}
            icon={icon}
            image={image}
            preview={preview}
          />
        ))}
      {particles.length > 0 && (
        <ParticleCanvas layers={particles} icon={icon} behind={behind} preview={preview} />
      )}
    </>
  );
}

export function LivingLayer({
  kind,
  live,
  behind,
  tune,
  icon,
  image,
  preview,
}: {
  kind: MeetingMotion;
  live?: boolean;
  /** Under the content of a block that doesn't position its children (see `skin-host`). */
  behind?: boolean;
  tune?: MotionTune | null;
  /** What the icon animations show (default: the ministry's or church's logo). */
  icon?: MotionIcon | null;
  /** The picture under it (an event's cover): the TV glitch tears and shifts it. */
  image?: string | null;
  /** A small preview in a picker: on full quality it isn't held back by the running cap. */
  preview?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const clip = useRef<HTMLSpanElement>(null);
  const { env } = useEnv();
  const quality = useEffectQuality();
  const unlimited = useUnlimited();
  // Off screen it stands still, and only a few layers run at once (no work for the phone).
  useEffect(
    () =>
      clip.current
        ? watchOffscreen(clip.current, !unlimited && (!preview || quality !== 'full'))
        : undefined,
    [kind, quality, preview, unlimited],
  );
  const speed = tune?.speed ?? 1;
  // Speed for every kind at once: the browser's own playback rate of its animations.
  useEffect(() => {
    const el = ref.current;
    if (!el || speed === 1) return;
    const id = requestAnimationFrame(() => {
      for (const a of el.getAnimations({ subtree: true })) a.playbackRate = speed;
    });
    return () => cancelAnimationFrame(id);
  }, [speed, kind, tune?.density, tune?.sharp]);
  // On "still" phones the animation layers aren't drawn at all.
  if (kind === 'off' || quality === 'still') return null;
  // Particles are drawn on one canvas instead of one moving element each.
  // One of the church's own effects: its layers, as saved in the Effect studio.
  if (kind === 'custom')
    return <CustomEffect tune={tune} behind={behind} icon={icon} image={image} preview={preview} />;
  const place = placeStyle(tune);
  if (PARTICLE_KINDS.has(kind))
    return (
      <ParticleCanvas
        layers={[{ kind, tune }]}
        icon={icon}
        behind={behind}
        preview={preview}
        place={place}
      />
    );
  // Smooth colour effects are drawn small by the shader engine (no huge blurred layers).
  if (SHADER_KINDS.has(kind))
    return (
      <ShaderEffect
        params={shaderParams(kind as ShaderKind, tune)}
        preview={preview}
        behind={behind}
        place={place}
      />
    );
  // Weaker phones draw every other particle.
  const few = <T,>(list: readonly T[]): readonly T[] =>
    quality === 'lite' ? list.filter((_, i) => i % 2 === 0) : list;
  // Its own settings: how many (or how far apart), how thick / big, how sharp, how strong.
  const density = tune?.density ?? 1;
  const weight = tune?.weight ?? 1;
  const strength = tune?.strength ?? 1;
  const sharp = tune?.sharp ?? null;
  const spots = (base: readonly Particle[] = PARTICLES) => few(particleSpots(base, density));
  const beams = [...Array(Math.min(6, Math.max(1, Math.round(3 * density)))).keys()];
  // The graphics-chip effects draw the photo themselves: never turned or resized here.
  const gpu = GPU_MOTIONS.includes(kind);
  const size = gpu ? 1 : (tune?.size ?? 1);
  const angle = gpu ? 0 : (tune?.angle ?? 0);
  // Turned or shrunk, the layer grows so it still covers the card.
  const grow = angle % 180 !== 0 || size < 1 ? '-40%' : angle ? '-10%' : undefined;
  const c = tune?.color;
  const lined = kind === 'lines' || kind === 'grid' || kind === 'crt' || kind === 'disco';
  const style = {
    ...(grow ? { inset: grow } : {}),
    // Lines and grid get brighter or fainter lines; the rest fade as a whole.
    ...(lined
      ? { '--k-strength': strength, '--k-gap': density, '--k-weight': weight }
      : strength < 1
        ? { opacity: strength }
        : {}),
    // Glows: less blur = clearer shapes (the aurora's colour turn has fixed steps).
    ...(sharp !== null ? { '--k-soft': 1 - sharp * 0.85, '--k-soft-b': sharp } : {}),
    ...(angle || size !== 1 ? { transform: `rotate(${angle}deg) scale(${size})` } : {}),
    ...(c
      ? {
          '--live-a': `color-mix(in srgb, ${c} 80%, #fff)`,
          '--live-b': c,
          '--live-c': `color-mix(in srgb, ${c} 70%, #000)`,
          '--p-color': c,
        }
      : {}),
  } as CSSProperties;
  const iconUrl = icon?.url ?? (icon?.emoji ? null : (env?.logoUrl ?? null));
  const iconEmoji = icon?.emoji ?? '✨';
  const code = kind === 'matrix' ? rainColumns(tune?.symbols, tune?.words) : CODE;
  return (
    // The frame clips the animation to its block even when it is enlarged or turned
    // (iPhones don't always clip moving layers to rounded corners on their own).
    <span
      ref={clip}
      aria-hidden="true"
      className="living-clip"
      style={{
        ...(behind ? { zIndex: -1 } : {}),
        // Light rays without a photo are drawn on black: mixed in as light.
        ...(kind === 'godrays' && !image ? { mixBlendMode: 'screen' } : {}),
        ...place,
      }}
    >
      <span
        ref={ref}
        style={style}
        className="living-bg"
        data-kind={kind}
        data-live={live ? 'true' : 'false'}
        data-level={kind === 'calm' ? 'calm' : 'lively'}
        data-sharp={sharp !== null ? Math.round(sharp * 3) : undefined}
      >
        {(kind === 'calm' || kind === 'lively') && (
          <>
            <i className="living-blob b1" />
            <i className="living-blob b2" />
            <i className="living-blob b3" />
            <i className="living-rays" />
            <i className="living-dots" />
            <i className="living-dots far" />
          </>
        )}
        {kind === 'stars' && (
          <>
            <i className="living-stars" />
            <i className="living-stars far" />
          </>
        )}
        {kind === 'waves' && (
          <>
            <i className="living-wave w1" />
            <i className="living-wave w2" />
            <i className="living-wave w3" />
          </>
        )}
        {kind === 'bokeh' &&
          [0, 1, 2, 3, 4, 5, 6].map((i) => (
            <i
              key={i}
              className={`living-bokeh k${i}`}
              style={weight !== 1 ? { scale: weight } : undefined}
            />
          ))}
        {kind === 'rays' && <i className="living-rays solo" />}
        {(kind === 'embers' ||
          kind === 'bubbles' ||
          kind === 'snow' ||
          kind === 'fireflies' ||
          kind === 'confetti') &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-p"
              style={
                {
                  '--x': `${p.x}%`,
                  '--y': `${(p.t * 9) % 90}%`,
                  '--s': `${(kind === 'bubbles' ? p.s * 2.2 : kind === 'confetti' ? p.s * 1.4 : p.s) * weight}px`,
                  '--d': `${p.d}s`,
                  '--t': `${-p.t}s`,
                  '--w': `${p.w}px`,
                  '--i': i,
                } as CSSProperties
              }
            />
          ))}
        {kind === 'warp' &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-warp"
              style={
                {
                  '--a': `${i * 30 + p.w}deg`,
                  '--d': `${p.d / 3}s`,
                  '--t': `${-p.t / 3}s`,
                } as CSSProperties
              }
            />
          ))}
        {kind === 'ripples' &&
          [0, 1, 2, 3].map((i) => <i key={i} className={`living-ripple r${i}`} />)}
        {kind === 'lines' && <i className="living-lines" />}
        {kind === 'grid' && <i className="living-grid" />}
        {kind === 'grain' && (
          <>
            <i className="living-grain" />
            <i className="living-sweep" />
          </>
        )}
        {PHOTO_EFFECTS.includes(kind) && (
          <PhotoEffect
            kind={kind}
            image={image}
            density={density}
            weight={weight}
            sharp={sharp}
            color={c}
          />
        )}
        {kind === 'glitch' && <Glitch image={image} density={density} weight={weight} />}
        {gpu && <GpuEffect kind={kind} tune={tune} image={image} preview={preview} />}
        {kind === 'crt' && (
          <>
            <i className="living-scan" />
            <i className="living-roll" />
            <i className="living-vignette" />
          </>
        )}
        {kind === 'static' && (
          <i className="living-static" style={weight !== 1 ? { scale: weight } : undefined} />
        )}
        {kind === 'matrix' &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-code"
              style={
                {
                  '--x': `${p.x}%`,
                  '--s': `${(8 + p.s) * weight}px`,
                  '--d': `${p.d * 0.6}s`,
                  '--t': `${-p.t * 0.6}s`,
                } as CSSProperties
              }
            >
              {code[i % code.length]}
            </i>
          ))}
        {kind === 'spotlight' &&
          beams.map((i) => (
            <i
              key={i}
              className="living-beam"
              style={
                {
                  left: `${((i + 0.5) / beams.length) * 100}%`,
                  scale: `${weight} 1`,
                  animationDuration: `${5 + (i % 3) * 1.3}s`,
                  animationDelay: `${-i * 1.7}s`,
                } as CSSProperties
              }
            />
          ))}
        {kind === 'spotlight' && <i className="living-haze" />}
        {kind === 'disco' && (
          <>
            <i className="living-disco" />
            <i className="living-disco two" />
          </>
        )}
        {kind === 'hearts' &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-icon living-heart"
              style={
                {
                  '--x': `${p.x}%`,
                  '--s': `${(10 + p.s * 2.5) * weight}px`,
                  '--d': `${p.d * 1.2}s`,
                  '--t': `${-p.t * 1.2}s`,
                } as CSSProperties
              }
            >
              ♥
            </i>
          ))}
        {kind === 'sparkle' &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-spark"
              style={
                {
                  left: `${p.x}%`,
                  top: `${(p.t * 23 + p.x) % 92}%`,
                  '--s': `${(8 + p.s * 2.2) * weight}px`,
                  animationDuration: `${1.6 + (p.d % 4) * 0.5}s`,
                  animationDelay: `${-p.t * 0.4}s`,
                } as CSSProperties
              }
            >
              ✦
            </i>
          ))}
        {(kind === 'leaves' || kind === 'snowfall' || kind === 'petals') &&
          spots().map((p, i) => (
            <i
              key={i}
              className="living-fallitem"
              style={
                {
                  '--x': `${p.x}%`,
                  '--s': `${(kind === 'snowfall' ? 6 + p.s * 2 : 12 + p.s * 2.5) * weight}px`,
                  '--d': `${kind === 'snowfall' ? p.d * 1.1 : p.d * 1.5}s`,
                  '--t': `${-p.t * 1.4}s`,
                  '--w': `${p.w * 2}px`,
                  '--r': `${(i % 2 ? 1 : -1) * (360 + p.d * 30)}deg`,
                } as CSSProperties
              }
            >
              {SEASON_ITEMS[kind][i % SEASON_ITEMS[kind].length]}
            </i>
          ))}
        {(kind === 'iconfloat' || kind === 'iconrain' || kind === 'iconorbit') &&
          (kind === 'iconorbit' ? few(PARTICLES.slice(0, 6)) : spots(PARTICLES.slice(0, 9))).map(
            (p, i) => (
              <i
                key={i}
                className="living-icon"
                style={
                  {
                    '--x': `${p.x}%`,
                    '--s': `${(10 + p.s * 3) * weight}px`,
                    '--d': `${p.d * 1.3}s`,
                    '--t': `${-p.t * 1.3}s`,
                    '--w': `${p.w}px`,
                    '--a': `${i * 60}deg`,
                  } as CSSProperties
                }
              >
                {iconUrl ? <img src={iconUrl} alt="" /> : iconEmoji}
              </i>
            ),
          )}
      </span>
    </span>
  );
}

/** Columns of the digital rain: a fixed jumble of digits and katakana each. */
/**
 * The falling columns of the digital rain: the classic code, columns made of the person's
 * own letters and symbols (emoji count as one), or whole words — one word a column, the
 * words in their order across the columns, so they fall one after another.
 */
export function rainColumns(
  symbols: string | null | undefined,
  words?: string[] | null,
): readonly string[] {
  const list = (words ?? []).map((w) => w.trim()).filter(Boolean);
  if (list.length) return list;
  const text = (symbols ?? '').replace(/\s+/g, '');
  const own =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter().segment(text)].map((x) => x.segment)
      : Array.from(text);
  if (own.length === 0) return CODE;
  return CODE.map((_, c) => {
    let out = '';
    for (let i = 0; i < 10; i++) out += own[(i * 7 + c * 3 + ((i * c) % 5)) % own.length];
    return out;
  });
}

const CODE = ['1ｱ0ｶ7ﾀ3ﾅ9ｻ', 'ﾊ8ﾏ2ﾔ5ﾗ0ﾜ1', '0ｲ4ｷ1ﾁ6ﾆ3ｼ', 'ﾋ7ﾐ0ﾕ9ﾘ2ｦ5', '3ｳ8ｸ5ﾂ0ﾇ7ｽ', 'ﾌ1ﾑ6ﾖ4ﾙ8ﾝ0'];

/** Where the torn strips of a TV glitch sit (top and height, % of the block). */
const GLITCH_BANDS = [
  [12, 6],
  [34, 3],
  [51, 9],
  [70, 4],
  [86, 7],
  [22, 5],
  [61, 3],
  [44, 5],
] as const;

/**
 * TV glitch: strips of the picture (or of light, without one) tear sideways now and then,
 * a red and a cyan copy jump apart, scanlines and a flicker on top. Everything jumps in
 * fixed steps (transform / opacity only). `density` = how many strips, `weight` = how thick.
 */
function Glitch({
  image,
  density,
  weight,
}: {
  image?: string | null;
  density: number;
  weight: number;
}) {
  const n = Math.min(GLITCH_BANDS.length, Math.max(2, Math.round(5 * density)));
  const fill = image ? { backgroundImage: `url("${image}")` } : undefined;
  return (
    <span className={`living-glitch ${image ? 'has-image' : ''}`}>
      {image && (
        <>
          <i className="gl-rgb red" style={fill} />
          <i className="gl-rgb cyan" style={fill} />
        </>
      )}
      {GLITCH_BANDS.slice(0, n).map(([top, h], i) => {
        const height = Math.min(30, h * weight);
        return (
          <i
            key={i}
            className={`gl-band b${i}`}
            style={{
              ...fill,
              clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - height)}% 0)`,
            }}
          />
        );
      })}
      <i className="gl-scan" />
      <i className="gl-tear" />
    </span>
  );
}
