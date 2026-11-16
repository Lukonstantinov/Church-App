import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from 'react';
import {
  MAX_POSTER_LAYERS,
  MAX_SLIDES,
  posterLayerSchema,
  resolveBrand,
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
  useUploadMedia,
} from '../lib/queries';
import { StillMotion } from '../lib/perf';
import {
  designColours,
  hueBetween,
  mainColour,
  recolourDoc,
  recolourEffects,
  recolourLayers,
  shiftHex,
} from '../lib/recolour';
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
import { MotionExport } from './MotionExport';
import type { PosterTextValue } from './PosterText';
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

/** How many colour variants one design can have, and the ones «create 5» starts with. */
const MAX_VARIANTS = 5;
const STARTER_TURNS = [60, 120, 180, 240, 300];
/** Small copies of the poster are laid out this wide and shrunk, so they match the big one. */
const THUMB_LAID = 400;

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
  screen: { w: 2000, h: 640 },
  a4: { w: 2480, h: 3508 },
} as const;

/** What the maker keeps on the phone between visits (the layers and slides separately). */
interface Kept {
  shape: Shape;
  /** The own size, when the shape is «Own size». */
  size?: Size;
  effects: EffectsState;
  /**
   * Before everything became layers, the poster was one of four kinds; a draft of another
   * kind is turned into layers once when opened (see `legacy` in the maker).
   */
  source?: 'photo' | 'template' | 'colours' | 'layers';
  tplId?: number | null;
}

/**
 * A new poster: the ministry's own colours with its name in big letters and lines for the
 * date and the place under it — a starting point, every part of it a layer to change.
 */
function ministryDoc(brand: { light: string; partner: string }): PosterDoc {
  const doc = starterDoc();
  return {
    ...doc,
    background: { ...doc.background, colors: [brand.light, brand.partner] },
    layers: [
      ...doc.layers.map((l) => (l.type === 'text' ? { ...l, color: '#ffffff' } : l)),
      // The third line of the words (the place); nothing is drawn while there is none.
      posterLayerSchema.parse({
        type: 'text',
        id: 'place',
        source: 'place',
        y: 91,
        size: 18,
        weight: 400,
        color: '#ffffff',
      }),
    ],
  };
}

/** A poster template's texts from the words: first line the title, then date, place, topic. */
function textsOf(words: PosterTextValue): PosterTexts {
  const [title = '', date = '', place = '', topic = ''] =
    words.mode === 'custom' ? words.text.split('\n') : [];
  return { title, date, time: '', place: place.replace(/^📍\s*/, ''), topic };
}

/**
 * «🎬 Animated poster» without an event: layers (photos, cut-outs, texts, colours) started
 * from the ministry's colours, a photo or a saved poster, any effects (several at once, each with its settings), own words on
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
  const [shape, setShape] = useState<Shape>(kept?.shape ?? '4:5');
  const [effects, setEffects] = useState<EffectsState>(
    () => kept?.effects ?? initEffects({ motion: 'aurora', motionTune: null, motionLayers: [] }),
  );
  const [size, setSize] = useState<Size>(kept?.size ?? { w: 1920, h: 1080 });
  useDraft('free', { shape, size, effects } satisfies Kept, fresh);
  useOpeningMark('free', !fresh);
  // Own layers, as in the poster editor (pictures, cut-outs, texts, colours, effects).
  const brand = resolveBrand(g.brandColor);
  const layered = usePosterDraft('free.layers', () => ministryDoc(brand));
  const upload = useUploadMedia(g.id, 'event');
  const toast = useToast();
  // A draft from before everything became layers: its photo or poster template is made
  // the layers' start, once (the ministry's colours are the start anyway).
  const legacy = useRef(!fresh && kept?.source && kept.source !== 'layers' ? kept.source : null);
  useEffect(() => {
    const was = legacy.current;
    if (!was) return;
    if (was === 'template' && !templates.data) return;
    legacy.current = null;
    // Kept without its old kind, so this isn't done again over later work.
    writeDraft('free', { shape, size, effects } satisfies Kept);
    const old = readDraft<string>('free.photo')?.data;
    dropDraft('free.photo');
    const tpl = templates.data?.find((x) => x.id === kept?.tplId) ?? templates.data?.[0];
    // (A layers draft already there is the person's work: a template doesn't replace it.)
    if (was === 'template' && tpl && !layered.restored) startFrom(tpl);
    else if (was === 'photo' && old)
      void fetch(old)
        .then((r) => r.blob())
        .then((blob) => startPhoto(blob))
        .catch(() => undefined);
    // Once, when an old draft is opened (and its templates have come).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data]);
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
  // Colour variants: the whole design turned this many degrees round the colour wheel each.
  const [keptTints] = useState(() =>
    fresh ? undefined : readDraft<{ turns: number[]; pictures: boolean }>('free.variants')?.data,
  );
  const [turns, setTurns] = useState<number[]>(keptTints?.turns ?? []);
  const [tintPictures, setTintPictures] = useState(keptTints?.pictures ?? false);
  useDraft('free.variants', { turns, pictures: tintPictures }, fresh);
  // The variant on the preview (null = the original); while all are being saved, the
  // one the recording asked for.
  const [picked, setPicked] = useState<number | null>(null);
  const [batch, setBatch] = useState<{ i: number | null } | null>(null);
  const batchShown = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!batchShown.current) return;
    const done = batchShown.current;
    batchShown.current = null;
    // The poster is drawn anew in the variant's colours: its pictures, letter masks and
    // effects are given time to be ready before the recorder looks.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setTimeout(done, 700));
    });
    return () => cancelAnimationFrame(id);
  }, [batch]);
  const variantRun = turns.length
    ? {
        count: turns.length,
        show: (i: number | null) =>
          new Promise<void>((resolve) => {
            batchShown.current = resolve;
            setBatch({ i });
          }),
        stop: () => setBatch(null),
      }
    : undefined;
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
    slides.length > 0
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

  // The original (first) and every colour variant, each ready to draw. Made once per
  // change: a poster given new layer objects on every redraw would remake its pictures.
  const looks = useMemo(
    () =>
      [0, ...turns].map((deg) => ({
        deg,
        doc: recolourDoc(layered.doc, deg, tintPictures),
        slides: deg
          ? slides.map((sl) => ({ ...sl, layers: recolourLayers(sl.layers, deg, tintPictures) }))
          : slides,
        fx: recolourEffects(effectLayers(effects), deg),
        // Effects and parts in the ministry's colour follow it through these.
        vars: deg
          ? ({
              '--brand': shiftHex(brand.light, deg),
              '--brand-dark': shiftHex(brand.dark, deg),
              '--brand-partner': shiftHex(brand.partner, deg),
            } as CSSProperties)
          : undefined,
      })),
    [turns, layered.doc, slides, effects, tintPictures, brand.light, brand.dark, brand.partner],
  );
  type Look = (typeof looks)[number];
  const viewed = batch ? batch.i : picked;
  const look = looks[viewed === null ? 0 : viewed + 1] ?? looks[0]!;
  // The colour a variant is named by: the design's main one (else the ministry's).
  const main =
    mainColour([
      ...designColours(layered.doc),
      ...slides.flatMap((sl) => designColours({ ...layered.doc, layers: sl.layers })),
      ...designColours(null, effectLayers(effects)),
    ]) ?? brand.light;
  const [ratioW = 1, ratioH = 1] = SHAPE_RATIO[shape].split(' / ').map(Number);
  const ratio = shape === 'custom' ? size.w / size.h : ratioW / ratioH;

  /** Starts again from a saved poster, or (none) the ministry's colours; slides stay. */
  function startFrom(tpl: PosterTemplate | null) {
    setSelected(null);
    setEditing(null);
    layered.setDoc(
      tpl
        ? {
            background: tpl.background,
            layers: tpl.layers.map((l) => ({ ...l })),
            frame: tpl.frame,
          }
        : ministryDoc(brand),
    );
  }
  /** A photo as the poster's background (kept in the app, like any layer's picture). */
  async function startPhoto(blob: Blob) {
    try {
      const up = await upload.mutateAsync(blob);
      layered.setDoc((d) => ({
        ...d,
        background: { ...d.background, type: 'photo', mediaId: up.id, url: up.url },
      }));
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }
  const pick = async (f: File | undefined) => {
    if (f) await startPhoto(await preparePhoto(f, 1400).catch(() => f));
  };
  const restart = async (tpl: PosterTemplate | null) => {
    if (await confirmDialog(tf.startConfirm)) startFrom(tpl);
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

  /** The poster in one look's colours; `thumb` = a small still copy (the first slide). */
  const draw = (lk: Look, words: PosterTextValue, thumb = false) => (
    <div
      // Drawn anew for another variant: effects read the ministry's colour when they start.
      key={thumb ? undefined : lk.deg}
      className={`relative w-full ${SHAPES[shape]}`}
      style={{
        ...(shape === 'custom' ? { aspectRatio: `${size.w} / ${size.h}` } : null),
        ...lk.vars,
      }}
    >
      {lk.slides.length && !thumb ? (
        <SlideshowPoster
          tpl={lk.doc}
          slides={lk.slides}
          texts={textsOf(words)}
          editing={slideIdx}
          forced={forced}
        />
      ) : (
        <LayeredPoster
          fill
          tpl={lk.doc}
          texts={textsOf(words)}
          slides={
            lk.slides[0] ? [{ key: lk.slides[0].id, layers: lk.slides[0].layers }] : undefined
          }
        />
      )}
      <LivingLayers layers={lk.fx} />
    </div>
  );
  // The layers move with a finger right on the preview.
  const render = (words: PosterTextValue) => (
    <PosterGestures
      layers={editDoc.layers}
      selected={selected}
      onSelect={setSelected}
      onPatch={patch}
    >
      {draw(look, words)}
    </PosterGestures>
  );

  // «🎨 Colour variants»: small still copies to choose from, each one's colour to change.
  const thumbW = Math.round(Math.min(170, Math.max(44, 58 * ratio)));
  const variantTile = (i: number | null, words: PosterTextValue) => {
    const lk = looks[i === null ? 0 : i + 1];
    if (!lk) return null;
    return (
      <button
        key={i ?? 'original'}
        type="button"
        onClick={() => {
          haptic.tap();
          setPicked(i);
        }}
        className={`relative shrink-0 overflow-hidden rounded-lg bg-black ring-2 transition ${
          picked === i ? 'ring-[var(--brand)]' : 'ring-transparent'
        }`}
        style={{ width: thumbW, height: Math.round(thumbW / ratio) }}
      >
        {/* A still picture: no effects run in the strip. */}
        <StillMotion.Provider value>
          <div
            className="pointer-events-none absolute left-0 top-0 text-white"
            style={{
              width: THUMB_LAID,
              transform: `scale(${thumbW / THUMB_LAID})`,
              transformOrigin: 'top left',
            }}
          >
            {draw(lk, words, true)}
          </div>
        </StillMotion.Provider>
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 px-1 py-0.5 text-[10px] font-semibold text-white">
          {i !== null && (
            <span
              className="h-2 w-2 rounded-full ring-1 ring-white/70"
              style={{ background: shiftHex(main, lk.deg) }}
            />
          )}
          {i === null ? tf.variants.original : i + 1}
        </span>
      </button>
    );
  };
  const setTurn = (i: number, deg: number) =>
    setTurns((cur) => cur.map((d, j) => (j === i ? ((Math.round(deg) % 360) + 360) % 360 : d)));
  const hasPictures = [layered.doc.layers, ...slides.map((sl) => sl.layers)].some((ls) =>
    ls.some((l) => l.type === 'image'),
  );
  const variantsBlock = (words: PosterTextValue) => (
    <div className="flex flex-col gap-2 rounded-2xl bg-hairline/50 p-2.5">
      <div className="text-[13px] font-semibold">🎨 {tf.variants.title}</div>
      <p className="text-[11px] leading-snug text-hint">{tf.variants.hint}</p>
      {turns.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            setTurns(STARTER_TURNS);
          }}
          className="self-start rounded-full bg-[var(--brand)] px-3 py-1.5 text-[13px] font-semibold text-white"
        >
          {tf.variants.create}
        </button>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto p-0.5 pb-1">
            {variantTile(null, words)}
            {turns.map((_, i) => variantTile(i, words))}
            {turns.length < MAX_VARIANTS && (
              <button
                type="button"
                aria-label={tf.variants.add}
                onClick={() => {
                  haptic.tap();
                  // A colour of its own: a step on from the last one.
                  setTurns((cur) => [...cur, ((cur[cur.length - 1] ?? 0) + 45) % 360 || 45]);
                  setPicked(turns.length);
                }}
                className="flex shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-hint/40 text-[20px] text-hint"
                style={{ width: 44, height: Math.round(thumbW / ratio) }}
              >
                ＋
              </button>
            )}
          </div>
          {picked !== null && turns[picked] !== undefined && (
            <div className="flex flex-col gap-2 rounded-xl bg-[var(--color-section)] p-2">
              <div className="flex items-center gap-2 text-[12px] text-hint">
                <label className="flex items-center gap-2">
                  {tf.variants.colour}
                  <input
                    type="color"
                    value={shiftHex(main, turns[picked])}
                    onChange={(e) => setTurn(picked, hueBetween(main, e.target.value))}
                    className="h-8 w-10 rounded-lg border-0 bg-transparent p-0"
                  />
                </label>
                <input
                  type="range"
                  min={1}
                  max={359}
                  value={turns[picked] || 1}
                  aria-label={tf.variants.shade}
                  onChange={(e) => setTurn(picked, Number(e.target.value))}
                  className="min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    setTurns((cur) => cur.filter((_, j) => j !== picked));
                    setPicked(null);
                  }}
                  className="rounded-full bg-hairline px-2.5 py-1 font-semibold text-[var(--color-danger,#e5484d)]"
                >
                  🗑 {tf.variants.remove}
                </button>
              </div>
              <p className="text-[11px] leading-snug text-hint">{tf.variants.shown(picked + 1)}</p>
            </div>
          )}
          {hasPictures && (
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={tintPictures}
                onChange={(e) => setTintPictures(e.target.checked)}
              />
              {tf.variants.pictures}
            </label>
          )}
          <p className="text-[11px] leading-snug text-hint">{tf.variants.saveHint}</p>
        </>
      )}
    </div>
  );

  // The preview first, pinned while everything that changes it scrolls below.
  const settings = (words: PosterTextValue) => (
    <>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold text-hint">{tf.startFrom}</div>
        <div className="flex flex-wrap gap-1.5">
          {pill(false, tf.startColours, () => void restart(null))}
          <label className="cursor-pointer rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold">
            {upload.isPending ? '…' : tf.startPhoto}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {(templates.data ?? []).map((x) => pill(false, `🖼 ${x.name}`, () => void restart(x)))}
        </div>
        <p className="text-[12px] leading-snug text-hint">{tf.startHint}</p>
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
      {
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
      }
      <PosterLayersEditor
        doc={editDoc}
        setDoc={setEditDoc}
        g={g}
        selected={selected}
        setSelected={setSelected}
      />
      <CoverEffects state={effects} onChange={setEffects} open={fxOpen} onOpen={setFxOpen} />
      {variantsBlock(words)}
    </>
  );

  return (
    <MotionExport
      name={tf.fileName}
      preview={{ preset: g.name, render, modes: ['custom', 'none'], plain: true }}
      extra={settings}
      draftKey="free.text"
      size={shape === 'custom' ? size : undefined}
      slideshow={slideshow}
      variants={variantRun}
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
