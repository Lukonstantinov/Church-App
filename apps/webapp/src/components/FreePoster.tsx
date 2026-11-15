import { useEffect, useRef, useState, type CSSProperties, type SetStateAction } from 'react';
import type { GroupSummary, PosterLayer, PosterTexts } from '@church/shared';
import {
  clearSuspect,
  dropDraft,
  isSuspectDraft,
  readDraft,
  useDraft,
  useOpeningMark,
  writeDraft,
} from '../lib/drafts';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { usePosterTemplates } from '../lib/queries';
import { haptic } from '../lib/telegram';
import {
  SLIDE_CHANGE_SECONDS,
  SLIDE_TRANSITIONS,
  lookStyle,
  slideAt,
  transitionAt,
  type Slide,
  type SlideTransition,
} from '../lib/slideshow';
import { CoverEffects, effectLayers, initEffects, type EffectsState } from './CoverEffects';
import { LayeredPoster } from './LayeredPoster';
import { PosterGestures } from './PosterGestures';
import {
  DraftAside,
  PosterLayersEditor,
  freshLinks,
  starterDoc,
  usePosterDraft,
  type PosterDoc,
} from './PosterStudio';
import { LookTop } from './LookTop';
import { groupLook } from './MeetingPoster';
import { MotionExport } from './MotionExport';
import { PosterTextLayer, type PosterTextValue } from './PosterText';
import { LivingLayers } from './ui';

const SHAPES = {
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '4:5': 'aspect-[4/5]',
  '9:16': 'aspect-[9/16]',
  // «Own size»: the shape comes from the width and height typed in.
  custom: '',
} as const;
type Shape = keyof typeof SHAPES;

/** An own size, in pixels of the finished video / picture. */
interface Size {
  w: number;
  h: number;
}
const SIZE_MIN = 200;
const SIZE_MAX = 4096;
const clampSide = (n: number) =>
  Number.isFinite(n) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n))) : 1080;
/** Ready sizes for «Own size» (wide screen, tall screen, square, post, banner, A4 print). */
const SIZE_PRESETS = {
  hd: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  post: { w: 1080, h: 1350 },
  banner: { w: 1500, h: 500 },
  a4: { w: 2480, h: 3508 },
} as const;
type Source = 'photo' | 'template' | 'colours' | 'layers';

/** What the maker keeps on the phone between visits (the photo separately: it is big). */
interface Kept {
  source: Source;
  tplId: number | null;
  shape: Shape;
  /** The own size, when the shape is «Own size». */
  size?: Size;
  effects: EffectsState;
}

/** The picked photo as a data link, so it can be kept on the phone with the draft. */
const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(blob);
  });

/** A poster template's texts from the words: first line the title, then date, place, topic. */
function textsOf(words: PosterTextValue): PosterTexts {
  const [title = '', date = '', place = '', topic = ''] =
    words.mode === 'custom' ? words.text.split('\n') : [];
  return { title, date, time: '', place: place.replace(/^📍\s*/, ''), topic };
}

/**
 * «🎬 Animated poster» without an event: a photo from the phone, a poster template or the
 * ministry's colours, any effects (several at once, each with its settings), own words on
 * it or none, in a shape for a chat, a square or a story. Recorded as a video or GIF and
 * sent to one's own chat with the bot, to forward anywhere.
 */
export function FreePoster({ g }: { g: GroupSummary }) {
  // The app closed itself while this was open last time: the draft is set aside, and the
  // maker opens fresh until the person brings it back or deletes it.
  const [aside, setAside] = useState(
    () =>
      (isSuspectDraft('free') || isSuspectDraft('free.layers')) &&
      !!(readDraft('free') ?? readDraft('free.layers')),
  );
  const [gen, setGen] = useState(0);
  const settle = () => {
    clearSuspect('free');
    clearSuspect('free.layers');
    setAside(false);
    setGen((n) => n + 1);
  };
  return (
    <>
      {aside && (
        <div className="mb-3">
          <DraftAside
            at={readDraft('free')?.at ?? readDraft('free.layers')?.at ?? null}
            onDelete={() => {
              dropDraft('free');
              settle();
            }}
            onRestore={settle}
          />
        </div>
      )}
      <FreePosterMaker key={gen} g={g} fresh={aside} />
    </>
  );
}

function FreePosterMaker({ g, fresh }: { g: GroupSummary; fresh: boolean }) {
  const t = useT();
  const tf = t.freePoster;
  const templates = usePosterTemplates();
  // Everything chosen here is kept as a draft: leaving or closing the app loses nothing.
  const [kept] = useState(() => (fresh ? undefined : readDraft<Kept>('free')?.data));
  const [source, setSource] = useState<Source>(kept?.source ?? 'colours');
  const [photo, setPhoto] = useState<string | null>(() =>
    fresh ? null : (readDraft<string>('free.photo')?.data ?? null),
  );
  const [tplId, setTplId] = useState<number | null>(kept?.tplId ?? null);
  const [shape, setShape] = useState<Shape>(kept?.shape ?? '4:5');
  const [effects, setEffects] = useState<EffectsState>(
    () => kept?.effects ?? initEffects({ motion: 'aurora', motionTune: null, motionLayers: [] }),
  );
  const [size, setSize] = useState<Size>(kept?.size ?? { w: 1920, h: 1080 });
  useDraft('free', { source, tplId, shape, size, effects } satisfies Kept, fresh);
  useOpeningMark('free', !fresh);
  // Own layers, as in the poster editor (pictures, cut-outs, texts, colours, effects).
  const layered = usePosterDraft('free.layers', starterDoc);
  const [selected, setSelected] = useState<string | null>(null);
  const [fxOpen, setFxOpen] = useState(false);
  // Slides (own layers only): each its own layers over the background and its effects.
  const [slides, setSlides] = useState<Slide[]>(() =>
    fresh ? [] : (readDraft<Slide[]>('free.slides')?.data ?? []),
  );
  useDraft('free.slides', slides, fresh);
  // Picture links in kept slides expire like the layers' (see freshLinks).
  useEffect(() => {
    if (fresh || slides.length === 0) return;
    let stop = false;
    void Promise.all(
      slides.map((sl) => freshLinks({ ...starterDoc(), layers: sl.layers }).then((d) => d.layers)),
    ).then((all) => {
      if (!stop) setSlides((cur) => cur.map((sl, i) => ({ ...sl, layers: all[i] ?? sl.layers })));
    });
    return () => {
      stop = true;
    };
    // Once, when the kept slides are opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Which part the editor works on: the background (null) or a slide.
  const [editing, setEditing] = useState<number | null>(null);
  const slideIdx = editing !== null && editing < slides.length ? editing : null;
  // While recording: the slide the recorder asked for (see MotionExport `slideshow`).
  const [forced, setForced] = useState<{ slide: number | null; bare: boolean } | null>(null);
  const shown = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!shown.current) return;
    const done = shown.current;
    shown.current = null;
    // Laid out and its pictures and letter masks made before the recorder looks.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setTimeout(done, 450));
    });
    return () => cancelAnimationFrame(id);
  }, [forced]);
  const slideshow =
    source === 'layers' && slides.length > 0
      ? {
          seconds: slides.map((sl) => sl.seconds),
          kinds: slides.map((sl) => sl.transition),
          show: (slide: number | null, bare: boolean) =>
            new Promise<void>((resolve) => {
              shown.current = resolve;
              setForced({ slide, bare });
            }),
          stop: () => setForced(null),
        }
      : undefined;
  // The doc the layer editor works on: the background's, or the chosen slide's layers.
  const editDoc: PosterDoc =
    slideIdx === null ? layered.doc : { ...layered.doc, layers: slides[slideIdx]!.layers };
  const setEditDoc = (upd: SetStateAction<PosterDoc>) => {
    if (slideIdx === null) return layered.setDoc(upd);
    const next = typeof upd === 'function' ? upd(editDoc) : upd;
    setSlides((cur) => cur.map((sl, i) => (i === slideIdx ? { ...sl, layers: next.layers } : sl)));
    // The background and frame stay the poster's own, shared by every slide.
    if (next.background !== editDoc.background || next.frame !== editDoc.frame)
      layered.setDoc((d) => ({ ...d, background: next.background, frame: next.frame }));
  };
  const setSlide = (i: number, p: Partial<Slide>) =>
    setSlides((cur) => cur.map((sl, j) => (j === i ? { ...sl, ...p } : sl)));
  const tpl = templates.data?.find((x) => x.id === tplId) ?? templates.data?.[0] ?? null;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    // The chosen photo stays on the phone (made smaller first), kept with the draft.
    const blob = await preparePhoto(f, 1400).catch(() => f);
    const url = await asDataUrl(blob);
    setPhoto(url);
    if (!fresh) writeDraft('free.photo', url);
    setSource('photo');
  };
  const patch = (id: string, p: Partial<PosterLayer>) =>
    setEditDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...p } as PosterLayer) : l)),
    }));

  const pill = (on: boolean, label: string, act: () => void) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        haptic.tap();
        act();
      }}
      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
        on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
      }`}
    >
      {label}
    </button>
  );

  const render = (words: PosterTextValue) => {
    const poster = (
      <div
        className={`relative w-full ${SHAPES[shape]}`}
        style={shape === 'custom' ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}
      >
        {source === 'layers' ? (
          slides.length ? (
            <SlideshowPoster
              tpl={layered.doc}
              slides={slides}
              texts={textsOf(words)}
              editing={slideIdx}
              forced={forced}
            />
          ) : (
            <LayeredPoster fill tpl={layered.doc} texts={textsOf(words)} />
          )
        ) : source === 'photo' && photo ? (
          <img
            src={photo}
            alt=""
            data-shot="under"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : source === 'template' && tpl ? (
          <LayeredPoster fill tpl={tpl} texts={textsOf(words)} coverUrl={photo} />
        ) : (
          <LookTop look={groupLook(g)} className="absolute inset-0">
            {null}
          </LookTop>
        )}
        <LivingLayers layers={effectLayers(effects)} image={source === 'photo' ? photo : null} />
        {/* A template (or own layers) writes the words in its own places. */}
        {source !== 'template' && source !== 'layers' && <PosterTextLayer value={words} />}
      </div>
    );
    // Own layers move with a finger right on the preview.
    return source === 'layers' ? (
      <PosterGestures
        layers={editDoc.layers}
        selected={selected}
        onSelect={setSelected}
        onPatch={patch}
      >
        {poster}
      </PosterGestures>
    ) : (
      poster
    );
  };

  // The preview first, pinned while everything that changes it scrolls below.
  const settings = (
    <>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-hint">{tf.picture}</div>
        <div className="flex flex-wrap gap-1.5">
          {pill(source === 'colours', tf.colours, () => setSource('colours'))}
          {photo ? (
            pill(source === 'photo', tf.photo, () => setSource('photo'))
          ) : (
            <label className="cursor-pointer rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold">
              {tf.choosePhoto}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </label>
          )}
          {(templates.data?.length ?? 0) > 0 &&
            pill(source === 'template', tf.template, () => setSource('template'))}
          {pill(source === 'layers', tf.layers, () => setSource('layers'))}
        </div>
        {source === 'layers' && (
          <p className="text-[12px] leading-snug text-hint">{tf.layersHint}</p>
        )}
        {source === 'photo' && photo && (
          <label className="cursor-pointer self-start text-[13px] font-semibold text-link">
            {tf.otherPhoto}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
        )}
        {source === 'template' && (
          <div className="flex flex-wrap gap-1.5">
            {(templates.data ?? []).map((x) =>
              pill(tpl?.id === x.id, x.name, () => setTplId(x.id)),
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-hint">{tf.shape}</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SHAPES) as Shape[]).map((s) =>
            pill(shape === s, tf.shapes[s], () => setShape(s)),
          )}
        </div>
        {shape === 'custom' && <OwnSize size={size} onChange={setSize} />}
      </div>
      {source === 'layers' && (
        <SlidesBar
          slides={slides}
          editing={slideIdx}
          onEdit={(i) => {
            haptic.tap();
            setSelected(null);
            setEditing(i);
          }}
          onAdd={() => {
            haptic.tap();
            setSlides((cur) => [
              ...cur,
              { id: `s${Date.now().toString(36)}`, layers: [], seconds: 4, transition: 'glitch' },
            ]);
            setSelected(null);
            setEditing(slides.length);
          }}
          onChange={setSlide}
          onDelete={(i) => {
            setSlides((cur) => cur.filter((_, j) => j !== i));
            setEditing(null);
            setSelected(null);
          }}
        />
      )}
      {source === 'layers' && (
        <PosterLayersEditor
          doc={editDoc}
          setDoc={setEditDoc}
          g={g}
          selected={selected}
          setSelected={setSelected}
        />
      )}
      <CoverEffects state={effects} onChange={setEffects} open={fxOpen} onOpen={setFxOpen} />
    </>
  );

  return (
    <MotionExport
      name={tf.fileName}
      preview={{ preset: g.name, render, modes: ['custom', 'none'] }}
      extra={settings}
      draftKey="free.text"
      size={shape === 'custom' ? size : undefined}
      slideshow={slideshow}
    />
  );
}

/**
 * The slideshow on the poster: the background and its layers always, and the slide of the
 * moment over them; in the change into a slide both are on, moved as the transition says
 * (the same formula the recording uses). While a slide is being edited it stands still
 * on screen; while recording, the recorder chooses what is shown (`forced`).
 */
function SlideshowPoster({
  tpl,
  slides,
  texts,
  editing,
  forced,
}: {
  tpl: PosterDoc;
  slides: Slide[];
  texts: PosterTexts;
  editing: number | null;
  forced: { slide: number | null; bare: boolean } | null;
}) {
  const [now, setNow] = useState(() => slideAt(slides, 0, SLIDE_CHANGE_SECONDS));
  const playing = !forced && editing === null;
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now();
    let last = '';
    let id = 0;
    const step = (ms: number) => {
      id = requestAnimationFrame(step);
      const at = slideAt(slides, (ms - t0) / 1000, SLIDE_CHANGE_SECONDS);
      // Re-drawn only when something changes: a new slide, or a step of a change.
      const key = at.prev === null ? `${at.index}` : `${at.index}|${at.p.toFixed(2)}`;
      if (key === last) return;
      last = key;
      setNow(at);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [playing, slides]);
  let shown: { key: string; layers: PosterLayer[]; style?: CSSProperties }[] = [];
  let flash = 0;
  if (forced) {
    const sl = forced.slide !== null ? slides[forced.slide] : undefined;
    shown = sl ? [{ key: sl.id, layers: sl.layers }] : [];
  } else if (editing !== null) {
    const sl = slides[editing];
    shown = sl ? [{ key: sl.id, layers: sl.layers }] : [];
  } else {
    const cur = slides[now.index];
    const prev = now.prev !== null ? slides[now.prev] : undefined;
    if (cur && prev && prev !== cur) {
      const look = transitionAt(cur.transition, now.p, now.index * 7 + 3);
      flash = look.flash;
      shown = [
        { key: prev.id, layers: prev.layers, style: lookStyle(look.out) as CSSProperties },
        { key: cur.id, layers: cur.layers, style: lookStyle(look.in) as CSSProperties },
      ];
    } else if (cur) shown = [{ key: cur.id, layers: cur.layers }];
  }
  return (
    <LayeredPoster fill tpl={tpl} texts={texts} slides={shown} bare={!!forced?.bare}>
      {flash > 0 && (
        <span
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ opacity: flash }}
        />
      )}
    </LayeredPoster>
  );
}

/** The slides: the background or a slide to edit, and each slide's length and change. */
function SlidesBar({
  slides,
  editing,
  onEdit,
  onAdd,
  onChange,
  onDelete,
}: {
  slides: Slide[];
  editing: number | null;
  onEdit: (i: number | null) => void;
  onAdd: () => void;
  onChange: (i: number, p: Partial<Slide>) => void;
  onDelete: (i: number) => void;
}) {
  const t = useT();
  const ts = t.freePoster.slides;
  const chip = (on: boolean, label: string, act: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={act}
      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
        on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
      }`}
    >
      {label}
    </button>
  );
  const sl = editing !== null ? slides[editing] : undefined;
  const total = slides.reduce((a, b) => a + b.seconds, 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-hairline/50 p-2.5">
      <div className="text-[12px] font-semibold text-hint">{ts.title}</div>
      <div className="flex flex-wrap gap-1.5">
        {chip(editing === null, ts.background, () => onEdit(null), 'bg')}
        {slides.map((_, i) => chip(editing === i, ts.slide(i + 1), () => onEdit(i), `s${i}`))}
        {slides.length < MAX_SLIDES && chip(false, ts.add, onAdd, 'add')}
      </div>
      <p className="text-[11px] leading-snug text-hint">
        {slides.length ? ts.total(Math.round(total)) : ts.hint}
      </p>
      {sl && editing !== null && (
        <>
          <label className="flex items-center gap-2 text-[12px] text-hint">
            {ts.seconds(sl.seconds)}
            <input
              type="range"
              min={1.5}
              max={15}
              step={0.5}
              value={sl.seconds}
              onChange={(e) => onChange(editing, { seconds: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
          <div className="text-[12px] font-semibold text-hint">{ts.transition}</div>
          <div className="flex flex-wrap gap-1.5">
            {SLIDE_TRANSITIONS.map((k: SlideTransition) =>
              chip(
                sl.transition === k,
                ts.kinds[k],
                () => {
                  haptic.tap();
                  onChange(editing, { transition: k });
                },
                k,
              ),
            )}
          </div>
          <button
            type="button"
            onClick={() => onDelete(editing)}
            className="self-start text-[13px] font-semibold text-[var(--color-danger,#e5484d)]"
          >
            {ts.remove}
          </button>
        </>
      )}
    </div>
  );
}

const MAX_SLIDES = 12;

/**
 * «📐 Own size»: width and height in pixels (typed, or a ready size). The preview takes the
 * shape at once; a number is kept within 200–4096 when the field is left.
 */
function OwnSize({ size, onChange }: { size: Size; onChange: (s: Size) => void }) {
  const t = useT();
  const tf = t.freePoster;
  // What is being typed, kept as text so a half-typed number isn't corrected under the finger.
  const [typed, setTyped] = useState({ w: String(size.w), h: String(size.h) });
  const set = (s: Size) => {
    onChange(s);
    setTyped({ w: String(s.w), h: String(s.h) });
  };
  const field = (side: 'w' | 'h', label: string) => (
    <label className="flex flex-1 flex-col gap-1 text-[12px] text-hint">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={SIZE_MIN}
        max={SIZE_MAX}
        value={typed[side]}
        onChange={(e) => {
          setTyped({ ...typed, [side]: e.target.value });
          const n = Number(e.target.value);
          // The preview follows every sensible number while typing.
          if (n >= SIZE_MIN && n <= SIZE_MAX) onChange({ ...size, [side]: Math.round(n) });
        }}
        onBlur={() => set({ ...size, [side]: clampSide(Number(typed[side])) })}
        className="w-full rounded-xl bg-hairline px-3 py-2 text-center text-[16px] text-[var(--color-text,inherit)] outline-none"
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-hairline/50 p-2.5">
      <div className="text-[12px] font-semibold text-hint">{tf.ownSize}</div>
      <div className="flex items-end gap-2">
        {field('w', tf.ownWidth)}
        <button
          type="button"
          aria-label="⇄"
          onClick={() => {
            haptic.tap();
            set({ w: size.h, h: size.w });
          }}
          className="mb-1 rounded-full bg-hairline px-2.5 py-1.5 text-[14px] font-semibold"
        >
          ⇄
        </button>
        {field('h', tf.ownHeight)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SIZE_PRESETS) as (keyof typeof SIZE_PRESETS)[]).map((k) => {
          const p = SIZE_PRESETS[k];
          const on = p.w === size.w && p.h === size.h;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                haptic.tap();
                set({ ...p });
              }}
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
              }`}
            >
              {tf.sizePresets[k]}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-snug text-hint">{tf.ownSizeHint}</p>
    </div>
  );
}
