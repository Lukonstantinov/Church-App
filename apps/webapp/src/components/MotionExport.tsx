import { useState, type RefObject } from 'react';
import type { EventSummary } from '@church/shared';
import { useT } from '../lib/i18n';
import { sendAnimationToChat } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { EventCover, useEventWhen } from './EventCard';
import { useToast } from './Toast';
import { Button } from './ui';

/**
 * «Send me the animation»: records the poster with its moving effects (lib/recorder.ts)
 * and the bot sends it to the person's own chat — as a short video that plays like a GIF
 * (Telegram, WhatsApp) or as a real GIF file. `onRecording` switches the poster's effects
 * fully on while it records, whatever this phone's graphics setting.
 */
export function MotionExport({
  node,
  name,
  onRecording,
}: {
  node: RefObject<HTMLElement | null>;
  name: string;
  onRecording?: (on: boolean) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<'video' | 'gif' | null>(null);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);

  async function run(kind: 'video' | 'gif') {
    if (busy) return;
    setBusy(kind);
    setProgress(0);
    onRecording?.(true);
    try {
      // The effects are switched on and laid out before recording starts.
      await new Promise((r) => setTimeout(r, 400));
      const el = node.current;
      const { hasEffects, recordLoop } = await import('../lib/recorder');
      if (!el || !hasEffects(el)) {
        haptic.error();
        toast(t.motionExport.noEffects, 'error');
        return;
      }
      const rec = await recordLoop(el, { gif: kind === 'gif', onProgress: setProgress });
      const file = kind === 'gif' ? rec.gif : (rec.mp4 ?? rec.gif);
      if (!file) throw new Error('no_file');
      if (kind === 'video' && !rec.mp4) toast(t.motionExport.noVideo);
      setSending(true);
      const safe = name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 50) || 'poster';
      await sendAnimationToChat(file, safe);
      haptic.success();
      toast(t.motionExport.sent);
    } catch (err) {
      console.warn('recording failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      onRecording?.(false);
      setSending(false);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl p-3 ring-1 ring-hairline">
      <div className="text-[15px] font-semibold">{t.motionExport.title}</div>
      <p className="text-[12px] leading-snug text-hint">{t.motionExport.hint}</p>
      {busy ? (
        <div className="flex flex-col gap-1.5 py-1">
          <div className="h-2 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-center text-[13px] text-hint">
            {sending
              ? t.motionExport.sending
              : t.motionExport.recording(Math.round(progress * 100))}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => void run('video')}>{t.motionExport.video}</Button>
          <Button variant="secondary" onClick={() => void run('gif')}>
            {t.motionExport.gif}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * An event's cover as a poster to record (laid out at phone size, recorded sharper): the poster template, the designed cover or
 * the cover photo with its effects (a photo gets the title, date and place over it).
 */
export function EventMotionPoster({
  e,
  ref,
}: {
  e: EventSummary;
  ref: RefObject<HTMLDivElement | null>;
}) {
  const when = useEventWhen();
  const photo = !!e.coverUrl && !e.poster;
  return (
    <div ref={ref} className="relative w-[400px] overflow-hidden bg-black text-white">
      <EventCover e={e} className="aspect-[4/5]" />
      {photo && (
        <>
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
              {e.groupName}
            </div>
            <div className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight">
              {e.title}
            </div>
            <div className="mt-1.5 text-[14px] opacity-90">{when(e)}</div>
            {e.location && <div className="mt-0.5 text-[14px] opacity-90">📍 {e.location}</div>}
          </div>
        </>
      )}
    </div>
  );
}
