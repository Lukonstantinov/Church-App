import { useLabels, useSetMemberLabels } from '../lib/queries';
import { useNav } from '../lib/nav';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { useToast } from './Toast';
import type { LabelLook, LabelRef } from '@church/shared';
import { LabelChip, lookColors } from './LabelLook';

export { LabelChip };

/** Everything that tags a person here: leader, position, and their custom labels. */
export function PersonTags({
  role,
  positionName,
  defaultPosition,
  leaderText,
  labels,
  inline,
  positionLook,
}: {
  /** The position drawn like a label (null = the plain chip). */
  positionLook?: LabelLook | null;
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
  // The generic "Leader" tag only when no position of their own says it already
  // (a "Youth leader" with leader rights shows just that).
  const showLeader = role === 'leader' && !showPosition && positionName !== leaderText;
  if (!showPosition && !showLeader && labels.length === 0) return null;
  return (
    <span className={`${inline ? '' : 'mt-1 '}flex flex-wrap items-center gap-1`}>
      {showLeader && (
        <span className="brand-gradient inline-flex rounded-full px-1.5 py-px text-[11px] font-semibold text-white">
          {leaderText}
        </span>
      )}
      {showPosition &&
        (positionLook ? (
          <LabelChip label={{ ...positionLook, name: positionName }} small />
        ) : (
          <span className="inline-flex rounded-full bg-brand/15 px-1.5 py-px text-[11px] font-semibold text-accent">
            {positionName}
          </span>
        ))}
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
                    style={{
                      background:
                        lookColors(l).length > 1
                          ? `linear-gradient(90deg, ${lookColors(l).join(', ')})`
                          : l.color,
                    }}
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
