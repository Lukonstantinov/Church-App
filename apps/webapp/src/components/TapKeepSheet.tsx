import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { previewKeep, type KeepPoint } from '../lib/cutout';
import { haptic } from '../lib/telegram';
import { Sheet } from './Sheet';
import { Button } from './ui';

/**
 * «👆 Tap what to keep»: the photo, and wherever the person taps the whole thing there is
 * picked (a person, a pet, a cup, a logo) and shown lit up over the photo. Several taps add
 * several things; ↶ takes the last one back. "Cut out" then cuts exactly that.
 */
export function TapKeepSheet({
  src,
  onCut,
  onClose,
}: {
  src: string;
  onCut: (points: KeepPoint[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tp = t.posters.tapKeep;
  const [points, setPoints] = useState<KeepPoint[]>([]);
  const [stage, setStage] = useState<'loading' | 'working' | null>(null);
  const [failed, setFailed] = useState(false);
  const overlay = useRef<HTMLCanvasElement>(null);

  // The picked parts, redrawn a moment after each tap (the model takes a second or two).
  useEffect(() => {
    let stop = false;
    const id = setTimeout(() => {
      if (!points.length) {
        const c = overlay.current;
        c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        return;
      }
      setFailed(false);
      void previewKeep(src, points, 420, (s) => !stop && setStage(s))
        .then((mask) => {
          if (stop) return;
          const c = overlay.current;
          if (!c) return;
          c.width = mask.width;
          c.height = mask.height;
          const ctx = c.getContext('2d')!;
          ctx.clearRect(0, 0, c.width, c.height);
          // The picked parts glow in the brand colour; the rest is dimmed.
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.globalCompositeOperation = 'destination-out';
          ctx.drawImage(mask, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
        })
        .catch(() => !stop && setFailed(true))
        .finally(() => !stop && setStage(null));
    }, 200);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [src, points]);

  return (
    <Sheet open onClose={onClose} title={`👆 ${tp.title}`}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[13px] leading-snug text-hint">{tp.hint}</p>
        <div
          className="relative overflow-hidden rounded-2xl bg-black/80"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
            if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return;
            haptic.tap();
            setPoints((list) => [...list, p].slice(-10));
          }}
        >
          <img src={src} alt="" className="block w-full select-none" draggable={false} />
          <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
          {points.map((p, i) => (
            <span
              key={i}
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--brand)] shadow"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            />
          ))}
          {stage && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-white">
              {stage === 'loading' ? t.posters.cutLoading : t.posters.cutWorking}
            </span>
          )}
        </div>
        {failed && (
          <p className="text-[13px] text-[var(--color-destructive,#ef4444)]">
            {t.posters.cutFailed}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!points.length}
            onClick={() => setPoints((l) => l.slice(0, -1))}
          >
            ↶ {tp.undo}
          </Button>
          <Button variant="secondary" disabled={!points.length} onClick={() => setPoints([])}>
            {tp.clear}
          </Button>
        </div>
        <Button disabled={!points.length} onClick={() => onCut(points)}>
          ✂️ {tp.cut}
        </Button>
      </div>
    </Sheet>
  );
}
