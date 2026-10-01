import { useState } from 'react';
import { displayName, type GroupSummary, type MeetingRow } from '@church/shared';
import { GroupCalendar, calendarOnHome, setCalendarOnHome } from '../components/GroupCalendar';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconCalendar, IconClock, IconPlus, IconRepeat } from '../components/icons';
import {
  Badge,
  Button,
  Card,
  DateBadge,
  EmptyState,
  ProgressBar,
  Screen,
  Segmented,
  Skeleton,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useEvents, usePast, useUpcoming } from '../lib/queries';
import { canRollNow } from './Overview';
import { storage } from '../lib/storage';
import { useEnv } from '../lib/env';
import { EventCard } from '../components/EventCard';

type View = 'upcoming' | 'past';
type Kind = 'meetings' | 'events';
const KIND_KEY = 'church.calendarKind';

export function Meetings({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
  const { can } = useEnv();
  const t = useT();
  const [view, setView] = useState<View>('upcoming');
  const [kind, setKindState] = useState<Kind>(() =>
    storage.get(KIND_KEY) === 'events' ? 'events' : 'meetings',
  );
  const setKind = (k: Kind) => {
    setKindState(k);
    storage.set(KIND_KEY, k);
  };
  const [limit, setLimit] = useState(20);

  const upcoming = useUpcoming(active.id);
  const past = usePast(active.id, limit, view === 'past');
  const list = view === 'upcoming' ? upcoming : past;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} subtitle={t.nav.meetings} />

      <KindSwitch kind={kind} onChange={setKind} />

      {kind === 'meetings' ? (
        <>
          {can('meetings.manage') && (
            <div className="flex gap-2">
              <Button
                small
                variant="glass"
                onClick={() => push({ name: 'schedule', groupId: active.id })}
              >
                <IconRepeat size={16} /> {t.meetings.schedule}
              </Button>
              <Button
                small
                variant="glass"
                onClick={() => push({ name: 'newMeeting', groupId: active.id })}
              >
                <IconPlus size={16} /> {t.meetings.newShort}
              </Button>
            </div>
          )}

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { key: 'upcoming', label: t.meetings.upcoming },
              { key: 'past', label: t.meetings.past },
            ]}
          />

          {view === 'upcoming' && <CalendarSection g={active} />}

          {list.isPending ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[76px] w-full" />
              ))}
            </div>
          ) : (list.data ?? []).length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconCalendar size={26} />}
                title={view === 'upcoming' ? t.meetings.noUpcoming : t.meetings.noPast}
                action={
                  view === 'upcoming' ? (
                    <Button onClick={() => push({ name: 'schedule', groupId: active.id })}>
                      {t.overview.setupSchedule}
                    </Button>
                  ) : undefined
                }
              >
                {view === 'upcoming' ? t.meetings.noUpcomingText : t.meetings.noPastText}
              </EmptyState>
            </Card>
          ) : (
            <>
              <MeetingList
                meetings={list.data ?? []}
                past={view === 'past'}
                onOpen={(m) => push({ name: 'meeting', meetingId: m.id })}
              />
            </>
          )}

          {view === 'past' && (past.data?.length ?? 0) >= limit && (
            <Button variant="glass" onClick={() => setLimit((n) => n + 20)}>
              {t.meetings.showMore}
            </Button>
          )}
        </>
      ) : (
        <>
          {can('events.manage') && (
            <Button onClick={() => push({ name: 'eventForm', groupId: active.id })}>
              <IconPlus size={18} /> {t.events.new}
            </Button>
          )}
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { key: 'upcoming', label: t.meetings.upcoming },
              { key: 'past', label: t.meetings.past },
            ]}
          />
          <EventsPanel groupId={active.id} view={view} />
        </>
      )}
    </Screen>
  );
}

function MeetingList({
  meetings,
  past,
  onOpen,
}: {
  meetings: MeetingRow[];
  past: boolean;
  onOpen: (m: MeetingRow) => void;
}) {
  const f = useFmt();
  const groups: { month: string; items: MeetingRow[] }[] = [];
  for (const m of meetings) {
    const month = f.monthYear(m.startsAt);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(m);
    else groups.push({ month, items: [m] });
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.month}>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {g.month}
          </h2>
          <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
            {g.items.map((m) => (
              <MeetingRowView key={m.id} m={m} past={past} onClick={() => onOpen(m)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MeetingRowView({
  m,
  past,
  onClick,
}: {
  m: MeetingRow;
  past: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const cancelled = m.status === 'cancelled';
  const attended = m.counts.present + m.counts.late;
  const total = attended + m.counts.absent;
  const needsRoll = past && m.status === 'scheduled';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-hairline px-3 py-2.5 text-left last:border-b-0 active:bg-hairline ${
        cancelled ? 'opacity-60' : ''
      }`}
    >
      <DateBadge {...f.dateBadge(m.startsAt)} muted={past || cancelled} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[16px] font-semibold ${cancelled ? 'line-through' : ''}`}>
          {m.title}
        </div>
        <div className="truncate text-[13px] text-hint">
          {!past && `${f.relativeDay(m.startsAt)} · `}
          {f.timeRange(m.startsAt, m.endsAt)}
          {m.location ? ` · ${m.location}` : ''}
        </div>
        {(m.leader || m.topic || m.kind || m.audience) && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {m.leader && (
              <span className="brand-gradient shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold text-white">
                🎤 {displayName(m.leader)}
              </span>
            )}
            {m.topic && <span className="truncate text-[13px] italic text-hint">{m.topic}</span>}
            {m.audience && (
              <span className="shrink-0 rounded-full bg-hairline px-2 py-0.5 text-[12px] font-semibold text-hint">
                🔒 {m.audience.length}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        className={`flex shrink-0 flex-col items-end gap-1 whitespace-nowrap ${m.status === 'done' ? 'w-[96px]' : ''}`}
      >
        {cancelled ? (
          <Badge tone="hint">{t.meetings.cancelled}</Badge>
        ) : m.status === 'done' ? (
          <>
            <span className="text-[14px] font-bold tabular-nums">
              {attended} <span className="font-normal text-hint">/ {total}</span>
            </span>
            <div className="w-full">
              <ProgressBar value={attended} max={total} />
            </div>
          </>
        ) : needsRoll ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-late/15 px-2 py-0.5 text-[12px] font-semibold text-late">
            <IconClock size={12} /> {t.meetings.notMarked}
          </span>
        ) : canRollNow(m) ? (
          <Badge>{t.meetings.rollOpen}</Badge>
        ) : null}
      </div>
    </button>
  );
}

/** Big two-way switch at the top of the tab: regular meetings or one-off events. */
function KindSwitch({ kind, onChange }: { kind: Kind; onChange: (k: Kind) => void }) {
  const t = useT();
  const item = (k: Kind, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === k}
      onClick={() => onChange(k)}
      className={`flex-1 pb-2 text-[20px] font-bold tracking-tight transition-colors ${
        kind === k
          ? 'border-b-[3px] border-[var(--brand)] text-text'
          : 'border-b-[3px] border-transparent text-hint'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-4 px-1" role="tablist">
      {item('meetings', t.events.tabMeetings)}
      {item('events', t.events.tabEvents)}
    </div>
  );
}

function EventsPanel({ groupId, view }: { groupId: number; view: View }) {
  const t = useT();
  const { push } = useNav();
  const q = useEvents(groupId, view);
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  const list = q.data ?? [];
  if (list.length === 0)
    return (
      <Card>
        <EmptyState
          icon={<IconCalendar size={26} />}
          title={view === 'upcoming' ? t.events.noUpcoming : t.events.noPast}
        >
          {view === 'upcoming' ? t.events.noUpcomingText : undefined}
        </EmptyState>
      </Card>
    );
  return (
    <div className="flex flex-col gap-3">
      {list.map((e) => (
        <EventCard key={e.id} e={e} onClick={() => push({ name: 'event', eventId: e.id })} />
      ))}
    </div>
  );
}

/** The ministry calendar, with the person's choice to keep it on the ministry's home. */
function CalendarSection({ g }: { g: GroupSummary }) {
  const t = useT();
  const [onHome, setOnHome] = useState(() => calendarOnHome(g.id));
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2 px-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.meetings.calendarTitle}
        </h2>
        <button
          type="button"
          onClick={() => {
            setCalendarOnHome(g.id, !onHome);
            setOnHome(!onHome);
          }}
          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            onHome ? 'bg-brand/15 text-accent' : 'bg-hairline text-hint'
          }`}
        >
          {onHome ? '✓ ' : ''}
          {t.meetings.showCalendarHome}
        </button>
      </div>
      <GroupCalendar key={g.id} g={g} />
    </section>
  );
}
