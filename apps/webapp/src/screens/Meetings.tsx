import { useState } from 'react';
import type { GroupSummary, MeetingRow } from '@church/shared';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconCalendar, IconClock, IconPlus, IconRepeat, IconX } from '../components/icons';
import { Sheet, SheetOption } from '../components/Sheet';
import { useToast } from '../components/Toast';
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
import { usePast, useUpcoming, useUpdateMeeting } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { canRollNow } from './Overview';

type View = 'upcoming' | 'past';

export function Meetings({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
  const t = useT();
  const [view, setView] = useState<View>('upcoming');
  const [limit, setLimit] = useState(20);
  const [sheetFor, setSheetFor] = useState<MeetingRow | null>(null);

  const upcoming = useUpcoming(active.id);
  const past = usePast(active.id, limit, view === 'past');
  const list = view === 'upcoming' ? upcoming : past;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} subtitle={t.nav.meetings} />

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

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { key: 'upcoming', label: t.meetings.upcoming },
          { key: 'past', label: t.meetings.past },
        ]}
      />

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
        <MeetingList
          meetings={list.data ?? []}
          past={view === 'past'}
          onOpen={(m) =>
            view === 'past' && m.status !== 'cancelled'
              ? push({ name: 'roll', meetingId: m.id })
              : setSheetFor(m)
          }
        />
      )}

      {view === 'past' && (past.data?.length ?? 0) >= limit && (
        <Button variant="glass" onClick={() => setLimit((n) => n + 20)}>
          {t.meetings.showMore}
        </Button>
      )}

      <MeetingSheet meeting={sheetFor} onClose={() => setSheetFor(null)} />
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
        </div>
      </div>
      <div className="flex w-[112px] shrink-0 flex-col items-end gap-1 whitespace-nowrap">
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

/** Actions for a meeting that isn't ready for (or doesn't need) a roll call. */
function MeetingSheet({ meeting, onClose }: { meeting: MeetingRow | null; onClose: () => void }) {
  const { push } = useNav();
  const t = useT();
  const f = useFmt();
  const update = useUpdateMeeting();
  const toast = useToast();
  if (!meeting) return null;
  const cancelled = meeting.status === 'cancelled';
  const rollable = canRollNow(meeting);

  async function setStatus(status: 'scheduled' | 'cancelled') {
    if (status === 'cancelled' && !(await confirmDialog(t.meetings.cancelConfirm))) return;
    try {
      await update.mutateAsync({ id: meeting!.id, status });
      haptic.success();
      toast(status === 'cancelled' ? t.meetings.cancelledToast : t.meetings.restoredToast);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={meeting.title}>
      <p className="px-5 pb-2 text-[14px] text-hint">
        {f.relativeDay(meeting.startsAt)} · {f.timeRange(meeting.startsAt, meeting.endsAt)}
      </p>
      {!cancelled && (
        <SheetOption
          icon={<IconCalendar size={20} />}
          label={t.meetings.openRoll}
          hint={rollable ? undefined : t.meetings.opensHourBefore}
          disabled={!rollable}
          onClick={() => {
            onClose();
            push({ name: 'roll', meetingId: meeting.id });
          }}
        />
      )}
      {cancelled ? (
        <SheetOption
          icon={<IconRepeat size={20} />}
          label={t.meetings.restore}
          onClick={() => void setStatus('scheduled')}
        />
      ) : (
        <SheetOption
          tone="destructive"
          icon={<IconX size={20} />}
          label={t.meetings.cancelMeeting}
          hint={t.meetings.cancelHint}
          onClick={() => void setStatus('cancelled')}
        />
      )}
      <SheetOption label={t.common.close} onClick={onClose} />
    </Sheet>
  );
}
