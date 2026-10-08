import { useEffect, useState } from 'react';
import type { GroupSummary, PosterTexts } from '@church/shared';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { usePosterTemplates } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { CoverEffects, effectLayers, initEffects, type EffectsState } from './CoverEffects';
import { LayeredPoster } from './LayeredPoster';
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
  const [source, setSource] = useState<'photo' | 'template' | 'colours'>('colours');
  const [photo, setPhoto] = useState<string | null>(null);
  const [tplId, setTplId] = useState<number | null>(null);
  const [shape, setShape] = useState<Shape>('4:5');
  const [effects, setEffects] = useState<EffectsState>(() =>
    initEffects({ motion: 'aurora', motionTune: null, motionLayers: [] }),
  );
  const [fxOpen, setFxOpen] = useState(false);
  const tpl = templates.data?.find((x) => x.id === tplId) ?? templates.data?.[0] ?? null;

  // The chosen photo stays on the phone (made smaller first); let go when replaced.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const blob = await preparePhoto(f, 1600).catch(() => f);
    setPhoto(URL.createObjectURL(blob));
    setSource('photo');
  };

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

  const render = (words: PosterTextValue) => (
    <div className={`relative w-full ${SHAPES[shape]}`}>
      {source === 'photo' && photo ? (
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
      {/* A template writes the words in its own places. */}
      {source !== 'template' && <PosterTextLayer value={words} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
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
        </div>
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
      <CoverEffects state={effects} onChange={setEffects} open={fxOpen} onOpen={setFxOpen} />
      <MotionExport
        name={tf.fileName}
        preview={{ preset: g.name, render, modes: ['custom', 'none'] }}
      />
    </div>
  );
}
