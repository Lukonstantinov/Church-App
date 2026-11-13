import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LAYER_REACH, type PosterLayer } from '@church/shared';
import { haptic } from '../lib/telegram';

/**
 * Moving poster layers with fingers, right on the preview: one finger drags the layer it
 * touches (the chosen one first, if it is under the finger), two fingers resize and turn
 * it. Works on pictures, texts, colour layers and effect layers. The page and Telegram
 * don't move while doing it (touch-action: none; the app's swipe-to-close is off).
 * Lines snap to the middle. The chosen layer gets a dashed outline while `outline` or
 * while a finger is on it (none in a recording).
 *
 * With `outline` the chosen layer also has handles to drag (a finger or the mouse): the
 * corner resizes it, the side and bottom ones stretch it one way only — a picture out of
 * its own shape, a colour or effect layer wider or taller. Any size goes, also far bigger
 * than the poster: the poster shows the part inside it. Handles of a layer reaching past
 * the poster wait at its edge, so they can always be reached.
 */
export function PosterGestures({
  layers,
  selected,
  onSelect,
  onPatch,
  outline,
  children,
}: {
  layers: PosterLayer[];
  selected: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, p: Partial<PosterLayer>) => void;
  /** Show the chosen layer's outline all the time (the editor), not only while moving. */
  outline?: boolean;
  children: ReactNode;
}) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{
    id: string;
    layer: PosterLayer;
    box: DOMRect;
    points: { x: number; y: number }[];
    snapped: boolean;
  } | null>(null);
  const [active, setActive] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Where the chosen layer is inside this box (for its handles), measured after each draw.
  const [frame, setFrame] = useState<{
    l: number;
    t: number;
    r: number;
    b: number;
    /** This box's own size (handles are kept inside it). */
    W: number;
    H: number;
  } | null>(null);
  const chosen = layers.find((l) => l.id === selected);
  useLayoutEffect(() => {
    const box = wrap.current;
    const el =
      outline && selected && chosen && !chosen.hidden
        ? box?.querySelector(`[data-layer-id="${CSS.escape(selected)}"]`)
        : null;
    if (!box || !el) {
      setFrame((f) => (f ? null : f));
      return;
    }
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const next = {
      l: r.left - b.left,
      t: r.top - b.top,
      r: r.right - b.left,
      b: r.bottom - b.top,
      W: b.width,
      H: b.height,
    };
    setFrame((f) =>
      f &&
      Math.abs(f.l - next.l) +
        Math.abs(f.t - next.t) +
        Math.abs(f.r - next.r) +
        Math.abs(f.b - next.b) +
        Math.abs(f.W - next.W) <
        0.5
        ? f
        : next,
    );
    // Measured again whenever the chosen layer changes (moved, resized, another one picked).
  }, [outline, selected, chosen]);
  const grip = useRef<{
    mode: 'both' | 'wide' | 'tall';
    layer: PosterLayer;
    /** The layer's middle on the screen, and the pointer's start from it (in the layer's own axes). */
    cx: number;
    cy: number;
    u0: number;
    v0: number;
    /** Half the layer's width and height on the screen. */
    hw: number;
    hh: number;
  } | null>(null);
  /** The pointer's place from the layer's middle, along the layer's own (turned) axes. */
  const axes = (x: number, y: number, g: { cx: number; cy: number; layer: PosterLayer }) => {
    const turn = 'rotate' in g.layer ? ((g.layer.rotate ?? 0) * Math.PI) / 180 : 0;
    const dx = x - g.cx;
    const dy = y - g.cy;
    return {
      u: dx * Math.cos(turn) + dy * Math.sin(turn),
      v: -dx * Math.sin(turn) + dy * Math.cos(turn),
    };
  };
  const gripDown = (e: React.PointerEvent, mode: 'both' | 'wide' | 'tall') => {
    if (!chosen || !frame || !wrap.current) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const b = wrap.current.getBoundingClientRect();
    const g = {
      mode,
      layer: chosen,
      cx: b.left + (frame.l + frame.r) / 2,
      cy: b.top + (frame.t + frame.b) / 2,
    };
    const { u, v } = axes(e.clientX, e.clientY, g);
    grip.current = {
      ...g,
      u0: u,
      v0: v,
      hw: Math.max(4, (frame.r - frame.l) / 2),
      hh: Math.max(4, (frame.b - frame.t) / 2),
    };
    setActive(true);
  };
  const gripMove = (e: React.PointerEvent) => {
    const g = grip.current;
    if (!g) return;
    e.stopPropagation();
    const { u, v } = axes(e.clientX, e.clientY, g);
    // By how far the pointer has gone from where it gripped, against the layer's half size
    // (not the handle's place: the handle of a layer bigger than the poster waits at the
    // poster's edge, far from the layer's real corner).
    const wide = (g.hw + (u - g.u0)) / g.hw;
    const tall = (g.hh + (v - g.v0)) / g.hh;
    const k = g.mode === 'both' ? (wide + tall) / 2 : g.mode === 'wide' ? wide : tall;
    onPatch(g.layer.id, sized(g.layer, g.mode, Math.max(0.02, k)));
  };
  const gripUp = (e: React.PointerEvent) => {
    if (!grip.current) return;
    e.stopPropagation();
    grip.current = null;
    setActive(false);
  };

  /** The layer under the finger: the chosen one if it is there, else the topmost. */
  const hit = (x: number, y: number): { id: string; box: DOMRect } | null => {
    const stack = document.elementsFromPoint(x, y);
    const ids: string[] = [];
    let poster: Element | null = null;
    for (const el of stack) {
      const id = el.closest('[data-layer-id]')?.getAttribute('data-layer-id');
      if (id && !ids.includes(id)) ids.push(id);
      poster ??= el.closest('.layered-poster');
    }
    if (!poster || ids.length === 0) return null;
    const visible = ids.filter((id) => !layers.find((l) => l.id === id)?.hidden);
    const id = selected && visible.includes(selected) ? selected : visible[0];
    return id ? { id, box: poster.getBoundingClientRect() } : null;
  };

  const begin = () => {
    const s = start.current;
    if (!s) return;
    s.points = [...pointers.current.values()].map((p) => ({ ...p }));
    s.layer = layers.find((l) => l.id === s.id) ?? s.layer;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const h = hit(e.clientX, e.clientY);
      if (!h) {
        pointers.current.clear();
        return;
      }
      const layer = layers.find((l) => l.id === h.id);
      if (!layer) return;
      if (h.id !== selected) {
        haptic.tap();
        onSelect(h.id);
      }
      start.current = { id: h.id, layer, box: h.box, points: [], snapped: false };
      setActive(true);
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    // A second finger restarts the gesture from where things are now.
    begin();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    const now = [...pointers.current.values()];
    if (now.length !== s.points.length) return;
    const W = s.box.width || 1;
    const H = s.box.height || 1;
    const mid = (ps: { x: number; y: number }[]) => ({
      x: ps.reduce((a, p) => a + p.x, 0) / ps.length,
      y: ps.reduce((a, p) => a + p.y, 0) / ps.length,
    });
    const m0 = mid(s.points);
    const m1 = mid(now);
    const dx = ((m1.x - m0.x) / W) * 100;
    const dy = ((m1.y - m0.y) / H) * 100;
    let scale = 1;
    let turn = 0;
    if (now.length >= 2) {
      const [a0, b0] = s.points as [{ x: number; y: number }, { x: number; y: number }];
      const [a1, b1] = now as [{ x: number; y: number }, { x: number; y: number }];
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      scale = d1 / d0;
      turn =
        ((Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) /
        Math.PI;
    }
    onPatch(s.id, moved(s.layer, dx, dy, scale, turn, s, W, H));
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      start.current = null;
      setActive(false);
    } else begin();
  };

  return (
    <div
      ref={wrap}
      className="relative touch-none select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {(outline || active) && selected && (
        <style>{`[data-layer-id="${CSS.escape(selected)}"]{outline:1.5px dashed rgba(255,255,255,.95);outline-offset:1px;box-shadow:0 0 0 1px rgba(0,0,0,.35)}`}</style>
      )}
      {children}
      {frame && chosen && (
        <Handles frame={frame} layer={chosen} onDown={gripDown} onMove={gripMove} onUp={gripUp} />
      )}
    </div>
  );
}

/**
 * The chosen layer's handles: the corner resizes it, the side and bottom ones stretch it
 * one way. Kept inside the box, so a layer bigger than the poster can still be gripped.
 */
function Handles({
  frame,
  layer,
  onDown,
  onMove,
  onUp,
}: {
  frame: { l: number; t: number; r: number; b: number; W: number; H: number };
  layer: PosterLayer;
  onDown: (e: React.PointerEvent, mode: 'both' | 'wide' | 'tall') => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
}) {
  const inX = (x: number) => Math.min(frame.W - 6, Math.max(6, x));
  const inY = (y: number) => Math.min(frame.H - 6, Math.max(6, y));
  const cover = layer.type === 'image' && layer.fit === 'cover';
  // One way only: pictures placed freely (with a known shape), colour and effect layers.
  const oneWay =
    layer.type === 'fill' ||
    layer.type === 'effect' ||
    (layer.type === 'image' && !cover && !!layer.ratio);
  const dot = (mode: 'both' | 'wide' | 'tall', x: number, y: number, cursor: string) => (
    <span
      key={mode}
      role="slider"
      aria-label={mode}
      aria-valuenow={0}
      tabIndex={-1}
      onPointerDown={(e) => onDown(e, mode)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute z-30 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: inX(x), top: inY(y), cursor, touchAction: 'none' }}
    >
      <span
        className={`block border-2 border-white bg-[var(--brand)] shadow-[0_0_0_1px_rgba(0,0,0,.45)] ${
          mode === 'both'
            ? 'h-4 w-4 rounded-full'
            : mode === 'wide'
              ? 'h-6 w-2.5 rounded-full'
              : 'h-2.5 w-6 rounded-full'
        }`}
      />
    </span>
  );
  return (
    <>
      {dot('both', frame.r, frame.b, 'nwse-resize')}
      {oneWay && dot('wide', frame.r, (frame.t + frame.b) / 2, 'ew-resize')}
      {oneWay && dot('tall', (frame.l + frame.r) / 2, frame.b, 'ns-resize')}
    </>
  );
}

/** The layer as it was when a handle was gripped, resized `k` times (both ways or one). */
function sized(l: PosterLayer, mode: 'both' | 'wide' | 'tall', k: number): Partial<PosterLayer> {
  const big = LAYER_REACH.size;
  const round = (v: number) => Math.round(v * 10) / 10;
  if (l.type === 'effect' || l.type === 'fill') {
    const w = l.w ?? 100;
    const h = l.h ?? 100;
    const lo = l.type === 'effect' ? 5 : 2;
    return {
      ...(mode !== 'tall' ? { w: Math.round(clamp(w * k, lo, big)) } : {}),
      ...(mode !== 'wide' ? { h: Math.round(clamp(h * k, lo, big)) } : {}),
      // An effect layer over the whole poster gets a place of its own once resized.
      ...(l.type === 'effect' ? { x: l.x ?? 50, y: l.y ?? 50 } : {}),
    };
  }
  if (l.type === 'image' && l.fit === 'cover')
    return { size: Math.round(clamp(l.size * k, 100, big)) };
  if (l.type === 'image' && mode !== 'both') {
    const stretch = l.stretch ?? 1;
    // Wider: the width grows and the height stays (so the stretch shrinks); taller: only the stretch.
    if (mode === 'wide') {
      const size = clamp(l.size * k, 2, big);
      return { size: round(size), stretch: round2(clamp((stretch * l.size) / size, 0.1, 10)) };
    }
    return { stretch: round2(clamp(stretch * k, 0.1, 10)) };
  }
  return { size: round(clamp(l.size * k, 2, big)) };
}
const round2 = (v: number) => Math.round(v * 100) / 100;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const turnTo = (deg: number) => Math.round(((((deg + 180) % 360) + 360) % 360) - 180);

/** A centre that lands near the middle snaps to it (with a little tap). */
function snap(v: number, s: { snapped: boolean }) {
  if (Math.abs(v - 50) < 1.5) {
    if (!s.snapped) haptic.tap();
    s.snapped = true;
    return 50;
  }
  s.snapped = false;
  return Math.round(v * 10) / 10;
}

/** The layer as it was at the gesture's start, moved, resized and turned. */
function moved(
  l: PosterLayer,
  dx: number,
  dy: number,
  scale: number,
  turn: number,
  s: { snapped: boolean },
  W: number,
  H: number,
): Partial<PosterLayer> {
  if (l.type === 'effect') {
    return {
      x: snap(clamp((l.x ?? 50) + dx, LAYER_REACH.min, LAYER_REACH.max), s),
      y: snap(clamp((l.y ?? 50) + dy, LAYER_REACH.min, LAYER_REACH.max), s),
      w: Math.round(clamp((l.w ?? 100) * scale, 5, LAYER_REACH.size)),
      h: Math.round(clamp((l.h ?? 100) * scale, 5, LAYER_REACH.size)),
    };
  }
  if (l.type === 'fill')
    return {
      x: snap(clamp(l.x + dx, LAYER_REACH.min, LAYER_REACH.max), s),
      y: snap(clamp(l.y + dy, LAYER_REACH.min, LAYER_REACH.max), s),
      w: Math.round(clamp(l.w * scale, 2, LAYER_REACH.size)),
      h: Math.round(clamp(l.h * scale, 2, LAYER_REACH.size)),
      rotate: turnTo(l.rotate + turn),
    };
  if (l.type === 'image' && l.fit === 'cover') {
    // A photo filling the poster: x/y say which part stays in view (0 = its left/top edge),
    // so dragging it right shows more of its left side.
    const zoom = clamp(l.size * scale, 100, LAYER_REACH.size);
    const r = l.ratio ?? W / H;
    const pw = Math.max(W, r * H) * (zoom / 100);
    const ph = Math.max(H, W / r) * (zoom / 100);
    const spareX = pw - W;
    const spareY = ph - H;
    return {
      x: spareX > 1 ? clamp(l.x - (dx * W) / spareX, 0, 100) : l.x,
      y: spareY > 1 ? clamp(l.y - (dy * H) / spareY, 0, 100) : l.y,
      size: Math.round(zoom),
    };
  }
  return {
    x: snap(clamp(l.x + dx, LAYER_REACH.min, LAYER_REACH.max), s),
    y: snap(clamp(l.y + dy, LAYER_REACH.min, LAYER_REACH.max), s),
    size: Math.round(clamp(l.size * scale, 2, LAYER_REACH.size) * 10) / 10,
    rotate: turnTo(l.rotate + turn),
  };
}
