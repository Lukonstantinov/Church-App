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
import { dateBadge, monthYear, relativeDay, timeRange } from '../lib/format';
import { useNav } from '../lib/nav';
import { useMe, usePast, useUpcoming, useUpdateMeeting } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { canRollNow } from './Overview';

type View = 'upcoming' | 'past';

export function Meetings({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
  const me = useMe();
  const tz = me.data?.church.timezone ?? 'Europe/Riga';
  const [view, setView] = useState<View>('upcoming');
  const [limit, setLimit] = useState(20);
  const [sheetFor, setSheetFor] = useState<MeetingRow | null>(null);

  const upcoming = useUpcoming(active.id);
  const past = usePast(active.id, limit, view === 'past');
  const list = view === 'upcoming' ? upcoming : past;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} />

      <div className="flex gap-2">
        <Button
          small
          variant="secondary"
          onClick={() => push({ name: 'schedule', groupId: active.id })}
        >
          <span className="inline-flex items-center gap-1.5">
            <IconRepeat size={16} /> Расписание
          </span>
        </Button>
        <Button
          small
          variant="secondary"
          onClick={() => push({ name: 'newMeeting', groupId: active.id })}
        >
          <span className="inline-flex items-center gap-1.5">
            <IconPlus size={16} /> Встреча
          </span>
        </Button>
      </div>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { key: 'upcoming', label: 'Предстоящие' },
          { key: 'past', label: 'Прошедшие' },
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
            title={view === 'upcoming' ? 'Нет предстоящих встреч' : 'Прошедших встреч пока нет'}
            action={
              view === 'upcoming' ? (
                <Button onClick={() => push({ name: 'schedule', groupId: active.id })}>
                  Настроить расписание
                </Button>
              ) : undefined
            }
          >
            {view === 'upcoming'
              ? 'Добавьте регулярное расписание или разовую встречу.'
              : 'Здесь появится история встреч.'}
          </EmptyState>
        </Card>
      ) : (
        <MeetingList
          meetings={list.data ?? []}
          tz={tz}
          past={view === 'past'}
          onOpen={(m) =>
            view === 'past' && m.status !== 'cancelled'
              ? push({ name: 'roll', meetingId: m.id })
              : setSheetFor(m)
          }
        />
      )}

      {view === 'past' && (past.data?.length ?? 0) >= limit && (
        <Button variant="secondary" onClick={() => setLimit((n) => n + 20)}>
          Показать ещё
        </Button>
      )}

      <MeetingSheet meeting={sheetFor} tz={tz} onClose={() => setSheetFor(null)} />
    </Screen>
  );
}

function MeetingList({
  meetings,
  tz,
  past,
  onOpen,
}: {
  meetings: MeetingRow[];
  tz: string;
  past: boolean;
  onOpen: (m: MeetingRow) => void;
}) {
  // Group by month with a small header, like a calendar agenda.
  const groups: { month: string; items: MeetingRow[] }[] = [];
  for (const m of meetings) {
    const month = monthYear(m.startsAt, tz);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(m);
    else groups.push({ month, items: [m] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.month}>
          <h2 className="mb-1.5 px-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {g.month}
          </h2>
          <div className="overflow-hidden rounded-2xl bg-section shadow-card">
            {g.items.map((m) => (
              <MeetingRowView key={m.id} m={m} tz={tz} past={past} onClick={() => onOpen(m)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MeetingRowView({
  m,
  tz,
  past,
  onClick,
}: {
  m: MeetingRow;
  tz: string;
  past: boolean;
  onClick: () => void;
}) {
  const b = dateBadge(m.startsAt, tz);
  const cancelled = m.status === 'cancelled';
  const attended = m.counts.present + m.counts.late;
  const total = attended + m.counts.absent;
  const needsRoll = past && m.status === 'scheduled';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-hairline px-3 py-2.5 text-left last:border-b-0 active:bg-bg-secondary ${
        cancelled ? 'opacity-60' : ''
      }`}
    >
      <DateBadge {...b} muted={past || cancelled} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[16px] font-medium ${cancelled ? 'line-through' : ''}`}>
          {m.title}
        </div>
        <div className="truncate text-[13px] text-hint">
          {!past && `${relativeDay(m.startsAt, tz)} · `}
          {timeRange(m.startsAt, m.endsAt, tz)}
        </div>
      </div>
      <div className="flex w-[108px] shrink-0 flex-col items-end gap-1 whitespace-nowrap">
        {cancelled ? (
          <Badge tone="hint">Отменена</Badge>
        ) : m.status === 'done' ? (
          <>
            <span className="text-[14px] font-semibold tabular-nums">
              {attended} <span className="font-normal text-hint">из {total}</span>
            </span>
            <div className="w-full">
              <ProgressBar value={attended} max={total} />
            </div>
          </>
        ) : needsRoll ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-late/15 px-2 py-0.5 text-[12px] font-medium text-late">
            <IconClock size={12} /> Не отмечена
          </span>
        ) : canRollNow(m) ? (
          <Badge>Идёт набор</Badge>
        ) : null}
      </div>
    </button>
  );
}

/** Actions for a meeting that isn't ready for (or doesn't need) a roll call. */
function MeetingSheet({
  meeting,
  tz,
  onClose,
}: {
  meeting: MeetingRow | null;
  tz: string;
  onClose: () => void;
}) {
  const { push } = useNav();
  const update = useUpdateMeeting();
  const toast = useToast();
  if (!meeting)
    return (
      <Sheet open={false} onClose={onClose}>
        {null}
      </Sheet>
    );
  const cancelled = meeting.status === 'cancelled';
  const rollable = canRollNow(meeting);

  async function setStatus(status: 'scheduled' | 'cancelled') {
    if (status === 'cancelled' && !(await confirmDialog('Отменить эту встречу?'))) return;
    try {
      await update.mutateAsync({ id: meeting!.id, status });
      haptic.success();
      toast(status === 'cancelled' ? 'Встреча отменена' : 'Встреча возвращена');
      onClose();
    } catch {
      toast('Не удалось сохранить', 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={meeting.title}>
      <p className="px-5 pb-2 text-[14px] text-hint">
        {relativeDay(meeting.startsAt, tz)} · {timeRange(meeting.startsAt, meeting.endsAt, tz)}
      </p>
      {!cancelled && (
        <SheetOption
          label="Открыть перекличку"
          hint={rollable ? undefined : 'Откроется за час до начала'}
          disabled={!rollable}
          onClick={() => {
            onClose();
            push({ name: 'roll', meetingId: meeting.id });
          }}
        />
      )}
      {cancelled ? (
        <SheetOption label="Вернуть встречу" onClick={() => void setStatus('scheduled')} />
      ) : (
        <SheetOption
          tone="destructive"
          icon={<IconX size={18} />}
          label="Отменить встречу"
          hint="Участники не увидят её в расписании"
          onClick={() => void setStatus('cancelled')}
        />
      )}
      <SheetOption label="Закрыть" onClick={onClose} />
    </Sheet>
  );
}
