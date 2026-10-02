import { and, asc, eq, gte, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { INTL_LOCALE, displayName, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import {
  eventRoleAssignees,
  eventRoles,
  events,
  groups,
  meetings,
  memberships,
  positions,
  users,
  type User,
} from '../db/schema';
import { getChurch } from './church';
import { escapeHtml } from './html';
import { audienceOf, meetingIsFor } from './meetings';

type Period = 'w' | 'm' | 'q';
const DAYS: Record<Period, number> = { w: 7, m: 31, q: 92 };

async function formatter(db: Db, locale: Locale) {
  const { timezone } = await getChurch(db);
  const intl = INTL_LOCALE[locale];
  const day = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  const time = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  return {
    day: (iso: string) => day.format(new Date(iso)),
    time: (iso: string) => time.format(new Date(iso)),
    key: (iso: string) => dayKey.format(new Date(iso)),
  };
}

/** Ministries the person is in. */
async function myGroups(db: Db, userId: number) {
  return db
    .select({
      groupId: groups.id,
      name: groups.name,
      role: memberships.role,
      position: positions.name,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
}

/** "Your services": ministries with position, duties at coming events, jobs at coming meetings. */
export async function myServicesText(db: Db, user: User, locale: Locale): Promise<string> {
  const t = messages(locale).bot;
  const f = await formatter(db, locale);
  const now = new Date().toISOString();
  const mine = await myGroups(db, user.id);
  if (mine.length === 0) return `${t.servicesTitle}\n\n${t.servicesEmpty}`;
  const out: string[] = [t.servicesTitle, '', t.servicesMinistries];
  for (const g of mine) {
    const tag = [g.role === 'leader' ? messages(locale).roles.leader : null, g.position]
      .filter((x, i, a) => x && a.indexOf(x) === i)
      .join(' · ');
    out.push(`• ${escapeHtml(g.name)}${tag ? ` — <i>${escapeHtml(tag)}</i>` : ''}`);
  }

  const duties = await db
    .select({
      eventId: events.id,
      title: events.title,
      startsAt: events.startsAt,
      role: eventRoles.name,
      leader: eventRoles.leaderUserId,
    })
    .from(eventRoleAssignees)
    .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
    .innerJoin(events, eq(events.id, eventRoles.eventId))
    .where(
      and(
        eq(eventRoleAssignees.userId, user.id),
        gte(events.startsAt, now),
        ne(events.status, 'cancelled'),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(20);
  if (duties.length) {
    out.push('', t.servicesDuties);
    for (const d of duties)
      out.push(
        `• ${escapeHtml(d.title)} — ${f.day(d.startsAt)}, ${f.time(d.startsAt)}\n   🛠 <b>${escapeHtml(d.role)}</b>${d.leader === user.id ? ` ★ ${t.leadsRole}` : ''}`,
      );
  }

  const jobs = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        gte(meetings.startsAt, now),
        or(eq(meetings.leaderUserId, user.id), eq(meetings.snackUserId, user.id)),
      ),
    )
    .orderBy(asc(meetings.startsAt))
    .limit(20);
  if (jobs.length) {
    out.push('', t.servicesJobs);
    for (const m of jobs) {
      const roles = [
        m.leaderUserId === user.id ? t.jobLead : null,
        m.snackUserId === user.id ? t.jobSnack : null,
      ]
        .filter(Boolean)
        .join(', ');
      out.push(
        `• ${escapeHtml(m.title)} — ${f.day(m.startsAt)}, ${f.time(m.startsAt)}\n   🎤 <b>${roles}</b>`,
      );
    }
  }
  return out.join('\n');
}

/** Short, one-line piece of a longer text. */
const short = (text: string | null, max: number) => {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** Names of people by id. */
async function namesOf(db: Db, ids: (number | null)[]) {
  const unique = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unique.length === 0) return new Map<number, string>();
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, displayName(r)]));
}

/** Each event's duties: name, its leader and the people on it ("Техника — ★Anna, Mark"). */
async function dutiesOf(db: Db, eventIds: number[]) {
  const roles = eventIds.length
    ? await db
        .select()
        .from(eventRoles)
        .where(inArray(eventRoles.eventId, eventIds))
        .orderBy(asc(eventRoles.sort), asc(eventRoles.id))
    : [];
  const assignees = roles.length
    ? await db
        .select()
        .from(eventRoleAssignees)
        .where(
          inArray(
            eventRoleAssignees.roleId,
            roles.map((r) => r.id),
          ),
        )
    : [];
  const names = await namesOf(db, [
    ...roles.map((r) => r.leaderUserId),
    ...assignees.map((a) => a.userId),
  ]);
  return { roles, assignees, names };
}

type Duties = Awaited<ReturnType<typeof dutiesOf>>;

function dutyLines(d: Duties, eventId: number, userId: number) {
  const lines: string[] = [];
  const mine: string[] = [];
  for (const r of d.roles.filter((x) => x.eventId === eventId)) {
    const people = d.assignees.filter((a) => a.roleId === r.id).map((a) => a.userId);
    if (people.includes(userId) || r.leaderUserId === userId) mine.push(r.name);
    const names = [
      ...(r.leaderUserId ? [`★ ${d.names.get(r.leaderUserId) ?? '?'}`] : []),
      ...people.filter((id) => id !== r.leaderUserId).map((id) => d.names.get(id) ?? '?'),
    ];
    lines.push(
      `• <b>${escapeHtml(r.name)}</b> — ${names.length ? escapeHtml(names.join(', ')) : '…'}`,
    );
  }
  return { lines, mine };
}

export type EventCard = { eventId: number; text: string; pictureId: number | null };

/**
 * The nearest events of the person's ministries (and pinned ones), one card each: when,
 * where, a bit of the description, who is responsible for what (★ = the duty's leader),
 * and the person's own duty. `pictureId` is the cover photo or the designed poster.
 */
export async function nearestEvents(
  db: Db,
  user: User,
  locale: Locale,
  limit = 5,
): Promise<{ empty: string | null; cards: EventCard[] }> {
  const t = messages(locale).bot;
  const f = await formatter(db, locale);
  const mine = await myGroups(db, user.id);
  const ids = mine.map((g) => g.groupId);
  const rows = ids.length
    ? await db
        .select({ e: events, group: groups.name })
        .from(events)
        .innerJoin(groups, eq(groups.id, events.groupId))
        .where(
          and(
            or(inArray(events.groupId, ids), isNotNull(events.pinnedAt)),
            gte(events.startsAt, new Date().toISOString()),
            ne(events.status, 'cancelled'),
          ),
        )
        .orderBy(asc(events.startsAt))
        .limit(limit)
    : [];
  if (rows.length === 0) return { empty: `${t.eventsTitle}\n\n${t.eventsEmpty}`, cards: [] };
  const duties = await dutiesOf(
    db,
    rows.map((r) => r.e.id),
  );
  const cards = rows.map(({ e, group }) => {
    const { lines, mine: myDuties } = dutyLines(duties, e.id, user.id);
    const parts = [
      `<b>${escapeHtml(e.title)}</b>`,
      `🗓 ${f.day(e.startsAt)}, ${f.time(e.startsAt)}${e.location ? `\n📍 ${escapeHtml(e.location)}` : ''}`,
      `<i>${escapeHtml(group)}</i>`,
    ];
    if (e.description) parts.push(escapeHtml(short(e.description, 220)));
    if (lines.length) parts.push(`👥 <b>${t.responsible}</b>\n${lines.slice(0, 8).join('\n')}`);
    if (myDuties.length) parts.push(`🛠 <b>${escapeHtml(t.eventYourDuty(myDuties.join(', ')))}</b>`);
    return {
      eventId: e.id,
      text: parts.join('\n\n'),
      pictureId: e.coverMediaId ?? e.posterMediaId ?? null,
    };
  });
  return { empty: null, cards };
}

/** Telegram allows 4096 characters; the list stops a bit before that. */
const MAX_CHARS = 3700;

/**
 * All meetings (and events) of the person's ministries for a week, a month or three
 * months, with who leads, who brings the snacks, where, and a short note.
 */
export async function scheduleText(
  db: Db,
  user: User,
  locale: Locale,
  period: Period,
): Promise<string> {
  const msg = messages(locale);
  const t = msg.bot;
  const f = await formatter(db, locale);
  const label = period === 'w' ? t.periodWeek : period === 'm' ? t.periodMonth : t.periodQuarter;
  const head = t.scheduleTitle(label);
  const mine = await myGroups(db, user.id);
  const ids = mine.map((g) => g.groupId);
  if (ids.length === 0) return `${head}\n\n${t.scheduleEmpty}`;
  const names = new Map(mine.map((g) => [g.groupId, g.name]));
  const from = new Date();
  const to = new Date(from.getTime() + DAYS[period] * 864e5).toISOString();
  const [ms, es] = await Promise.all([
    db
      .select()
      .from(meetings)
      .where(
        and(
          inArray(meetings.groupId, ids),
          eq(meetings.status, 'scheduled'),
          gte(meetings.startsAt, from.toISOString()),
          lt(meetings.startsAt, to),
        ),
      )
      .orderBy(asc(meetings.startsAt))
      .limit(200),
    db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.groupId, ids),
          ne(events.status, 'cancelled'),
          gte(events.startsAt, from.toISOString()),
          lt(events.startsAt, to),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(100),
  ]);
  const audience = await audienceOf(
    db,
    ms.map((m) => m.id),
  );
  const visible = ms.filter((m) => meetingIsFor(audience, m.id, user.id));
  const people = await namesOf(db, [
    ...visible.map((m) => m.leaderUserId),
    ...visible.map((m) => m.snackUserId),
  ]);
  const duties = await dutiesOf(
    db,
    es.map((e) => e.id),
  );
  const ministry = (groupId: number) =>
    ids.length > 1 ? ` · <i>${escapeHtml(names.get(groupId) ?? '')}</i>` : '';
  const person = (id: number | null) =>
    id ? escapeHtml(people.get(id) ?? '?') : `<i>${t.notAssigned}</i>`;
  type Row = { at: string; text: string };
  const rows: Row[] = [
    ...visible.map((m) => {
      const lines = [
        `${f.time(m.startsAt)} — <b>${escapeHtml(m.title)}</b>${m.topic ? ` «${escapeHtml(m.topic)}»` : ''}${ministry(m.groupId)}${
          m.leaderUserId === user.id || m.snackUserId === user.id ? ' 🛠' : ''
        }`,
        `   🎤 ${t.whoLeads}: ${person(m.leaderUserId)} · 🍪 ${t.whoSnacks}: ${person(m.snackUserId)}`,
      ];
      if (m.location) lines.push(`   📍 ${escapeHtml(m.location)}`);
      if (m.notes) lines.push(`   <i>${escapeHtml(short(m.notes, 90))}</i>`);
      return { at: m.startsAt, text: lines.join('\n') };
    }),
    ...es.map((e) => {
      const lines = [
        `${f.time(e.startsAt)} — 📅 <b>${escapeHtml(e.title)}</b>${ministry(e.groupId)}`,
      ];
      if (e.location) lines.push(`   📍 ${escapeHtml(e.location)}`);
      if (e.description) lines.push(`   <i>${escapeHtml(short(e.description, 90))}</i>`);
      const { lines: d } = dutyLines(duties, e.id, user.id);
      lines.push(...d.slice(0, 5).map((x) => `   ${x}`));
      return { at: e.startsAt, text: lines.join('\n') };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (rows.length === 0) return `${head}\n\n${t.scheduleEmpty}`;
  const out = [head];
  let size = head.length;
  let lastDay = '';
  let shown = 0;
  for (const r of rows) {
    const k = f.key(r.at);
    const block = k !== lastDay ? `\n\n<b>${f.day(r.at)}</b>\n${r.text}` : `\n\n${r.text}`;
    if (size + block.length > MAX_CHARS) break;
    out.push(block);
    size += block.length;
    lastDay = k;
    shown++;
  }
  if (rows.length > shown) out.push(`\n\n${t.moreItems(rows.length - shown)}`);
  return out.join('');
}

export type SchedulePeriod = Period;
