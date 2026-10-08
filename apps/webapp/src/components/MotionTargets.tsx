import type { MeetingMotion, MotionTune, MotionTunes } from '@church/shared';
import { useT } from '../lib/i18n';
import { Group, Pill } from './LookControls';
import { MotionPicker } from './MotionPicker';

interface Target {
  value: MeetingMotion | null;
  set: (m: MeetingMotion | null) => void;
  /** The name of "as the template / ministry" (none = no such choice). */
  inherit?: string;
}

/**
 * The animations of a meeting (or a template) for each place it shows — its screen, its
 * home tile, its poster — with a switch between them (which also turns the preview, when
 * there is one) and the picked animation's settings under it (speed, size, direction…).
 */
export function MotionTargets({
  slide,
  onSlide,
  screen,
  tile,
  poster,
  tunes,
}: {
  slide: number;
  onSlide: (i: number) => void;
  screen: Target;
  tile: Target;
  poster: Target;
  /** Settings per animation: its own, over what it inherits. */
  tunes?: { value: MotionTunes; inherited?: MotionTunes; set: (v: MotionTunes) => void };
}) {
  const t = useT();
  const parts = [screen, tile, poster];
  const labels = [t.design.previewApp, t.design.previewTile, t.design.previewPoster];
  const part = parts[slide] ?? screen;
  const tuneOf = (m: MeetingMotion): MotionTune | null =>
    tunes ? { ...tunes.inherited?.[m], ...tunes.value[m] } : null;
  // Only the settings that differ from what it follows become its own, so later changes of
  // the template still reach the rest.
  const onTune = (m: MeetingMotion, tune: MotionTune | null) => {
    if (!tunes) return;
    const base = tunes.inherited?.[m] ?? {};
    const diff = Object.fromEntries(
      Object.entries(tune ?? {}).filter(
        ([k, v]) => v != null && v !== (base as Record<string, unknown>)[k],
      ),
    ) as MotionTune;
    const next = { ...tunes.value };
    if (Object.keys(diff).length) next[m] = diff;
    else delete next[m];
    tunes.set(next);
  };
  return (
    <Group title={t.design.motion}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l, i) => (
            <Pill key={l} on={slide === i} onClick={() => onSlide(i)} label={l} />
          ))}
        </div>
        {slide === 2 && <p className="text-[13px] text-hint">{t.design.posterMotionHint}</p>}
        <MotionPicker
          key={slide}
          value={part.value}
          onChange={part.set}
          allowInherit={!!part.inherit}
          inheritLabel={part.inherit}
          tuneOf={tunes ? tuneOf : undefined}
          onTune={tunes ? onTune : undefined}
        />
      </div>
    </Group>
  );
}
