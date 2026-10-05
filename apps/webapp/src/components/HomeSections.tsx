import { useState, type ReactNode } from 'react';
import {
  fontFamily,
  type MeetingRow,
  type AnnouncementRow,
  type EventSummary,
  type GroupSummary,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useEvents, useFeed } from '../lib/queries';
import { storage } from '../lib/storage';
import { haptic } from '../lib/telegram';
import { useTileDrag } from '../lib/useTileDrag';
import { CountdownBadge, CountdownOnCover, hasCountdown } from './Countdown';
import { EventCard, EventCover } from './EventCard';
import { CalendarTile, GroupCalendar, calendarOnHome, setCalendarOnHome } from './GroupCalendar';
import { UnreadBadges } from './FeedEntry';
import {
  IconCalendar,
  IconChart,
  IconClock,
  IconEdit,
  IconMegaphone,
  IconPlus,
  IconUserPlus,
  IconUsers,
} from './icons';
import { MeetingHeroLines } from '../screens/MeetingScreen';
import { canRollNow } from '../screens/Overview';
import { Button, DateBadge, HeroCard } from './ui';
import { BurnFrame } from './Burn';
import { LiveNow } from './Live';
import { LookTop } from './LookTop';
import { PosterCard, PosterMedia, hasCover } from './Poster';

export interface HomeAction {
  key: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  badge?: ReactNode;
}

/** The ministry's shortcuts in one compact row at the top of its home. */
export function HomeActionRow({ actions }: { actions: HomeAction[] }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none]">
      {actions.map((a, i) => (
        <button
          key={a.key}
          style={{ '--i': i } as React.CSSProperties}
          type="button"
          onClick={() => {
            haptic.tap();
            a.onClick();
          }}
          className="reveal spring glass relative flex min-w-[62px] flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-2 shadow-card"
        >
          <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
            {a.icon}
          </span>
          <span className="w-full truncate text-center text-[10px] font-semibold tracking-tight">
            {a.label}
          </span>
          {a.badge && <span className="absolute -right-1 -top-1.5">{a.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Standard shortcuts: feed (with its counters), post, meeting, invite, members — by rights. */
export function useHomeActions(
  g: GroupSummary,
  fallbackTheme: string,
  can: (p: 'announce' | 'meetings.manage' | 'people.manage' | 'people.view') => boolean,
): HomeAction[] {
  const t = useT();
  const { push } = useNav();
  const actions: HomeAction[] = [
    {
      key: 'feed',
      icon: <IconMegaphone size={18} />,
      label: t.overview.quickFeed,
      onClick: () => push({ name: 'announcements', groupId: g.id }),
      badge:
        g.unreadPosts || g.unreadComments ? (
          <UnreadBadges g={g} fallbackTheme={fallbackTheme} />
        ) : undefined,
    },
  ];
  if (can('announce'))
    actions.push({
      key: 'post',
      icon: <IconEdit size={18} />,
      label: t.overview.quickPost,
      onClick: () => push({ name: 'newPost', groupId: g.id }),
    });
  if (can('meetings.manage'))
    actions.push({
      key: 'meeting',
      icon: <IconPlus size={18} />,
      label: t.overview.quickMeeting,
      onClick: () => push({ name: 'newMeeting', groupId: g.id }),
    });
  if (can('people.manage'))
    actions.push({
      key: 'invite',
      icon: <IconUserPlus size={18} />,
      label: t.overview.quickInvite,
      onClick: () => push({ name: 'addPerson', groupId: g.id }),
    });
  actions.push({
    key: 'members',
    icon: <IconUsers size={18} />,
    label: t.overview.quickMembers,
    onClick: () => push({ name: 'contacts', groupId: g.id }),
  });
  if (can('people.view'))
    actions.push({
      key: 'stats',
      icon: <IconChart size={18} />,
      label: t.stats.title,
      onClick: () => push({ name: 'stats', groupId: g.id }),
    });
  return actions;
}

/** What a meeting tile needs (manager rows and a member's next meeting both fit). */
export type MeetingTileData = Pick<
  MeetingRow,
  'id' | 'title' | 'startsAt' | 'endsAt' | 'location' | 'topic' | 'kind' | 'leader'
> &
  Partial<Pick<MeetingRow, 'status'>>;

type Item =
  | { kind: 'calendar' }
  | { kind: 'meeting'; meeting: MeetingTileData }
  | { kind: 'post'; post: AnnouncementRow }
  | { kind: 'event'; event: EventSummary };

/** The automatic post written when an event was created repeats the event tile. */
const echoesEvent = (p: AnnouncementRow, events: EventSummary[]) =>
  p.eventId
    ? events.some((e) => e.id === p.eventId)
    : events.some((e) => (p.text.split('\n')[0] ?? '').includes(e.title));

const foldKey = (id: number) => `church.eventsFolded.${id}`;
const orderKey = (id: number) => `church.homeOrder.${id}`;

/** Puts items in the person's saved order; new ones keep their place next to their neighbour. */
function applyOrder<T>(items: T[], keyOf: (i: T) => string, saved: string[]): T[] {
  if (saved.length === 0) return items;
  const rank = new Map(saved.map((k, i) => [k, i]));
  const known = items
    .filter((i) => rank.has(keyOf(i)))
    .sort((x, y) => rank.get(keyOf(x))! - rank.get(keyOf(y))!);
  const out = [...known];
  items.forEach((item, idx) => {
    if (rank.has(keyOf(item))) return;
    const before = items[idx - 1];
    const at = before ? out.findIndex((o) => keyOf(o) === keyOf(before)) : -1;
    out.splice(at + 1, 0, item);
  });
  return out;
}

/**
 * What opens a ministry, as small tiles two per row: the calendar, then what is coming
 * next (meetings and events by date), then pinned posts. Tiles can be dragged to other
 * places (hold, then drag); events can be folded into single rows. A tile expands in
 * steps: row, square, full card, the page itself.
 */
export function HomeHighlights({
  g,
  meetings = [],
  onRoll,
}: {
  g: GroupSummary;
  /** Coming regular meetings (the person's next one, or the next few for leaders). */
  meetings?: MeetingTileData[];
  /** Leaders: open the roll call of a meeting. */
  onRoll?: (meetingId: number) => void;
}) {
  const t = useT();
  const { push } = useNav();
  const feed = useFeed(g.id);
  const events = useEvents(g.id, 'upcoming');
  const [open, setOpen] = useState<string | null>(null);
  // Folded events show as one row until tapped (then a square, then the full card).
  const [folded, setFolded] = useState(() => storage.get(foldKey(g.id)) === '1');
  const [peek, setPeek] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(storage.get(orderKey(g.id)) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const [withCalendar, setWithCalendar] = useState(() => calendarOnHome(g.id));
  const first = feed.data?.pages[0] ?? [];
  const shownEvents = (events.data ?? []).filter((e) => e.status !== 'cancelled').slice(0, 6);
  const timeline: Item[] = [
    ...meetings
      .filter((m) => m.status !== 'cancelled')
      .map((meeting) => ({ kind: 'meeting' as const, meeting })),
    ...shownEvents.map((event) => ({ kind: 'event' as const, event })),
  ].sort((a, b) =>
    (a.kind === 'meeting'
      ? a.meeting.startsAt
      : a.kind === 'event'
        ? a.event.startsAt
        : ''
    ).localeCompare(
      b.kind === 'meeting' ? b.meeting.startsAt : b.kind === 'event' ? b.event.startsAt : '',
    ),
  );
  const keyOf = (i: Item) =>
    i.kind === 'calendar'
      ? 'cal'
      : i.kind === 'post'
        ? `p${i.post.id}`
        : i.kind === 'event'
          ? `e${i.event.id}`
          : `m${i.meeting.id}`;
  const base: Item[] = [
    ...(withCalendar ? [{ kind: 'calendar' as const }] : []),
    ...timeline,
    ...first
      .filter((p) => p.pinned && !echoesEvent(p, shownEvents))
      .map((post) => ({ kind: 'post' as const, post })),
  ];
  const items = applyOrder(base, keyOf, saved);
  const latest = first.find((p) => !p.pinned && !echoesEvent(p, shownEvents));
  const openPost = (id: number) => push({ name: 'post', groupId: g.id, postId: id });
  const openEvent = (id: number) => push({ name: 'event', eventId: id });

  const drag = useTileDrag((from, to) => {
    const keys = items.map(keyOf);
    const i = keys.indexOf(from);
    const j = keys.indexOf(to);
    if (i < 0 || j < 0) return;
    keys.splice(j, 0, keys.splice(i, 1)[0]!);
    setSaved(keys);
    storage.set(orderKey(g.id), JSON.stringify(keys));
  });
  const hasEvents = items.some((i) => i.kind === 'event');

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {t.overview.important}
            </h2>
            {hasEvents && (
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  setFolded(!folded);
                  storage.set(foldKey(g.id), folded ? '0' : '1');
                  setPeek(new Set());
                }}
                className="spring rounded-full bg-hairline px-2.5 py-1 text-[12px] font-semibold text-hint"
              >
                {folded ? t.overview.unfoldEvents : t.overview.foldEvents}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((item, idx) => {
              const k = keyOf(item);
              const expanded = open === k;
              const asRow = item.kind === 'event' && folded && !peek.has(k) && !expanded;
              const toggle = () => {
                haptic.tap();
                setOpen(expanded ? null : k);
              };
              const reveal = { '--i': idx } as React.CSSProperties;
              if (expanded)
                return (
                  <div key={k} className="reveal col-span-2 flex flex-col gap-1.5" style={reveal}>
                    {item.kind === 'calendar' ? (
                      <>
                        <GroupCalendar g={g} />
                        <button
                          type="button"
                          onClick={() => {
                            setCalendarOnHome(g.id, false);
                            setWithCalendar(false);
                            setOpen(null);
                          }}
                          className="self-center text-[13px] font-semibold text-hint"
                        >
                          {t.meetings.hideCalendar}
                        </button>
                      </>
                    ) : item.kind === 'meeting' ? (
                      <MeetingExpanded meeting={item.meeting} onRoll={onRoll} />
                    ) : item.kind === 'post' ? (
                      <PosterCard post={item.post} onOpen={() => openPost(item.post.id)} />
                    ) : (
                      <EventCard e={item.event} onClick={() => openEvent(item.event.id)} />
                    )}
                    <button
                      type="button"
                      onClick={toggle}
                      className="self-center rounded-full bg-hairline px-3 py-1 text-[13px] font-semibold"
                    >
                      {t.overview.collapse}
                    </button>
                  </div>
                );
              const st = drag.state(k);
              return (
                <div
                  key={k}
                  {...drag.bind(k)}
                  style={{ ...reveal, ...st.style }}
                  className={`reveal no-select spring min-w-0 ${asRow ? 'col-span-2' : ''} ${
                    st.dragging ? 'dragging' : ''
                  } ${st.over ? 'drop-target' : ''}`}
                >
                  {item.kind === 'calendar' ? (
                    <CalendarTile g={g} onToggle={toggle} />
                  ) : item.kind === 'meeting' ? (
                    <MeetingTile m={item.meeting} g={g} onToggle={toggle} />
                  ) : item.kind === 'post' ? (
                    <PostTile post={item.post} onToggle={toggle} />
                  ) : asRow ? (
                    <EventRow
                      e={item.event}
                      onToggle={() => {
                        haptic.tap();
                        setPeek(new Set(peek).add(k));
                      }}
                    />
                  ) : (
                    <EventTile e={item.event} g={g} onToggle={toggle} />
                  )}
                </div>
              );
            })}
          </div>
          {items.length > 1 && (
            <p className="mt-1.5 px-3 text-center text-[11px] text-hint/80">
              {t.overview.dragHint}
            </p>
          )}
        </section>
      )}
      {latest && (
        <>
          {items.length > 0 && (
            <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {t.feed.latest}
            </h2>
          )}
          <PosterCard post={latest} onOpen={() => openPost(latest.id)} />
        </>
      )}
    </div>
  );
}

/** An event folded into one row: date, name and a live timer. */
function EventRow({ e, onToggle }: { e: EventSummary; onToggle: () => void }) {
  const f = useFmt();
  const t = useT();
  const d = f.dateBadge(e.startsAt);
  return (
    <BurnFrame e={e} radius={16}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={t.overview.expand}
        className="glass flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left shadow-card active:scale-[0.99]"
      >
        <span className="brand-gradient flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-white">
          <span className="text-[17px] font-bold leading-none tabular-nums">{d.day}</span>
          <span className="text-[9px] font-semibold uppercase leading-tight opacity-90">
            {d.month}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">{e.title}</span>
          <span className="block truncate text-[12px] text-hint">
            {d.weekday} · {f.time(e.startsAt)}
          </span>
        </span>
        <CountdownBadge startsAt={e.startsAt} design={e.design} compact muted={!hasCountdown(e)} />
        <LiveNow startsAt={e.startsAt} endsAt={e.endsAt} cancelled={e.status === 'cancelled'} compact />
      </button>
    </BurnFrame>
  );
}

function Tile({ onToggle, children }: { onToggle: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.overview.expand}
      className="glass flex h-full w-full flex-col overflow-hidden rounded-2xl text-left shadow-card active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

function PostTile({ post, onToggle }: { post: AnnouncementRow; onToggle: () => void }) {
  return (
    <Tile onToggle={onToggle}>
      {hasCover(post) ? (
        <div className="pointer-events-none">
          <PosterMedia
            title={post.title}
            photos={post.photos.slice(0, 1)}
            tint={post.tint}
            look={post.look}
            design={post.design ? { ...post.design, kind: null } : post.design}
            compact
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5 p-2.5">
        <span className="text-[11px] font-bold text-accent">📌</span>
        <span
          className="line-clamp-2 text-[13px] leading-snug"
          style={{ fontFamily: fontFamily(post.design?.bodyFont) }}
        >
          {post.text || post.title}
        </span>
      </div>
    </Tile>
  );
}

function EventTile({ e, g, onToggle }: { e: EventSummary; g: GroupSummary; onToggle: () => void }) {
  const f = useFmt();
  const cover = e.coverUrl || e.design?.banner;
  return (
    <BurnFrame e={e} radius={16} className="h-full">
      <Tile onToggle={onToggle}>
        {cover ? (
          <div className="pointer-events-none relative">
            <EventCover e={e} className="aspect-[16/10]" compact />
            <CountdownOnCover e={e} compact />
          </div>
        ) : (
          <div className="relative">
            <LookTop
              look={e.look ?? g}
              className="flex aspect-[16/10] items-center justify-center text-[28px]"
            >
              <span className="m-auto">
                <IconCalendar size={30} />
              </span>
            </LookTop>
            <CountdownOnCover e={e} compact />
          </div>
        )}
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[14px] font-semibold">{e.title}</span>
          <span className="truncate text-[12px] text-hint">
            {f.weekdayDayMonth(e.startsAt)} · {f.time(e.startsAt)}
          </span>
        </div>
      </Tile>
    </BurnFrame>
  );
}

function MeetingTile({
  m,
  g,
  onToggle,
}: {
  m: MeetingTileData;
  g: GroupSummary;
  onToggle: () => void;
}) {
  const t = useT();
  const f = useFmt();
  return (
    <Tile onToggle={onToggle}>
      <LookTop look={g} className="flex aspect-[16/10] flex-col p-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          {t.meetings.details}
        </span>
        <div className="flex items-end gap-2">
          <DateBadge {...f.dateBadge(m.startsAt)} onBrand />
          {m.leader && (
            <span className="mb-1 truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--brand)]">
              {m.leader.firstName}
            </span>
          )}
        </div>
      </LookTop>
      <div className="flex flex-col gap-0.5 p-2.5">
        <span className="truncate text-[14px] font-semibold">{m.title}</span>
        <span className="truncate text-[12px] text-hint">
          {f.relativeDay(m.startsAt)} · {f.time(m.startsAt)}
        </span>
      </div>
    </Tile>
  );
}

/** A meeting tile opened: when, topic, place and leader, with the way in (and the roll). */
function MeetingExpanded({
  meeting: m,
  onRoll,
}: {
  meeting: MeetingTileData;
  onRoll?: (id: number) => void;
}) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const rollable = onRoll && canRollNow({ status: m.status ?? 'scheduled', startsAt: m.startsAt });
  return (
    <HeroCard>
      <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-white/80">
        {t.overview.nextMeeting}
      </div>
      <div className="flex items-center gap-3.5">
        <DateBadge {...f.dateBadge(m.startsAt)} onBrand />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[21px] font-bold leading-tight">{m.title}</div>
          <div className="text-[15px] text-white/85">
            {f.relativeDay(m.startsAt)} · {f.timeRange(m.startsAt, m.endsAt)}
          </div>
        </div>
      </div>
      <MeetingHeroLines meeting={m} />
      <div className="mt-4 flex flex-col gap-2">
        {rollable && (
          <Button variant="white" onClick={() => onRoll!(m.id)}>
            {t.overview.startRoll}
          </Button>
        )}
        <button
          type="button"
          onClick={() => push({ name: 'meeting', meetingId: m.id })}
          className="rounded-2xl bg-white/18 px-3 py-2.5 text-[15px] font-semibold active:scale-[0.98]"
        >
          {t.overview.openMeeting}
        </button>
        {onRoll && !rollable && (
          <p className="flex items-center gap-2 text-[13px] text-white/85">
            <IconClock size={15} /> {t.overview.rollOpensSoon}
          </p>
        )}
      </div>
    </HeroCard>
  );
}
