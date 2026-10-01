import { useState } from 'react';
import type { MeetingRow } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useMeetingPeople, useUpdateMeeting } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconChevronRight } from './icons';
import { PersonPicker } from './PersonPicker';
import { useToast } from './Toast';
import { Card } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A small month calendar of the coming meetings. Days with a meeting are marked; a
 * day whose meeting has a leader shows their initials. Tapping a day picks who leads
 * that meeting (the bot then messages them).
 */
export function MeetingCalendar({ meetings }: { meetings: MeetingRow[] }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const update = useUpdateMeeting();
  const today = f.todayInput();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<MeetingRow | null>(null);
  const people = useMeetingPeople(selected?.id ?? 0, selected !== null);

  const byDay = new Map<string, MeetingRow[]>();
  for (const m of meetings) {
    if (m.status === 'cancelled') continue;
    const day = f.dateInput(m.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
  }
  const last = meetings.length
    ? f.dateInput(meetings[meetings.length - 1]!.startsAt).slice(0, 7)
    : month;

  const [y, mo] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  async function assign(id: number | null) {
    if (!selected) return;
    try {
      const res = await update.mutateAsync({ id: selected.id, leaderUserId: id });
      haptic.success();
      toast(res.notified.length ? t.meetings.notified : t.common.saved);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="previous month"
          disabled={month <= today.slice(0, 7)}
          onClick={() => shift(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
        >
          <IconChevronRight size={16} className="rotate-180" />
        </button>
        <span className="text-[15px] font-semibold">{f.periodLong(month)}</span>
        <button
          type="button"
          aria-label="next month"
          disabled={month >= last}
          onClick={() => shift(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {f.weekdaysShort.map((d) => (
          <span key={d} className="pb-1 text-[11px] font-semibold uppercase text-hint">
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${pad(i + 1)}`;
          const list = byDay.get(day);
          const m = list?.[0];
          const leader = m?.leader;
          const past = day < today;
          return (
            <button
              key={day}
              type="button"
              disabled={!m || past}
              onClick={() => {
                haptic.tap();
                setSelected(m!);
              }}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl text-[14px] transition active:scale-90 ${
                m
                  ? leader
                    ? 'brand-gradient font-bold text-white shadow-cta'
                    : 'bg-brand/15 font-semibold text-accent ring-1 ring-[var(--brand)]/40'
                  : past
                    ? 'text-hint/50'
                    : ''
              } ${day === today ? 'outline outline-2 outline-offset-1 outline-[var(--brand)]' : ''}`}
            >
              <span>{i + 1}</span>
              {m && (
                <span className="text-[9px] font-semibold leading-none">
                  {leader ? `${leader.firstName[0]}${leader.lastName?.[0] ?? ''}` : '•'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12px] text-hint">{t.meetings.calendarHint}</p>
      <PersonPicker
        open={selected !== null}
        title={
          selected
            ? `${t.meetings.assignLeader} · ${f.dayMonth(selected.startsAt)}`
            : t.meetings.assignLeader
        }
        people={people.data}
        value={selected?.leader?.id ?? null}
        onClose={() => setSelected(null)}
        onPick={(id) => void assign(id)}
      />
    </Card>
  );
}
