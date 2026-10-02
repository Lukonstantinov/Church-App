import { displayName, type MeResponse } from '@church/shared';
import { useEventWhen } from './EventCard';
import { IconCalendar, IconChevronRight, IconUsers } from './icons';
import { Avatar } from './Avatar';
import { Card } from './ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useAssignments, useMyEvents } from '../lib/queries';

/**
 * The profile row of the main page, opened: every duty the person has (at events and on
 * meetings they lead or buy snacks for), each with a short explanation and a tap to its page.
 */
export function MyAssignments({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const t = useT();
  const f = useFmt();
  const when = useEventWhen();
  const { push } = useNav();
  const events = useMyEvents();
  const jobs = useAssignments();
  const duties = (events.data ?? []).filter(
    (e) => e.myDuties.length > 0 && e.status !== 'cancelled',
  );
  const meetings = jobs.data ?? [];
  const empty = duties.length === 0 && meetings.length === 0;
  const row =
    'flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 active:bg-hairline';
  return (
    <Card className="overflow-hidden">
      {empty && <p className="px-4 py-4 text-[15px] text-hint">{t.events.nothingAssigned}</p>}
      {duties.map((e) => (
        <button
          key={e.id}
          type="button"
          className={row}
          onClick={() => push({ name: 'event', eventId: e.id })}
        >
          <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
            <IconUsers size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{e.title}</span>
            <span className="block truncate text-[12px] text-hint">
              {e.groupName} · {when(e)}
            </span>
            {e.myDuties.map((d) => (
              <span key={d.name} className="mt-0.5 block text-[13px] leading-snug">
                <b>{d.name}</b>
                {d.description ? <span className="text-hint"> — {d.description}</span> : null}
              </span>
            ))}
          </span>
          <IconChevronRight size={16} className="shrink-0 text-hint" />
        </button>
      ))}
      {meetings.map((a) => (
        <button
          key={`${a.meetingId}:${a.role}`}
          type="button"
          className={row}
          onClick={() => push({ name: 'task', meetingId: a.meetingId })}
        >
          <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
            <IconCalendar size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{a.title}</span>
            <span className="block truncate text-[12px] text-hint">
              {a.groupName} · {f.weekdayDayMonth(a.startsAt)} · {f.time(a.startsAt)}
            </span>
            <span className="mt-0.5 block text-[13px] leading-snug">
              <b>{a.role === 'leader' ? t.meetings.youLeadShort : t.meetings.youSnackShort}</b>
            </span>
          </span>
          <IconChevronRight size={16} className="shrink-0 text-hint" />
        </button>
      ))}
      <button
        type="button"
        className={`${row} text-[14px] font-semibold text-link`}
        onClick={() => {
          onClose();
          push({ name: 'member', userId: me.user.id });
        }}
      >
        <Avatar
          id={me.user.id}
          firstName={me.user.firstName}
          lastName={me.user.lastName}
          size={28}
        />
        {t.events.openProfile} · {displayName(me.user)}
      </button>
    </Card>
  );
}
