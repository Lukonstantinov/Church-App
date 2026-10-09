import { useRef, useState, type ReactNode } from 'react';
import type { PosterLayer } from '@church/shared';
import { haptic } from '../lib/telegram';

/**
 * Moving poster layers with fingers, right on the preview: one finger drags the layer it
 * touches (the chosen one first, if it is under the finger), two fingers resize and turn
 * it. Works on pictures, texts, colour layers and effect layers. The page and Telegram
 * don't move while doing it (touch-action: none; the app's swipe-to-close is off).
 * Lines snap to the middle. The chosen layer gets a dashed outline while `outline` or
 * while a finger is on it (none in a recording).
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
    </div>
  );
}

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
      x: snap(clamp((l.x ?? 50) + dx, -50, 150), s),
      y: snap(clamp((l.y ?? 50) + dy, -50, 150), s),
      w: Math.round(clamp((l.w ?? 100) * scale, 5, 300)),
      h: Math.round(clamp((l.h ?? 100) * scale, 5, 300)),
    };
  }
  if (l.type === 'fill')
    return {
      x: snap(clamp(l.x + dx, -50, 150), s),
      y: snap(clamp(l.y + dy, -50, 150), s),
      w: Math.round(clamp(l.w * scale, 2, 300)),
      h: Math.round(clamp(l.h * scale, 2, 300)),
      rotate: turnTo(l.rotate + turn),
    };
  if (l.type === 'image' && l.fit === 'cover') {
    // A photo filling the poster: x/y say which part stays in view (0 = its left/top edge),
    // so dragging it right shows more of its left side.
    const zoom = clamp(l.size * scale, 100, 300);
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
    x: snap(clamp(l.x + dx, -50, 150), s),
    y: snap(clamp(l.y + dy, -50, 150), s),
    size: Math.round(clamp(l.size * scale, 2, 300) * 10) / 10,
    rotate: turnTo(l.rotate + turn),
  };
}
