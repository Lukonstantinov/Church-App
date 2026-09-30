import { plural, type GroupSummary, type MeetingRow } from '@church/shared';
import { AttendanceChart } from '../components/AttendanceChart';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconCalendar, IconClock } from '../components/icons';
import {
  Badge,
  Button,
  Card,
  DateBadge,
  EmptyState,
  Screen,
  Skeleton,
  StatTile,
} from '../components/ui';
import { dateBadge, dayMonth, relativeDay, timeRange, weekdayDayMonth } from '../lib/format';
import { useNav } from '../lib/nav';
import { useGroupStats, useMe } from '../lib/queries';

const HOUR = 3_600_000;

/** A meeting is open for roll call from one hour before it starts. */
export const canRollNow = (m: Pick<MeetingRow, 'startsAt' | 'status'>, now = Date.now()) =>
  m.status !== 'cancelled' && new Date(m.startsAt).getTime() - now <= HOUR;

export function Overview({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push, setTab } = useNav();
  const me = useMe();
  const stats = useGroupStats(active.id);
  const tz = me.data?.church.timezone ?? 'Europe/Riga';
  const s = stats.data;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} />

      {!s ? (
        <>
          <Skeleton className="h-36 w-full" />
          <div className="flex gap-3">
            <Skeleton className="h-28 flex-1" />
            <Skeleton className="h-28 flex-1" />
          </div>
          <Skeleton className="h-56 w-full" />
        </>
      ) : (
        <>
          {s.awaitingRoll.length > 0 && (
            <Card className="overflow-hidden border-l-4 border-late">
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2 text-[15px] font-semibold text-late">
                  <IconClock size={18} />
                  {s.awaitingRoll.length === 1
                    ? 'Не отмечена встреча'
                    : `Не отмечены встречи: ${s.awaitingRoll.length}`}
                </div>
                {s.awaitingRoll.slice(0, 2).map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px]">{m.title}</div>
                      <div className="text-[13px] text-hint">{weekdayDayMonth(m.startsAt, tz)}</div>
                    </div>
                    <Button small onClick={() => push({ name: 'roll', meetingId: m.id })}>
                      Отметить
                    </Button>
                  </div>
                ))}
                {s.awaitingRoll.length > 2 && (
                  <button
                    type="button"
                    className="min-h-[32px] text-left text-[14px] text-link"
                    onClick={() => setTab('meetings')}
                  >
                    и ещё {s.awaitingRoll.length - 2}
                  </button>
                )}
              </div>
            </Card>
          )}

          {s.nextMeeting ? (
            <NextMeetingCard
              meeting={s.nextMeeting}
              tz={tz}
              onRoll={() => push({ name: 'roll', meetingId: s.nextMeeting!.id })}
            />
          ) : (
            <Card>
              <EmptyState
                icon={<IconCalendar size={26} />}
                title="Встреч пока нет"
                action={
                  <Button onClick={() => push({ name: 'schedule', groupId: active.id })}>
                    Настроить расписание
                  </Button>
                }
              >
                Задайте регулярное расписание — встречи появятся сами.
              </EmptyState>
            </Card>
          )}

          <div className="flex gap-3">
            <StatTile
              label="Посещаемость"
              value={s.averageRate === null ? '—' : `${s.averageRate}%`}
              hint={
                s.series.length === 0
                  ? 'нет данных'
                  : `за ${s.series.length} ${plural(s.series.length, ['встречу', 'встречи', 'встреч'])}`
              }
            />
            <StatTile
              label="Участники"
              value={s.activeMembers}
              badge={
                s.pendingCount > 0 ? <Badge tone="danger">+{s.pendingCount}</Badge> : undefined
              }
              hint={
                s.pendingCount > 0
                  ? `${s.pendingCount} ${plural(s.pendingCount, ['заявка', 'заявки', 'заявок'])}`
                  : 'в группе'
              }
              onClick={() => setTab('people')}
            />
          </div>

          <Card className="p-4">
            <h2 className="text-[17px] font-semibold">Посещаемость по встречам</h2>
            <p className="mb-3 flex items-center gap-1.5 text-[13px] text-hint">
              {s.averageRate === null ? (
                'Появится после первой переклички'
              ) : (
                <>
                  <span className="inline-block h-px w-4 bg-text/40" aria-hidden="true" />
                  среднее {s.averageRate}%
                </>
              )}
            </p>
            {s.series.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-hint">
                Проведите первую перекличку — здесь появится график.
              </p>
            ) : (
              <AttendanceChart series={s.series} average={s.averageRate} timezone={tz} />
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

function NextMeetingCard({
  meeting,
  tz,
  onRoll,
}: {
  meeting: MeetingRow;
  tz: string;
  onRoll: () => void;
}) {
  const b = dateBadge(meeting.startsAt, tz);
  const open = canRollNow(meeting);
  return (
    <Card className="p-4">
      <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-hint">
        Ближайшая встреча
      </div>
      <div className="flex items-center gap-3">
        <DateBadge {...b} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-semibold">{meeting.title}</div>
          <div className="text-[14px] text-hint">
            {relativeDay(meeting.startsAt, tz)} · {timeRange(meeting.startsAt, meeting.endsAt, tz)}
          </div>
          <div className="text-[13px] text-hint">{dayMonth(meeting.startsAt, tz)}</div>
        </div>
      </div>
      <div className="mt-3">
        {open ? (
          <Button onClick={onRoll}>Начать перекличку</Button>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-hint">
            <IconClock size={16} className="shrink-0" />
            Перекличка откроется за час до начала
          </p>
        )}
      </div>
    </Card>
  );
}
