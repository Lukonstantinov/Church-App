import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { displayName, type PosterAudience } from '@church/shared';
import type { EventDetail, EventSummary } from '@church/shared';
import { FullMotion } from '../lib/perf';
import { CoverPicture } from './CoverSlideshow';
import { useT } from '../lib/i18n';
import { sendAnimationToChat, useContacts, useCoverLoop, useMe } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { EventCover, useEventWhen } from './EventCard';
import {
  PosterTextControls,
  PosterTextLayer,
  posterText,
  type PosterTextMode,
  type PosterTextValue,
} from './PosterText';
import { fontFamily } from '@church/shared';
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
  node: outer,
  preview,
  name,
  caption,
  onRecording,
  share,
  extra,
}: {
  /** The poster to record, drawn by the caller (no preview here). */
  node?: RefObject<HTMLElement | null>;
  /**
   * Or the poster drawn here: a live preview (moving, as it will be recorded) with the
   * words on it to switch off, change, and set in another font, size and place.
   */
  preview?: {
    preset: string;
    render: (text: PosterTextValue) => ReactNode;
    /** The text choices (default: own words or none). */
    modes?: PosterTextMode[];
    /** Laid out this wide (default 400). */
    width?: number;
  };
  name: string;
  caption?: string;
  onRecording?: (on: boolean) => void;
  /**
   * The event or meeting it is for, when the person may publish there: then it can go to
   * chosen people, the whole ministry, the whole church (church admins) or those serving.
   */
  share?: { kind: 'event' | 'meeting'; id: number; groupId: number };
  /** More settings shown right under the pinned preview (the poster maker's picture, shape, effects). */
  extra?: ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const own = useRef<HTMLDivElement>(null);
  const node = outer ?? own;
  // The words on the poster: prepared from the event until the person changes them.
  const [style, setStyle] = useState<PosterTextValue>(() =>
    posterText('', preview?.modes?.[0] ?? 'custom'),
  );
  const [ownWords, setOwnWords] = useState<string | null>(null);
  const words: PosterTextValue = { ...style, text: ownWords ?? preview?.preset ?? '' };
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
      {preview && (
        <>
          <LivePreview node={own} width={preview.width}>
            {preview.render(words)}
          </LivePreview>
          {!busy && extra}
          {!busy && (
            <PosterTextControls
              value={words}
              preset={preview.preset}
              modes={preview.modes}
              onChange={(v) => {
                setStyle(v);
                if (v.text !== words.text) setOwnWords(v.text);
              }}
            />
          )}
        </>
      )}
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

/** Width the moving posters are laid out at (recorded sharper, previewed smaller). */
const POSTER_W = 400;

/**
 * The poster live, as it will be recorded: laid out at its full width and shrunk to fit,
 * with its effects running in full. The recording is made from this very copy.
 */
export function LivePreview({
  node,
  children,
  width = POSTER_W,
}: {
  node: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** Laid out this wide, shown smaller to fit. */
  width?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, max: 0 });
  useEffect(() => {
    const outerEl = box.current;
    const inner = node.current;
    if (!outerEl || !inner) return;
    const measure = () =>
      setSize({
        w: outerEl.clientWidth,
        h: inner.offsetHeight,
        // At most about a third of the screen: the settings below stay in reach.
        max: Math.max(180, window.innerHeight * 0.34),
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outerEl);
    ro.observe(inner);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [node]);
  const k = size.w ? Math.min(1, size.w / width, size.h ? size.max / size.h : 1) : 1;
  return (
    // Pinned at the top while the settings under it scroll, so every change is seen.
    <div className="sticky top-0 z-20 -mx-3 bg-[var(--color-section)] px-3 pb-2 pt-1 shadow-card">
      <div ref={box} className="flex w-full justify-center">
        <div
          className="overflow-hidden rounded-xl bg-black"
          style={{ width: width * k, height: size.h ? size.h * k : undefined }}
        >
          <div style={{ width, transform: `scale(${k})`, transformOrigin: 'top left' }}>
            <FullMotion.Provider value>
              <div
                ref={node}
                className="relative overflow-hidden bg-black text-white"
                style={{ width }}
              >
                {children}
              </div>
            </FullMotion.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What / when / where of an event, as the words prepared for its moving poster. */
export function useEventPosterText() {
  const when = useEventWhen();
  return (e: EventSummary) =>
    [e.title, when(e), e.location ? `📍 ${e.location}` : null].filter(Boolean).join('\n');
}

/**
 * The poster doesn't move yet: designers get a way to add its animation (the event's
 * cover effects, the meeting's design), others are told a designer can.
 */
export function NoMotionPrompt({ onDesign }: { onDesign?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-hairline/60 p-3">
      <p className="text-[13px] leading-snug text-hint">
        {onDesign ? t.motionExport.noMotionDesigner : t.motionExport.noMotionAsk}
      </p>
      {onDesign && (
        <Button small variant="secondary" onClick={onDesign}>
          🎨 {t.motionExport.addMotion}
        </Button>
      )}
    </div>
  );
}

/** Whether an event's cover moves (has effects). */
export const eventMoves = (e: Pick<EventSummary, 'motion' | 'motionLayers'>) =>
  (!!e.motion && e.motion !== 'off') || (e.motionLayers?.length ?? 0) > 0;

/** The text choices of an event's poster: a designed cover shows its own title. */
export const eventPosterModes = (e: EventSummary): PosterTextMode[] =>
  e.coverUrl && !e.poster ? ['custom', 'none'] : ['design', 'custom'];

/**
 * An event's cover as a moving poster: the photo framed as on the event screen with the
 * words over it — or a designed cover / poster template (which shows its own title) with
 * the words in a band under it. Without words, just the picture and its effects.
 */
export function EventMotionPoster({ e, text }: { e: EventSummary; text: PosterTextValue }) {
  const photo = !!e.coverUrl && !e.poster;
  const [head, ...rest] = text.text.trim().split('\n');
  return (
    <>
      <EventCover
        e={{ ...e, coverLoop: null }}
        className={photo || e.poster ? 'aspect-[4/3]' : undefined}
      />
      {photo && <PosterTextLayer value={text} />}
      {!photo && text.mode === 'custom' && text.text.trim() && (
        <div
          className="flex flex-col gap-0.5 bg-[#111] px-5 py-3.5"
          style={{ fontFamily: fontFamily(text.font) }}
        >
          <div className="text-[16px] font-semibold">{head}</div>
          {rest
            .filter((l) => l.trim())
            .map((l, i) => (
              <div key={i} className="text-[14px] opacity-85">
                {l}
              </div>
            ))}
        </div>
      )}
    </>
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
