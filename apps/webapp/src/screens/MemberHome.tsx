import { displayName, ru, type MeResponse } from '@church/shared';
import { AttendanceSummary } from '../components/AttendanceSummary';
import { IconCalendar, IconUsers } from '../components/icons';
import {
  Badge,
  Card,
  DateBadge,
  EmptyState,
  Row,
  Screen,
  Section,
  Skeleton,
  Title,
} from '../components/ui';
import { dateBadge, relativeDay, timeRange } from '../lib/format';
import { useNav } from '../lib/nav';
import { useMyAttendance } from '../lib/queries';

/** Regular members: their own attendance and the next meeting, nothing else. */
export function MemberHome({ me }: { me: MeResponse }) {
  const { push } = useNav();
  const { user, memberships, church } = me;
  const att = useMyAttendance();
  const active = memberships.filter((m) => m.status === 'active');
  const pending = memberships.filter((m) => m.status === 'pending');
  const tz = church.timezone;

  return (
    <Screen>
      <Title subtitle={active.length === 0 ? undefined : church.name}>
        {ru.app.hello(user.firstName)}
      </Title>

      {pending.length > 0 && (
        <Section>
          {pending.map((m) => (
            <Row
              key={m.groupId}
              title={m.groupName}
              subtitle={ru.app.statusPending}
              after={<Badge tone="hint">ожидает</Badge>}
            />
          ))}
        </Section>
      )}

      {active.length === 0 && pending.length === 0 && (
        <Card>
          <EmptyState icon={<IconUsers size={26} />} title="Вы пока не в группе">
            {ru.app.noGroupsYet}
          </EmptyState>
        </Card>
      )}

      {active.length > 0 && !att.data && (
        <>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-44 w-full" />
        </>
      )}

      {att.data?.groups.map((g) => (
        <div key={g.groupId} className="flex flex-col gap-3">
          {g.nextMeeting ? (
            <Card className="p-4">
              <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-hint">
                Ближайшая встреча · {g.groupName}
              </div>
              <div className="flex items-center gap-3">
                <DateBadge {...dateBadge(g.nextMeeting.startsAt, tz)} />
                <div className="min-w-0">
                  <div className="truncate text-[18px] font-semibold">{g.nextMeeting.title}</div>
                  <div className="text-[14px] text-hint">
                    {relativeDay(g.nextMeeting.startsAt, tz)} ·{' '}
                    {timeRange(g.nextMeeting.startsAt, g.nextMeeting.endsAt, tz)}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="flex items-center gap-3 p-4 text-[14px] text-hint">
              <IconCalendar size={22} />
              Ближайшие встречи пока не назначены — {g.groupName}
            </Card>
          )}
          <AttendanceSummary data={g} tz={tz} />
        </div>
      ))}

      <Section title={ru.app.profile}>
        <Row
          title={displayName(user)}
          subtitle={user.username ? `@${user.username}` : undefined}
          onClick={() => push({ name: 'member', userId: user.id })}
        />
      </Section>
      <p className="px-4 pb-2 text-[13px] leading-snug text-hint">
        Ваши данные видят только лидеры группы и администраторы церкви. Подробнее — команда /privacy
        в боте.
      </p>
    </Screen>
  );
}
