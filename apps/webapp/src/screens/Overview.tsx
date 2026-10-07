import type { GroupSummary, MeetingRow } from '@church/shared';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconCalendar, IconClock } from '../components/icons';
import { Button, Card, EmptyState, Screen, Skeleton } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useEnv } from '../lib/env';
import { useNav } from '../lib/nav';
import { useGroupStats, useMe, useUpcoming } from '../lib/queries';
import { useTasks } from '../components/Assignments';
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
  const upcoming = useUpcoming(active.id);
  const tasks = useTasks(active.id);
  const base = useHomeActions(active, me.data?.church.brandColor ?? 'blue', can);
  const actions = tasks.action ? [tasks.action, ...base] : base;

  return (
    <Screen tabs>
      <GroupSwitcher
        groups={groups}
        active={active}
        subtitle={t.common.members(active.activeCount)}
      />

      <HomeActionRow actions={actions} />
      {tasks.panel}
      <HomeHighlights
        g={active}
        meetings={comingWeek((upcoming.data ?? []).filter((m) => m.status !== 'cancelled'))}
        onRoll={can('attendance.take') ? (id) => push({ name: 'roll', meetingId: id }) : undefined}
      />

      {!s ? (
        <Skeleton className="h-20 w-full" />
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

/** Meetings of the coming week (all of them, however many a day has), at least the next two. */
function comingWeek<T extends { startsAt: string }>(list: T[]): T[] {
  const until = Date.now() + 7 * 864e5;
  const week = list.filter((m) => Date.parse(m.startsAt) <= until);
  return week.length >= 2 ? week : list.slice(0, 2);
}
