import { displayName, type MeResponse } from '@church/shared';
import { FeedHighlights } from '../components/FeedEntry';
import { PosterCard } from '../components/Poster';
import { useEnv } from '../lib/env';
import { AttendanceSummary } from '../components/AttendanceSummary';
import { Avatar } from '../components/Avatar';
import { BrandHeader } from '../components/BrandHeader';
import { GroupDot } from '../components/GroupSwitcher';
import { IconCalendar, IconTelegram, IconUsers } from '../components/icons';
import {
  Badge,
  Card,
  DateBadge,
  EmptyState,
  HeroCard,
  Row,
  Screen,
  Section,
  Skeleton,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useMyAnnouncements, useMyAttendance, useMyEvents } from '../lib/queries';
import { openTelegramLink } from '../lib/telegram';
import { EventCard } from '../components/EventCard';
import { MeetingHeroLines } from './MeetingScreen';

/** Regular members: their next meeting, own attendance and announcements. */
export function MemberHome({ me, groupId }: { me: MeResponse; groupId?: number }) {
  const { push } = useNav();
  const t = useT();
  const f = useFmt();
  const { user } = me;
  const { env } = useEnv();
  // Inside one ministry: only its data.
  const memberships =
    groupId === undefined ? me.memberships : me.memberships.filter((m) => m.groupId === groupId);
  const active = memberships.filter((m) => m.status === 'active');
  const pending = memberships.filter((m) => m.status === 'pending');
  const inScope = <T extends { groupId: number }>(list: T[] | undefined) =>
    groupId === undefined ? list : list?.filter((x) => x.groupId === groupId);
  const att = useMyAttendance(active.length > 0);
  const news = useMyAnnouncements(active.length > 0 && !env);
  const events = useMyEvents(active.length > 0);
  const chats = active.filter((m) => m.chatUrl);

  return (
    <Screen>
      <BrandHeader
        title={t.home.hello(user.firstName)}
        subtitle={
          active[0] && groupId !== undefined
            ? [active[0].groupName, active[0].positionName].filter(Boolean).join(' · ')
            : undefined
        }
      />

      {pending.length > 0 && (
        <Section>
          {pending.map((m) => (
            <Row
              key={m.groupId}
              before={<GroupDot id={m.groupId} />}
              title={m.groupName}
              subtitle={t.member.statusPending}
              after={<Badge tone="hint">{t.home.pending}</Badge>}
            />
          ))}
        </Section>
      )}

      {env && active.length > 0 && <FeedHighlights g={env} fallbackTheme={me.church.brandColor} />}

      {active.length === 0 && pending.length === 0 && (
        <Card>
          <EmptyState icon={<IconUsers size={26} />} title={t.home.notInGroupTitle}>
            {t.home.notInGroupText}
          </EmptyState>
        </Card>
      )}

      {active.length > 0 && !att.data && (
        <>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-44 w-full" />
        </>
      )}

      {inScope(att.data?.groups)?.map((g) => (
        <div key={g.groupId} className="flex flex-col gap-4">
          {g.nextMeeting ? (
            <HeroCard>
              <button
                type="button"
                onClick={() => push({ name: 'meeting', meetingId: g.nextMeeting!.id })}
                className="block w-full text-left"
              >
                <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-white/80">
                  {t.home.nextMeetingIn(g.groupName)}
                </div>
                <div className="flex items-center gap-3.5">
                  <DateBadge {...f.dateBadge(g.nextMeeting.startsAt)} onBrand />
                  <div className="min-w-0">
                    <div className="truncate text-[21px] font-bold leading-tight">
                      {g.nextMeeting.title}
                    </div>
                    <div className="text-[15px] text-white/85">
                      {f.relativeDay(g.nextMeeting.startsAt)} ·{' '}
                      {f.timeRange(g.nextMeeting.startsAt, g.nextMeeting.endsAt)}
                    </div>
                  </div>
                </div>
                <MeetingHeroLines meeting={g.nextMeeting} />
              </button>
            </HeroCard>
          ) : (
            <Card className="flex items-center gap-3 p-4 text-[14px] text-hint">
              <IconCalendar size={22} />
              {t.home.noNextMeeting(g.groupName)}
            </Card>
          )}
          <AttendanceSummary data={g} />
        </div>
      ))}

      {(inScope(events.data) ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.events.upcomingOnHome}
          </h2>
          {inScope(events.data)!.map((e) => (
            <EventCard
              key={e.id}
              e={e}
              showGroup={active.length > 1}
              onClick={() => push({ name: 'event', eventId: e.id })}
            />
          ))}
        </section>
      )}

      {chats.length > 0 && (
        <Section>
          {chats.map((m) => (
            <Row
              key={m.groupId}
              before={
                <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
                  <IconTelegram size={19} />
                </span>
              }
              title={t.groups.openGroupChat}
              subtitle={chats.length > 1 ? m.groupName : undefined}
              onClick={() => openTelegramLink(m.chatUrl!)}
            />
          ))}
        </Section>
      )}

      {!env && (inScope(news.data) ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.home.announcements}
          </h2>
          {inScope(news.data)!
            .slice(0, 3)
            .map((a) => (
              <PosterCard
                key={a.id}
                post={a}
                showGroup={active.length > 1}
                onOpen={() => push({ name: 'post', groupId: a.groupId, postId: a.id })}
              />
            ))}
        </section>
      )}

      <Section title={t.member.profile}>
        <Row
          before={<Avatar id={user.id} firstName={user.firstName} lastName={user.lastName} />}
          title={displayName(user)}
          subtitle={user.username ? `@${user.username}` : undefined}
          onClick={() => push({ name: 'member', userId: user.id })}
        />
      </Section>
      <p className="px-4 pb-2 text-[13px] leading-snug text-hint">{t.home.privacyNote}</p>
    </Screen>
  );
}
