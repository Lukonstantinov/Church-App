import {
  MAX_EFFECTS,
  type EventSummary,
  type MeetingMotion,
  type MotionLayer,
  type MotionTune,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { EffectSets } from './EffectSets';
import { IconChevronDown } from './icons';
import { MotionPicker } from './MotionPicker';
import { MotionTuneControls, TunePanel } from './MotionTune';
import { Button, LivingLayers, Section } from './ui';

/** How many effects one cover can wear at once (shared/motions.ts). */
export { MAX_EFFECTS };

/**
 * A cover's effects while being edited: in the order picked, each with its own settings,
 * plus copies of picked ones with settings of their own (two smokes from different sides).
 */
export interface EffectsState {
  effects: MeetingMotion[];
  tunes: Partial<Record<MeetingMotion, MotionTune>>;
  copies: MotionLayer[];
}

type Saved = Partial<Pick<EventSummary, 'motion' | 'motionTune' | 'motionLayers'>>;

export function initEffects(e?: Saved | null): EffectsState {
  const effects: MeetingMotion[] = [];
  const tunes: EffectsState['tunes'] = {};
  if (e?.motion && e.motion !== 'off') {
    effects.push(e.motion);
    if (e.motionTune) tunes[e.motion] = e.motionTune;
  }
  const copies: MotionLayer[] = [];
  for (const l of e?.motionLayers ?? []) {
    // The same effect again is a copy with its own settings.
    if (effects.includes(l.kind)) {
      copies.push({ kind: l.kind, tune: l.tune ?? null });
      continue;
    }
    effects.push(l.kind);
    if (l.tune) tunes[l.kind] = l.tune;
  }
  return { effects, tunes, copies };
}

/** Every layer the cover draws: the picked effects, then the copies. */
export const effectLayers = (s: EffectsState): MotionLayer[] => [
  ...s.effects.map((kind) => ({ kind, tune: s.tunes[kind] ?? null })),
  ...s.copies,
];

/** What the API stores: the first effect, its settings, and the rest as layers. */
export function effectsPayload(s: EffectsState): Required<Saved> {
  const [first, ...rest] = effectLayers(s).slice(0, MAX_EFFECTS);
  return {
    motion: first?.kind ?? null,
    motionTune: first?.tune ?? null,
    motionLayers: rest,
  };
}

/** All of a cover's effects, drawn over each other (the glitch tears `image`). */
export function CoverEffectLayers({ e, image }: { e: Saved; image?: string | null }) {
  return <LivingLayers layers={effectLayers(initEffects(e))} image={image} />;
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
  const names = effectLayers(state)
    .map((l) => t.meetings.motions[l.kind])
    .join(' + ');
  const total = state.effects.length + state.copies.length;
  const toggle = (m: MeetingMotion) => {
    if (m === 'off') return onChange({ ...state, effects: [], copies: [] });
    const on = state.effects.includes(m);
    onChange({
      ...state,
      // Adding one past the limit drops the oldest; switching one off drops its copies too.
      effects: on
        ? state.effects.filter((x) => x !== m)
        : [...state.effects, m].slice(-(MAX_EFFECTS - state.copies.length)),
      copies: on ? state.copies.filter((c) => c.kind !== m) : state.copies,
    });
  };
  // A copy starts turned round (from the other side), with the original's other settings.
  const addCopy = (m: MeetingMotion) => {
    const base = state.tunes[m] ?? {};
    haptic.tap();
    onChange({
      ...state,
      copies: [
        ...state.copies,
        { kind: m, tune: { ...base, angle: ((base.angle ?? 0) + 180) % 360 } },
      ],
    });
  };
  const setCopy = (i: number, tune: MotionTune | null) =>
    onChange({ ...state, copies: state.copies.map((c, k) => (k === i ? { ...c, tune } : c)) });
  const dropCopy = (i: number) =>
    onChange({ ...state, copies: state.copies.filter((_, k) => k !== i) });
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
            {t.events.effectsCount(total, MAX_EFFECTS)}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[14px] font-semibold text-accent">
          {open ? t.events.hideEffects : t.events.changeEffects}
          <IconChevronDown size={18} className={`transition ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-hairline p-3">
          <EffectSets
            current={effectLayers(state)}
            onApply={(layers) => {
              const [first, ...rest] = layers;
              onChange(
                initEffects({
                  motion: first?.kind ?? null,
                  motionTune: first?.tune ?? null,
                  motionLayers: rest,
                }),
              );
            }}
          />
          <MotionPicker
            value={null}
            onChange={() => undefined}
            many={{ values: state.effects, toggle }}
            tuneOf={(m) => state.tunes[m] ?? null}
            onTune={(m, tune) => onChange({ ...state, tunes: { ...state.tunes, [m]: tune ?? {} } })}
          />
          {/* The same effect again with its own settings, e.g. smoke from both sides. */}
          {state.effects.length > 0 && total < MAX_EFFECTS && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] text-hint">{t.events.effectCopyHint}</div>
              <div className="flex flex-wrap gap-2">
                {state.effects.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => addCopy(m)}
                    className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold active:scale-95"
                  >
                    ＋ {t.meetings.motions[m]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.copies.map((c, i) => (
            <TunePanel
              key={`${c.kind}${i}`}
              title={`${t.meetings.motions[c.kind]} · ${t.events.effectCopy}`}
            >
              <MotionTuneControls
                kind={c.kind}
                tune={c.tune ?? {}}
                onChange={(tune) => setCopy(i, tune)}
              />
              <button
                type="button"
                onClick={() => dropCopy(i)}
                className="mt-3 text-[13px] font-semibold text-destructive"
              >
                {t.events.effectCopyRemove}
              </button>
            </TunePanel>
          ))}
          <Button variant="secondary" onClick={() => onOpen(false)}>
            {t.events.effectsDone}
          </Button>
        </div>
      )}
    </Section>
  );
}
