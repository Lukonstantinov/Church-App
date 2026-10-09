import { useState } from 'react';
import type { GroupSummary, PosterLayer, PosterTexts } from '@church/shared';
import { readDraft, useDraft, writeDraft } from '../lib/drafts';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { usePosterTemplates } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { CoverEffects, effectLayers, initEffects, type EffectsState } from './CoverEffects';
import { LayeredPoster } from './LayeredPoster';
import { PosterGestures } from './PosterGestures';
import { PosterLayersEditor, starterDoc, usePosterDraft } from './PosterStudio';
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
} as const;
type Shape = keyof typeof SHAPES;
type Source = 'photo' | 'template' | 'colours' | 'layers';

/** What the maker keeps on the phone between visits (the photo separately: it is big). */
interface Kept {
  source: Source;
  tplId: number | null;
  shape: Shape;
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
  const t = useT();
  const tf = t.freePoster;
  const templates = usePosterTemplates();
  // Everything chosen here is kept as a draft: leaving or closing the app loses nothing.
  const [kept] = useState(() => readDraft<Kept>('free')?.data);
  const [source, setSource] = useState<Source>(kept?.source ?? 'colours');
  const [photo, setPhoto] = useState<string | null>(
    () => readDraft<string>('free.photo')?.data ?? null,
  );
  const [tplId, setTplId] = useState<number | null>(kept?.tplId ?? null);
  const [shape, setShape] = useState<Shape>(kept?.shape ?? '4:5');
  const [effects, setEffects] = useState<EffectsState>(
    () => kept?.effects ?? initEffects({ motion: 'aurora', motionTune: null, motionLayers: [] }),
  );
  useDraft('free', { source, tplId, shape, effects } satisfies Kept);
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
    writeDraft('free.photo', url);
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
      <div className={`relative w-full ${SHAPES[shape]}`}>
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
    />
  );
}
