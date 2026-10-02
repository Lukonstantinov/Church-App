import type { CSSProperties } from 'react';
import { useLabels, useSetMemberLabels } from '../lib/queries';
import { useNav } from '../lib/nav';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import type { LabelAnimation, LabelRef } from '@church/shared';

const isLight = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 170;
};

/** One custom label: its colour and its own animation. */
const RAINBOW = 'linear-gradient(100deg,#ef4444,#f97316,#eab308,#22c55e,#3b82f6,#a855f7,#ec4899)';

/** The label's fill: one colour, a two-colour gradient, or a rainbow. */
export function labelBackground(l: Pick<LabelRef, 'color' | 'color2' | 'style'>): string {
  if (l.style === 'rainbow') return RAINBOW;
  if (l.style === 'gradient' && l.color2) return `linear-gradient(100deg, ${l.color}, ${l.color2})`;
  return l.color;
}

export function LabelChip({
  label,
  small,
}: {
  label: Pick<LabelRef, 'name' | 'color' | 'color2' | 'style'> & { animation: LabelAnimation };
  small?: boolean;
}) {
  const anim = label.animation === 'none' ? '' : `label-${label.animation}`;
  // Gradients and rainbows slowly drift along their colours.
  const fill =
    label.style === 'rainbow' || (label.style === 'gradient' && label.color2) ? 'label-fill' : '';
  return (
    <span
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full font-semibold ${
        small ? 'px-1.5 py-px text-[11px]' : 'px-2.5 py-0.5 text-[12px]'
      } ${anim} ${fill}`}
      style={
        {
          '--label-color': label.color,
          background: labelBackground(label),
          color:
            label.style === 'rainbow' ? '#ffffff' : isLight(label.color) ? '#111827' : '#ffffff',
          textShadow: label.style === 'rainbow' ? '0 1px 2px rgba(0,0,0,0.45)' : undefined,
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

/** Tap labels to give them to the person (everyone in the ministry sees them) or take them away. */
export function LabelPicker({
  groupId,
  userId,
  current,
}: {
  groupId: number;
  userId: number;
  current: LabelRef[];
}) {
  const t = useT();
  const labels = useLabels(groupId);
  const set = useSetMemberLabels(groupId);
  const { push } = useNav();
  const mine = new Set(current.map((l) => l.id));
  const toggle = (id: number) => {
    haptic.tap();
    const next = new Set(mine);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set.mutate({ userId, labelIds: [...next] });
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-hint">
          {t.labels.assign}
        </span>
        <button
          type="button"
          onClick={() => push({ name: 'labels', groupId })}
          className="text-[13px] font-semibold text-link"
        >
          {t.labels.manage}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(labels.data ?? []).map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => toggle(l.id)}
            className={`rounded-full transition active:scale-95 ${mine.has(l.id) ? 'ring-2 ring-[var(--text)] ring-offset-1' : 'opacity-45'}`}
          >
            <LabelChip label={l} />
          </button>
        ))}
        {(labels.data ?? []).length === 0 && (
          <span className="text-[13px] text-hint">{t.labels.empty}</span>
        )}
      </div>
    </div>
  );
}
