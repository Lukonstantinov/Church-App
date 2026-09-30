import { displayName, type MeResponse } from '@church/shared';
import { AnnouncementCard } from '../components/AnnouncementCard';
import { AttendanceSummary } from '../components/AttendanceSummary';
import { Avatar } from '../components/Avatar';
import { MyDuesCard } from '../components/MyDuesCard';
import { BrandHeader } from '../components/BrandHeader';
import { GroupDot } from '../components/GroupSwitcher';
import { IconCalendar, IconUsers } from '../components/icons';
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
import { useMyAnnouncements, useMyAttendance, useMyFinance } from '../lib/queries';

/** Regular members: their next meeting, own attendance and announcements. */
export function MemberHome({ me }: { me: MeResponse }) {
  const { push } = useNav();
  const t = useT();
  const f = useFmt();
  const { user, memberships } = me;
  const active = memberships.filter((m) => m.status === 'active');
  const pending = memberships.filter((m) => m.status === 'pending');
  const att = useMyAttendance(active.length > 0);
  const news = useMyAnnouncements(active.length > 0);
  const finance = useMyFinance(active.length > 0);

  return (
    <Screen>
      <BrandHeader title={t.home.hello(user.firstName)} />

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

      {att.data?.groups.map((g) => (
        <div key={g.groupId} className="flex flex-col gap-4">
          {g.nextMeeting ? (
            <HeroCard>
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

      {finance.data?.map((g) => (
        <MyDuesCard key={g.groupId} g={g} showGroup={active.length > 1} />
      ))}

      {(news.data ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.home.announcements}
          </h2>
          {news.data!.map((a) => (
            <AnnouncementCard key={a.id} a={a} showGroup={active.length > 1} />
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
