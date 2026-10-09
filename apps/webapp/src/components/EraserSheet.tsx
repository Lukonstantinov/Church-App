import { useEffect, useRef, useState } from 'react';
import { MEDIA_MAX_BYTES } from '@church/shared';
import { imageOf } from '../lib/cutout';
import { useT } from '../lib/i18n';
import { canvasToBlob } from '../lib/image';
import { freeCanvas } from '../lib/poster';
import { haptic } from '../lib/telegram';
import { Knob } from './MotionTune';
import { Pill } from './LookControls';
import { Sheet } from './Sheet';
import { Button } from './ui';

/**
 * The eraser for a picture layer: rub out what shouldn't be there with a finger (a piece of
 * the stage left on a cut-out, a corner of a logo), or bring parts back. "Bring back" paints
 * from the whole original photo when the picture was cut out of one (`sourceUrl`), else
 * from the picture as it was. Brush size and softness; undo; pinch is not needed — the
 * picture fills the sheet's width. Saved as a new picture (see-through kept).
 */
export function EraserSheet({
  url,
  sourceUrl,
  onDone,
  onClose,
}: {
  url: string;
  sourceUrl?: string | null;
  onDone: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const te = t.posters.eraser;
  const view = useRef<HTMLCanvasElement>(null);
  /** What is kept (white) and rubbed out (see-through), at the picture's size. */
  const mask = useRef<HTMLCanvasElement | null>(null);
  /** What "bring back" paints from. */
  const full = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [size, setSize] = useState(0.06);
  const [soft, setSoft] = useState(0.5);
  const [steps, setSteps] = useState(0);
  const [saving, setSaving] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // The picture, its original and a mask from the picture's own see-through parts.
  useEffect(() => {
    let stop = false;
    void (async () => {
      const pic = await imageOf(url);
      const orig = sourceUrl ? await imageOf(sourceUrl).catch(() => null) : null;
      if (stop) return;
      const w = pic.naturalWidth;
      const h = pic.naturalHeight;
      const m = document.createElement('canvas');
      m.width = w;
      m.height = h;
      m.getContext('2d')!.drawImage(pic, 0, 0);
      const f = document.createElement('canvas');
      f.width = w;
      f.height = h;
      f.getContext('2d')!.drawImage(orig ?? pic, 0, 0, w, h);
      mask.current = m;
      full.current = f;
      const v = view.current!;
      v.width = w;
      v.height = h;
      setReady(true);
    })();
    return () => {
      stop = true;
      freeCanvas(mask.current);
      freeCanvas(full.current);
    };
  }, [url, sourceUrl]);

  /** Shows the picture: the original where the mask keeps it, a check pattern elsewhere. */
  const paint = () => {
    const v = view.current;
    const m = mask.current;
    const f = full.current;
    if (!v || !m || !f) return;
    const ctx = v.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.drawImage(f, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  };
  useEffect(() => {
    if (ready) paint();
  }, [ready]);

  const at = (e: React.PointerEvent) => {
    const v = view.current!;
    const r = v.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * v.width,
      y: ((e.clientY - r.top) / r.height) * v.height,
    };
  };

  /** One dab of the brush on the mask (erase cuts it, bring back fills it from the original). */
  const dab = (x: number, y: number) => {
    const m = mask.current!;
    const ctx = m.getContext('2d')!;
    const radius = Math.max(2, size * Math.max(m.width, m.height));
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(Math.max(0.01, 1 - soft), 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  const stroke = (to: { x: number; y: number }) => {
    const from = last.current ?? to;
    const m = mask.current!;
    const step = Math.max(1, size * Math.max(m.width, m.height) * 0.25);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++)
      dab(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
    last.current = to;
    paint();
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ready) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const m = mask.current!;
    undo.current.push(m.getContext('2d')!.getImageData(0, 0, m.width, m.height));
    if (undo.current.length > 12) undo.current.shift();
    setSteps(undo.current.length);
    last.current = null;
    stroke(at(e));
  };
  const onMove = (e: React.PointerEvent) => {
    if (last.current) stroke(at(e));
  };
  const onUp = () => {
    last.current = null;
  };

  const back = () => {
    const prev = undo.current.pop();
    if (!prev || !mask.current) return;
    mask.current.getContext('2d')!.putImageData(prev, 0, 0);
    setSteps(undo.current.length);
    paint();
  };

  async function save() {
    const v = view.current;
    if (!v) return;
    setSaving(true);
    try {
      // The finished picture, smaller if needed to fit the upload limit.
      let out: Blob | null = null;
      for (const k of [1, 0.8, 0.6, 0.45]) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.width * k));
        c.height = Math.max(1, Math.round(v.height * k));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        let b = await canvasToBlob(c, 'image/webp', 0.9);
        if (!b || b.type !== 'image/webp') b = await canvasToBlob(c, 'image/png');
        freeCanvas(c);
        if (b && b.size <= MEDIA_MAX_BYTES) {
          out = b;
          break;
        }
      }
      if (!out) throw new Error('too large');
      await onDone(out);
      haptic.success();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`🧽 ${te.title}`}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[13px] leading-snug text-hint">{sourceUrl ? te.hintSource : te.hint}</p>
        <div className="flex justify-center rounded-2xl bg-[repeating-conic-gradient(#cfcfcf_0_25%,#ffffff_0_50%)] bg-[length:16px_16px] p-1">
          <canvas
            ref={view}
            className="max-h-[52dvh] max-w-full touch-none select-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill on={mode === 'erase'} onClick={() => setMode('erase')} label={`🧽 ${te.erase}`} />
          <Pill
            on={mode === 'restore'}
            onClick={() => setMode('restore')}
            label={`🖌 ${te.restore}`}
          />
          <Pill on={false} onClick={back} label={`↶ ${te.undo}${steps ? ` (${steps})` : ''}`} />
        </div>
        <Knob
          label={te.size}
          value={size}
          min={0.01}
          max={0.2}
          step={0.005}
          show={(v) => `${Math.round(v * 100)}`}
          onChange={setSize}
        />
        <Knob
          label={te.soft}
          value={soft}
          min={0}
          max={1}
          step={0.05}
          show={(v) => `${Math.round(v * 100)}%`}
          onChange={setSoft}
        />
        <Button disabled={!ready || saving} onClick={() => void save()}>
          {saving ? t.common.saving : te.done}
        </Button>
      </div>
    </Sheet>
  );
}
