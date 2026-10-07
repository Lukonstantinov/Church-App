import { useState } from 'react';
import {
  displayName,
  NOTE_COLORS,
  type CalendarData,
  type CalendarNote,
  type EventSummary,
  type GroupSummary,
  type MeetingPerson,
  type MeetingRow,
} from '@church/shared';
import { useEnv } from '../lib/env';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useCalendar,
  useDeleteNote,
  useMeetingPeople,
  useSaveNote,
  useUpdateMeeting,
} from '../lib/queries';
import { storage } from '../lib/storage';
import { confirmDialog, haptic } from '../lib/telegram';
import { CountdownBadge, daysUntil, hasCountdown } from './Countdown';
import { IconCheck, IconChevronRight, IconClock, IconMic } from './icons';
import { LiveNow } from './Live';
import { NotifySheet } from './NotifySheet';
import { PersonPicker } from './PersonPicker';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Card, Skeleton } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const noon = (day: string) => `${day}T12:00:00`;

/** Whether this person keeps the small calendar on the ministry's home (their choice). */
const homeKey = (groupId: number) => `church.calendarHome.${groupId}`;
export const calendarOnHome = (groupId: number) => storage.get(homeKey(groupId)) !== 'off';
export const setCalendarOnHome = (groupId: number, on: boolean) =>
  storage.set(homeKey(groupId), on ? 'on' : 'off');

interface Day {
  meetings: MeetingRow[];
  events: EventSummary[];
  notes: CalendarNote[];
}

/** Everything in the calendar grouped by local "YYYY-MM-DD". */
function useDays(data: CalendarData | undefined) {
  const f = useFmt();
  const days = new Map<string, Day>();
  const at = (d: string) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = { meetings: [], events: [], notes: [] }));
    return v;
  };
  if (!data) return days;
  for (const m of data.meetings)
    if (m.status !== 'cancelled') at(f.dateInput(m.startsAt)).meetings.push(m);
  for (const e of data.events) {
    if (e.status === 'cancelled') continue;
    // A multi-day event marks every day it runs (up to a month).
    const first = f.dateInput(e.startsAt);
    const last = e.endsAt ? f.dateInput(e.endsAt) : first;
    let d = first;
    for (let i = 0; i < 31 && d <= last; i++) {
      at(d).events.push(e);
      const next = new Date(Date.parse(`${d}T12:00:00Z`) + 864e5);
      d = next.toISOString().slice(0, 10);
    }
  }
  for (const n of data.notes ?? []) at(n.date).notes.push(n);
  // Earliest first, so a day with several meetings reads in order.
  for (const d of days.values()) d.meetings.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return days;
}

/** The nearest thing from today: a note, an event or a meeting. */
function nextUp(days: Map<string, Day>, today: string) {
  const day = [...days.keys()].filter((d) => d >= today).sort()[0];
  return day ? { day, ...days.get(day)! } : null;
}

/** A month grid; days with something carry coloured marks. */
function MonthGrid({
  month,
  days,
  today,
  onPick,
  small,
}: {
  month: string;
  days: Map<string, Day>;
  today: string;
  onPick?: (day: string) => void;
  small?: boolean;
}) {
  const f = useFmt();
  const [y, mo] = month.split('-').map(Number) as [number, number];
  const offset = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return (
    <div className={`grid grid-cols-7 text-center ${small ? 'gap-y-0.5' : 'gap-1'}`}>
      {f.weekdaysShort.map((d) => (
        <span
          key={d}
          className={`font-semibold uppercase text-hint ${small ? 'text-[8px]' : 'pb-1 text-[11px]'}`}
        >
          {small ? d.slice(0, 1) : d}
        </span>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <span key={`e${i}`} />
      ))}
      {Array.from({ length: count }, (_, i) => {
        const day = `${month}-${pad(i + 1)}`;
        const d = days.get(day);
        const m = d?.meetings[0];
        const past = day < today;
        const isToday = day === today;
        const dots = [
          ...(d?.events.length ? ['#f97316'] : []),
          ...(d?.notes ?? []).map((n) => n.color),
        ].slice(0, 3);
        if (small)
          return (
            <span
              key={day}
              className={`relative mx-auto flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9.5px] leading-none ${
                m ? 'brand-gradient font-bold text-white' : past ? 'text-hint/50' : ''
              } ${isToday && !m ? 'font-bold text-accent ring-1 ring-[var(--brand)]' : ''}`}
            >
              {i + 1}
              {d && d.meetings.length > 1 && (
                <span className="absolute -right-1 -top-1 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-white px-0.5 text-[7px] font-bold leading-none text-[var(--brand)] ring-1 ring-[var(--brand)]">
                  {d.meetings.length}
                </span>
              )}
              {dots[0] && (
                <span
                  className="absolute -bottom-0.5 h-1 w-1 rounded-full"
                  style={{ background: dots[0] }}
                />
              )}
            </span>
          );
        return (
          <button
            key={day}
            type="button"
            onClick={() => {
              haptic.tap();
              onPick?.(day);
            }}
            className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl text-[14px] transition active:scale-90 ${
              m
                ? m.leader
                  ? 'brand-gradient font-bold text-white shadow-cta'
                  : 'bg-brand/15 font-semibold text-accent ring-1 ring-[var(--brand)]/40'
                : past
                  ? 'text-hint/50'
                  : ''
            } ${isToday ? 'outline outline-2 outline-offset-1 outline-[var(--brand)]' : ''}`}
          >
            <span className="leading-none">{i + 1}</span>
            {d && d.meetings.length > 1 ? (
              <span className="text-[9px] font-bold leading-none">×{d.meetings.length}</span>
            ) : m?.leader ? (
              <span className="text-[9px] font-semibold leading-none">
                {`${m.leader.firstName[0]}${m.leader.lastName?.[0] ?? ''}`}
              </span>
            ) : null}
            {dots.length > 0 && (
              <span className="flex gap-0.5">
                {dots.map((c, k) => (
                  <span
                    key={k}
                    className="h-1.5 w-1.5 rounded-full ring-1 ring-white/70"
                    style={{ background: c }}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The ministry calendar: meetings (those the person is in), coming events and, for
 * leaders, colour notes. Tapping a day lists what's on it; leaders add notes, assign
 * a meeting's leader or create an event on that day.
 */
export function GroupCalendar({ g }: { g: GroupSummary }) {
  const t = useT();
  const f = useFmt();
  const q = useCalendar(g.id);
  const today = f.todayInput();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const days = useDays(q.data);

  const [y, mo] = month.split('-').map(Number) as [number, number];
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const min = (() => {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  })();

  if (q.isPending) return <Skeleton className="h-[300px] w-full" />;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="previous month"
          disabled={month <= min}
          onClick={() => shift(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
        >
          <IconChevronRight size={16} className="rotate-180" />
        </button>
        <span className="text-[15px] font-semibold">{f.periodLong(month)}</span>
        <button
          type="button"
          aria-label="next month"
          onClick={() => shift(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
      <MonthGrid month={month} days={days} today={today} onPick={setDay} />
      <p className="mt-2 px-1 text-[12px] text-hint">{t.meetings.calendarHint}</p>
      {day && (
        <DaySheet
          g={g}
          day={day}
          today={today}
          d={days.get(day) ?? { meetings: [], events: [], notes: [] }}
          canNote={q.data?.canNote ?? false}
          onClose={() => setDay(null)}
        />
      )}
    </Card>
  );
}

type NoteDraft = { id?: number; text: string; color: (typeof NOTE_COLORS)[number] };

function DaySheet({
  g,
  day,
  today,
  d,
  canNote,
  onClose,
}: {
  g: GroupSummary;
  day: string;
  today: string;
  d: Day;
  canNote: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const { push } = useNav();
  const { can } = useEnv();
  const update = useUpdateMeeting();
  const saveNote = useSaveNote(g.id);
  const deleteNote = useDeleteNote(g.id);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [assign, setAssign] = useState<MeetingRow | null>(null);
  const [notify, setNotify] = useState<{ meeting: MeetingRow; person: MeetingPerson } | null>(null);
  const people = useMeetingPeople(assign?.id ?? 0, assign !== null);
  const manage = can('meetings.manage');
  const upcoming = day >= today;
  const empty = !d.meetings.length && !d.events.length && !d.notes.length;

  async function pickLeader(id: number | null) {
    const m = assign;
    if (!m) return;
    try {
      const row = await update.mutateAsync({ id: m.id, leaderUserId: id });
      haptic.success();
      toast(t.meetings.assigned);
      const person = people.data?.find((p) => p.id === id);
      if (person) setNotify({ meeting: row, person });
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  async function submitNote() {
    if (!note || !note.text.trim()) return;
    try {
      await saveNote.mutateAsync({
        id: note.id,
        date: day,
        text: note.text.trim(),
        color: note.color,
      });
      haptic.success();
      setNote(null);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  async function removeNote(id: number) {
    if (!(await confirmDialog(t.meetings.deleteNote))) return;
    try {
      await deleteNote.mutateAsync(id);
      setNote(null);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  const left = daysUntil(day, today);
  return (
    <>
      <Sheet
        open={!assign && !notify}
        onClose={onClose}
        title={`${f.weekdayDayMonth(noon(day))}${left > 0 && left < 400 ? ` · ${f.relativeDay(noon(day))}` : ''}`}
      >
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {note ? (
            <div className="flex flex-col gap-3">
              <textarea
                autoFocus
                value={note.text}
                onChange={(e) => setNote({ ...note, text: e.target.value })}
                maxLength={300}
                rows={3}
                placeholder={t.meetings.noteText}
                className="w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] outline-none"
              />
              <div className="flex gap-2.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setNote({ ...note, color: c })}
                    className={`h-8 w-8 rounded-full transition active:scale-90 ${
                      note.color === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <p className="text-[12px] text-hint">{t.meetings.noteHint}</p>
              <Button
                disabled={!note.text.trim() || saveNote.isPending}
                onClick={() => void submitNote()}
              >
                {t.common.save}
              </Button>
              {note.id && (
                <Button variant="destructive" onClick={() => void removeNote(note.id!)}>
                  {t.meetings.deleteNote}
                </Button>
              )}
              <Button variant="glass" onClick={() => setNote(null)}>
                {t.common.cancel}
              </Button>
            </div>
          ) : (
            <>
              {empty && (
                <p className="py-3 text-center text-[14px] text-hint">
                  {t.meetings.nothingThisDay}
                </p>
              )}
              {d.meetings.map((m) => (
                <div
                  key={m.id}
                  className="glass flex items-center gap-3 rounded-2xl p-3 shadow-card"
                >
                  <button
                    type="button"
                    onClick={() => push({ name: 'meeting', meetingId: m.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold">{m.title}</span>
                      <LiveNow startsAt={m.startsAt} endsAt={m.endsAt} compact />
                    </span>
                    <span className="block truncate text-[13px] text-hint">
                      {f.timeRange(m.startsAt, m.endsAt)}
                      {m.topic ? ` · «${m.topic}»` : ''}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[13px]">
                      <IconMic size={14} className="shrink-0 text-hint" />
                      <span className="truncate">
                        {m.leader ? displayName(m.leader) : t.meetings.noLeader}
                      </span>
                      {m.leaderAcceptedAt ? (
                        <IconCheck size={14} className="shrink-0 text-present" />
                      ) : m.leaderNotifiedAt ? (
                        <IconClock size={14} className="shrink-0 text-hint" />
                      ) : null}
                    </span>
                  </button>
                  {manage && upcoming && (
                    <button
                      type="button"
                      onClick={() => setAssign(m)}
                      className="brand-gradient shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white active:scale-95"
                    >
                      {m.leader ? t.common.edit : t.meetings.assignLeader}
                    </button>
                  )}
                </div>
              ))}
              {d.events.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => push({ name: 'event', eventId: e.id })}
                  className="glass flex flex-col gap-1.5 rounded-2xl p-3 text-left shadow-card"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#f97316]" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                      {e.title}
                    </span>
                    <span className="shrink-0 text-[13px] text-hint">{f.time(e.startsAt)}</span>
                  </span>
                  {hasCountdown(e) && (
                    <CountdownBadge
                      startsAt={e.startsAt}
                      design={e.design}
                      className="self-start"
                    />
                  )}
                </button>
              ))}
              {d.notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={!canNote}
                  onClick={() =>
                    setNote({ id: n.id, text: n.text, color: n.color as NoteDraft['color'] })
                  }
                  className="flex items-stretch gap-2.5 rounded-xl bg-hairline/60 py-2 pr-3 text-left"
                >
                  <span className="w-1 shrink-0 rounded-full" style={{ background: n.color }} />
                  <span className="whitespace-pre-line text-[14px]">{n.text}</span>
                </button>
              ))}
              <div className="mt-1 flex flex-wrap gap-2">
                {canNote && (
                  <Button
                    small
                    variant="glass"
                    onClick={() => setNote({ text: '', color: NOTE_COLORS[0] })}
                  >
                    {t.meetings.addNote}
                  </Button>
                )}
                {can('events.manage') && upcoming && (
                  <Button
                    small
                    variant={d.meetings.length ? 'glass' : 'primary'}
                    onClick={() => push({ name: 'eventForm', groupId: g.id, date: day })}
                  >
                    {d.meetings.length ? t.meetings.addEvent : t.meetings.createEvent}
                  </Button>
                )}
                {manage && upcoming && (
                  <Button
                    small
                    variant="glass"
                    onClick={() => push({ name: 'newMeeting', groupId: g.id, date: day })}
                  >
                    {t.meetings.addMeeting}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Sheet>
      <PersonPicker
        open={assign !== null}
        title={`${t.meetings.assignLeader} · ${f.dayMonth(noon(day))}`}
        people={people.data}
        value={assign?.leader?.id ?? null}
        onClose={() => setAssign(null)}
        onPick={(id) => {
          void pickLeader(id).finally(() => setAssign(null));
        }}
      />
      {notify && (
        <NotifySheet
          meeting={notify.meeting}
          group={g}
          role="leader"
          person={notify.person}
          onClose={() => setNotify(null)}
        />
      )}
    </>
  );
}

/**
 * The calendar as a small home tile: this month in miniature and, below, the nearest
 * thing (a note, an event or a meeting).
 */
export function CalendarTile({ g, onToggle }: { g: GroupSummary; onToggle: () => void }) {
  const t = useT();
  const f = useFmt();
  const q = useCalendar(g.id);
  const today = f.todayInput();
  const days = useDays(q.data);
  const next = nextUp(days, today);
  const label = next
    ? (next.notes[0]?.text ??
      next.events[0]?.title ??
      (next.meetings[0] ? (next.meetings[0].topic ?? next.meetings[0].title) : ''))
    : t.meetings.nothingThisDay;
  const color = next?.notes[0]?.color ?? (next?.events.length ? '#f97316' : 'var(--brand)');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.overview.expand}
      className="glass flex flex-col overflow-hidden rounded-2xl p-2 text-left shadow-card active:scale-[0.98]"
    >
      <span className="mb-1 flex items-center justify-between px-0.5 text-[10px] font-bold uppercase tracking-wider text-hint">
        <span>{t.meetings.calendarTitle}</span>
        <span>{f.monthShort(today.slice(0, 7))}</span>
      </span>
      <MonthGrid month={today.slice(0, 7)} days={days} today={today} small />
      <span className="mt-1.5 flex items-start gap-1.5 border-t border-hairline px-0.5 pt-1.5">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1">
          {next && (
            <span className="block text-[10px] font-semibold text-hint">
              {next.day === today ? t.meetings.today : f.dayMonthShort(next.day)}
            </span>
          )}
          <span className="line-clamp-2 text-[12px] font-medium leading-tight">{label}</span>
        </span>
      </span>
    </button>
  );
}
