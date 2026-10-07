import type { CSSProperties } from 'react';
import { displayName, type MeetingRow, type PeopleLook, type PeopleStyle } from '@church/shared';

/** Tints for "different tints": each person gets the next one. */
export const MIXED_TINTS = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#a855f7',
];

/** The chosen style of the people cards and chips (older saves: a colour means "one colour"). */
export const peopleStyleOf = (look: PeopleLook | null | undefined): PeopleStyle =>
  look?.style ?? (look?.color ? 'color' : 'dark');

/** The tint of the n-th person, for the "one colour" and "different tints" styles. */
export const tintOf = (look: PeopleLook | null | undefined, index: number): string | undefined => {
  const style = peopleStyleOf(look);
  if (style === 'mixed') return MIXED_TINTS[index % MIXED_TINTS.length];
  if (style === 'color') return look?.color ?? undefined;
  return undefined;
};

export const leaderIconOf = (look: PeopleLook | null | undefined) => look?.leaderIcon ?? '🎙';
export const snackIconOf = (look: PeopleLook | null | undefined) => look?.snackIcon ?? '🍕';

type TeamData = Partial<Pick<MeetingRow, 'leader' | 'snackPerson' | 'helpers' | 'peopleLook'>>;

/** Everyone with a job, in the meeting's order: leader, speakers, snacks, other services. */
export function teamOf(m: TeamData) {
  const helpers = m.helpers ?? [];
  const out: { key: string; icon: string | null; name: string; role: string }[] = [];
  if (m.leader)
    out.push({
      key: 'l',
      icon: leaderIconOf(m.peopleLook),
      name: displayName(m.leader),
      role: 'leader',
    });
  for (const h of helpers.filter((x) => x.speaker))
    out.push({ key: `h${h.id}`, icon: h.icon, name: displayName(h.person), role: h.role });
  if (m.snackPerson)
    out.push({
      key: 's',
      icon: snackIconOf(m.peopleLook),
      name: displayName(m.snackPerson),
      role: 'snack',
    });
  for (const h of helpers.filter((x) => !x.speaker))
    out.push({ key: `h${h.id}`, icon: h.icon, name: displayName(h.person), role: h.role });
  return out;
}

/**
 * The people of a meeting as small chips (icon + name) on a coloured card, in the same
 * style as the meeting's people cards: dark metal, see-through, one colour or
 * different tints. Without a chosen style the leader is a white chip, others soft glass.
 */
export function TeamChips({
  m,
  className = '',
  compact,
}: {
  m: TeamData;
  className?: string;
  /** Small tiles: the first person's first name, then "+N". */
  compact?: boolean;
}) {
  const all = teamOf(m);
  // A small tile has room for the first person only, then how many more.
  const team = compact ? all.slice(0, 1) : all;
  if (team.length === 0) return null;
  const look = m.peopleLook;
  const style = look ? peopleStyleOf(look) : null;
  return (
    <div
      className={`flex items-center ${compact ? 'flex-nowrap gap-1 overflow-hidden' : 'flex-wrap gap-1.5'} ${className}`}
    >
      {team.map((p, i) => {
        const tint = tintOf(look, i);
        const cls =
          style === null
            ? i === 0
              ? 'bg-white text-[var(--brand)] font-bold'
              : 'bg-white/20 font-semibold'
            : style === 'dark'
              ? 'team-chip-dark font-semibold text-white'
              : style === 'glass'
                ? 'bg-white/18 font-semibold text-white ring-1 ring-white/45 backdrop-blur'
                : 'font-semibold text-white ring-1 ring-white/30';
        return (
          <span
            key={p.key}
            title={p.role}
            className={`inline-flex max-w-full items-center gap-1 truncate rounded-full ${
              compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[13px]'
            } ${cls}`}
            style={
              tint
                ? ({
                    background: `linear-gradient(135deg, ${tint}, color-mix(in srgb, ${tint} 60%, #000))`,
                  } as CSSProperties)
                : undefined
            }
          >
            {p.icon && <span className="leading-none">{p.icon}</span>}
            <span className="truncate">{compact ? p.name.split(' ')[0] : p.name}</span>
          </span>
        );
      })}
      {compact && all.length > team.length && (
        <span className="shrink-0 rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold">
          +{all.length - team.length}
        </span>
      )}
    </div>
  );
}
