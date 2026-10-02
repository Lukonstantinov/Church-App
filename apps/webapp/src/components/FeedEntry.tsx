import { resolveBrand, type GroupSummary } from '@church/shared';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { IconMegaphone } from './icons';
import { Card, Chevron } from './ui';

/** Unread counters: new posts in the ministry's colour, new chat messages in red. */
export function UnreadBadges({ g, fallbackTheme }: { g: GroupSummary; fallbackTheme: string }) {
  const postColor = g.badgeColor ?? resolveBrand(g.brandColor ?? fallbackTheme).partner;
  return (
    <span className="flex items-center gap-1">
      {g.unreadPosts > 0 && (
        <span
          className="min-w-[22px] rounded-full px-1.5 text-center text-[12px] font-bold leading-[22px] text-white ring-2 ring-white/90"
          style={{ background: postColor }}
        >
          {g.unreadPosts > 99 ? '99+' : g.unreadPosts}
        </span>
      )}
      {g.unreadComments > 0 && (
        <span className="breathe min-w-[22px] rounded-full bg-[#ef4444] px-1.5 text-center text-[12px] font-bold leading-[22px] text-white ring-2 ring-white/90">
          {g.unreadComments > 99 ? '99+' : g.unreadComments}
        </span>
      )}
    </span>
  );
}

/** "Feed" row inside a ministry, with its unread counters. */
export function FeedEntry({ g, fallbackTheme }: { g: GroupSummary; fallbackTheme: string }) {
  const t = useT();
  const { push } = useNav();
  const parts = [
    g.unreadPosts ? t.feed.newPosts(g.unreadPosts) : null,
    g.unreadComments ? t.feed.newMessages(g.unreadComments) : null,
  ].filter(Boolean);
  return (
    <Card
      onClick={() => push({ name: 'announcements', groupId: g.id })}
      className="flex items-center gap-3 p-4"
    >
      <span className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-cta">
        <IconMegaphone size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold">{t.feed.title}</span>
        <span className="block truncate text-[13px] text-hint">
          {parts.length ? parts.join(' · ') : t.feed.open}
        </span>
      </span>
      <UnreadBadges g={g} fallbackTheme={fallbackTheme} />
      <Chevron />
    </Card>
  );
}
