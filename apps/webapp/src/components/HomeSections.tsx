import { SkinLayer, fs, skinClass, skinStyle, useModuleLook } from './ModuleSkin';
import { useState, type ReactNode } from 'react';
import {
  fontFamily,
  type MeetingRow,
  type AnnouncementRow,
  type EventSummary,
  type GroupSummary,
  type MeetingMotion,
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
import { Button, DateBadge, HeroCard, LivingLayer } from './ui';
import { BurnFrame } from './Burn';
import { LiveBadge, LiveNow, SoonPulse, SoonTimer, useIsLive, useStartsSoon } from './Live';
import { isLiveWindow, useNowSecond } from '../lib/live';
import { TeamChips, meetingLook } from './TeamChips';
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
  const look = useModuleLook('actions');
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none]">
      {actions.map((a, i) => (
        <button
          key={a.key}
          style={{ '--i': i, ...skinStyle(look) } as React.CSSProperties}
          type="button"
          onClick={() => {
            haptic.tap();
            a.onClick();
          }}
          className={`reveal spring glass relative flex min-w-[62px] flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-2 shadow-card ${skinClass(look)}`}
        >
          <SkinLayer look={look} />
          <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
            {a.icon}
          </span>
          <span
            className="w-full truncate text-center text-[10px] font-semibold tracking-tight"
            style={fs(10)}
          >
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
  Partial<
    Pick<
      MeetingRow,
      | 'status'
      | 'snackPerson'
      | 'helpers'
      | 'peopleLook'
      | 'design'
      | 'templateId'
      | 'look'
      | 'motion'
    >
  >;

type Item =
  | { kind: 'calendar' }
  | { kind: 'meeting'; meeting: MeetingTileData }
  /** Several meetings on one day share one square (earliest on top). */
  | { kind: 'meetingDay'; day: string; meetings: MeetingTileData[] }
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
  const f = useFmt();
  const coming = meetings
    .filter((m) => m.status !== 'cancelled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = new Map<string, MeetingTileData[]>();
  for (const m of coming) {
    const day = f.dateInput(m.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
  }
  const startOf = (i: Item) =>
    i.kind === 'meeting'
      ? i.meeting.startsAt
      : i.kind === 'meetingDay'
        ? i.meetings[0]!.startsAt
        : i.kind === 'event'
          ? i.event.startsAt
          : '';
  const timeline: Item[] = [
    ...[...byDay.entries()].map(([day, list]): Item =>
      list.length > 1
        ? { kind: 'meetingDay', day, meetings: list }
        : { kind: 'meeting', meeting: list[0]! },
    ),
    ...shownEvents.map((event) => ({ kind: 'event' as const, event })),
  ].sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const keyOf = (i: Item) =>
    i.kind === 'calendar'
      ? 'cal'
      : i.kind === 'post'
        ? `p${i.post.id}`
        : i.kind === 'event'
          ? `e${i.event.id}`
          : i.kind === 'meetingDay'
            ? `d${i.day}`
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
                    ) : item.kind === 'meetingDay' ? (
                      item.meetings.map((m) => (
                        <MeetingExpanded key={m.id} meeting={m} onRoll={onRoll} />
                      ))
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
                  ) : item.kind === 'meetingDay' ? (
                    <MeetingDayTile list={item.meetings} g={g} onToggle={toggle} />
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
        <LiveNow
          startsAt={e.startsAt}
          endsAt={e.endsAt}
          cancelled={e.status === 'cancelled'}
          compact
        />
      </button>
    </BurnFrame>
  );
}

/**
 * A meeting tile's animation: the meeting's own (as on its screen), or the tile's own when
 * the Design studio separates them; tuned there (speed, size, direction, colour, icon).
 */
function TileMotion({ motion, live }: { motion?: MeetingMotion; live?: boolean }) {
  const look = useModuleLook('meetings');
  const kind = look.own ? (look.motion ?? 'off') : (motion ?? 'calm');
  return <LivingLayer kind={kind} live={live} behind tune={look.tune} icon={look.icon} />;
}

function Tile({
  onToggle,
  live,
  module,
  children,
}: {
  onToggle: () => void;
  /** Which page part's Design-studio look it wears. */
  module: 'meetings' | 'posts';
  /** Going on now: a red tint and a pulsing red outline, to spot it at a glance. */
  live?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const own = useModuleLook(module);
  // A meeting tile's main animation sits in its coloured top (TileMotion); layers cover all.
  const look = module === 'meetings' ? { ...own, motion: null } : own;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.overview.expand}
      className={`glass relative flex h-full w-full flex-col overflow-hidden rounded-2xl text-left shadow-card active:scale-[0.98] ${
        live ? 'live-ring' : ''
      } ${skinClass(look)}`}
      style={skinStyle(look)}
    >
      <SkinLayer look={look} />
      {children}
      {live && <span aria-hidden="true" className="live-tint" />}
    </button>
  );
}

function PostTile({ post, onToggle }: { post: AnnouncementRow; onToggle: () => void }) {
  return (
    <Tile onToggle={onToggle} module="posts">
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
  const live = useIsLive(e.startsAt, e.endsAt, e.status === 'cancelled');
  return (
    <BurnFrame e={e} radius={16} className="h-full">
      <Tile onToggle={onToggle} live={live} module="meetings">
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
  const live = useIsLive(m.startsAt, m.endsAt, m.status === 'cancelled');
  return (
    <SoonPulse
      startsAt={m.startsAt}
      cancelled={m.status === 'cancelled'}
      motion={m.motion}
      className="h-full"
    >
      <Tile onToggle={onToggle} live={live} module="meetings">
        <LookTop look={meetingLook(m) ?? g} className="isolate flex aspect-[16/10] flex-col p-2.5">
          {/* The meeting's living animation, as on its own screen. */}
          <TileMotion motion={m.motion} live={live} />
          <span className="flex min-w-0 items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider">
            {/* While live the badge takes the label's place, so nothing spills out. */}
            {live ? (
              <LiveBadge compact />
            ) : (
              <span className="truncate opacity-80">{t.meetings.details}</span>
            )}
            <SoonTimer startsAt={m.startsAt} compact />
          </span>
          <div className="flex items-end gap-2">
            <DateBadge {...f.dateBadge(m.startsAt)} onBrand />
            <TeamChips m={m} compact className="mb-1 min-w-0" />
          </div>
        </LookTop>
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[14px] font-semibold" style={fs(14)}>
            {m.title}
          </span>
          <span className="truncate text-[12px] text-hint">
            {f.relativeDay(m.startsAt)} · {f.time(m.startsAt)}
          </span>
        </div>
      </Tile>
    </SoonPulse>
  );
}

/**
 * Two to four meetings of one day in one square: small stacked cards, earliest on
 * top (more than four show "+N"). Tapping opens them all at full size.
 */
function MeetingDayTile({
  list,
  g,
  onToggle,
}: {
  list: MeetingTileData[];
  g: GroupSummary;
  onToggle: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const shown = list.slice(0, 4);
  // The next one still to start sets the pulse.
  const now = useNowSecond() * 1000;
  const next = list.find((m) => Date.parse(m.startsAt) > now) ?? list[0]!;
  const soon = useStartsSoon(next.startsAt);
  const isLive = (m: MeetingTileData) =>
    m.status !== 'cancelled' && isLiveWindow(m.startsAt, m.endsAt, now);
  return (
    <SoonPulse startsAt={next.startsAt} motion={next.motion} className="h-full">
      <Tile onToggle={onToggle} live={shown.some(isLive)} module="meetings">
        <LookTop look={meetingLook(list[0]!) ?? g} className="isolate flex flex-col gap-1.5 p-2">
          <TileMotion motion={next.motion} />
          <span className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider opacity-85">
            <span>{f.relativeDay(list[0]!.startsAt)}</span>
            {soon ? (
              <SoonTimer startsAt={next.startsAt} compact />
            ) : (
              <span>{t.meetings.meetingsToday(list.length)}</span>
            )}
          </span>
          <div className={`grid gap-1 ${shown.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {shown.map((m, i) => (
              <span
                key={m.id}
                className={`flex min-w-0 flex-col rounded-lg px-1.5 py-1 ${
                  isLive(m) ? 'live-cell text-white' : 'bg-white/22 backdrop-blur'
                }`}
              >
                {/* A small cell has no room for the pill: a pulsing dot and a red cell say it. */}
                <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold tabular-nums">
                  {isLive(m) && <LiveBadge dot />}
                  <span className="truncate">{f.time(m.startsAt)}</span>
                </span>
                <span className="truncate text-[11px] leading-tight opacity-90">
                  {i === 3 && list.length > 4 ? `+${list.length - 3}` : m.title}
                </span>
              </span>
            ))}
          </div>
        </LookTop>
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[14px] font-semibold" style={fs(14)}>
            {list[0]!.title}
          </span>
          <span className="truncate text-[12px] text-hint">{t.meetings.showAllMeetings}</span>
        </div>
      </Tile>
    </SoonPulse>
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
  // The meeting screen's animation, tuned in the Design studio (unless tiles have their own).
  const meetingsLook = useModuleLook('meetings');
  const meetingTune = meetingsLook.own ? {} : meetingsLook;
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const rollable = onRoll && canRollNow({ status: m.status ?? 'scheduled', startsAt: m.startsAt });
  return (
    <SoonPulse startsAt={m.startsAt} cancelled={m.status === 'cancelled'} motion={m.motion}>
      <HeroCard
        living={m.motion ?? 'calm'}
        look={meetingLook(m)}
        tune={meetingTune.tune}
        icon={meetingTune.icon}
      >
        <SoonTimer startsAt={m.startsAt} className="mb-2" />
        <LiveNow
          startsAt={m.startsAt}
          endsAt={m.endsAt}
          cancelled={m.status === 'cancelled'}
          className="mb-2"
        />
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
    </SoonPulse>
  );
}
