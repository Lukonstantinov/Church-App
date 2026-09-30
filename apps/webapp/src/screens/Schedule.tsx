import { useState } from 'react';
import type { ScheduleRow } from '@church/shared';
import { MeetingFields, WeekdayPicker, type MeetingFormValue } from '../components/MeetingForm';
import { IconRepeat, IconTrash } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorState, Loading, Screen, Title } from '../components/ui';
import { WEEKDAYS_EVERY, durationLabel } from '../lib/format';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

const DEFAULT: MeetingFormValue & { weekday: number } = {
  title: 'Молодёжная встреча',
  weekday: 4,
  startTime: '19:00',
  durationMin: 120,
};

function endTime(start: string, min: number): string {
  const [h, m] = start.split(':').map(Number) as [number, number];
  const t = (h * 60 + m + min) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function Schedule({ groupId }: { groupId: number }) {
  const schedules = useSchedules(groupId);
  const create = useCreateSchedule(groupId);
  const update = useUpdateSchedule();
  const remove = useDeleteSchedule();
  const toast = useToast();
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  const [form, setForm] = useState(DEFAULT);

  if (schedules.isPending) return <Loading />;
  if (schedules.isError) return <ErrorState onRetry={() => void schedules.refetch()} />;

  function open(target: ScheduleRow | 'new') {
    setForm(
      target === 'new'
        ? DEFAULT
        : {
            title: target.title,
            weekday: target.weekday,
            startTime: target.startTime,
            durationMin: target.durationMin,
          },
    );
    setEditing(target);
  }

  async function save() {
    if (!form.title.trim() || !form.startTime) return;
    try {
      if (editing === 'new') await create.mutateAsync(form);
      else if (editing) await update.mutateAsync({ id: editing.id, ...form });
      haptic.success();
      toast(editing === 'new' ? 'Расписание добавлено' : 'Сохранено');
      setEditing(null);
    } catch {
      toast('Не удалось сохранить', 'error');
    }
  }

  async function del() {
    if (!editing || editing === 'new') return;
    if (
      !(await confirmDialog(
        'Удалить это расписание? Будущие встречи по нему исчезнут, история сохранится.',
      ))
    )
      return;
    await remove.mutateAsync(editing.id);
    toast('Расписание удалено');
    setEditing(null);
  }

  const list = schedules.data;

  return (
    <Screen>
      <Title subtitle="Встречи создаются на 4 недели вперёд">Расписание</Title>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconRepeat size={26} />}
            title="Расписания нет"
            action={<Button onClick={() => open('new')}>Добавить</Button>}
          >
            Например: «Молодёжная встреча — каждую пятницу в 19:00».
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl bg-section shadow-card">
            {list.map((s) => (
              <div
                key={s.id}
                className={`flex items-center border-b border-hairline last:border-b-0 ${s.active ? '' : 'opacity-55'}`}
              >
                <button
                  type="button"
                  onClick={() => open(s)}
                  className="min-w-0 flex-1 px-4 py-3 text-left active:bg-bg-secondary"
                >
                  <div className="truncate text-[17px] font-medium">{s.title}</div>
                  <div className="text-[14px] text-hint">
                    {WEEKDAYS_EVERY[s.weekday]} · {s.startTime}–
                    {endTime(s.startTime, s.durationMin)} ({durationLabel(s.durationMin)})
                  </div>
                </button>
                <label className="flex h-[60px] w-[64px] shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--color-button)]"
                    checked={s.active}
                    aria-label={`Расписание «${s.title}» включено`}
                    onChange={(e) =>
                      void update.mutateAsync({ id: s.id, active: e.target.checked })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <Button onClick={() => open('new')}>+ Добавить расписание</Button>
        </>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Новое расписание' : 'Расписание'}
      >
        <div className="flex flex-col gap-4 px-4 pb-2 pt-1">
          <WeekdayPicker
            value={form.weekday}
            onChange={(weekday) => setForm({ ...form, weekday })}
          />
          <MeetingFields value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
          <Button
            onClick={() => void save()}
            disabled={!form.title.trim() || create.isPending || update.isPending}
          >
            Сохранить
          </Button>
          {editing && editing !== 'new' && (
            <button
              type="button"
              onClick={() => void del()}
              className="flex min-h-[44px] items-center justify-center gap-2 text-[16px] text-destructive"
            >
              <IconTrash size={18} /> Удалить расписание
            </button>
          )}
        </div>
      </Sheet>
    </Screen>
  );
}
