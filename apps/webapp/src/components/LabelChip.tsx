import type { CSSProperties } from 'react';
import { useLabels, useSetMemberLabels } from '../lib/queries';
import { useNav } from '../lib/nav';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { useToast } from './Toast';
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
  inline,
}: {
  /** Sits on the name's line (no top gap). */
  inline?: boolean;
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
    <span className={`${inline ? '' : 'mt-1 '}flex flex-wrap items-center gap-1`}>
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
  const toast = useToast();
  const labels = useLabels(groupId);
  const set = useSetMemberLabels(groupId);
  const { push } = useNav();
  const mine = new Set(current.map((l) => l.id));
  const all = labels.data ?? [];
  const toggle = (l: LabelRef) => {
    haptic.tap();
    const next = new Set(mine);
    const giving = !next.has(l.id);
    if (giving) next.add(l.id);
    else next.delete(l.id);
    set.mutate(
      { userId, labelIds: [...next] },
      {
        onSuccess: () => {
          haptic.success();
          toast(giving ? t.labels.givenToast(l.name) : t.labels.takenToast(l.name));
        },
        onError: () => {
          haptic.error();
          toast(t.common.actionFailed, 'error');
        },
      },
    );
  };
  const given = all.filter((l) => mine.has(l.id));
  const free = all.filter((l) => !mine.has(l.id));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
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
      {all.length === 0 ? (
        <span className="text-[13px] text-hint">{t.labels.empty}</span>
      ) : (
        <>
          {/* What the person has: the real chips, tap ✕ to take one away. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {given.length === 0 ? (
              <span className="text-[13px] text-hint">{t.labels.noneYet}</span>
            ) : (
              given.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={set.isPending}
                  onClick={() => toggle(l)}
                  className="inline-flex items-center gap-1 rounded-full active:scale-95"
                >
                  <LabelChip label={l} />
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-hairline text-[12px] text-hint">
                    ✕
                  </span>
                </button>
              ))
            )}
          </div>
          {/* Labels to give: outlined, with a plus. */}
          {free.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {free.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={set.isPending}
                  onClick={() => toggle(l)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-hint/50 px-2.5 py-0.5 text-[12px] font-semibold text-hint active:scale-95"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: labelBackground(l) }}
                  />
                  + {l.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-[12px] leading-snug text-hint">{t.labels.tapToGive}</p>
        </>
      )}
    </div>
  );
}
