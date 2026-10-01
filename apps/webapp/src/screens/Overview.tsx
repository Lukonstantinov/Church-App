import type { GroupSummary, MeetingRow } from '@church/shared';
import { AttendanceChart } from '../components/AttendanceChart';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconCalendar, IconClock, IconUsers } from '../components/icons';
import { Badge, Button, Card, EmptyState, Screen, Skeleton, StatTile } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useEnv } from '../lib/env';
import { useNav } from '../lib/nav';
import { useGroupStats, useMe, useUpcoming } from '../lib/queries';
import { AssignmentCards } from '../components/Assignments';
import { HomeActionRow, HomeHighlights, useHomeActions } from '../components/HomeSections';

const HOUR = 3_600_000;

/** A meeting is open for roll call from one hour before it starts. */
export const canRollNow = (m: Pick<MeetingRow, 'startsAt' | 'status'>, now = Date.now()) =>
  m.status !== 'cancelled' && new Date(m.startsAt).getTime() - now <= HOUR;

export function Overview({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push, setTab } = useNav();
  const { can } = useEnv();
  const t = useT();
  const f = useFmt();
  const stats = useGroupStats(active.id);
  const me = useMe();
  const s = stats.data;
  // Requests only matter to people who can approve them.
  const pending = s && can('people.manage') ? s.pendingCount : 0;
  const upcoming = useUpcoming(active.id);
  const actions = useHomeActions(active, me.data?.church.brandColor ?? 'blue', can);

  return (
    <Screen tabs>
      <GroupSwitcher
        groups={groups}
        active={active}
        subtitle={t.common.members(active.activeCount)}
      />

      <AssignmentCards groupId={active.id} />
      <HomeActionRow actions={actions} />
      <HomeHighlights
        g={active}
        meetings={(upcoming.data ?? []).filter((m) => m.status !== 'cancelled').slice(0, 2)}
        onRoll={can('attendance.take') ? (id) => push({ name: 'roll', meetingId: id }) : undefined}
      />

      {!s ? (
        <>
          <Skeleton className="h-44 w-full" />
          <div className="flex gap-3">
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 flex-1" />
          </div>
          <Skeleton className="h-56 w-full" />
        </>
      ) : (
        <>
          {can('attendance.take') && s.awaitingRoll.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2 text-[15px] font-semibold text-late">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-late/15">
                    <IconClock size={16} />
                  </span>
                  {s.awaitingRoll.length === 1
                    ? t.overview.awaitingOne
                    : t.overview.awaitingMany(s.awaitingRoll.length)}
                </div>
                {s.awaitingRoll.slice(0, 2).map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-medium">{m.title}</div>
                      <div className="text-[13px] text-hint">{f.weekdayDayMonth(m.startsAt)}</div>
                    </div>
                    <Button small onClick={() => push({ name: 'roll', meetingId: m.id })}>
                      {t.overview.mark}
                    </Button>
                  </div>
                ))}
                {s.awaitingRoll.length > 2 && (
                  <button
                    type="button"
                    className="min-h-[32px] text-left text-[14px] font-semibold text-link"
                    onClick={() => setTab('meetings')}
                  >
                    {t.overview.andMore(s.awaitingRoll.length - 2)}
                  </button>
                )}
              </div>
            </Card>
          )}

          {!s.nextMeeting && (
            <Card>
              <EmptyState
                icon={<IconCalendar size={26} />}
                title={t.overview.noMeetingsTitle}
                action={
                  can('meetings.manage') ? (
                    <Button onClick={() => push({ name: 'schedule', groupId: active.id })}>
                      {t.overview.setupSchedule}
                    </Button>
                  ) : undefined
                }
              >
                {t.overview.noMeetingsText}
              </EmptyState>
            </Card>
          )}

          <div className="flex gap-3">
            <StatTile
              icon={<IconCalendar size={17} />}
              label={t.overview.attendance}
              value={s.averageRate === null ? '—' : `${s.averageRate}%`}
              hint={
                s.series.length === 0 ? t.common.noData : t.overview.forMeetings(s.series.length)
              }
            />
            <StatTile
              icon={<IconUsers size={17} />}
              label={t.overview.members}
              value={s.activeMembers}
              badge={pending > 0 ? <Badge tone="danger">+{pending}</Badge> : undefined}
              hint={pending > 0 ? t.common.requests(pending) : t.overview.inGroup}
              onClick={can('people.view') ? () => setTab('people') : undefined}
            />
          </div>

          <Card className="p-4">
            <h2 className="text-[17px] font-semibold">{t.overview.chartTitle}</h2>
            <p className="mb-3 flex items-center gap-1.5 text-[13px] text-hint">
              {s.averageRate === null ? (
                t.overview.chartAppears
              ) : (
                <>
                  <span className="inline-block h-px w-4 bg-text/40" aria-hidden="true" />
                  {t.overview.average(s.averageRate)}
                </>
              )}
            </p>
            {s.series.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-hint">{t.overview.chartEmpty}</p>
            ) : (
              <AttendanceChart series={s.series} average={s.averageRate} />
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

const TONES = {
  good: 'linear-gradient(145deg, #22c55e, #15803d)',
  bad: 'linear-gradient(145deg, #f87171, #b91c1c)',
};

export function QuickAction({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  /** Green (money in) or red (money out) instead of the theme colour. */
  tone?: keyof typeof TONES;
}) {
  return (
    <Card onClick={onClick} className="flex flex-col items-center gap-2 px-2 py-3.5 text-center">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-cta ${tone ? '' : 'brand-gradient'}`}
        style={tone ? { background: TONES[tone] } : undefined}
      >
        {icon}
      </span>
      <span className="line-clamp-2 w-full text-center text-[13px] font-semibold leading-tight break-words hyphens-auto">
        {label}
      </span>
    </Card>
  );
}
