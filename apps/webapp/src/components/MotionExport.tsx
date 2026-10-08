import { useRef, useState, type RefObject } from 'react';
import { displayName, type PosterAudience } from '@church/shared';
import type { EventDetail, EventSummary } from '@church/shared';
import { FullMotion } from '../lib/perf';
import { CoverPicture } from './CoverSlideshow';
import { useT } from '../lib/i18n';
import { sendAnimationToChat, useContacts, useCoverLoop, useMe } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { EventCover, EventHeroText, useEventWhen } from './EventCard';
import { useToast } from './Toast';
import { Button, TextArea } from './ui';

/**
 * Quality of a moving poster: the video's and the GIF's width, frames a second and how much
 * detail the video keeps. Higher takes longer to record and makes bigger files.
 */
const QUALITY = {
  standard: { video: 720, gif: 540, fps: 20, bitrate: 0.12 },
  high: { video: 1080, gif: 640, fps: 20, bitrate: 0.12 },
  max: { video: 1080, gif: 720, fps: 24, bitrate: 0.2 },
} as const;

/**
 * Telegram plays a GIF in the chat only while it is small enough; a bigger one arrives as
 * a file to download (a 13 MB one did). A GIF over this is made again, narrower.
 */
const GIF_MAX_BYTES = 9_000_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * «Send me the animation»: records the poster with its moving effects (lib/recorder.ts)
 * and the bot sends it to the person's own chat with `caption` (what, when, where) under it
 * — as a short video or a GIF, both playing in the chat (long-press to save or forward).
 * `onRecording` switches the poster's effects fully on while it records, whatever this
 * phone's graphics setting.
 */
export function MotionExport({
  node,
  name,
  caption,
  onRecording,
  share,
}: {
  node: RefObject<HTMLElement | null>;
  name: string;
  caption?: string;
  onRecording?: (on: boolean) => void;
  /**
   * The event or meeting it is for, when the person may publish there: then it can go to
   * chosen people, the whole ministry, the whole church (church admins) or those serving.
   */
  share?: { kind: 'event' | 'meeting'; id: number; groupId: number };
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  // The text under the poster: prepared from the event/meeting, editable; follows the
  // prepared text until the person changes it.
  const [ownText, setOwnText] = useState<string | null>(null);
  const text = ownText ?? caption ?? '';
  const [to, setTo] = useState<PosterAudience>('me');
  const [chosen, setChosen] = useState<number[]>([]);
  const contacts = useContacts(share?.groupId ?? 0, !!share && to === 'people');
  const audiences: PosterAudience[] = share
    ? ['me', 'people', 'group', ...(me.data?.user.isAdmin ? (['church'] as const) : []), 'serving']
    : ['me'];
  const [busy, setBusy] = useState<'video' | 'gif' | null>(null);
  const [quality, setQuality] = useState<keyof typeof QUALITY>('standard');
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [shrinking, setShrinking] = useState(false);

  async function run(kind: 'video' | 'gif') {
    if (busy) return;
    if (to === 'people' && chosen.length === 0) {
      toast(t.motionExport.noneChosen, 'error');
      return;
    }
    if (to !== 'me' && !(await confirmDialog(t.motionExport.confirmTo(t.motionExport.to[to]))))
      return;
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
      const q = QUALITY[quality];
      const record = (gifWidth: number) =>
        recordLoop(el, {
          gif: kind === 'gif',
          // A GIF only: no video is made alongside (quicker).
          video: kind === 'video',
          // The picture is drawn at least as wide as the file that is made from it.
          width: kind === 'gif' ? Math.max(720, q.gif) : q.video,
          gifWidth,
          fps: q.fps,
          quality: q.bitrate,
          onProgress: setProgress,
        });
      let rec = await record(q.gif);
      // Too big for Telegram to play: again, narrower by about as much as needed.
      let width: number = q.gif;
      for (let tries = 0; rec.gif && rec.gif.size > GIF_MAX_BYTES && tries < 3; tries++) {
        width = even(width * Math.sqrt(GIF_MAX_BYTES / rec.gif.size) * 0.92);
        if (width < 300) break;
        setShrinking(true);
        setProgress(0);
        rec = await record(width);
      }
      const file = kind === 'gif' ? rec.gif : (rec.mp4 ?? rec.gif);
      if (!file) throw new Error('no_file');
      if (kind === 'video' && !rec.mp4) toast(t.motionExport.noVideo);
      setSending(true);
      const safe = name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 50) || 'poster';
      const res = await sendAnimationToChat(
        file,
        safe,
        text.trim() || undefined,
        share && to !== 'me' ? { to, kind: share.kind, id: share.id, users: chosen } : undefined,
      );
      haptic.success();
      toast(to === 'me' ? t.motionExport.sent : t.motionExport.sentTo(res.sent));
    } catch (err) {
      console.warn('recording failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      onRecording?.(false);
      setSending(false);
      setShrinking(false);
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
              : shrinking
                ? t.motionExport.shrinking(Math.round(progress * 100))
                : t.motionExport.recording(Math.round(progress * 100))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(QUALITY) as (keyof typeof QUALITY)[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setQuality(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  quality === k ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                }`}
              >
                {t.motionExport.quality[k]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-hint">{t.motionExport.qualityHint[quality]}</p>
          <div className="text-[12px] font-semibold text-hint">{t.motionExport.textLabel}</div>
          <TextArea value={text} onChange={setOwnText} maxLength={1024} rows={3} />
          {audiences.length > 1 && (
            <>
              <div className="text-[12px] font-semibold text-hint">{t.motionExport.toLabel}</div>
              <div className="flex flex-wrap gap-1.5">
                {audiences.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      setTo(a);
                    }}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                      to === a ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                    }`}
                  >
                    {t.motionExport.to[a]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-hint">{t.motionExport.toHint[to]}</p>
              {to === 'people' && (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {(contacts.data ?? [])
                    .filter((c) => c.id !== me.data?.user.id)
                    .map((c) => {
                      const on = chosen.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={c.offline}
                          onClick={() =>
                            setChosen(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])
                          }
                          className={`rounded-full px-3 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
                            on ? 'bg-[var(--brand)] text-white' : 'glass'
                          }`}
                        >
                          {on ? '✓ ' : ''}
                          {displayName(c)}
                        </button>
                      );
                    })}
                </div>
              )}
            </>
          )}
          <div className="flex gap-2">
            <Button small onClick={() => void run('video')}>
              {to === 'me' ? t.motionExport.video : t.motionExport.sendVideo}
            </Button>
            <Button small variant="secondary" onClick={() => void run('gif')}>
              {to === 'me' ? t.motionExport.gif : t.motionExport.sendGif}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * An event's cover as a poster to record (laid out at phone size, recorded sharper), always
 * with what, when and where: the poster template, the designed cover or
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
      {/* The shape, shade and name block of the event screen's cover, so the poster shows
          the photo framed exactly as in the app. */}
      <EventCover
        e={{ ...e, coverLoop: null }}
        className={photo || e.poster ? 'aspect-[4/3]' : undefined}
      />
      {photo && (
        <>
          <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <EventHeroText e={e} />
          </div>
        </>
      )}
      {/* A designed cover or poster template shows its own title: the date and place go
          in a band under it, so the shared poster still says when and where. */}
      {!photo && (
        <div className="flex flex-col gap-0.5 bg-[#111] px-5 py-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">
            {e.groupName}
          </div>
          <div className="text-[16px] font-semibold">{when(e)}</div>
          {e.location && <div className="text-[14px] opacity-85">📍 {e.location}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * «🎬 Video cover»: the cover photo with its effects recorded once as a loop that phones
 * play instead of drawing the effects (event cards, pinned card, event screen). Only a
 * single photo with effects; any later change of the photo or effects brings the live
 * effects back until it is recorded again (the server keeps its fingerprint).
 */
export function CoverLoopSection({ e }: { e: EventDetail }) {
  const t = useT();
  const toast = useToast();
  const save = useCoverLoop(e.id);
  const node = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const moving = !!e.motion && e.motion !== 'off';
  if (!e.canDesign || !e.coverUrl || e.poster || e.coverSlides || !moving) return null;

  async function record() {
    setProgress(0);
    try {
      await new Promise((r) => setTimeout(r, 500));
      const { recordLoop } = await import('../lib/recorder');
      if (!node.current) throw new Error('no_cover');
      const rec = await recordLoop(node.current, { quality: 0.08, onProgress: setProgress });
      if (!rec.mp4) {
        toast(t.studio.bakeNoVideo, 'error');
        return;
      }
      await save.mutateAsync(rec.mp4);
      haptic.success();
      toast(t.common.saved);
    } catch (err) {
      console.warn('cover loop failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl p-3 ring-1 ring-hairline">
      <div className="text-[15px] font-semibold">{t.motionExport.coverTitle}</div>
      <p className="text-[12px] leading-snug text-hint">{t.motionExport.coverHint}</p>
      {e.coverLoop && (
        <p className="text-[13px] font-semibold text-present">✓ {t.studio.bakeFresh}</p>
      )}
      {progress !== null ? (
        <div className="flex flex-col gap-1.5 py-1">
          <div className="h-2 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-center text-[13px] text-hint">
            {t.motionExport.recording(Math.round(progress * 100))}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button small disabled={save.isPending} onClick={() => void record()}>
            🎬 {e.coverLoop ? t.studio.bakeAgain : t.studio.bakeRecord}
          </Button>
          {e.coverLoop && (
            <Button
              small
              variant="glass"
              disabled={save.isPending}
              onClick={() => void save.mutateAsync(null).catch(() => undefined)}
            >
              {t.studio.bakeRemove}
            </Button>
          )}
        </div>
      )}
      {/* The cover (photo and effects, no texts), off screen and only while recording. */}
      {progress !== null && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0 }}>
          <FullMotion.Provider value>
            <div ref={node} className="relative aspect-[4/3] w-[400px] overflow-hidden bg-black">
              <CoverPicture e={{ ...e, coverLoop: null }} />
            </div>
          </FullMotion.Provider>
        </div>
      )}
    </div>
  );
}
