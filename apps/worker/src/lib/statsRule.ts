import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { groups, meetings } from '../db/schema';

/**
 * Which meetings count in attendance statistics. A ministry chooses the kinds that count
 * (`groups.stat_kinds`: MEETING_KINDS plus 'regular' for meetings without a kind; NULL =
 * all), and a single meeting can be switched in or out on its own (`meetings.counts`).
 * Optional meetings are still recorded (roll call, history); they just don't raise or
 * lower anyone's percentage.
 */
export function countedWhere(statKinds: string[] | null | undefined): SQL {
  const rule =
    statKinds == null
      ? sql`1`
      : statKinds.length === 0
        ? sql`0`
        : sql`(coalesce(${meetings.kind}, 'regular') in (${sql.join(
            statKinds.map((k) => sql`${k}`),
            sql`, `,
          )}))`;
  return sql`coalesce(${meetings.counts}, ${rule}) = 1`;
}

/** The same rule for a meeting already loaded. */
export function meetingCounts(
  m: { kind: string | null; counts: boolean | null },
  statKinds: string[] | null | undefined,
): boolean {
  if (m.counts != null) return m.counts;
  return statKinds == null || statKinds.includes(m.kind ?? 'regular');
}

/** The rule of one ministry, as a condition on meetings. */
export async function countedIn(db: Db, groupId: number): Promise<SQL> {
  const g = await db.query.groups.findFirst({
    where: eq(groups.id, groupId),
    columns: { statKinds: true },
  });
  return countedWhere(g?.statKinds ?? null);
}
