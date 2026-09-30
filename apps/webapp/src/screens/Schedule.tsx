import { useState } from 'react';
import type { ScheduleRow } from '@church/shared';
import { MeetingFields, WeekdayPicker, type MeetingFormValue } from '../components/MeetingForm';
import { IconRepeat, IconTrash } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  Switch,
  Title,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

function endTime(start: string, min: number): string {
  const [h, m] = start.split(':').map(Number) as [number, number];
  const t = (h * 60 + m + min) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function Schedule({ groupId }: { groupId: number }) {
  const t = useT();
  const f = useFmt();
  const schedules = useSchedules(groupId);
  const create = useCreateSchedule(groupId);
  const update = useUpdateSchedule();
  const remove = useDeleteSchedule();
  const toast = useToast();
  const defaults = {
    title: t.schedule.defaultTitle,
    weekday: 4,
    startTime: '19:00',
    durationMin: 120,
  };
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  const [form, setForm] = useState<MeetingFormValue & { weekday: number }>(defaults);

  if (schedules.isPending) return <Loading />;
  if (schedules.isError) return <ErrorState onRetry={() => void schedules.refetch()} />;

  function open(target: ScheduleRow | 'new') {
    setForm(
      target === 'new'
        ? defaults
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
      toast(editing === 'new' ? t.schedule.added : t.common.saved);
      setEditing(null);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  async function del() {
    if (!editing || editing === 'new') return;
    if (!(await confirmDialog(t.schedule.deleteConfirm))) return;
    await remove.mutateAsync(editing.id);
    toast(t.schedule.deleted);
    setEditing(null);
  }

  const list = schedules.data;

  return (
    <Screen>
      <Title subtitle={t.schedule.subtitle}>{t.schedule.title}</Title>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconRepeat size={26} />}
            title={t.schedule.emptyTitle}
            action={<Button onClick={() => open('new')}>{t.common.add}</Button>}
          >
            {t.schedule.emptyText}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
            {list.map((s) => (
              <div
                key={s.id}
                className={`flex items-center border-b border-hairline last:border-b-0 ${s.active ? '' : 'opacity-55'}`}
              >
                <button
                  type="button"
                  onClick={() => open(s)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-hairline"
                >
                  <span className="brand-gradient flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-cta">
                    <span className="text-[11px] font-bold uppercase leading-none">
                      {f.weekdaysShort[s.weekday]}
                    </span>
                    <span className="text-[12px] font-semibold tabular-nums leading-tight">
                      {s.startTime}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-semibold">{s.title}</span>
                    <span className="block text-[14px] text-hint">
                      {f.every(s.weekday)} · {s.startTime}–{endTime(s.startTime, s.durationMin)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.active}
                  aria-label={t.schedule.enabled(s.title)}
                  onClick={() => void update.mutateAsync({ id: s.id, active: !s.active })}
                  className="flex h-[64px] w-[74px] shrink-0 items-center justify-center"
                >
                  <Switch on={s.active} />
                </button>
              </div>
            ))}
          </div>
          <Button onClick={() => open('new')}>{t.schedule.addFull}</Button>
        </>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t.schedule.newTitle : t.schedule.title}
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
            {t.common.save}
          </Button>
          {editing && editing !== 'new' && (
            <button
              type="button"
              onClick={() => void del()}
              className="flex min-h-[44px] items-center justify-center gap-2 text-[16px] font-semibold text-destructive"
            >
              <IconTrash size={18} /> {t.schedule.deleteSchedule}
            </button>
          )}
        </div>
      </Sheet>
    </Screen>
  );
}
