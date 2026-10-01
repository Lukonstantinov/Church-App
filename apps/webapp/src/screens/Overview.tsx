import type { GroupSummary, MeetingRow } from '@church/shared';
import { AttendanceChart } from '../components/AttendanceChart';
import { GroupSwitcher } from '../components/GroupSwitcher';
import {
  IconCalendar,
  IconClock,
  IconMegaphone,
  IconPlus,
  IconUserPlus,
  IconUsers,
} from '../components/icons';
import {
  Badge,
  Button,
  Card,
  DateBadge,
  EmptyState,
  HeroCard,
  Screen,
  Skeleton,
  StatTile,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useEnv } from '../lib/env';
import { useNav } from '../lib/nav';
import { useGroupStats, useMe } from '../lib/queries';
import { FeedHighlights } from '../components/FeedEntry';
import { MeetingHeroLines } from './MeetingScreen';

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

  return (
    <Screen tabs>
      <GroupSwitcher
        groups={groups}
        active={active}
        subtitle={t.common.members(active.activeCount)}
      />

      <FeedHighlights g={active} fallbackTheme={me.data?.church.brandColor ?? 'blue'} />

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

          {s.nextMeeting ? (
            <NextMeetingHero
              meeting={s.nextMeeting}
              onRoll={
                can('attendance.take')
                  ? () => push({ name: 'roll', meetingId: s.nextMeeting!.id })
                  : undefined
              }
            />
          ) : (
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

          {(can('announce') || can('meetings.manage') || can('people.manage')) && (
            <div className="grid grid-cols-3 gap-3">
              {can('announce') && (
                <QuickAction
                  icon={<IconMegaphone size={22} />}
                  label={t.overview.quickAnnounce}
                  onClick={() => push({ name: 'newPost', groupId: active.id })}
                />
              )}
              {can('meetings.manage') && (
                <QuickAction
                  icon={<IconPlus size={22} />}
                  label={t.overview.quickMeeting}
                  onClick={() => push({ name: 'newMeeting', groupId: active.id })}
                />
              )}
              {can('people.manage') && (
                <QuickAction
                  icon={<IconUserPlus size={22} />}
                  label={t.overview.quickInvite}
                  onClick={() => push({ name: 'addPerson', groupId: active.id })}
                />
              )}
            </div>
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

function NextMeetingHero({ meeting, onRoll }: { meeting: MeetingRow; onRoll?: () => void }) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const open = canRollNow(meeting);
  return (
    <HeroCard>
      <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-white/80">
        {t.overview.nextMeeting}
      </div>
      <button
        type="button"
        onClick={() => push({ name: 'meeting', meetingId: meeting.id })}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-3.5">
          <DateBadge {...f.dateBadge(meeting.startsAt)} onBrand />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[21px] font-bold leading-tight">{meeting.title}</div>
            <div className="text-[15px] text-white/85">
              {f.relativeDay(meeting.startsAt)} · {f.timeRange(meeting.startsAt, meeting.endsAt)}
            </div>
          </div>
        </div>
        <MeetingHeroLines meeting={meeting} />
      </button>
      {onRoll && (
        <div className="mt-4">
          {open ? (
            <Button variant="white" onClick={onRoll}>
              {t.overview.startRoll}
            </Button>
          ) : (
            <p className="flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2.5 text-[14px] text-white/90">
              <IconClock size={16} className="shrink-0" />
              {t.overview.rollOpensSoon}
            </p>
          )}
        </div>
      )}
    </HeroCard>
  );
}
