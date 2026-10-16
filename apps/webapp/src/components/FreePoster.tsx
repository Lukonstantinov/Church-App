import { useState } from 'react';
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
import { CoverEffects, effectLayers, initEffects, type EffectsState } from './CoverEffects';
import { LayeredPoster } from './LayeredPoster';
import { PosterGestures } from './PosterGestures';
import { DraftAside, PosterLayersEditor, starterDoc, usePosterDraft } from './PosterStudio';
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
    layered.setDoc((d) => ({
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
          <LayeredPoster fill tpl={layered.doc} texts={textsOf(words)} />
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
        layers={layered.doc.layers}
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
        <PosterLayersEditor
          doc={layered.doc}
          setDoc={layered.setDoc}
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
    />
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
      <p className="text-[11px] leading-snug text-hint">{tf.ownSizeHint}</p>
    </div>
  );
}
