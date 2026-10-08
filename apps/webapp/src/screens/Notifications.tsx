import type { NotificationKind, NotificationLink, NotificationRow } from '@church/shared';
import { IconBell, IconCalendar, IconMegaphone, IconUsers } from '../components/icons';
import { Button, Card, EmptyState, Loading, Screen, Title } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav, type Route } from '../lib/nav';
import { useNotifications, useReadNotifications } from '../lib/queries';
import { haptic } from '../lib/telegram';

const ICON: Record<NotificationKind, typeof IconBell> = {
  event_reminder: IconBell,
  event_duty: IconUsers,
  meeting_job: IconCalendar,
  meeting_announce: IconCalendar,
  meeting_rsvp: IconUsers,
  post_repeat: IconMegaphone,
  publish_request: IconMegaphone,
};

const routeOf = (l: NotificationLink): Route =>
  l.type === 'event'
    ? { name: 'event', eventId: l.eventId }
    : l.type === 'task'
      ? { name: 'task', meetingId: l.meetingId }
      : { name: 'post', groupId: l.groupId, postId: l.postId };

/** Everything the bot told the person, kept here: unread first-class, tap to open the page. */
export function Notifications() {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const inbox = useNotifications();
  const read = useReadNotifications();
  if (inbox.isPending) return <Loading />;
  const items = inbox.data?.items ?? [];

  const open = (n: NotificationRow) => {
    haptic.tap();
    if (!n.read) read.mutate({ ids: [n.id] });
    if (n.link) push(routeOf(n.link));
  };

  return (
    <Screen>
      <Title subtitle={t.inbox.hint}>{t.inbox.title}</Title>
      {(inbox.data?.unread ?? 0) > 0 && (
        <div>
          <Button small variant="glass" onClick={() => read.mutate({})}>
            {t.inbox.markAll}
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<IconBell size={26} />} title={t.inbox.empty}>
            {t.inbox.hint}
          </EmptyState>
        </Card>
      ) : (
        <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
          {items.map((n) => {
            const Icon = ICON[n.kind] ?? IconBell;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => open(n)}
                className="flex w-full items-start gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 active:bg-hairline"
              >
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    n.read ? 'bg-hairline text-hint' : 'brand-gradient text-white'
                  }`}
                >
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span
                      className={`text-[15px] leading-snug ${n.read ? 'font-medium' : 'font-bold'}`}
                    >
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#ef4444]" />
                    )}
                  </span>
                  <span className="mt-0.5 block whitespace-pre-line text-[13px] leading-snug text-hint">
                    {n.body}
                  </span>
                  <span className="mt-1 block text-[12px] text-hint/80">
                    {f.dayMonth(n.createdAt)} · {f.time(n.createdAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
