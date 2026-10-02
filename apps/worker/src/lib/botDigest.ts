import { and, asc, eq, gte, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { INTL_LOCALE, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import {
  eventRoleAssignees,
  eventRoles,
  events,
  groups,
  meetings,
  memberships,
  positions,
  type User,
} from '../db/schema';
import { getChurch } from './church';
import { escapeHtml } from './html';
import { audienceOf, meetingIsFor } from './meetings';

/** The longest list sent in one message (Telegram allows 4096 characters). */
const MAX_LINES = 30;

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

/** The nearest events of the person's ministries, with their own duty at each. */
export async function nearestEventsText(db: Db, user: User, locale: Locale): Promise<string> {
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
        .limit(8)
    : [];
  if (rows.length === 0) return `${t.eventsTitle}\n\n${t.eventsEmpty}`;
  const duties = await db
    .select({ eventId: eventRoles.eventId, role: eventRoles.name })
    .from(eventRoleAssignees)
    .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
    .where(
      and(
        eq(eventRoleAssignees.userId, user.id),
        inArray(
          eventRoles.eventId,
          rows.map((r) => r.e.id),
        ),
      ),
    );
  const out = [t.eventsTitle, ''];
  for (const { e, group } of rows) {
    const mineHere = duties.filter((d) => d.eventId === e.id).map((d) => d.role);
    out.push(
      `<b>${escapeHtml(e.title)}</b>\n${f.day(e.startsAt)}, ${f.time(e.startsAt)}${e.location ? ` · 📍 ${escapeHtml(e.location)}` : ''}\n<i>${escapeHtml(group)}</i>${mineHere.length ? `\n🛠 <b>${escapeHtml(mineHere.join(', '))}</b>` : ''}\n`,
    );
  }
  return out.join('\n').trim();
}

/** All meetings (and events) of the person's ministries for a week, a month or three months. */
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
  type Row = { at: string; text: string };
  const rows: Row[] = [
    ...ms
      .filter((m) => meetingIsFor(audience, m.id, user.id))
      .map((m) => ({
        at: m.startsAt,
        text: `${f.time(m.startsAt)} — ${escapeHtml(m.title)}${m.topic ? ` «${escapeHtml(m.topic)}»` : ''}${ids.length > 1 ? ` · <i>${escapeHtml(names.get(m.groupId) ?? '')}</i>` : ''}${
          m.leaderUserId === user.id || m.snackUserId === user.id ? ' 🛠' : ''
        }`,
      })),
    ...es.map((e) => ({
      at: e.startsAt,
      text: `${f.time(e.startsAt)} — 📅 <b>${escapeHtml(e.title)}</b>${e.location ? ` · ${escapeHtml(e.location)}` : ''}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (rows.length === 0) return `${head}\n\n${t.scheduleEmpty}`;
  const out = [head];
  let lastDay = '';
  let shown = 0;
  for (const r of rows) {
    if (shown >= MAX_LINES) break;
    const k = f.key(r.at);
    if (k !== lastDay) {
      out.push('', `<b>${f.day(r.at)}</b>`);
      lastDay = k;
    }
    out.push(r.text);
    shown++;
  }
  if (rows.length > shown) out.push('', t.moreItems(rows.length - shown));
  return out.join('\n');
}

export type SchedulePeriod = Period;
