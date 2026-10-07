import { MEETING_MOTIONS, type MeetingMotion } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { LivingLayer } from './ui';

/**
 * Every meeting animation as a small live preview to pick from; with `allowInherit`
 * the first tile is "like the ministry" (value null).
 */
export function MotionPicker({
  value,
  onChange,
  allowInherit,
}: {
  value: MeetingMotion | null;
  onChange: (v: MeetingMotion | null) => void;
  allowInherit?: boolean;
}) {
  const t = useT();
  const tiles: (MeetingMotion | null)[] = [...(allowInherit ? [null] : []), ...MEETING_MOTIONS];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((m) => {
        const on = value === m;
        return (
          <button
            key={m ?? 'inherit'}
            type="button"
            onClick={() => {
              haptic.tap();
              onChange(m);
            }}
            className={`flex flex-col items-center gap-1 rounded-2xl p-1 transition active:scale-95 ${
              on ? 'ring-2 ring-[var(--brand)]' : ''
            }`}
          >
            <span className="brand-gradient relative block aspect-[4/3] w-full overflow-hidden rounded-xl">
              {m && <LivingLayer kind={m} />}
              {!m && (
                <span className="absolute inset-0 flex items-center justify-center text-[20px] text-white">
                  ⛪
                </span>
              )}
            </span>
            <span className={`text-[12px] ${on ? 'font-bold text-accent' : 'text-hint'}`}>
              {m ? t.meetings.motions[m] : t.meetings.motionMinistry}
            </span>
          </button>
        );
      })}
    </div>
  );
}
