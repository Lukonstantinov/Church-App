import { useEffect, useRef } from 'react';
import type { MeetingMotion, MotionTune } from '@church/shared';

/**
 * Effects drawn by the graphics chip with PixiJS filters (MIT): the photo under the layer
 * bent by heat haze, a shockwave, a swirl or a lens, its bright parts glowing, a zoom
 * burst, light rays or a water reflection. One WebGL canvas each, loaded only when such an
 * effect is on screen (the library is fetched on first use).
 *
 * - The canvas draws the photo itself (covering the box like the photo under it), so the
 *   effect lines up; without a photo only the light rays have something to show.
 * - Its own clock draws 30 times a second while on screen; a recording steps it through
 *   time instead (seekGpu / holdGpu, like the particle canvases).
 * - Phones allow only so many WebGL canvases: at most MAX_LIVE run at once, and the picker's
 *   small previews show a still stand-in instead of a canvas.
 */

const MAX_LIVE = 6;
let live = 0;

interface Layer {
  draw: (seconds: number) => void;
  held: boolean;
}
const layers = new Map<HTMLCanvasElement, Layer>();

/** Recording: draws the GPU canvases inside `root` as they are `seconds` in. */
export function seekGpu(root: Element, seconds: number) {
  for (const [c, l] of layers) if (root.contains(c)) l.draw(seconds);
}

/** Recording: stops (or restarts) their own clocks while it steps them. */
export function holdGpu(root: Element, hold: boolean) {
  for (const [c, l] of layers) if (root.contains(c)) l.held = hold;
}

const STAND_IN: Partial<Record<MeetingMotion, string>> = {
  heatwave: '🌫',
  shockwave: '💥',
  bloom: '✨',
  zoomburst: '🚀',
  swirl: '🌀',
  bulge: '🔍',
  godrays: '☀️',
  reflection: '🌊',
};

/** Effects that bend or light the photo: nothing to show without one. */
const NEEDS_PHOTO = new Set<MeetingMotion>([
  'heatwave',
  'shockwave',
  'bloom',
  'zoomburst',
  'swirl',
  'bulge',
  'reflection',
]);

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

/** A soft noise picture that tiles, for the heat haze to bend the photo by. */
function noiseCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  // A few smooth waves added up: no hard specks, and the edges meet when tiled.
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const a = (x / 128) * Math.PI * 2;
      const b = (y / 128) * Math.PI * 2;
      const r = 0.5 + 0.25 * Math.sin(a * 2 + Math.sin(b * 3)) + 0.25 * Math.sin(b * 2 + a);
      const g = 0.5 + 0.25 * Math.cos(b * 3 + Math.sin(a * 2)) + 0.25 * Math.cos(a * 3 - b);
      const i = (y * 128 + x) * 4;
      img.data[i] = Math.round(r * 255);
      img.data[i + 1] = Math.round(g * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function GpuEffect({
  kind,
  tune,
  image,
  preview,
}: {
  kind: MeetingMotion;
  tune?: MotionTune | null;
  image?: string | null;
  preview?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const weight = tune?.weight ?? 1;
  const density = tune?.density ?? 1;
  const color = tune?.color ?? null;
  const angle = tune?.angle ?? 0;
  const speed = tune?.speed ?? 1;
  const blank = NEEDS_PHOTO.has(kind) && !image;

  useEffect(() => {
    const el = ref.current;
    if (!el || preview || blank || live >= MAX_LIVE) return;
    live++;
    let stopped = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const PIXI = await import('pixi.js');
      const F = await import('pixi-filters');
      const box = el.parentElement;
      if (stopped || !box) return;
      const app = new PIXI.Application();
      await app.init({
        canvas: el,
        width: Math.max(1, box.clientWidth),
        height: Math.max(1, box.clientHeight),
        backgroundAlpha: 0,
        antialias: false,
        // The recorder copies the canvas between frames.
        preserveDrawingBuffer: true,
        autoStart: false,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: false,
        preference: 'webgl',
      });
      const photo = image ? await loadImage(image).catch(() => null) : null;
      if (stopped) {
        app.destroy({ removeView: false }, { children: true, texture: true });
        return;
      }
      const stage = new PIXI.Container();
      app.stage.addChild(stage);
      let sprite: InstanceType<typeof PIXI.Sprite> | null = null;
      if (photo) {
        sprite = new PIXI.Sprite(PIXI.Texture.from(photo));
        stage.addChild(sprite);
      } else {
        // Light rays need something to light: black, mixed in as light (`screen`).
        const g = new PIXI.Graphics().rect(0, 0, 4000, 4000).fill(0x000000);
        stage.addChild(g);
      }

      // The photo covers the box as the photo under it does (centred).
      const layout = () => {
        const W = box.clientWidth || 1;
        const H = box.clientHeight || 1;
        app.renderer.resize(W, H);
        if (sprite && photo) {
          const k = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
          sprite.scale.set(k);
          sprite.position.set((W - photo.naturalWidth * k) / 2, (H - photo.naturalHeight * k) / 2);
        }
        return { W, H };
      };
      let { W, H } = layout();

      let noise: InstanceType<typeof PIXI.Sprite> | null = null;
      const filter = (() => {
        switch (kind) {
          case 'heatwave': {
            const tex = PIXI.Texture.from(noiseCanvas());
            tex.source.addressMode = 'repeat';
            noise = new PIXI.Sprite(tex);
            // Big, slow ripples like air over hot ground (not a wobble).
            noise.scale.set(4);
            noise.renderable = false;
            app.stage.addChild(noise);
            return new PIXI.DisplacementFilter({ sprite: noise, scale: 6 * weight });
          }
          case 'shockwave':
            return new F.ShockwaveFilter({
              center: { x: W / 2, y: H / 2 },
              amplitude: 16 * weight,
              wavelength: 140,
              speed: 380,
              brightness: 1.15,
              radius: -1,
            });
          case 'bloom':
            return new F.AdvancedBloomFilter({ threshold: 0.62, bloomScale: 0.4, blur: 8 });
          case 'zoomburst':
            return new F.ZoomBlurFilter({
              center: { x: W / 2, y: H / 2 },
              innerRadius: Math.min(W, H) * 0.12,
              strength: 0,
            });
          case 'swirl':
            return new F.TwistFilter({
              offset: { x: W / 2, y: H / 2 },
              radius: Math.min(W, H) * 0.48,
              angle: 0,
              padding: 0,
            });
          case 'bulge':
            return new F.BulgePinchFilter({
              center: { x: 0.5, y: 0.5 },
              radius: Math.min(W, H) * 0.42,
              strength: 0,
            });
          case 'godrays':
            return new F.GodrayFilter({
              angle: 30 + angle,
              gain: 0.45 + 0.1 * density,
              lacunarity: 2.6,
              parallel: true,
              alpha: 0.85,
            });
          case 'reflection':
            return new F.ReflectionFilter({
              mirror: true,
              boundary: 0.66,
              amplitude: [0, 18 * weight],
              waveLength: [30, 110],
              alpha: [1, 1],
            });
          default:
            return null;
        }
      })();
      if (filter) stage.filters = [filter];
      if (color && kind === 'godrays') stage.tint = color;

      // One moment of the effect (seconds since its start, at its speed).
      const draw = (seconds: number) => {
        const t = seconds * speed;
        const wave = 0.5 + 0.5 * Math.sin(t * 1.6);
        if (filter instanceof PIXI.DisplacementFilter && noise) {
          noise.position.set(t * 30, t * 18);
        } else if (filter instanceof F.ShockwaveFilter) {
          filter.time = t % 2.6;
        } else if (filter instanceof F.AdvancedBloomFilter) {
          // Only the brightest parts glow, breathing gently.
          filter.bloomScale = 0.2 + 0.55 * weight * wave;
        } else if (filter instanceof F.ZoomBlurFilter) {
          filter.strength = 0.14 * weight * Math.pow(wave, 3);
        } else if (filter instanceof F.TwistFilter) {
          filter.angle = 2.2 * weight * Math.sin(t * 0.7);
        } else if (filter instanceof F.BulgePinchFilter) {
          filter.strength = 0.55 * Math.max(-1, Math.min(1, weight * Math.sin(t * 1.1)));
        } else if (filter instanceof F.GodrayFilter) {
          filter.time = t * 0.6;
        } else if (filter instanceof F.ReflectionFilter) {
          filter.time = t * 1.4;
        }
        app.render();
      };
      const entry: Layer = { draw, held: false };
      layers.set(el, entry);

      const resize = new ResizeObserver(() => {
        ({ W, H } = layout());
        if (filter instanceof F.ShockwaveFilter || filter instanceof F.ZoomBlurFilter)
          filter.center = { x: W / 2, y: H / 2 };
        if (filter instanceof F.TwistFilter) {
          filter.offset = { x: W / 2, y: H / 2 };
          filter.radius = Math.min(W, H) * 0.48;
        }
        if (filter instanceof F.BulgePinchFilter) filter.radius = Math.min(W, H) * 0.42;
      });
      resize.observe(box);

      // Its own clock: 30 drawings a second, none while off screen or hidden.
      const start = performance.now();
      let last = 0;
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (entry.held || now - last < 33 || document.hidden || el.closest('[data-off]')) return;
        last = now;
        draw((now - start) / 1000);
      };
      frame = requestAnimationFrame(tick);

      cleanup = () => {
        resize.disconnect();
        layers.delete(el);
        // Give the WebGL canvas back at once (phones allow only a few).
        const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
        app.destroy({ removeView: false }, { children: true, texture: true, textureSource: true });
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      };
      if (stopped) cleanup();
    })().catch(() => {
      // No WebGL here: the effect is simply left out.
    });

    return () => {
      stopped = true;
      live--;
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [kind, image, preview, blank, weight, density, color, angle, speed]);

  if (preview)
    return (
      <span className="gpu-stand-in" aria-hidden="true">
        {STAND_IN[kind]}
      </span>
    );
  if (blank) return null;
  // A new canvas for each set-up: a WebGL canvas can't start again once given back.
  return (
    <canvas
      key={`${kind}|${image}|${weight}|${density}|${color}|${angle}|${speed}`}
      ref={ref}
      className="gpu-canvas"
    />
  );
}
