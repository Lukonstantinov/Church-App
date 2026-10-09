import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  MAX_EFFECTS,
  MAX_POSTER_LAYERS,
  BLEND_MODES,
  FILL_MOVES,
  LAYER_SHAPES,
  TEXT_SOURCES,
  type BlendMode,
  type FontKey,
  type GroupSummary,
  type LayerStyle,
  type MotionLayer,
  type PosterBackground,
  type PosterFrame,
  type PosterLayer,
  type PosterTemplate,
  type PosterTexts,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { cutOutPeople } from '../lib/cutout';
import { dropDraft, readDraft, useDraft } from '../lib/drafts';
import { prepareCutout } from '../lib/image';
import { FullMotion } from '../lib/perf';
import {
  posterLinks,
  useDeletePosterTemplate,
  usePosterTemplates,
  useSavePosterTemplate,
  useUploadMedia,
} from '../lib/queries';
import { askBeforeClosing, confirmDialog, haptic } from '../lib/telegram';
import { EffectSets } from './EffectSets';
import { EraserSheet } from './EraserSheet';
import { FontPicker } from './FontPicker';
import { IconChevronDown, IconPlus, IconX } from './icons';
import { LayeredPoster } from './LayeredPoster';
import { LookTop } from './LookTop';
import { Group, Pill } from './LookControls';
import { MotionPicker } from './MotionPicker';
import { PosterGestures } from './PosterGestures';
import { Knob, PALETTE } from './MotionTune';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, DateBadge, Toggle } from './ui';

/**
 * Where a poster is shown, in the app's real shapes: the poster sent by the bot (4:5), a
 * home tile (16:10), the event or meeting screen (4:3) and, for events, the pinned card on
 * the main page.
 */
type View = 'poster' | 'tile' | 'screen' | 'pinned';
type Kind = 'event' | 'meeting';
const VIEWS: Record<Kind, View[]> = {
  event: ['poster', 'tile', 'screen', 'pinned'],
  meeting: ['poster', 'tile', 'screen'],
};

const newId = () => `l${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;

/** Made-up details for the previews (a real event or meeting fills in its own). */
function useSample(kind: Kind = 'meeting') {
  const t = useT();
  const f = useFmt();
  // A sample day nine days ahead at 18:00, fixed while the screen is open.
  const [when] = useState(() => {
    const d = new Date(Date.now() + 9 * 86_400_000);
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  });
  const texts = useMemo(
    (): PosterTexts => ({
      title: kind === 'event' ? t.posters.sampleEvent : t.design.sampleTitle,
      date: f.weekdayDayMonth(when),
      time: f.time(when),
      place: t.design.sampleLocation,
      topic: t.design.sampleTopic,
    }),
    [t, f, when, kind],
  );
  return { texts, when };
}

/** The poster as it will look in the app, with made-up details around it. */
function Mockup({
  view,
  kind,
  tpl,
  g,
}: {
  view: View;
  kind: Kind;
  tpl: Pick<PosterTemplate, 'background' | 'layers' | 'frame'>;
  g: GroupSummary;
}) {
  const t = useT();
  const f = useFmt();
  const { texts, when } = useSample(kind);
  const poster = (className: string) => (
    <LayeredPoster tpl={tpl} texts={texts} className={className} />
  );
  if (view === 'poster') return poster('aspect-[4/5] h-full rounded-2xl shadow-card');
  if (view === 'pinned')
    return (
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wide text-section-header">
          📌 {t.posters.views.pinned}
        </span>
        <div className="relative h-[150px] w-[280px] overflow-hidden rounded-[24px] shadow-cta">
          <LayeredPoster fill tpl={tpl} texts={texts} />
        </div>
      </div>
    );
  if (view === 'tile')
    return (
      <div className="glass flex w-[172px] flex-col overflow-hidden rounded-2xl shadow-card">
        {kind === 'meeting' ? (
          <LookTop
            look={g}
            className="isolate flex aspect-[16/10] flex-col justify-between p-2.5"
            under={<LayeredPoster fill tpl={tpl} texts={texts} />}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
              {t.meetings.details}
            </span>
            <DateBadge {...f.dateBadge(when)} onBrand />
          </LookTop>
        ) : (
          poster('aspect-[16/10] w-full')
        )}
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[14px] font-semibold">
            {kind === 'meeting' ? texts.topic : texts.title}
          </span>
          <span className="truncate text-[12px] text-hint">
            {kind === 'meeting' ? f.relativeDay(when) : texts.date} · {texts.time}
          </span>
        </div>
      </div>
    );
  // The top of the event or meeting screen, as on a phone.
  return (
    <div className="flex h-full w-[220px] flex-col gap-2 overflow-hidden rounded-[26px] border-4 border-[var(--color-text)]/80 bg-[var(--color-bg)] p-2 shadow-card">
      {poster('aspect-[4/3] w-full shrink-0 rounded-[14px] shadow-card')}
      <div className="brand-gradient shrink-0 rounded-[14px] p-3 text-white shadow-card">
        <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">{g.name}</div>
        <div className="truncate text-[15px] font-bold leading-tight">{texts.title}</div>
        <div className="text-[11px] opacity-85">
          {texts.date} · {texts.time}
        </div>
        {kind === 'meeting' && (
          <div className="mt-1 truncate text-[11px] font-semibold">«{texts.topic}»</div>
        )}
      </div>
      <div className="h-8 shrink-0 rounded-[12px] bg-hairline" />
    </div>
  );
}

/**
 * Design → Posters: the church's poster templates as live previews, and "New poster".
 * A template is a background and layers (pictures, texts, effects) and can be chosen for
 * any event or meeting, whose own words fill in its texts.
 */
export function PosterStudio({ g }: { g: GroupSummary }) {
  const t = useT();
  const list = usePosterTemplates();
  const { texts } = useSample();
  const [editing, setEditing] = useState<PosterTemplate | 'new' | null>(null);
  return (
    <section>
      <div className="motion-still grid grid-cols-3 gap-2.5">
        {(list.data ?? []).map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => setEditing(tpl)}
            className="flex flex-col gap-1 text-left active:scale-95"
          >
            <LayeredPoster
              tpl={tpl}
              texts={texts}
              className="aspect-[4/5] w-full rounded-2xl shadow-card"
            />
            <span className="truncate px-1 text-[12px] font-semibold">{tpl.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="glass flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-hint/30 text-hint active:scale-95"
        >
          <IconPlus size={24} />
          <span className="text-[12px] font-semibold">{t.posters.new}</span>
        </button>
      </div>
      {editing && (
        <PosterEditor
          tpl={editing === 'new' ? null : editing}
          g={g}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** A new colour layer: covering the whole poster, under what is added after it. */
const FILL_START = {
  type: 'fill',
  x: 50,
  y: 50,
  w: 100,
  h: 100,
  rotate: 0,
  angle: 135,
} as const;

/** A starting point: a red background with the event's name in big letters. */
const STARTER: { background: PosterBackground; layers: PosterLayer[] } = {
  background: { type: 'gradient', colors: ['#e8402c', '#7a1410'], angle: 160, dim: null },
  layers: [
    {
      type: 'text',
      id: 'title',
      source: 'title',
      x: 50,
      y: 42,
      size: 60,
      rotate: 0,
      weight: 900,
      upper: true,
      color: '#111111',
    },
    {
      type: 'text',
      id: 'date',
      source: 'date',
      x: 50,
      y: 78,
      size: 22,
      rotate: 0,
      weight: 700,
      color: '#ffffff',
    },
  ],
};

/** A poster's design: background, layers (front last) and frame. */
export interface PosterDoc {
  background: PosterBackground;
  layers: PosterLayer[];
  frame: PosterFrame | null;
}

/** A new design: a red background with the title and the date. */
export const starterDoc = (): PosterDoc => ({ ...STARTER, frame: null });

/**
 * A design kept on the phone gets fresh links to its pictures (they last a day or two):
 * the server signs the same pictures again.
 */
export async function freshLinks(doc: PosterDoc): Promise<PosterDoc> {
  const ids = [
    doc.background.mediaId,
    ...doc.layers.flatMap((l) => (l.type === 'image' ? [l.mediaId, l.source] : [])),
  ].filter((x): x is number => !!x);
  if (ids.length === 0) return doc;
  const links = await posterLinks([...new Set(ids)]).catch(() => ({}) as Record<number, string>);
  const link = (id: number | null | undefined, old?: string | null) =>
    (id && links[id]) || old || null;
  return {
    ...doc,
    background: { ...doc.background, url: link(doc.background.mediaId, doc.background.url) },
    layers: doc.layers.map((l) =>
      l.type === 'image'
        ? { ...l, url: link(l.mediaId, l.url), sourceUrl: link(l.source, l.sourceUrl) }
        : l,
    ),
  };
}

/** Keeps a design as a draft on this phone and brings it back (with fresh picture links). */
export function usePosterDraft(key: string, initial: () => PosterDoc) {
  const [kept] = useState(() => readDraft<PosterDoc>(key));
  const [doc, setDoc] = useState<PosterDoc>(() => kept?.data ?? initial());
  const [restored, setRestored] = useState(!!kept);
  useEffect(() => {
    if (!kept) return;
    let stop = false;
    void freshLinks(kept.data).then((d) => !stop && setDoc(d));
    return () => {
      stop = true;
    };
  }, [kept]);
  useDraft(key, doc);
  const forget = () => {
    dropDraft(key);
    setRestored(false);
  };
  return { doc, setDoc, restored, forget };
}

/**
 * The layers of a design, to add, cut out, erase, order, hide and set up — the poster editor
 * and the animated poster maker both use it. The preview with finger moving is the caller's
 * (PosterGestures round LayeredPoster).
 */
export function PosterLayersEditor({
  doc,
  setDoc,
  g,
  selected,
  setSelected,
}: {
  doc: PosterDoc;
  setDoc: Dispatch<SetStateAction<PosterDoc>>;
  g: GroupSummary;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const upload = useUploadMedia(g.id, 'event');
  const picture = useRef<HTMLInputElement>(null);
  const [pictureFor, setPictureFor] = useState<string | null>(null);
  // The next new photo also gets its people cut out onto a layer of their own.
  const [cutNew, setCutNew] = useState(false);
  const [cutting, setCutting] = useState<'loading' | 'working' | null>(null);
  const [erasing, setErasing] = useState<Extract<PosterLayer, { type: 'image' }> | null>(null);
  const { background, layers, frame } = doc;

  const setLayers = (f: (all: PosterLayer[]) => PosterLayer[]) =>
    setDoc((d) => ({ ...d, layers: f(d.layers) }));
  const patch = (id: string, p: Partial<PosterLayer>) =>
    setLayers((all) => all.map((l) => (l.id === id ? ({ ...l, ...p } as PosterLayer) : l)));
  const move = (id: string, by: number) =>
    setLayers((all) => {
      const i = all.findIndex((l) => l.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = (layer: PosterLayer) => {
    haptic.tap();
    setLayers((all) => [...all, layer].slice(-MAX_POSTER_LAYERS));
    setSelected(layer.id);
  };

  /**
   * A picture layer split in two, both placed the same: the photo without the people (the
   * hole filled from around it) stays where the photo was, and the people go on a new layer
   * right above it — each with its own effects, styles and edges. Both remember the whole
   * photo, so the eraser can bring parts of it back.
   */
  async function cutOut(from: Extract<PosterLayer, { type: 'image' }>, src: Blob | string) {
    try {
      const cut = await cutOutPeople(src, setCutting);
      if (!cut.found) {
        toast(t.posters.cutNone, 'error');
        return;
      }
      const [people, back] = await Promise.all([
        upload.mutateAsync(cut.people),
        upload.mutateAsync(cut.background),
      ]);
      const source = from.source ?? from.mediaId;
      const sourceUrl = from.source ? from.sourceUrl : from.url;
      const layer: PosterLayer = {
        ...from,
        id: newId(),
        mediaId: people.id,
        url: people.url,
        ratio: cut.ratio,
        cutout: true,
        effects: null,
        style: null,
        hidden: null,
        source,
        sourceUrl,
      };
      setLayers((all) => {
        const next = all.map((l) =>
          l.id === from.id
            ? ({ ...l, mediaId: back.id, url: back.url, source, sourceUrl } as PosterLayer)
            : l,
        );
        next.splice(next.findIndex((l) => l.id === from.id) + 1, 0, layer);
        return next.slice(-MAX_POSTER_LAYERS);
      });
      setSelected(layer.id);
      haptic.success();
      toast(t.posters.cutDone);
    } catch {
      toast(t.posters.cutFailed, 'error');
    } finally {
      setCutting(null);
    }
  }

  async function pickPicture(file: File | undefined) {
    if (!file) return;
    try {
      const cut = await prepareCutout(file);
      const up = await upload.mutateAsync(cut.blob);
      const shape = { ratio: cut.ratio, cutout: cut.transparent };
      if (pictureFor === 'background') {
        setDoc((d) => ({
          ...d,
          background: { ...d.background, type: 'photo', mediaId: up.id, url: up.url },
        }));
      } else if (pictureFor) {
        patch(pictureFor, {
          mediaId: up.id,
          url: up.url,
          source: null,
          sourceUrl: null,
          ...shape,
        } as Partial<PosterLayer>);
      } else {
        // A cut-out (letters, a logo) is placed like a sticker; a plain photo fills the
        // poster, so it lines up the same in the poster, the tile and the screen.
        const layer: Extract<PosterLayer, { type: 'image' }> = {
          type: 'image',
          id: newId(),
          mediaId: up.id,
          url: up.url,
          x: 50,
          y: 50,
          size: cut.transparent ? 70 : 100,
          rotate: 0,
          fit: cut.transparent ? 'free' : 'cover',
          ...shape,
        };
        add(layer);
        if (cutNew) await cutOut(layer, cut.blob);
      }
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      setPictureFor(null);
      setCutNew(false);
      if (picture.current) picture.current.value = '';
    }
  }
  const choosePicture = (forId: string | null, cut = false) => {
    setPictureFor(forId);
    setCutNew(cut);
    picture.current?.click();
  };

  // Front first in the list, as in Photoshop.
  const ordered = [...layers].reverse();
  const label = (l: PosterLayer) =>
    l.type === 'image'
      ? l.cutout && l.source
        ? t.posters.peopleLayer
        : l.source
          ? t.posters.backgroundLayer
          : t.posters.picture
      : l.type === 'text'
        ? l.source === 'custom'
          ? l.text || t.posters.sources.custom
          : t.posters.sources[l.source]
        : l.type === 'fill'
          ? t.posters.fillLayer(l.paint)
          : t.meetings.motions[l.kind];

  return (
    <>
      <input
        ref={picture}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pickPicture(e.target.files?.[0])}
      />
      <div>
        <div className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.posters.addLayer}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill on={false} onClick={() => choosePicture(null)} label={`🖼 ${t.posters.picture}`} />
          <Pill
            on={false}
            onClick={() => choosePicture(null, true)}
            label={`✂️ ${t.posters.pictureNoBg}`}
          />
          <Pill
            on={false}
            onClick={() =>
              add({
                type: 'text',
                id: newId(),
                source: 'custom',
                text: t.posters.sampleWords,
                x: 50,
                y: 50,
                size: 30,
                rotate: 0,
              })
            }
            label={`T ${t.posters.text}`}
          />
          <Pill
            on={false}
            onClick={() =>
              add({
                ...FILL_START,
                id: newId(),
                paint: 'color',
                colors: ['#111111'],
                opacity: 0.5,
              })
            }
            label={`🎨 ${t.posters.colorLayer}`}
          />
          <Pill
            on={false}
            onClick={() =>
              add({
                ...FILL_START,
                id: newId(),
                paint: 'linear',
                colors: ['#7c3aed', '#ec4899', '#f59e0b'],
                move: 'flow',
                opacity: 0.7,
                blend: 'overlay',
              })
            }
            label={`🌈 ${t.posters.gradientLayer}`}
          />
          <Pill
            on={false}
            onClick={() => add({ type: 'effect', id: newId(), kind: 'sparkle' })}
            label={`✨ ${t.posters.effect}`}
          />
        </div>
        <p className="mt-1.5 px-1 text-[12px] text-hint">{t.posters.pictureHint}</p>
        <p className="mt-1 px-1 text-[12px] text-hint">{t.posters.cutHint}</p>
        {cutting && (
          <p className="mt-2 rounded-xl bg-hairline px-3 py-2 text-[13px] font-semibold">
            ✂️ {cutting === 'loading' ? t.posters.cutLoading : t.posters.cutWorking}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="px-1 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.posters.layers}
        </div>
        {/* The frame is in front of everything. */}
        <LayerRow
          title={t.posters.frame}
          icon="▢"
          hidden={!frame}
          open={selected === 'frame'}
          onOpen={() => setSelected(selected === 'frame' ? null : 'frame')}
        >
          <FrameSettings value={frame} onChange={(f) => setDoc((d) => ({ ...d, frame: f }))} />
        </LayerRow>
        {ordered.map((l, i) => (
          <LayerRow
            key={l.id}
            title={label(l)}
            icon={
              l.type === 'image' ? '🖼' : l.type === 'text' ? 'T' : l.type === 'fill' ? '🎨' : '✨'
            }
            thumb={l.type === 'image' ? l.url : null}
            hidden={!!l.hidden}
            open={selected === l.id}
            onOpen={() => setSelected(selected === l.id ? null : l.id)}
            onHide={() => patch(l.id, { hidden: !l.hidden })}
            onUp={i > 0 ? () => move(l.id, 1) : undefined}
            onDown={i < ordered.length - 1 ? () => move(l.id, -1) : undefined}
            onDelete={() => {
              setLayers((all) => all.filter((x) => x.id !== l.id));
              setSelected(null);
            }}
          >
            <LayerSettings
              layer={l}
              onChange={(p) => patch(l.id, p)}
              onPicture={() => choosePicture(l.id)}
              onCut={
                l.type === 'image' && l.url && !cutting
                  ? () => void cutOut(l, l.sourceUrl && !l.cutout ? l.sourceUrl : l.url!)
                  : undefined
              }
              onErase={l.type === 'image' && l.url ? () => setErasing(l) : undefined}
              cutting={cutting}
            />
          </LayerRow>
        ))}
        <LayerRow
          title={t.posters.background}
          icon="▦"
          thumb={background.type === 'photo' ? background.url : null}
          hidden={false}
          open={selected === 'background'}
          onOpen={() => setSelected(selected === 'background' ? null : 'background')}
        >
          <BackgroundSettings
            value={background}
            onChange={(b) => setDoc((d) => ({ ...d, background: b }))}
            onPhoto={() => choosePicture('background')}
          />
        </LayerRow>
      </div>
      {erasing?.url && (
        <EraserSheet
          url={erasing.url}
          sourceUrl={erasing.sourceUrl}
          onClose={() => setErasing(null)}
          onDone={async (blob) => {
            try {
              const up = await upload.mutateAsync(blob);
              // Rubbed-out parts make it see-through: effects then follow its outline.
              patch(erasing.id, { mediaId: up.id, url: up.url, cutout: true });
            } catch {
              toast(t.treasury.uploadFailed, 'error');
              throw new Error('upload');
            }
          }}
        />
      )}
    </>
  );
}

function PosterEditor({
  tpl,
  g,
  onClose,
}: {
  tpl: PosterTemplate | null;
  g: GroupSummary;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const save = useSavePosterTemplate();
  const remove = useDeletePosterTemplate();
  const draftKey = `poster.${tpl?.id ?? 'new'}`;
  const { doc, setDoc, restored, forget } = usePosterDraft(draftKey, () =>
    tpl ? { background: tpl.background, layers: tpl.layers, frame: tpl.frame } : starterDoc(),
  );
  const [name, setName] = useState(
    () => readDraft<string>(`${draftKey}.name`)?.data ?? tpl?.name ?? t.posters.defaultName,
  );
  useDraft(`${draftKey}.name`, name);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('poster');
  const [kind, setKind] = useState<Kind>('event');
  // Closing Telegram by mistake asks first (the draft is kept anyway).
  useEffect(() => askBeforeClosing(), []);

  const patch = (id: string, p: Partial<PosterLayer>) =>
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...p } as PosterLayer) : l)),
    }));

  async function submit() {
    try {
      await save.mutateAsync({
        id: tpl?.id,
        name: name.trim() || t.posters.defaultName,
        background: doc.background,
        layers: doc.layers,
        frame: doc.frame,
      });
      forget();
      dropDraft(`${draftKey}.name`);
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={tpl ? `🖼 ${tpl.name}` : `🖼 ${t.posters.new}`}>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* The poster in the chosen shape, pinned while the settings scroll. */}
        <div className="sticky top-0 z-20 -mx-4 rounded-b-[22px] bg-[var(--color-section)] px-4 pb-3 pt-1 shadow-card">
          <div className="mb-1.5 flex justify-center gap-1.5">
            {(['event', 'meeting'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  if (!VIEWS[k].includes(view)) setView('poster');
                }}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  kind === k
                    ? 'bg-[var(--color-text)] text-[var(--color-bg)]'
                    : 'bg-hairline text-hint'
                }`}
              >
                {k === 'event' ? t.posters.forEvent : t.posters.forMeeting}
              </button>
            ))}
          </div>
          <div className="mb-2 flex justify-center gap-1.5">
            {VIEWS[kind].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                  view === v ? 'brand-gradient text-white shadow-cta' : 'bg-hairline text-hint'
                }`}
              >
                {t.posters.views[v]}
              </button>
            ))}
          </div>
          <PosterGestures
            layers={doc.layers}
            selected={selected}
            onSelect={setSelected}
            onPatch={patch}
            outline
          >
            {/* What is being designed always moves, whatever the phone's graphics setting. */}
            <FullMotion.Provider value>
              <div className="flex h-[262px] items-center justify-center">
                <Mockup view={view} kind={kind} tpl={doc} g={g} />
              </div>
            </FullMotion.Provider>
          </PosterGestures>
          <p className="mt-1.5 text-center text-[11px] text-hint">{t.posters.dragHint}</p>
        </div>

        {restored && (
          <div className="flex items-center gap-2 rounded-xl bg-hairline px-3 py-2 text-[13px]">
            <span className="flex-1">💾 {t.posters.draftRestored}</span>
            <button
              type="button"
              className="font-semibold text-link"
              onClick={async () => {
                if (!(await confirmDialog(t.posters.draftDiscardConfirm))) return;
                forget();
                dropDraft(`${draftKey}.name`);
                setDoc(
                  tpl
                    ? { background: tpl.background, layers: tpl.layers, frame: tpl.frame }
                    : starterDoc(),
                );
                setName(tpl?.name ?? t.posters.defaultName);
              }}
            >
              {t.posters.draftDiscard}
            </button>
          </div>
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder={t.posters.name}
          className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
        />

        <PosterLayersEditor
          doc={doc}
          setDoc={setDoc}
          g={g}
          selected={selected}
          setSelected={setSelected}
        />

        <Button disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
        {tpl?.mine !== false && tpl && (
          <Button
            variant="secondary"
            disabled={remove.isPending}
            onClick={async () => {
              if (!(await confirmDialog(t.posters.deleteConfirm))) return;
              await remove.mutateAsync(tpl.id).catch(() => toast(t.common.actionFailed, 'error'));
              forget();
              onClose();
            }}
          >
            {t.posters.delete}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** One layer in the list: show/hide, move up/down, delete; tap to open its settings. */
function LayerRow({
  title,
  icon,
  thumb,
  hidden,
  open,
  onOpen,
  onHide,
  onUp,
  onDown,
  onDelete,
  children,
}: {
  title: string;
  icon: string;
  thumb?: string | null;
  hidden: boolean;
  open: boolean;
  onOpen: () => void;
  onHide?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const small =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline text-[14px] active:scale-90 disabled:opacity-30';
  return (
    <div
      className={`glass rounded-2xl ${open ? 'ring-2 ring-[var(--brand)]' : ''} ${hidden ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:10px_10px] object-contain"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-hairline text-[16px] font-bold">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</span>
          <IconChevronDown
            size={18}
            className={`shrink-0 text-hint transition ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {onHide && (
          <button type="button" aria-label={t.posters.hide} onClick={onHide} className={small}>
            {hidden ? '◌' : '👁'}
          </button>
        )}
        {(onUp || onDown) && (
          <>
            <button type="button" aria-label="up" disabled={!onUp} onClick={onUp} className={small}>
              ↑
            </button>
            <button
              type="button"
              aria-label="down"
              disabled={!onDown}
              onClick={onDown}
              className={small}
            >
              ↓
            </button>
          </>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label={t.posters.deleteLayer}
            onClick={onDelete}
            className={small}
          >
            <IconX size={14} />
          </button>
        )}
      </div>
      {open && <div className="flex flex-col gap-4 border-t border-hairline p-3">{children}</div>}
    </div>
  );
}

/** A row of colours: the palette, any colour, and (optionally) none. */
function ColorDots({
  value,
  onChange,
  allowNone,
}: {
  value: string | null | undefined;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
}) {
  const t = useT();
  const own = !!value && !PALETTE.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowNone && <Pill on={!value} onClick={() => onChange(null)} label={t.posters.none} />}
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full ring-1 ring-black/10 active:scale-90 ${value === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''}`}
          style={{ background: c }}
        />
      ))}
      <label
        className={`relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ${own ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''}`}
        style={{
          background: own
            ? value!
            : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
        }}
      >
        <input
          type="color"
          value={value ?? '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v)}%`;

/** Where it sits, how big, how turned; how see-through; how it blends with what is below. */
function PlaceAndLook({
  layer,
  onChange,
}: {
  layer: PosterLayer;
  onChange: (p: Partial<PosterLayer>) => void;
}) {
  const t = useT();
  // A photo filling the poster: x/y pick the part in view, size zooms in.
  const cover = layer.type === 'image' && layer.fit === 'cover';
  return (
    <>
      {layer.type === 'fill' && (
        <Group title={t.posters.position}>
          <div className="flex flex-col gap-3">
            <Knob
              label={t.posters.x}
              value={layer.x}
              min={-20}
              max={120}
              step={1}
              show={pct}
              onChange={(x) => onChange({ x })}
            />
            <Knob
              label={t.posters.y}
              value={layer.y}
              min={-20}
              max={120}
              step={1}
              show={pct}
              onChange={(y) => onChange({ y })}
            />
            <Knob
              label={t.posters.width}
              value={layer.w}
              min={4}
              max={200}
              step={1}
              show={pct}
              onChange={(w) => onChange({ w })}
            />
            <Knob
              label={t.posters.height}
              value={layer.h}
              min={4}
              max={200}
              step={1}
              show={pct}
              onChange={(h) => onChange({ h })}
            />
            <Knob
              label={t.posters.rotate}
              value={layer.rotate}
              min={-180}
              max={180}
              step={1}
              show={(v) => `${v}°`}
              onChange={(rotate) => onChange({ rotate })}
            />
          </div>
        </Group>
      )}
      {layer.type === 'effect' && (
        <Group title={t.posters.position}>
          <div className="flex flex-col gap-3">
            {(
              [
                ['x', t.posters.x, 50, -20, 120],
                ['y', t.posters.y, 50, -20, 120],
                ['w', t.posters.width, 100, 5, 200],
                ['h', t.posters.height, 100, 5, 200],
              ] as const
            ).map(([k, label, base, min, max]) => (
              <Knob
                key={k}
                label={label}
                value={layer[k] ?? base}
                min={min}
                max={max}
                step={1}
                show={pct}
                onChange={(v) => onChange({ [k]: v })}
              />
            ))}
            <button
              type="button"
              onClick={() => onChange({ x: null, y: null, w: null, h: null })}
              className="self-start text-[13px] font-semibold text-link"
            >
              ↺ {t.posters.wholePoster}
            </button>
          </div>
        </Group>
      )}
      {layer.type !== 'effect' && layer.type !== 'fill' && (
        <Group title={t.posters.position}>
          <div className="flex flex-col gap-3">
            <Knob
              label={t.posters.x}
              value={layer.x}
              min={cover ? 0 : -20}
              max={cover ? 100 : 120}
              step={1}
              show={pct}
              onChange={(x) => onChange({ x })}
            />
            <Knob
              label={t.posters.y}
              value={layer.y}
              min={cover ? 0 : -20}
              max={cover ? 100 : 120}
              step={1}
              show={pct}
              onChange={(y) => onChange({ y })}
            />
            <Knob
              label={cover ? t.posters.zoom : t.posters.size}
              value={layer.size}
              min={cover ? 100 : 4}
              max={cover ? 300 : 200}
              step={1}
              show={pct}
              onChange={(size) => onChange({ size })}
            />
            <Knob
              label={t.posters.rotate}
              value={layer.rotate}
              min={-180}
              max={180}
              step={1}
              show={(v) => `${v}°`}
              onChange={(rotate) => onChange({ rotate })}
            />
          </div>
        </Group>
      )}
      <Knob
        label={t.posters.opacity}
        value={layer.opacity ?? 1}
        min={0.05}
        max={1}
        step={0.05}
        show={(v) => pct(v * 100)}
        onChange={(opacity) => onChange({ opacity })}
      />
      <Group title={t.posters.blend}>
        <div className="flex flex-wrap gap-1.5">
          {BLEND_MODES.map((b) => (
            <Pill
              key={b}
              on={(layer.blend ?? 'normal') === b}
              onClick={() => onChange({ blend: b as BlendMode })}
              label={t.posters.blends[b]}
            />
          ))}
        </div>
      </Group>
    </>
  );
}

/** Layer styles: drop shadow, outer glow, stroke, bevel. */
function StyleControls({
  value,
  onChange,
}: {
  value: LayerStyle | null | undefined;
  onChange: (s: LayerStyle) => void;
}) {
  const t = useT();
  const s = value ?? {};
  const set = (p: Partial<LayerStyle>) => onChange({ ...s, ...p });
  return (
    <Group title={t.posters.styles}>
      <div className="flex flex-col gap-3">
        <Knob
          label={t.posters.shadow}
          value={s.shadow ?? 0}
          min={0}
          max={1}
          step={0.05}
          show={(v) => pct(v * 100)}
          onChange={(shadow) => set({ shadow: shadow || null })}
        />
        <div>
          <div className="mb-1.5 text-[14px]">{t.posters.glow}</div>
          <ColorDots value={s.glow} onChange={(glow) => set({ glow })} allowNone />
        </div>
        <div>
          <div className="mb-1.5 text-[14px]">{t.posters.stroke}</div>
          <ColorDots
            value={s.stroke}
            onChange={(stroke) =>
              set({ stroke, strokeWidth: stroke ? (s.strokeWidth ?? 4) : null })
            }
            allowNone
          />
        </div>
        {s.stroke && (
          <Knob
            label={t.posters.strokeWidth}
            value={s.strokeWidth ?? 4}
            min={1}
            max={12}
            step={1}
            show={(v) => `${v}`}
            onChange={(strokeWidth) => set({ strokeWidth })}
          />
        )}
        <Toggle label={t.posters.bevel} checked={!!s.bevel} onChange={(bevel) => set({ bevel })} />
      </div>
    </Group>
  );
}

/** Pictures saved before their shape was known get it now (their effects line up then). */
function useKnownRatio(
  layer: Extract<PosterLayer, { type: 'image' }>,
  onChange: (p: Partial<PosterLayer>) => void,
) {
  const url = layer.url;
  const known = layer.ratio != null;
  useEffect(() => {
    if (known || !url) return;
    const img = new Image();
    img.onload = () =>
      img.naturalHeight && onChange({ ratio: img.naturalWidth / img.naturalHeight });
    img.src = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, url]);
}

/**
 * Effects of one layer only (a picture, a text, a colour layer): several at once, tap
 * again to remove, saved sets to apply with one tap.
 */
function LayerEffects({
  title,
  hint,
  list,
  onChange,
  children,
}: {
  title: string;
  hint: string;
  list: MotionLayer[];
  onChange: (effects: MotionLayer[]) => void;
  children?: ReactNode;
}) {
  const kinds = list.map((e) => e.kind);
  return (
    <Group title={title}>
      <p className="mb-2 px-1 text-[12px] text-hint">{hint}</p>
      {children}
      <div className="mb-3">
        <EffectSets current={list} onApply={onChange} />
      </div>
      <MotionPicker
        value={null}
        onChange={() => undefined}
        many={{
          values: kinds,
          toggle: (m) =>
            onChange(
              m === 'off'
                ? []
                : kinds.includes(m)
                  ? list.filter((e) => e.kind !== m)
                  : [...list, { kind: m }].slice(-MAX_EFFECTS),
            ),
        }}
        tuneOf={(m) => list.find((e) => e.kind === m)?.tune ?? null}
        onTune={(m, tune) => onChange(list.map((e) => (e.kind === m ? { ...e, tune } : e)))}
      />
    </Group>
  );
}

/** A layer's outline (rectangle, rounded, circle, oval) and how soft its edges are. */
function EdgeControls({
  layer,
  onChange,
}: {
  layer: Extract<PosterLayer, { type: 'image' | 'fill' }>;
  onChange: (p: Partial<PosterLayer>) => void;
}) {
  const t = useT();
  return (
    <Group title={t.posters.edges}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {LAYER_SHAPES.map((sh) => (
            <Pill
              key={sh}
              on={(layer.shape ?? 'rect') === sh}
              onClick={() => onChange({ shape: sh === 'rect' ? null : sh })}
              label={t.posters.shapes[sh]}
            />
          ))}
        </div>
        <Knob
          label={t.posters.soft}
          value={layer.soft ?? 0}
          min={0}
          max={1}
          step={0.05}
          show={(v) => pct(v * 100)}
          onChange={(soft) => onChange({ soft: soft || null })}
        />
      </div>
    </Group>
  );
}

/** A colour layer: one colour or a gradient (up to four colours) that can move. */
function FillSettings({
  layer,
  onChange,
}: {
  layer: Extract<PosterLayer, { type: 'fill' }>;
  onChange: (p: Partial<PosterLayer>) => void;
}) {
  const t = useT();
  const one = layer.paint === 'color';
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {(['color', 'linear', 'radial'] as const).map((p) => (
          <Pill
            key={p}
            on={layer.paint === p}
            onClick={() =>
              onChange({
                paint: p,
                colors:
                  p !== 'color' && layer.colors.length < 2
                    ? [layer.colors[0] ?? '#7c3aed', '#ec4899']
                    : layer.colors,
              })
            }
            label={t.posters.paints[p]}
          />
        ))}
      </div>
      {(one ? [0] : [0, 1, 2, 3]).map((i) =>
        // A further colour slot appears once the one before it is set.
        i > layer.colors.length ? null : (
          <div key={i}>
            <div className="mb-1.5 text-[14px]">{t.posters.colorN(i + 1)}</div>
            <ColorDots
              value={layer.colors[i] ?? null}
              allowNone={i >= 2}
              onChange={(c) => {
                const colors = [...layer.colors];
                if (c) colors[i] = c;
                else colors.splice(i, 1);
                onChange({ colors: colors.filter(Boolean).slice(0, 4) });
              }}
            />
          </div>
        ),
      )}
      {layer.paint === 'linear' && (
        <Knob
          label={t.posters.angle}
          value={layer.angle}
          min={0}
          max={360}
          step={5}
          show={(v) => `${v}°`}
          onChange={(angle) => onChange({ angle })}
        />
      )}
      {!one && (
        <Group title={t.posters.moveTitle}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {FILL_MOVES.map((m) => (
                <Pill
                  key={m}
                  on={(layer.move ?? 'none') === m}
                  onClick={() => onChange({ move: m === 'none' ? null : m })}
                  label={t.posters.moves[m]}
                />
              ))}
            </div>
            {layer.move && layer.move !== 'none' && (
              <Knob
                label={t.posters.speed}
                value={layer.speed ?? 1}
                min={0.25}
                max={3}
                step={0.05}
                show={(v) => `×${v.toFixed(2)}`}
                onChange={(speed) => onChange({ speed })}
              />
            )}
          </div>
        </Group>
      )}
    </>
  );
}

/** The frame round the poster: on/off, colour, thickness, distance, corners, glow. */
function FrameSettings({
  value,
  onChange,
}: {
  value: PosterFrame | null;
  onChange: (f: PosterFrame | null) => void;
}) {
  const t = useT();
  const f = value;
  const set = (p: Partial<PosterFrame>) => f && onChange({ ...f, ...p });
  return (
    <>
      <Toggle
        label={t.posters.frameOn}
        checked={!!f}
        onChange={(on) =>
          onChange(on ? { width: 1.2, color: '#ffffff', inset: 3, radius: 3, glow: null } : null)
        }
      />
      {f && (
        <>
          <div>
            <div className="mb-1.5 text-[14px]">{t.posters.color}</div>
            <ColorDots value={f.color} onChange={(color) => set({ color: color ?? '#ffffff' })} />
          </div>
          <Knob
            label={t.posters.frameWidth}
            value={f.width}
            min={0.2}
            max={8}
            step={0.1}
            show={(v) => v.toFixed(1)}
            onChange={(width) => set({ width })}
          />
          <Knob
            label={t.posters.frameInset}
            value={f.inset}
            min={0}
            max={12}
            step={0.5}
            show={(v) => v.toFixed(1)}
            onChange={(inset) => set({ inset })}
          />
          <Knob
            label={t.posters.frameRadius}
            value={f.radius}
            min={0}
            max={30}
            step={0.5}
            show={(v) => v.toFixed(1)}
            onChange={(radius) => set({ radius })}
          />
          <div>
            <div className="mb-1.5 text-[14px]">{t.posters.frameGlow}</div>
            <ColorDots value={f.glow} onChange={(glow) => set({ glow })} allowNone />
          </div>
          <Toggle
            label={t.posters.frameDouble}
            checked={!!f.double}
            onChange={(double) => set({ double })}
          />
        </>
      )}
    </>
  );
}

function LayerSettings({
  layer,
  onChange,
  onPicture,
  onCut,
  onErase,
  cutting,
}: {
  layer: PosterLayer;
  onChange: (p: Partial<PosterLayer>) => void;
  onPicture: () => void;
  /** Cut the people out onto a new layer above (pictures). */
  onCut?: () => void;
  /** Open the eraser (pictures). */
  onErase?: () => void;
  cutting: 'loading' | 'working' | null;
}) {
  const t = useT();
  if (layer.type === 'effect')
    return (
      <>
        <MotionPicker
          value={layer.kind}
          // Tapping the chosen effect again takes it off (the layer stays, empty).
          onChange={(m) => onChange({ kind: m ?? 'off', tune: null })}
          tuneOf={(m) => (m === layer.kind ? (layer.tune ?? null) : null)}
          onTune={(m, tune) => m === layer.kind && onChange({ tune: tune ?? {} })}
        />
        <div>
          <Knob
            label={t.posters.fade}
            value={layer.fade ?? 0}
            min={0}
            max={1}
            step={0.05}
            show={(v) => pct(v * 100)}
            onChange={(fade) => onChange({ fade: fade || null })}
          />
          <p className="mt-1 px-1 text-[12px] text-hint">{t.posters.fadeHint}</p>
        </div>
        <PlaceAndLook layer={layer} onChange={onChange} />
      </>
    );
  if (layer.type === 'fill')
    return (
      <>
        <FillSettings layer={layer} onChange={onChange} />
        <PlaceAndLook layer={layer} onChange={onChange} />
        <EdgeControls layer={layer} onChange={onChange} />
        <LayerEffects
          title={t.posters.layerEffects}
          hint={t.posters.layerEffectsHint}
          list={layer.effects ?? []}
          onChange={(effects) => onChange({ effects })}
        />
      </>
    );
  if (layer.type === 'image')
    return (
      <ImageSettings
        layer={layer}
        onChange={onChange}
        onPicture={onPicture}
        onCut={onCut}
        onErase={onErase}
        cutting={cutting}
      />
    );
  return <TextSettings layer={layer} onChange={onChange} />;
}

function ImageSettings({
  layer,
  onChange,
  onPicture,
  onCut,
  onErase,
  cutting,
}: {
  layer: Extract<PosterLayer, { type: 'image' }>;
  onChange: (p: Partial<PosterLayer>) => void;
  onPicture: () => void;
  onCut?: () => void;
  onErase?: () => void;
  cutting: 'loading' | 'working' | null;
}) {
  const t = useT();
  useKnownRatio(layer, onChange);
  return (
    <>
      <Button variant="secondary" onClick={onPicture}>
        🖼 {t.posters.replacePicture}
      </Button>
      <div>
        <Button variant="secondary" disabled={!onCut} onClick={onCut}>
          ✂️{' '}
          {cutting
            ? cutting === 'loading'
              ? t.posters.cutLoading
              : t.posters.cutWorking
            : t.posters.cutPeople}
        </Button>
        <p className="mt-1 px-1 text-[12px] text-hint">{t.posters.cutHint}</p>
      </div>
      <div>
        <Button variant="secondary" disabled={!onErase} onClick={onErase}>
          🧽 {t.posters.eraser.open}
        </Button>
        <p className="mt-1 px-1 text-[12px] text-hint">{t.posters.eraser.openHint}</p>
      </div>
      <div>
        <Toggle
          label={t.posters.fill}
          checked={layer.fit === 'cover'}
          onChange={(on) =>
            onChange(
              on
                ? { fit: 'cover', x: 50, y: 50, size: 100, rotate: 0 }
                : { fit: 'free', x: 50, y: 50, size: 70 },
            )
          }
        />
        <p className="mt-1 px-1 text-[12px] text-hint">{t.posters.fillHint}</p>
      </div>
      <PlaceAndLook layer={layer} onChange={onChange} />
      <EdgeControls layer={layer} onChange={onChange} />
      <LayerEffects
        title={t.posters.pictureEffects}
        hint={t.posters.pictureEffectsHint}
        list={layer.effects ?? []}
        onChange={(effects) => onChange({ effects })}
      />
      <StyleControls value={layer.style} onChange={(style) => onChange({ style })} />
    </>
  );
}

function TextSettings({
  layer,
  onChange,
}: {
  layer: Extract<PosterLayer, { type: 'text' }>;
  onChange: (p: Partial<PosterLayer>) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {TEXT_SOURCES.map((src) => (
          <Pill
            key={src}
            on={layer.source === src}
            onClick={() => onChange({ source: src })}
            label={t.posters.sources[src]}
          />
        ))}
      </div>
      {layer.source === 'custom' && (
        <textarea
          value={layer.text ?? ''}
          onChange={(e) => onChange({ text: e.target.value.slice(0, 160) })}
          rows={2}
          className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none"
        />
      )}
      <FontPicker
        label={t.posters.font}
        value={(layer.font as FontKey | null | undefined) ?? null}
        onChange={(font) => onChange({ font })}
      />
      <div>
        <div className="mb-1.5 text-[14px]">{t.posters.color}</div>
        <ColorDots
          value={layer.color ?? '#ffffff'}
          onChange={(color) => onChange({ color: color ?? '#ffffff' })}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {([400, 700, 900] as const).map((w) => (
          <Pill
            key={w}
            on={(layer.weight ?? 900) === w}
            onClick={() => onChange({ weight: w })}
            label={t.posters.weights[w]}
          />
        ))}
        {(['left', 'center', 'right'] as const).map((a) => (
          <Pill
            key={a}
            on={(layer.align ?? 'center') === a}
            onClick={() => onChange({ align: a })}
            label={t.posters.aligns[a]}
          />
        ))}
      </div>
      <Toggle
        label={t.posters.upper}
        checked={!!layer.upper}
        onChange={(upper) => onChange({ upper })}
      />
      <PlaceAndLook layer={layer} onChange={onChange} />
      <StyleControls value={layer.style} onChange={(style) => onChange({ style })} />
      <LayerEffects
        title={t.posters.textEffects}
        hint={t.posters.textEffectsHint}
        list={layer.effects ?? []}
        onChange={(effects) => onChange({ effects })}
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['letters', 'around'] as const).map((m) => (
            <Pill
              key={m}
              on={(layer.fxIn ?? 'letters') === m}
              onClick={() => onChange({ fxIn: m === 'letters' ? null : m })}
              label={t.posters.fxIn[m]}
            />
          ))}
        </div>
      </LayerEffects>
    </>
  );
}

function BackgroundSettings({
  value,
  onChange,
  onPhoto,
}: {
  value: PosterBackground;
  onChange: (b: PosterBackground) => void;
  onPhoto: () => void;
}) {
  const t = useT();
  const set = (p: Partial<PosterBackground>) => onChange({ ...value, ...p });
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {(['color', 'gradient', 'photo', 'cover'] as const).map((k) => (
          <Pill
            key={k}
            on={value.type === k}
            onClick={() => (k === 'photo' && !value.mediaId ? onPhoto() : set({ type: k }))}
            label={t.posters.bgTypes[k]}
          />
        ))}
      </div>
      {value.type === 'cover' && <p className="text-[12px] text-hint">{t.posters.coverHint}</p>}
      {(value.type === 'color' || value.type === 'gradient') && (
        <>
          {(value.type === 'color' ? [0] : [0, 1, 2]).map((i) => (
            <div key={i}>
              <div className="mb-1.5 text-[14px]">{t.posters.colorN(i + 1)}</div>
              <ColorDots
                value={value.colors[i] ?? null}
                allowNone={i === 2}
                onChange={(c) => {
                  const colors = [...value.colors];
                  if (c) colors[i] = c;
                  else colors.splice(i, 1);
                  set({ colors: colors.filter(Boolean).slice(0, 3) });
                }}
              />
            </div>
          ))}
          {value.type === 'gradient' && (
            <Knob
              label={t.posters.angle}
              value={value.angle}
              min={0}
              max={360}
              step={5}
              show={(v) => `${v}°`}
              onChange={(angle) => set({ angle })}
            />
          )}
        </>
      )}
      {value.type === 'photo' && (
        <Button variant="secondary" onClick={onPhoto}>
          📷 {t.posters.replacePicture}
        </Button>
      )}
      {(value.type === 'photo' || value.type === 'cover') && (
        <Knob
          label={t.posters.dim}
          value={value.dim ?? 0}
          min={0}
          max={0.8}
          step={0.05}
          show={(v) => pct(v * 100)}
          onChange={(dim) => set({ dim })}
        />
      )}
    </>
  );
}

/**
 * Picking a poster template for an event or meeting: "No poster" and every template as a
 * small live preview with the event's own words.
 */
export function PosterPicker({
  value,
  onChange,
  texts,
  coverUrl,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  texts?: PosterTexts;
  coverUrl?: string | null;
}) {
  const t = useT();
  const list = usePosterTemplates();
  const { texts: sample } = useSample();
  if (!list.data?.length) return <p className="text-[13px] text-hint">{t.posters.noneYet}</p>;
  return (
    <div className="motion-still grid grid-cols-4 gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`flex aspect-[4/5] items-center justify-center rounded-xl bg-hairline p-1 text-center text-[11px] font-semibold text-hint ${value === null ? 'ring-2 ring-[var(--brand)]' : ''}`}
      >
        {t.posters.pickNone}
      </button>
      {list.data.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => {
            haptic.tap();
            onChange(value === tpl.id ? null : tpl.id);
          }}
          className={`rounded-xl ${value === tpl.id ? 'ring-2 ring-[var(--brand)] ring-offset-2' : ''}`}
        >
          <LayeredPoster
            tpl={tpl}
            texts={texts ?? sample}
            coverUrl={coverUrl}
            className="aspect-[4/5] w-full rounded-xl"
          />
        </button>
      ))}
    </div>
  );
}
