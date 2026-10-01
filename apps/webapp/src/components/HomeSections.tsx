import { useState, type ReactNode } from 'react';
import {
  fontFamily,
  type AnnouncementRow,
  type EventSummary,
  type GroupSummary,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useEvents, useFeed } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { EventCard, EventCover } from './EventCard';
import { UnreadBadges } from './FeedEntry';
import { IconMegaphone, IconPlus, IconUserPlus, IconUsers } from './icons';
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

type Item = { kind: 'post'; post: AnnouncementRow } | { kind: 'event'; event: EventSummary };

/**
 * What opens a ministry: pinned posts and coming events as small tiles, two per row
 * (tap to expand one to full width), then the newest post.
 */
export function HomeHighlights({ g }: { g: GroupSummary }) {
  const t = useT();
  const { push } = useNav();
  const feed = useFeed(g.id);
  const events = useEvents(g.id, 'upcoming');
  const [open, setOpen] = useState<string | null>(null);
  const first = feed.data?.pages[0] ?? [];
  const items: Item[] = [
    ...first.filter((p) => p.pinned).map((post) => ({ kind: 'post' as const, post })),
    ...(events.data ?? [])
      .filter((e) => e.status !== 'cancelled')
      .slice(0, 6)
      .map((event) => ({ kind: 'event' as const, event })),
  ];
  const latest = first.find((p) => !p.pinned);
  const keyOf = (i: Item) => (i.kind === 'post' ? `p${i.post.id}` : `e${i.event.id}`);
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
                    {item.kind === 'post' ? (
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
              return item.kind === 'post' ? (
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
      </div>
    </Tile>
  );
}
