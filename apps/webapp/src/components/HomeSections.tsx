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
import { haptic } from '../lib/telegram';
import { CountdownBar } from './Countdown';
import { EventCard, EventCover } from './EventCard';
import { CalendarTile, GroupCalendar, calendarOnHome, setCalendarOnHome } from './GroupCalendar';
import { UnreadBadges } from './FeedEntry';
import { IconClock, IconMegaphone, IconPlus, IconUserPlus, IconUsers } from './icons';
import { MeetingHeroLines } from '../screens/MeetingScreen';
import { canRollNow } from '../screens/Overview';
import { Button, DateBadge, HeroCard } from './ui';
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
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => {
            haptic.tap();
            a.onClick();
          }}
          className="glass relative flex min-w-[62px] flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-2 shadow-card active:scale-95"
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
  can: (p: 'announce' | 'meetings.manage' | 'people.manage') => boolean,
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
      icon: <span className="text-[17px] leading-none">✍️</span>,
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

/**
 * What opens a ministry: pinned posts and coming events as small tiles, two per row
 * (tap to expand one to full width), then the newest post.
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
  const [withCalendar, setWithCalendar] = useState(() => calendarOnHome(g.id));
  const first = feed.data?.pages[0] ?? [];
  const shownEvents = (events.data ?? []).filter((e) => e.status !== 'cancelled').slice(0, 6);
  const items: Item[] = [
    ...(withCalendar ? [{ kind: 'calendar' as const }] : []),
    ...meetings
      .filter((m) => m.status !== 'cancelled')
      .map((meeting) => ({ kind: 'meeting' as const, meeting })),
    ...first
      .filter((p) => p.pinned && !echoesEvent(p, shownEvents))
      .map((post) => ({ kind: 'post' as const, post })),
    ...shownEvents.map((event) => ({ kind: 'event' as const, event })),
  ];
  const latest = first.find((p) => !p.pinned && !echoesEvent(p, shownEvents));
  const keyOf = (i: Item) =>
    i.kind === 'calendar'
      ? 'cal'
      : i.kind === 'post'
        ? `p${i.post.id}`
        : i.kind === 'event'
          ? `e${i.event.id}`
          : `m${i.meeting.id}`;
  const openPost = (id: number) => push({ name: 'post', groupId: g.id, postId: id });
  const openEvent = (id: number) => push({ name: 'event', eventId: id });

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <section>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.overview.important}
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((item) => {
              const k = keyOf(item);
              const expanded = open === k;
              const toggle = () => {
                haptic.tap();
                setOpen(expanded ? null : k);
              };
              if (expanded)
                return (
                  <div key={k} className="col-span-2 flex flex-col gap-1.5">
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
                      ▴ {t.overview.collapse}
                    </button>
                  </div>
                );
              return item.kind === 'calendar' ? (
                <CalendarTile key={k} g={g} onToggle={toggle} />
              ) : item.kind === 'meeting' ? (
                <MeetingTile key={k} m={item.meeting} onToggle={toggle} />
              ) : item.kind === 'post' ? (
                <PostTile key={k} post={item.post} onToggle={toggle} />
              ) : (
                <EventTile key={k} e={item.event} onToggle={toggle} />
              );
            })}
          </div>
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

function Tile({ onToggle, children }: { onToggle: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.overview.expand}
      className="glass flex flex-col overflow-hidden rounded-2xl text-left shadow-card active:scale-[0.98]"
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

function EventTile({ e, onToggle }: { e: EventSummary; onToggle: () => void }) {
  const f = useFmt();
  const cover = e.coverUrl || e.design?.banner;
  return (
    <Tile onToggle={onToggle}>
      {cover ? (
        <div className="pointer-events-none">
          <EventCover e={e} className="aspect-[16/10]" compact />
        </div>
      ) : (
        <div className="brand-gradient flex aspect-[16/10] items-center justify-center text-[28px]">
          📅
        </div>
      )}
      <div className="flex flex-col gap-0.5 p-2.5">
        <span className="truncate text-[14px] font-semibold">{e.title}</span>
        <span className="truncate text-[12px] text-hint">
          {f.weekdayDayMonth(e.startsAt)} · {f.time(e.startsAt)}
        </span>
        <CountdownBar e={e} compact />
      </div>
    </Tile>
  );
}

function MeetingTile({ m, onToggle }: { m: MeetingTileData; onToggle: () => void }) {
  const t = useT();
  const f = useFmt();
  return (
    <Tile onToggle={onToggle}>
      <div className="brand-gradient flex aspect-[16/10] flex-col justify-between p-2.5 text-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/80">
          {t.meetings.details}
        </span>
        <div className="flex items-end gap-2">
          <DateBadge {...f.dateBadge(m.startsAt)} onBrand />
          {m.leader && (
            <span className="mb-1 truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--brand)]">
              🎤 {m.leader.firstName}
            </span>
          )}
        </div>
      </div>
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
