import {
  MOTION_GROUPS,
  type MeetingMotion,
  type MotionIcon,
  type MotionTune,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Group } from './LookControls';
import { MotionTuneControls, TunePanel } from './MotionTune';
import { useRef } from 'react';
import { useNearScreen } from '../lib/perf';
import { LivingLayer } from './ui';

/** A preview's animation, drawn only while its tile is on or near the screen. */
function LivePreview(props: {
  kind: MeetingMotion;
  icon?: MotionIcon | null;
  tune?: MotionTune | null;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref);
  return (
    <span ref={ref} className="absolute inset-0">
      {near && <LivingLayer kind={props.kind} icon={props.icon} tune={props.tune} preview />}
    </span>
  );
}

/**
 * Every animation as a small live preview to pick from, sorted by type (light and colour,
 * particles, liquid, textures, icons) in groups that fold away. "Off" comes first; with
 * `allowInherit` also "like the ministry" (value null). With `tuneOf`/`onTune`, the picked
 * animation's own settings open right under its group, and the previews show them.
 */
export function MotionPicker({
  value,
  onChange,
  allowInherit,
  inheritLabel,
  icon,
  tuneOf,
  onTune,
  many,
}: {
  value: MeetingMotion | null;
  onChange: (v: MeetingMotion | null) => void;
  allowInherit?: boolean;
  /** The name of the "inherit" choice (default: like the ministry). */
  inheritLabel?: string;
  /** What the icon animations show in their previews. */
  icon?: MotionIcon | null;
  /** The settings each animation has here (null = as designed). */
  tuneOf?: (m: MeetingMotion) => MotionTune | null;
  onTune?: (m: MeetingMotion, tune: MotionTune | null) => void;
  /**
   * Several at once, drawn over each other: tapping one adds or removes it ("off" clears
   * all), and every picked one opens its settings under its group.
   */
  many?: { values: MeetingMotion[]; toggle: (m: MeetingMotion) => void };
}) {
  const t = useT();
  const first: (MeetingMotion | null)[] = [...(allowInherit ? [null] : []), 'off'];
  const tile = (m: MeetingMotion | null) => {
    const on = many
      ? m === 'off'
        ? many.values.length === 0
        : !!m && many.values.includes(m)
      : value === m;
    return (
      <button
        key={m ?? 'inherit'}
        type="button"
        onClick={() => {
          haptic.tap();
          if (many) {
            if (m) many.toggle(m);
            return;
          }
          // Tapping the chosen one again takes it off.
          onChange(on && m && m !== 'off' ? (allowInherit ? null : 'off') : m);
        }}
        className={`flex flex-col items-center gap-1 rounded-2xl p-1 transition active:scale-95 ${
          on ? 'ring-2 ring-[var(--brand)]' : ''
        }`}
      >
        <span className="brand-gradient relative block aspect-[4/3] w-full overflow-hidden rounded-xl">
          {m && <LivePreview kind={m} icon={icon} tune={tuneOf?.(m)} />}
          {!m && (
            <span className="absolute inset-0 flex items-center justify-center text-[20px] text-white">
              ⛪
            </span>
          )}
        </span>
        <span
          className={`text-center text-[12px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
        >
          {m ? t.meetings.motions[m] : (inheritLabel ?? t.meetings.motionMinistry)}
        </span>
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">{first.map(tile)}</div>
      {MOTION_GROUPS.map((g) => (
        <Group key={g.key} title={t.meetings.motionGroups[g.key]}>
          <div className="grid grid-cols-3 gap-2">{g.items.map(tile)}</div>
          {/* The picked ones' settings, opened right under their group. */}
          {onTune &&
            (many ? many.values : value ? [value] : [])
              .filter((m) => g.items.includes(m))
              .map((m) => (
                <div key={m} className="mt-3">
                  <TunePanel title={`${t.studio.knob.settings}: ${t.meetings.motions[m]}`}>
                    <MotionTuneControls
                      kind={m}
                      tune={tuneOf?.(m) ?? {}}
                      onChange={(tune) => onTune(m, tune)}
                    />
                  </TunePanel>
                </div>
              ))}
        </Group>
      ))}
    </div>
  );
}
