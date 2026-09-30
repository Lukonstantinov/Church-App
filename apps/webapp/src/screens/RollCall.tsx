import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  displayName,
  type AttendanceStatus,
  type RollEntry,
  type RollResponse,
} from '@church/shared';
import { Avatar } from '../components/Avatar';
import {
  IconCheck,
  IconInfo,
  IconMinus,
  IconMore,
  IconPlus,
  IconSearch,
  IconUsers,
} from '../components/icons';
import { Sheet, SheetOption } from '../components/Sheet';
import { STATUS_LABEL, StatusChip, StatusDot, StatusIcon } from '../components/Status';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  ProgressBar,
  Segmented,
} from '../components/ui';
import { timeRange, weekdayDayMonth } from '../lib/format';
import { useNav } from '../lib/nav';
import { useMe, useRoll, useSaveRoll, useUpdateMeeting } from '../lib/queries';
import { ApiError } from '../lib/api';
import { confirmDialog, haptic } from '../lib/telegram';

type Marks = Record<number, AttendanceStatus | null>;

const OPTIONS: AttendanceStatus[] = ['present', 'late', 'excused', 'absent'];
const OPTION_HINT: Record<AttendanceStatus, string> = {
  present: 'Пришёл вовремя',
  late: 'Пришёл, но позже начала',
  excused: 'Не пришёл по уважительной причине — не влияет на процент',
  absent: 'Не пришёл',
};

/** Loads the roll; the editor below then owns all local edits. */
export function RollCall({ meetingId }: { meetingId: number }) {
  const roll = useRoll(meetingId);
  if (roll.isPending) return <Loading />;
  if (roll.isError || !roll.data) return <ErrorState onRetry={() => void roll.refetch()} />;
  return <RollEditor meetingId={meetingId} data={roll.data} reload={() => void roll.refetch()} />;
}

function RollEditor({
  meetingId,
  data,
  reload,
}: {
  meetingId: number;
  data: RollResponse;
  reload: () => void;
}) {
  const nav = useNav();
  const me = useMe();
  const toast = useToast();
  const save = useSaveRoll(meetingId);
  const update = useUpdateMeeting();
  const tz = me.data?.church.timezone ?? 'Europe/Riga';

  // Snapshot of what the server has, to tell whether there is anything unsaved.
  const [initial] = useState(() => ({
    marks: Object.fromEntries(data.roster.map((r) => [r.userId, r.status])) as Marks,
    guests: data.meeting.guestCount,
  }));
  const [marks, setMarks] = useState<Marks>(initial.marks);
  const [guests, setGuests] = useState(initial.guests);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo'>('all');
  const [menuFor, setMenuFor] = useState<RollEntry | null>(null);

  const dirty = useMemo(() => {
    return (
      guests !== initial.guests || Object.keys(marks).some((k) => marks[+k] !== initial.marks[+k])
    );
  }, [marks, guests, initial]);

  // Ask before throwing away unsaved marks (Telegram's Back button goes through this).
  const { setBackGuard } = nav;
  useEffect(() => {
    setBackGuard(dirty ? () => confirmDialog('Выйти без сохранения отметок?') : null);
    return () => setBackGuard(null);
  }, [dirty, setBackGuard]);

  const roster = data.roster;
  const setMark = useMemo(
    () => (id: number, status: AttendanceStatus | null) =>
      setMarks((m) => ({ ...m, [id]: status })),
    [],
  );

  const { meeting, editable, editableUntil } = data;
  const cancelled = meeting.status === 'cancelled';
  const total = roster.length;
  const marked = roster.filter((r) => marks[r.userId]).length;
  const attended = roster.filter(
    (r) => marks[r.userId] === 'present' || marks[r.userId] === 'late',
  ).length;
  const unmarked = total - marked;
  const interactive = editable && !cancelled;

  const q = query.trim().toLowerCase();
  const visible = roster.filter((r) => {
    if (filter === 'todo' && marks[r.userId]) return false;
    if (q && !displayName(r).toLowerCase().includes(q)) return false;
    return true;
  });

  function markAllPresent() {
    setMarks((m) => {
      const next = { ...m };
      for (const r of roster) if (!next[r.userId]) next[r.userId] = 'present';
      return next;
    });
    haptic.tap();
  }

  async function submit() {
    try {
      await save.mutateAsync({
        entries: roster.flatMap((r) =>
          marks[r.userId] ? [{ userId: r.userId, status: marks[r.userId]! }] : [],
        ),
        guestCount: guests,
      });
      haptic.success();
      toast(`Сохранено: пришли ${attended} из ${total}`);
      setBackGuard(null);
      nav.back();
    } catch (err) {
      haptic.error();
      const code = err instanceof ApiError ? err.code : '';
      toast(
        code === 'not_started'
          ? 'Перекличка откроется за час до начала'
          : code === 'edit_window_closed'
            ? 'Редактирование закрыто'
            : 'Не удалось сохранить. Попробуйте ещё раз',
        'error',
      );
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-40">
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="px-1">
          <h1 className="text-[24px] font-bold leading-tight">{meeting.title}</h1>
          <div className="text-[15px] text-hint">
            {weekdayDayMonth(meeting.startsAt, tz)} ·{' '}
            {timeRange(meeting.startsAt, meeting.endsAt, tz)}
          </div>
        </header>

        {cancelled && (
          <Card className="flex flex-col gap-3 p-4">
            <p className="text-[15px]">Эта встреча отменена, перекличка недоступна.</p>
            <Button
              variant="secondary"
              onClick={async () => {
                await update.mutateAsync({ id: meeting.id, status: 'scheduled' });
                haptic.success();
                reload();
              }}
            >
              Вернуть встречу
            </Button>
          </Card>
        )}

        {!editable && !cancelled && (
          <Card className="flex items-start gap-2 p-3 text-[14px] text-hint">
            <IconInfo size={18} className="mt-0.5 shrink-0" />
            <span>
              Редактирование закрыто: прошло больше 14 дней после встречи. Обратитесь к
              администратору.
            </span>
          </Card>
        )}
        {interactive && meeting.status === 'done' && editableUntil && (
          <p className="px-1 text-[13px] text-hint">
            Перекличка уже сохранена — можно исправить отметки.
          </p>
        )}

        {total > 0 && !cancelled && (
          <div className="flex flex-col gap-2 px-1">
            <div className="flex items-baseline justify-between text-[14px]">
              <span>
                Отмечено <b className="tabular-nums">{marked}</b> из {total}
              </span>
              <span className="text-hint">
                пришли <b className="tabular-nums text-present">{attended}</b>
              </span>
            </div>
            <ProgressBar value={marked} max={total} tone="accent" />
            {interactive && marked === 0 && (
              <p className="flex items-start gap-1.5 pt-1 text-[13px] leading-snug text-hint">
                <IconInfo size={15} className="mt-px shrink-0" />
                Нажмите на человека — «был». Удерживайте или нажмите ⋯ — другие статусы.
              </p>
            )}
            {interactive && marked > 0 && unmarked > 0 && (
              <p className="text-[13px] text-hint">
                Не отмеченные ({unmarked}) при сохранении запишутся как отсутствующие.
              </p>
            )}
          </div>
        )}

        {total === 0 && !cancelled && (
          <Card>
            <EmptyState icon={<IconUsers size={26} />} title="В группе пока нет участников">
              Добавьте участников или отправьте ссылку-приглашение на вкладке «Люди».
            </EmptyState>
          </Card>
        )}

        {total > 6 && !cancelled && (
          <div className="flex flex-col gap-2">
            <label className="flex min-h-[44px] items-center gap-2 rounded-xl bg-section px-3 shadow-card">
              <IconSearch size={18} className="text-hint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по имени"
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-hint"
                enterKeyHint="search"
              />
            </label>
            {interactive && (
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { key: 'all', label: `Все · ${total}` },
                  { key: 'todo', label: `Не отмечены · ${unmarked}` },
                ]}
              />
            )}
          </div>
        )}

        {total > 0 && !cancelled && (
          <div className="overflow-hidden rounded-2xl bg-section shadow-card">
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-[14px] text-hint">
                {filter === 'todo' && !q ? 'Все отмечены 🎉' : 'Никого не найдено'}
              </p>
            ) : (
              visible.map((r) => (
                <MemberLine
                  key={r.userId}
                  entry={r}
                  status={marks[r.userId] ?? null}
                  interactive={interactive}
                  onToggle={setMark}
                  onMenu={setMenuFor}
                />
              ))
            )}
          </div>
        )}

        {total > 0 && !cancelled && (
          <Card className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1 pl-1">
              <div className="text-[16px]">Гости</div>
              <div className="text-[13px] text-hint">Пришли не из списка группы</div>
            </div>
            <Stepper value={guests} onChange={setGuests} disabled={!interactive} />
          </Card>
        )}
      </div>

      {interactive && total > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-section/95 backdrop-blur-md"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-xl items-center gap-2 px-4 pt-3">
            <button
              type="button"
              disabled={unmarked === 0}
              onClick={markAllPresent}
              className="min-h-[48px] shrink-0 rounded-xl bg-button/12 px-4 text-[15px] font-medium text-accent active:opacity-70 disabled:opacity-40"
            >
              Все пришли
            </button>
            <div className="flex-1">
              <Button
                onClick={() => void submit()}
                disabled={save.isPending || (!dirty && meeting.status === 'done')}
              >
                {save.isPending ? 'Сохраняем…' : `Сохранить · ${attended} из ${total}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      <StatusSheet
        entry={menuFor}
        current={menuFor ? (marks[menuFor.userId] ?? null) : null}
        onPick={(s) => {
          if (menuFor) setMark(menuFor.userId, s);
          haptic.tap();
          setMenuFor(null);
        }}
        onClose={() => setMenuFor(null)}
      />
    </div>
  );
}

// ---------- one person ----------

const HOLD_MS = 420;

const MemberLine = memo(function MemberLine({
  entry,
  status,
  interactive,
  onToggle,
  onMenu,
}: {
  entry: RollEntry;
  status: AttendanceStatus | null;
  interactive: boolean;
  onToggle: (id: number, s: AttendanceStatus | null) => void;
  onMenu: (e: RollEntry) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const handlers = interactive
    ? {
        onPointerDown: () => {
          held.current = false;
          cancelHold();
          timer.current = setTimeout(() => {
            held.current = true;
            haptic.tap();
            onMenu(entry);
          }, HOLD_MS);
        },
        onPointerUp: cancelHold,
        onPointerLeave: cancelHold,
        onPointerCancel: cancelHold,
        onPointerMove: cancelHold, // scrolling, not holding
        onClick: () => {
          if (held.current) return;
          haptic.tap();
          onToggle(entry.userId, status === 'present' ? null : 'present');
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {};

  return (
    <div
      className={`flex items-center border-b border-hairline last:border-b-0 ${
        status === 'present' ? 'bg-present/[0.07]' : ''
      }`}
    >
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? status === 'present' : undefined}
        aria-label={`${displayName(entry)}: ${status ? STATUS_LABEL[status] : 'не отмечен'}`}
        className={`flex min-h-[60px] min-w-0 flex-1 select-none items-center gap-3 py-2 pl-3 ${
          interactive ? 'cursor-pointer active:bg-bg-secondary' : ''
        }`}
        style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
        {...handlers}
      >
        <Avatar id={entry.userId} firstName={entry.firstName} lastName={entry.lastName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px]">{displayName(entry)}</div>
          <div className="mt-0.5 flex items-center gap-1" aria-label="Последние встречи">
            {entry.recent.length === 0 || entry.recent.every((s) => s === null) ? (
              <span className="text-[12px] text-hint">
                {entry.offline ? 'без Telegram' : 'новый участник'}
              </span>
            ) : (
              entry.recent.map((s, i) => <StatusDot key={i} status={s} />)
            )}
          </div>
        </div>
        <StatusMark status={status} />
      </div>
      {interactive && (
        <button
          type="button"
          aria-label={`Другие статусы: ${displayName(entry)}`}
          onClick={() => onMenu(entry)}
          className="flex h-[60px] w-[48px] shrink-0 items-center justify-center text-hint active:bg-bg-secondary"
        >
          <IconMore />
        </button>
      )}
    </div>
  );
});

function StatusMark({ status }: { status: AttendanceStatus | null }) {
  if (status === 'present') {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-present text-white">
        <IconCheck size={18} strokeWidth={3} />
      </span>
    );
  }
  if (status) return <StatusChip status={status} />;
  return <span className="h-8 w-8 rounded-full border-2 border-hairline" />;
}

function StatusSheet({
  entry,
  current,
  onPick,
  onClose,
}: {
  entry: RollEntry | null;
  current: AttendanceStatus | null;
  onPick: (s: AttendanceStatus | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={entry !== null} onClose={onClose} title={entry ? displayName(entry) : ''}>
      {OPTIONS.map((s) => (
        <SheetOption
          key={s}
          icon={<StatusIcon status={s} />}
          label={STATUS_LABEL[s]}
          hint={OPTION_HINT[s]}
          selected={current === s}
          onClick={() => onPick(s)}
        />
      ))}
      <SheetOption
        label="Сбросить отметку"
        onClick={() => onPick(null)}
        disabled={current === null}
      />
    </Sheet>
  );
}

function Stepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full bg-hairline active:opacity-60 disabled:opacity-40';
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={btn}
        disabled={disabled || value === 0}
        onClick={() => onChange(value - 1)}
        aria-label="Меньше гостей"
      >
        <IconMinus size={18} />
      </button>
      <span className="w-9 text-center text-[19px] font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        aria-label="Больше гостей"
      >
        <IconPlus size={18} />
      </button>
    </div>
  );
}
