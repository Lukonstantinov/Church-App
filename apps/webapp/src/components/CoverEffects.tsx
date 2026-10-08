import type { EventSummary, MeetingMotion, MotionLayer, MotionTune } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { IconChevronDown } from './icons';
import { MotionPicker } from './MotionPicker';
import { Button, LivingLayers, Section } from './ui';

/** How many effects one cover can wear at once (the first plus three layers). */
export const MAX_EFFECTS = 4;

/** A cover's effects while being edited: in the order picked, each with its own settings. */
export interface EffectsState {
  effects: MeetingMotion[];
  tunes: Partial<Record<MeetingMotion, MotionTune>>;
}

type Saved = Partial<Pick<EventSummary, 'motion' | 'motionTune' | 'motionLayers'>>;

export function initEffects(e?: Saved | null): EffectsState {
  const effects: MeetingMotion[] = [];
  const tunes: EffectsState['tunes'] = {};
  if (e?.motion && e.motion !== 'off') {
    effects.push(e.motion);
    if (e.motionTune) tunes[e.motion] = e.motionTune;
  }
  for (const l of e?.motionLayers ?? []) {
    if (effects.includes(l.kind)) continue;
    effects.push(l.kind);
    if (l.tune) tunes[l.kind] = l.tune;
  }
  return { effects, tunes };
}

/** What the API stores: the first effect, its settings, and the rest as layers. */
export function effectsPayload(s: EffectsState): Required<Saved> {
  const [first, ...rest] = s.effects;
  return {
    motion: first ?? null,
    motionTune: first ? (s.tunes[first] ?? null) : null,
    motionLayers: rest.map((kind): MotionLayer => ({ kind, tune: s.tunes[kind] ?? null })),
  };
}

/** All of a cover's effects, drawn over each other (the glitch tears `image`). */
export function CoverEffectLayers({ e, image }: { e: Saved; image?: string | null }) {
  const { effects, tunes } = initEffects(e);
  return (
    <LivingLayers layers={effects.map((kind) => ({ kind, tune: tunes[kind] }))} image={image} />
  );
}

/**
 * Picking a cover's effects: folded to one line (what is on, "Change") so the rest of the
 * event can be filled in; opened, every animation to tap on or off — several combine —
 * with each picked one's settings under it, and "Done" to fold it again.
 */
export function CoverEffects({
  state,
  onChange,
  open,
  onOpen,
}: {
  state: EffectsState;
  onChange: (s: EffectsState) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const t = useT();
  const names = state.effects.map((m) => t.meetings.motions[m]).join(' + ');
  const toggle = (m: MeetingMotion) => {
    if (m === 'off') return onChange({ ...state, effects: [] });
    const on = state.effects.includes(m);
    onChange({
      ...state,
      // Adding a fifth drops the oldest.
      effects: on
        ? state.effects.filter((x) => x !== m)
        : [...state.effects, m].slice(-MAX_EFFECTS),
    });
  };
  return (
    <Section title={t.events.coverMotion} footer={open ? t.events.coverMotionHint : undefined}>
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          onOpen(!open);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-70"
      >
        <span className="text-[20px]">✨</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">
            {names || t.events.noEffects}
          </span>
          <span className="block text-[12px] text-hint">
            {t.events.effectsCount(state.effects.length, MAX_EFFECTS)}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[14px] font-semibold text-accent">
          {open ? t.events.hideEffects : t.events.changeEffects}
          <IconChevronDown size={18} className={`transition ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-hairline p-3">
          <MotionPicker
            value={null}
            onChange={() => undefined}
            many={{ values: state.effects, toggle }}
            tuneOf={(m) => state.tunes[m] ?? null}
            onTune={(m, tune) => onChange({ ...state, tunes: { ...state.tunes, [m]: tune ?? {} } })}
          />
          <Button variant="secondary" onClick={() => onOpen(false)}>
            {t.events.effectsDone}
          </Button>
        </div>
      )}
    </Section>
  );
}
