import { useEffect, useRef, useState, type CSSProperties, type SetStateAction } from 'react';
import {
  MAX_POSTER_LAYERS,
  MAX_SLIDES,
  posterLayerSchema,
  type GroupSummary,
  type PosterLayer,
  type PosterTemplate,
  type PosterTexts,
  type SavedSlideshow,
} from '@church/shared';
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
import {
  useDeleteSlideshow,
  usePosterTemplates,
  useSaveSlideshow,
  useSlideshows,
} from '../lib/queries';
import { StillMotion } from '../lib/perf';
import { useToast } from './Toast';
import { confirmDialog, haptic } from '../lib/telegram';
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
/** Each shape's width ÷ height, for the slide pictures in the strip. */
const SHAPE_RATIO: Record<Shape, string> = {
  '4:3': '4 / 3',
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '9:16': '9 / 16',
  custom: '16 / 9',
};

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
          setSlides={setSlides}
          editing={slideIdx}
          onEdit={(i) => {
            haptic.tap();
            setSelected(null);
            setEditing(i);
          }}
          doc={layered.doc}
          setDoc={(d) => layered.setDoc(d)}
          templates={templates.data ?? []}
          aspect={shape === 'custom' ? `${size.w} / ${size.h}` : SHAPE_RATIO[shape]}
          texts={textsOf({ mode: 'none', text: '' } as never)}
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

/** A poster template as a slide's layers: its background first (as a colour or picture layer). */
function posterAsLayers(tpl: PosterTemplate): PosterLayer[] {
  const tag = Date.now().toString(36);
  const bg = tpl.background;
  const under: PosterLayer[] = [];
  if (bg.type === 'color' || bg.type === 'gradient')
    under.push(
      posterLayerSchema.parse({
        id: `${tag}bg`,
        type: 'fill',
        paint: bg.type === 'color' ? 'color' : 'linear',
        colors: bg.colors.slice(0, 4),
        angle: bg.angle,
      }),
    );
  else if (bg.type === 'photo' && bg.mediaId)
    under.push(
      posterLayerSchema.parse({
        id: `${tag}bg`,
        type: 'image',
        mediaId: bg.mediaId,
        url: bg.url ?? null,
        fit: 'cover',
      }),
    );
  if (bg.type === 'photo' && bg.dim)
    under.push(
      posterLayerSchema.parse({
        id: `${tag}dim`,
        type: 'fill',
        paint: 'color',
        colors: ['#000000'],
        opacity: bg.dim,
      }),
    );
  return [...under, ...tpl.layers.map((l, i) => ({ ...l, id: `${tag}${i}${l.id}` }))].slice(
    0,
    MAX_POSTER_LAYERS,
  );
}

/**
 * The slides: a strip of small pictures (the background, then each slide) to choose what
 * to edit; a new slide is empty, a copy, or made from a saved poster; the chosen slide's
 * length, change, place in the row; and saving the whole slideshow in the app to open
 * again (church-wide, like poster templates).
 */
function SlidesBar({
  slides,
  setSlides,
  editing,
  onEdit,
  doc,
  setDoc,
  templates,
  aspect,
  texts,
}: {
  slides: Slide[];
  setSlides: (f: (cur: Slide[]) => Slide[]) => void;
  editing: number | null;
  onEdit: (i: number | null) => void;
  doc: PosterDoc;
  setDoc: (d: PosterDoc) => void;
  templates: PosterTemplate[];
  aspect: string;
  texts: PosterTexts;
}) {
  const t = useT();
  const toast = useToast();
  const ts = t.freePoster.slides;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const saved = useSlideshows(listOpen || openId !== null);
  const save = useSaveSlideshow();
  const remove = useDeleteSlideshow();
  const sl = editing !== null ? slides[editing] : undefined;
  const total = slides.reduce((a, b) => a + b.seconds, 0);
  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const add = (layers: PosterLayer[], from?: Slide) => {
    haptic.tap();
    setSlides((cur) => [
      ...cur,
      {
        id: newId(),
        layers,
        seconds: from?.seconds ?? 4,
        transition: from?.transition ?? 'glitch',
      },
    ]);
    setAdding(false);
    onEdit(slides.length);
  };
  const change = (p: Partial<Slide>) =>
    editing !== null && setSlides((cur) => cur.map((x, i) => (i === editing ? { ...x, ...p } : x)));
  const move = (d: -1 | 1) => {
    if (editing === null) return;
    const to = editing + d;
    if (to < 0 || to >= slides.length) return;
    haptic.tap();
    setSlides((cur) => {
      const next = [...cur];
      [next[editing], next[to]] = [next[to]!, next[editing]!];
      return next;
    });
    onEdit(to);
  };
  const mine = saved.data?.find((x) => x.id === openId)?.mine ?? false;
  const doSave = async () => {
    const title = name.trim() || ts.untitled;
    try {
      const res = await save.mutateAsync({
        ...(openId && mine ? { id: openId } : {}),
        name: title,
        background: doc.background,
        layers: doc.layers,
        frame: doc.frame ?? null,
        slides,
      });
      setOpenId(res.id);
      setName(res.name);
      haptic.success();
      toast(ts.savedOk);
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  };
  const open = async (x: SavedSlideshow) => {
    if (slides.length && !(await confirmDialog(ts.openConfirm(x.name)))) return;
    setDoc({ ...doc, background: x.background, layers: x.layers, frame: x.frame });
    setSlides(() => x.slides.map((s) => ({ ...s })));
    setOpenId(x.id);
    setName(x.name);
    setListOpen(false);
    onEdit(null);
  };
  const tile = (
    on: boolean,
    key: string,
    label: string,
    act: () => void,
    layers: PosterLayer[] | null,
  ) => (
    <button
      key={key}
      type="button"
      onClick={act}
      className={`relative w-[86px] shrink-0 overflow-hidden rounded-lg ring-2 transition ${
        on ? 'ring-[var(--brand)]' : 'ring-transparent'
      }`}
      style={{ aspectRatio: aspect }}
    >
      {/* A still picture: no effects run in the strip. */}
      <StillMotion.Provider value>
        <div className="pointer-events-none absolute inset-0 [container-type:size]">
          <LayeredPoster fill tpl={doc} texts={texts} slides={layers ? [{ key, layers }] : []} />
        </div>
      </StillMotion.Provider>
      <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[10px] font-semibold text-white">
        {label}
      </span>
    </button>
  );
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-hairline/50 p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold">🎞 {ts.title}</div>
        {slides.length > 0 && (
          <div className="text-[12px] font-semibold text-hint">
            {t.motionExport.length(Math.round(total))}
          </div>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto p-0.5 pb-1">
        {tile(editing === null, 'bg', ts.background, () => onEdit(null), null)}
        {slides.map((x, i) =>
          tile(editing === i, x.id, `${i + 1} · ${x.seconds} с`, () => onEdit(i), x.layers),
        )}
        {slides.length < MAX_SLIDES && (
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            className="flex w-[86px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-hint/40 text-[22px] text-hint"
            style={{ aspectRatio: aspect }}
            aria-label={ts.add}
          >
            ＋
          </button>
        )}
      </div>
      {slides.length === 0 && !adding && (
        <p className="text-[11px] leading-snug text-hint">{ts.hint}</p>
      )}
      {adding && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-[var(--color-section)] p-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => add([])}
              className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold"
            >
              {ts.emptySlide}
            </button>
            {sl && (
              <button
                type="button"
                onClick={() =>
                  add(
                    sl.layers.map((l) => ({ ...l, id: `${l.id}c` })),
                    sl,
                  )
                }
                className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold"
              >
                {ts.copySlide}
              </button>
            )}
          </div>
          {templates.length > 0 && (
            <>
              <div className="text-[12px] font-semibold text-hint">{ts.fromPoster}</div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => add(posterAsLayers(tpl))}
                    className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold"
                  >
                    🖼 {tpl.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {sl && editing !== null && (
        <div className="flex flex-col gap-2 rounded-xl bg-[var(--color-section)] p-2">
          <label className="flex items-center gap-2 text-[12px] text-hint">
            {ts.seconds(sl.seconds)}
            <input
              type="range"
              min={1.5}
              max={15}
              step={0.5}
              value={sl.seconds}
              onChange={(e) => change({ seconds: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
          <div className="text-[12px] font-semibold text-hint">{ts.transition}</div>
          <div className="flex flex-wrap gap-1.5">
            {SLIDE_TRANSITIONS.map((k: SlideTransition) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  haptic.tap();
                  change({ transition: k });
                }}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  sl.transition === k ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                }`}
              >
                {ts.kinds[k]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={editing === 0}
              className="rounded-full bg-hairline px-3 py-1 disabled:opacity-40"
            >
              ← {ts.earlier}
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={editing === slides.length - 1}
              className="rounded-full bg-hairline px-3 py-1 disabled:opacity-40"
            >
              {ts.later} →
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!(await confirmDialog(ts.removeConfirm))) return;
                setSlides((cur) => cur.filter((_, j) => j !== editing));
                onEdit(null);
              }}
              className="rounded-full bg-hairline px-3 py-1 text-[var(--color-danger,#e5484d)]"
            >
              🗑 {ts.remove}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t border-hairline pt-2">
        {slides.length > 0 && (
          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder={ts.namePlaceholder}
              className="min-w-0 flex-1 rounded-xl bg-[var(--color-section)] px-3 py-1.5 text-[14px] outline-none"
            />
            <button
              type="button"
              onClick={() => void doSave()}
              disabled={save.isPending}
              className="rounded-full bg-[var(--brand)] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              💾 {openId && mine ? ts.update : ts.save}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setListOpen(!listOpen)}
          className="self-start text-[13px] font-semibold text-link"
        >
          📂 {ts.savedList} {listOpen ? '▴' : '▾'}
        </button>
        {listOpen && (
          <div className="flex flex-col gap-1">
            {saved.isLoading && <p className="text-[12px] text-hint">…</p>}
            {saved.data?.length === 0 && <p className="text-[12px] text-hint">{ts.noSaved}</p>}
            {saved.data?.map((x) => (
              <div
                key={x.id}
                className="flex items-center gap-2 rounded-xl bg-[var(--color-section)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{x.name}</div>
                  <div className="text-[11px] text-hint">
                    {ts.count(
                      x.slides.length,
                      Math.round(x.slides.reduce((a, b) => a + b.seconds, 0)),
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void open(x)}
                  className="rounded-full bg-hairline px-3 py-1 text-[12px] font-semibold"
                >
                  {ts.open}
                </button>
                {x.mine && (
                  <button
                    type="button"
                    aria-label={ts.deleteSaved}
                    onClick={async () => {
                      if (!(await confirmDialog(ts.deleteConfirm(x.name)))) return;
                      remove.mutate(x.id);
                      if (openId === x.id) setOpenId(null);
                    }}
                    className="rounded-full px-2 py-1 text-[13px]"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
      <SavedSizes size={size} onPick={set} />
      <p className="text-[11px] leading-snug text-hint">{tf.ownSizeHint}</p>
    </div>
  );
}

/** Own sizes kept on this phone or computer (a screen in the hall, a banner…). */
const SIZES_KEY = 'church.ownSizes';
function readSizes(): Size[] {
  try {
    const v = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '[]') as Size[];
    return Array.isArray(v) ? v.filter((x) => x && x.w > 0 && x.h > 0).slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** The kept own sizes to pick, and «save this size» for the one being used. */
function SavedSizes({ size, onPick }: { size: Size; onPick: (s: Size) => void }) {
  const tf = useT().freePoster;
  const [list, setList] = useState(readSizes);
  const keep = (next: Size[]) => {
    setList(next);
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: kept for this visit only.
    }
  };
  const has = list.some((x) => x.w === size.w && x.h === size.h);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((x) => {
        const on = x.w === size.w && x.h === size.h;
        return (
          <span
            key={`${x.w}x${x.h}`}
            className={`flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-[12px] font-semibold ${
              on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                onPick(x);
              }}
            >
              ⭐ {x.w}×{x.h}
            </button>
            <button
              type="button"
              aria-label={tf.forgetSize}
              onClick={() => keep(list.filter((y) => y !== x))}
              className="rounded-full px-1.5 opacity-70"
            >
              ✕
            </button>
          </span>
        );
      })}
      {!has && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            keep([{ w: size.w, h: size.h }, ...list].slice(0, 12));
          }}
          className="rounded-full border border-dashed border-hint/50 px-2.5 py-1 text-[12px] font-semibold text-link"
        >
          {tf.saveSize(size.w, size.h)}
        </button>
      )}
    </div>
  );
}
