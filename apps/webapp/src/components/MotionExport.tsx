import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { displayName, type PosterAudience } from '@church/shared';
import type { EventDetail, EventSummary } from '@church/shared';
import { readDraft, useDraft } from '../lib/drafts';
import { FullMotion } from '../lib/perf';
import { CoverPicture } from './CoverSlideshow';
import { useT } from '../lib/i18n';
import {
  keepForDevice,
  sendAnimationToChat,
  sendPictureToChat,
  useContacts,
  useCoverLoop,
  useMe,
} from '../lib/queries';
import { confirmDialog, downloadToDevice, haptic, isInsideTelegram } from '../lib/telegram';
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
import { SLIDE_CHANGE_SECONDS, type SlideTransition } from '../lib/slideshow';
import { Button, TextArea } from './ui';

/**
 * Quality of a moving poster: the video's and the GIF's width, frames a second and how much
 * detail the video keeps. Higher takes longer to record and makes bigger files.
 */
const QUALITY = {
  standard: { video: 720, gif: 540, fps: 20, bitrate: 0.12 },
  high: { video: 1080, gif: 640, fps: 20, bitrate: 0.12 },
  max: { video: 1080, gif: 720, fps: 24, bitrate: 0.2 },
  // Full HD: the long side 1920 px — 1920×1080 lying, 1080×1920 standing (see videoWidth).
  fullhd: { video: 1920, gif: 720, fps: 30, bitrate: 0.14 },
} as const;

/**
 * The width a video is drawn at: the quality's width, or for Full HD the width that makes
 * the poster's long side 1920 px.
 */
function videoWidth(q: keyof typeof QUALITY, el: { offsetWidth: number; offsetHeight: number }) {
  if (q !== 'fullhd') return QUALITY[q].video;
  const w = Math.max(1, el.offsetWidth);
  const h = Math.max(1, el.offsetHeight);
  return even(w >= h ? 1920 : (1920 * w) / h);
}

/**
 * Telegram plays a GIF in the chat only while it is small enough; a bigger one arrives as
 * a file to download (a 13 MB one did). A GIF over this is made again, narrower.
 */
const GIF_MAX_BYTES = 9_000_000;

/**
 * How long a recording runs, in seconds. A GIF stops at 30 (a longer one is too big to play
 * in the chat) and has fewer frames a second the longer it is.
 */
const LENGTHS = [6, 15, 30, 60] as const;
const GIF_MAX_SECONDS = 30;
const gifFpsFor = (s: number) => (s <= 6 ? 10 : s <= 15 ? 8 : 6);

/**
 * The upload to the bot takes 45 MB and Telegram 50: a long video's detail is lowered so
 * the whole file stays near this (a 60 s 1080p video at «Максимум» would be ~75 MB).
 */
const VIDEO_BUDGET_BYTES = 42_000_000;

/** Frames a second of the video (more = smoother movement, longer to record). */
const FPS = [20, 24, 30] as const;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The largest picture a recording may be: every frame is a canvas this big, and a few
 * dozen of them are held at once. A phone gets Full HD; a computer up to 4K.
 */
const pixelBudget = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    ? 1920 * 1088
    : 3840 * 2160;

/** An own size made to fit the budget, keeping its shape (even numbers, for the video). */
export function fitSize(size: { w: number; h: number }) {
  const k = Math.min(
    1,
    Math.sqrt(pixelBudget() / (size.w * size.h)),
    4096 / Math.max(size.w, size.h),
  );
  return { w: even(size.w * k), h: even(size.h * k) };
}

/** Saves the file on this device (a computer's browser outside Telegram). */
function saveHere(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

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
  draftKey,
  size,
  slideshow,
  variants,
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
  /**
   * More settings shown right under the pinned preview (the poster maker's picture, shape,
   * effects); as a function it is given the words on the poster (for small copies of it).
   */
  extra?: ReactNode | ((text: PosterTextValue) => ReactNode);
  /** Keeps the words and the message on this phone under this name until changed again. */
  draftKey?: string;
  /**
   * An own size in pixels (the poster maker's «Own size»): the video and the picture come
   * out exactly this big (within what the device can record), whatever the quality.
   */
  size?: { w: number; h: number };
  /**
   * A slideshow (the poster maker's slides): the recording runs the slides' lengths and
   * asks the caller to put each slide on in turn (lib/recorder.ts recordSlides).
   */
  slideshow?: {
    seconds: number[];
    kinds: SlideTransition[];
    show: (slide: number | null, bare: boolean) => Promise<void>;
    stop: () => void;
  };
  /**
   * Colour variants (the poster maker's): «all variants» saves the original and each
   * variant one after another — the caller puts each on the preview in turn (null = the
   * original) and `stop` brings back what was shown.
   */
  variants?: {
    count: number;
    show: (variant: number | null) => Promise<void>;
    stop: () => void;
  };
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const own = useRef<HTMLDivElement>(null);
  const node = outer ?? own;
  // The words on the poster: prepared from the event until the person changes them.
  const [kept] = useState(() =>
    draftKey
      ? readDraft<{ style: PosterTextValue; ownWords: string | null; ownText: string | null }>(
          draftKey,
        )?.data
      : undefined,
  );
  const [style, setStyle] = useState<PosterTextValue>(
    () => kept?.style ?? posterText('', preview?.modes?.[0] ?? 'custom'),
  );
  const [ownWords, setOwnWords] = useState<string | null>(kept?.ownWords ?? null);
  const words: PosterTextValue = { ...style, text: ownWords ?? preview?.preset ?? '' };
  // The text under the poster: prepared from the event/meeting, editable; follows the
  // prepared text until the person changes it.
  const [ownText, setOwnText] = useState<string | null>(kept?.ownText ?? null);
  useDraft(draftKey ?? '', { style, ownWords, ownText }, !draftKey);
  const text = ownText ?? caption ?? '';
  const [to, setTo] = useState<PosterAudience>('me');
  const [chosen, setChosen] = useState<number[]>([]);
  const contacts = useContacts(share?.groupId ?? 0, !!share && to === 'people');
  const audiences: PosterAudience[] = share
    ? ['me', 'people', 'group', ...(me.data?.user.isAdmin ? (['church'] as const) : []), 'serving']
    : ['me'];
  const [busy, setBusy] = useState<'video' | 'gif' | 'picture' | null>(null);
  // Plays in the chat (an animation) or comes as a file to save, full size and untouched.
  // Plays in the chat, comes as a file there, or is saved straight onto this device.
  // A poster in an own size is made for a screen or print: it starts as a file to keep.
  const [deliver, setDeliver] = useState<'play' | 'file' | 'device'>(size ? 'device' : 'play');
  const asFile = deliver === 'file';
  const toDevice = deliver === 'device' && isInsideTelegram();
  const out = size ? fitSize(size) : null;
  const [quality, setQuality] = useState<keyof typeof QUALITY>('standard');
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(6);
  const [fps, setFps] = useState<(typeof FPS)[number]>(30);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  // Colour variants: only what is on the preview, or the original and every variant.
  const [all, setAll] = useState(false);
  const [step, setStep] = useState<{ n: number; of: number } | null>(null);
  const everyVariant = !!variants && variants.count > 0 && all && to === 'me';

  const fileName = (tag = '') =>
    (name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 50) || 'poster') + tag;

  /**
   * Makes what is on the preview — or, for «all variants», the original and then each
   * colour variant, numbered from 2. Stops at the first that could not be made.
   */
  async function each(act: (tag: string) => Promise<boolean>) {
    if (!variants || !everyVariant) return void (await act(''));
    const of = variants.count + 1;
    for (let n = 0; n < of; n++) {
      setStep({ n: n + 1, of });
      setSending(false);
      setShrinking(false);
      setProgress(0);
      await variants.show(n === 0 ? null : n - 1);
      if (!(await act(n === 0 ? '' : ` ${n + 1}`))) break;
    }
  }

  /** Kept by the worker for a day, then Telegram's save dialog opens on this device. */
  async function saveOnDevice(file: Blob, name: string) {
    setSending(true);
    const kept = await keepForDevice(file, name);
    toast(t.motionExport.savedDevice);
    if (await downloadToDevice(kept.url, kept.name)) haptic.success();
  }

  /** A still of the poster with its effects, at the own size (or the quality's width). */
  async function picture() {
    if (busy) return;
    setBusy('picture');
    setProgress(0);
    onRecording?.(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const { recordLoop } = await import('../lib/recorder');
      await each(async (tag) => {
        const el = node.current;
        if (!el) throw new Error('no_poster');
        const rec = await recordLoop(el, {
          width: out?.w ?? Math.max(1080, videoWidth(quality, el)),
          height: out?.h,
          still: 1.5,
          onProgress: setProgress,
        });
        if (!rec.png) throw new Error('no_file');
        setSending(true);
        if (toDevice) await saveOnDevice(rec.png, fileName(tag));
        else if (!isInsideTelegram()) saveHere(rec.png, `${fileName(tag)}.png`);
        // A photo is squeezed by Telegram (and refused over 9 MB): big ones go as a file.
        else await sendPictureToChat(rec.png, fileName(tag), asFile || rec.png.size > 9_000_000);
        return true;
      });
      // (Saving onto the device has said so itself.)
      if (toDevice) return;
      haptic.success();
      toast(isInsideTelegram() ? t.motionExport.sent : t.motionExport.saved);
    } catch (err) {
      console.warn('picture failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      onRecording?.(false);
      variants?.stop();
      setStep(null);
      setSending(false);
      setBusy(null);
    }
  }

  /** One video or GIF of what is on the preview, sent or saved; false when it has no effects. */
  async function record(kind: 'video' | 'gif', tag: string): Promise<boolean> {
    const el = node.current;
    const { hasEffects, recordLoop } = await import('../lib/recorder');
    if (!el || !hasEffects(el)) {
      haptic.error();
      toast(t.motionExport.noEffects, 'error');
      return false;
    }
    const q = QUALITY[quality];
    const slideTotal = slideshow ? slideshow.seconds.reduce((a, b) => a + b, 0) : 0;
    // A slideshow runs its slides' lengths (a GIF of it too, however long).
    const seconds = slideshow
      ? slideTotal
      : kind === 'gif'
        ? Math.min(length, GIF_MAX_SECONDS)
        : length;
    // The video's detail (bits per pixel per frame), lowered for a long one to fit the
    // budget: the width it is drawn at times the block's shape gives its pixels.
    const vw = out ? out.w : videoWidth(quality, el);
    const vh = out ? out.h : vw * (el.offsetHeight / Math.max(1, el.offsetWidth));
    const viaBot = isInsideTelegram() || to !== 'me';
    const bitrate = viaBot
      ? Math.min(q.bitrate, (VIDEO_BUDGET_BYTES * 8) / (seconds * vw * vh * fps))
      : q.bitrate;
    const make = (gifWidth: number) =>
      recordLoop(el, {
        seconds,
        gifFps: gifFpsFor(seconds),
        slides: slideshow
          ? {
              seconds: slideshow.seconds,
              kinds: slideshow.kinds,
              change: SLIDE_CHANGE_SECONDS,
              show: slideshow.show,
            }
          : undefined,
        gif: kind === 'gif',
        // A GIF only: no video is made alongside (quicker).
        video: kind === 'video',
        // The picture is drawn at least as wide as the file that is made from it; an
        // own size is the video's exact size.
        width: out
          ? kind === 'gif'
            ? Math.min(out.w, Math.max(720, gifWidth))
            : out.w
          : kind === 'gif'
            ? Math.max(720, q.gif)
            : videoWidth(quality, el),
        gifWidth: out ? Math.min(out.w, gifWidth) : gifWidth,
        // The video exactly the own size (the GIF follows its shape).
        height: out && kind === 'video' ? out.h : undefined,
        fps,
        quality: bitrate,
        onProgress: setProgress,
      });
    let rec = await make(q.gif);
    // Too big for Telegram to play: again, narrower by about as much as needed.
    let width: number = q.gif;
    // (A file to save may stay big: it isn't played in the chat.)
    for (
      let tries = 0;
      rec.gif &&
      rec.gif.size > GIF_MAX_BYTES &&
      !((asFile || toDevice) && to === 'me') &&
      tries < 3;
      tries++
    ) {
      width = even(width * Math.sqrt(GIF_MAX_BYTES / rec.gif.size) * 0.92);
      if (width < 300) break;
      setShrinking(true);
      setProgress(0);
      rec = await make(width);
    }
    const file = kind === 'gif' ? rec.gif : (rec.mp4 ?? rec.gif);
    if (!file) throw new Error('no_file');
    if (kind === 'video' && !rec.mp4) toast(t.motionExport.noVideo);
    setSending(true);
    const safe = fileName(tag);
    // On a computer's browser (outside Telegram) the file is simply saved here.
    if (to === 'me' && !isInsideTelegram()) {
      saveHere(file, `${safe}.${file.type === 'image/gif' ? 'gif' : 'mp4'}`);
      haptic.success();
      toast(t.motionExport.saved);
      return true;
    }
    if (to === 'me' && toDevice) {
      await saveOnDevice(file, safe);
      return true;
    }
    const res = await sendAnimationToChat(
      file,
      safe,
      text.trim() || undefined,
      share && to !== 'me' ? { to, kind: share.kind, id: share.id, users: chosen } : undefined,
      asFile && to === 'me',
    );
    haptic.success();
    toast(to === 'me' ? t.motionExport.sent : t.motionExport.sentTo(res.sent));
    return true;
  }

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
      await each((tag) => record(kind, tag));
    } catch (err) {
      console.warn('recording failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      onRecording?.(false);
      slideshow?.stop();
      variants?.stop();
      setStep(null);
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
          {!busy && (typeof extra === 'function' ? extra(words) : extra)}
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
          {step && (
            <div className="text-center text-[13px] font-semibold">
              {t.motionExport.variantStep(step.n, step.of)}
            </div>
          )}
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
          <p className="text-[11px] text-hint">
            {out ? t.motionExport.sizeHint(out.w, out.h) : t.motionExport.qualityHint[quality]}
          </p>
          <div className="text-[12px] font-semibold text-hint">{t.motionExport.lengthLabel}</div>
          {slideshow ? (
            <p className="text-[11px] text-hint">
              {t.motionExport.slideshowLength(
                Math.round(slideshow.seconds.reduce((a, b) => a + b, 0)),
              )}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {LENGTHS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setLength(s)}
                  className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                    length === s ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                  }`}
                >
                  {t.motionExport.length(s)}
                </button>
              ))}
            </div>
          )}
          {length > 6 && !slideshow && (
            <p className="text-[11px] text-hint">{t.motionExport.lengthHint}</p>
          )}
          <div className="text-[12px] font-semibold text-hint">{t.motionExport.fpsLabel}</div>
          <div className="flex flex-wrap gap-1.5">
            {FPS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setFps(n)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  fps === n ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                }`}
              >
                {t.motionExport.fps(n)}
              </button>
            ))}
          </div>
          {(() => {
            // A long video at this quality that won't fit Telegram's limit: said plainly.
            const q = QUALITY[quality];
            const vw = out ? out.w : q.video;
            const vh = out ? out.h : (vw * 9) / 16;
            const need = (q.bitrate * vw * vh * fps * length) / 8;
            return need > VIDEO_BUDGET_BYTES && isInsideTelegram() ? (
              <p className="text-[11px] text-hint">{t.motionExport.fitHint}</p>
            ) : null;
          })()}
          {out && size && (out.w !== even(size.w) || out.h !== even(size.h)) && (
            <p className="text-[11px] text-hint">{t.motionExport.sizeLimited}</p>
          )}
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
          {to === 'me' && isInsideTelegram() && (
            <>
              <div className="text-[12px] font-semibold text-hint">
                {t.motionExport.deliverLabel}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['play', 'file', 'device'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      setDeliver(f);
                    }}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                      deliver === f ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                    }`}
                  >
                    {t.motionExport.deliver[f]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-hint">
                {t.motionExport.deliverHint[deliver]}
              </p>
            </>
          )}
          {variants && variants.count > 0 && to === 'me' && (
            <>
              <div className="text-[12px] font-semibold text-hint">{t.motionExport.whatLabel}</div>
              <div className="flex flex-wrap gap-1.5">
                {[false, true].map((every) => (
                  <button
                    key={String(every)}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      setAll(every);
                    }}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                      all === every ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                    }`}
                  >
                    {every ? t.motionExport.whatAll(variants.count + 1) : t.motionExport.whatShown}
                  </button>
                ))}
              </div>
              {all && (
                <p className="text-[11px] leading-snug text-hint">{t.motionExport.whatHint}</p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button small onClick={() => void run('video')}>
              {to !== 'me'
                ? t.motionExport.sendVideo
                : !isInsideTelegram()
                  ? t.motionExport.saveVideo
                  : t.motionExport.video}
            </Button>
            <Button small variant="secondary" onClick={() => void run('gif')}>
              {to !== 'me'
                ? t.motionExport.sendGif
                : !isInsideTelegram()
                  ? t.motionExport.saveGif
                  : t.motionExport.gif}
            </Button>
            {to === 'me' && (
              <Button small variant="secondary" onClick={() => void picture()}>
                {isInsideTelegram() ? t.motionExport.picture : t.motionExport.savePicture}
              </Button>
            )}
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
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // Full screen: the poster laid out as wide as the screen (its effects drawn that sharp,
  // not a small copy blown up) and shown as big as the screen allows.
  const [big, setBig] = useState(false);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState({ w: 0, h: 0, max: 0 });
  const laid = big ? Math.max(width, Math.min(view.w - 16, 1600)) : width;
  useEffect(() => {
    const outerEl = box.current;
    const inner = node.current;
    if (!outerEl || !inner) return;
    const measure = () => {
      setView({ w: window.innerWidth, h: window.innerHeight });
      setSize({
        w: outerEl.clientWidth,
        h: inner.offsetHeight,
        // At most about a third of the screen: the settings below stay in reach.
        max: big ? window.innerHeight - 70 : Math.max(180, window.innerHeight * 0.34),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outerEl);
    ro.observe(inner);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [node, big]);
  useEffect(() => {
    if (!big) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [big]);
  const k = size.w ? Math.min(1, size.w / laid, size.h ? size.max / size.h : 1) : 1;
  const toggle = (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        setBig(!big);
      }}
      aria-label={big ? t.motionExport.smallView : t.motionExport.fullView}
      className="absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[13px] font-semibold text-white backdrop-blur-sm"
    >
      {big ? '✕' : '⛶'}
    </button>
  );
  const view_ = (
    // Pinned at the top while the settings under it scroll, so every change is seen.
    <div
      className={
        big
          ? 'fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black p-2'
          : 'sticky top-0 z-20 -mx-3 bg-[var(--color-section)] px-3 pb-2 pt-1 shadow-card'
      }
    >
      <div ref={box} className="flex w-full justify-center">
        <div
          className="relative overflow-hidden rounded-xl bg-black"
          style={{ width: laid * k, height: size.h ? size.h * k : undefined }}
        >
          <div style={{ width: laid, transform: `scale(${k})`, transformOrigin: 'top left' }}>
            <FullMotion.Provider value>
              <div
                ref={node}
                className="relative overflow-hidden bg-black text-white"
                style={{ width: laid }}
              >
                {children}
              </div>
            </FullMotion.Provider>
          </div>
          {toggle}
        </div>
      </div>
    </div>
  );
  // Full screen is put on the page itself: inside a sliding sheet (moved with a transform)
  // a fixed box would stay within the sheet.
  return big ? createPortal(view_, document.body) : view_;
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
