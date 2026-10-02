import type { CSSProperties } from 'react';
import type { LabelAnimation, LabelRef } from '@church/shared';

const isLight = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 170;
};

/** One custom label: its colour and its own animation. */
export function LabelChip({
  label,
  small,
}: {
  label: Pick<LabelRef, 'name' | 'color'> & { animation: LabelAnimation };
  small?: boolean;
}) {
  const anim = label.animation === 'none' ? '' : `label-${label.animation}`;
  return (
    <span
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full font-semibold ${
        small ? 'px-1.5 py-px text-[11px]' : 'px-2.5 py-0.5 text-[12px]'
      } ${anim}`}
      style={
        {
          '--label-color': label.color,
          background: label.color,
          color: isLight(label.color) ? '#111827' : '#ffffff',
        } as CSSProperties
      }
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** Everything that tags a person here: leader, position, and their custom labels. */
export function PersonTags({
  role,
  positionName,
  defaultPosition,
  leaderText,
  labels,
}: {
  role: 'leader' | 'member';
  positionName: string | null;
  /** The position everyone starts with (not worth a tag). */
  defaultPosition?: boolean;
  leaderText: string;
  labels: LabelRef[];
}) {
  const showPosition = positionName && !defaultPosition;
  const showLeader = role === 'leader' && positionName !== leaderText;
  if (!showPosition && !showLeader && labels.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {showLeader && (
        <span className="brand-gradient inline-flex rounded-full px-1.5 py-px text-[11px] font-semibold text-white">
          {leaderText}
        </span>
      )}
      {showPosition && (
        <span className="inline-flex rounded-full bg-brand/15 px-1.5 py-px text-[11px] font-semibold text-accent">
          {positionName}
        </span>
      )}
      {labels.map((l) => (
        <LabelChip key={l.id} label={l} small />
      ))}
    </span>
  );
}
