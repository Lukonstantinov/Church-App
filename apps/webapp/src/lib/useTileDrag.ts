import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import { haptic } from './telegram';

const HOLD_MS = 380;
const SLOP = 10;

/**
 * Long-press a tile and drag it over another to change their places. Scrolling still
 * works: a press that moves before the hold is just a scroll. Each tile gets
 * `bind(key)` (pointer handlers + data-tile) and `state(key)` for its look; `onMove`
 * receives the dragged key and the key it was dropped on.
 */
export function useTileDrag(onMove: (from: string, to: string) => void) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const press = useRef<{
    key: string;
    x: number;
    y: number;
    scroll: number;
    timer: ReturnType<typeof setTimeout> | null;
    active: boolean;
  } | null>(null);
  const justDragged = useRef(false);
  const lastOver = useRef<string | null>(null);

  const finish = useCallback(
    (drop: boolean) => {
      const p = press.current;
      if (p?.timer) clearTimeout(p.timer);
      if (p?.active) {
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 350);
        if (drop && lastOver.current && lastOver.current !== p.key) {
          haptic.success();
          onMove(p.key, lastOver.current);
        }
      }
      press.current = null;
      lastOver.current = null;
      setDragKey(null);
      setOverKey(null);
      setOffset({ x: 0, y: 0 });
    },
    [onMove],
  );

  // While dragging, the page must not scroll under the finger.
  useEffect(() => {
    if (!dragKey) return;
    const stop = (e: TouchEvent) => e.cancelable && e.preventDefault();
    window.addEventListener('touchmove', stop, { passive: false });
    return () => window.removeEventListener('touchmove', stop);
  }, [dragKey]);

  const bind = (key: string) => ({
    'data-tile': key,
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== undefined && e.button > 0) return;
      const timer = setTimeout(() => {
        const p = press.current;
        if (!p || p.key !== key) return;
        p.active = true;
        haptic.tap();
        setDragKey(key);
      }, HOLD_MS);
      press.current = {
        key,
        x: e.clientX,
        y: e.clientY,
        scroll: window.scrollY,
        timer,
        active: false,
      };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.key !== key) return;
      if (!p.active) {
        // Moved before the hold: the finger is scrolling.
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP && p.timer) {
          clearTimeout(p.timer);
          press.current = null;
        }
        return;
      }
      setOffset({ x: e.clientX - p.x, y: e.clientY - p.y + (window.scrollY - p.scroll) });
      // Near the screen's edge the page follows.
      if (e.clientY < 90) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - 130) window.scrollBy(0, 12);
      const under = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((el) => (el as HTMLElement).closest?.('[data-tile]') as HTMLElement | null)
        .find((el) => el && el.dataset.tile !== key);
      const next = under?.dataset.tile ?? null;
      if (next !== lastOver.current) {
        lastOver.current = next;
        setOverKey(next);
        if (next) haptic.tap();
      }
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    // A drag must not also count as a tap.
    onClickCapture: (e: React.MouseEvent) => {
      if (justDragged.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  });

  const state = (key: string) => ({
    dragging: dragKey === key,
    over: overKey === key && dragKey !== key,
    style:
      dragKey === key
        ? {
            transform: `translate(${offset.x}px, ${offset.y}px) scale(1.04)`,
            touchAction: 'none' as const,
          }
        : undefined,
  });

  return { bind, state, active: dragKey !== null };
}
