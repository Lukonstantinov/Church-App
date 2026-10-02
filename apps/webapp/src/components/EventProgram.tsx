import { useState } from 'react';
import {
  displayName,
  type EventDetail,
  type EventProgramItem,
  type MeetingPerson,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { useMembers, useSetProgram } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconPlus, IconX } from './icons';
import { PersonPicker } from './PersonPicker';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { ActionRow, Button, Section, TimeField } from './ui';

/** The programme grouped by day (a single day shows no heading). */
export function ProgramList({ items, days }: { items: EventProgramItem[]; days?: boolean }) {
  const t = useT();
  const byDay = new Map<number, EventProgramItem[]>();
  for (const i of items) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  const multi = days ?? byDay.size > 1;
  return (
    <div>
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          {multi && (
            <div className="bg-hairline/50 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-hint">
              {t.events.programDay(day + 1)}
            </div>
          )}
          {list.map((i) => (
            <div
              key={i.id}
              className="flex gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
            >
              <span className="w-[52px] shrink-0 pt-0.5 text-[15px] font-bold tabular-nums text-accent">
                {i.time}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-snug">{i.title}</span>
                {i.person && (
                  <span className="block text-[13px] text-hint">{displayName(i.person)}</span>
                )}
                {i.note && (
                  <span className="block text-[13px] leading-snug text-hint">{i.note}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Draft {
  key: string;
  day: number;
  time: string;
  title: string;
  userId: number | null;
  note: string;
}

/** The programme on the event page; managers edit it in place. */
export function ProgramBlock({ e }: { e: EventDetail }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  if (e.program.length === 0 && !e.canManage) return null;
  return (
    <Section title={t.events.program}>
      {e.program.length === 0 ? (
        <p className="px-4 py-4 text-[15px] text-hint">{t.events.programEmpty}</p>
      ) : (
        <ProgramList items={e.program} />
      )}
      {e.canManage && (
        <ActionRow icon={<IconPlus size={20} />} onClick={() => setEditing(true)}>
          {e.program.length === 0 ? t.events.programAdd : t.events.programEdit}
        </ActionRow>
      )}
      {editing && <ProgramEditor e={e} onClose={() => setEditing(false)} />}
    </Section>
  );
}

function ProgramEditor({ e, onClose }: { e: EventDetail; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const members = useMembers(e.groupId);
  const save = useSetProgram(e.id);
  const [items, setItems] = useState<Draft[]>(() =>
    e.program.map((i) => ({
      key: String(i.id),
      day: i.day,
      time: i.time,
      title: i.title,
      userId: i.person?.id ?? null,
      note: i.note ?? '',
    })),
  );
  const [pick, setPick] = useState<string | null>(null);
  const people: MeetingPerson[] = (members.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({
      id: m.userId,
      firstName: m.firstName,
      lastName: m.lastName,
      username: m.username,
    }));
  const nameOf = (id: number | null) => {
    const p = people.find((x) => x.id === id) ?? e.program.find((i) => i.person?.id === id)?.person;
    return p ? displayName(p) : null;
  };
  const edit = (key: string, patch: Partial<Draft>) =>
    setItems((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = () =>
    setItems((l) => [
      ...l,
      {
        key: `n${Date.now()}${l.length}`,
        day: l.at(-1)?.day ?? 0,
        time: l.at(-1)?.time ?? '18:00',
        title: '',
        userId: null,
        note: '',
      },
    ]);

  async function submit() {
    try {
      await save.mutateAsync({
        items: items
          .filter((i) => i.title.trim())
          .map((i) => ({
            day: i.day,
            time: i.time,
            title: i.title.trim(),
            userId: i.userId,
            note: i.note.trim() || null,
          })),
      });
      haptic.success();
      onClose();
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  const field =
    'w-full rounded-xl bg-hairline px-3 py-2 text-[15px] outline-none placeholder:text-hint';
  return (
    <>
      <Sheet open={pick === null} onClose={onClose} title={t.events.program}>
        <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto px-4 pb-4">
          {items.map((i) => (
            <div key={i.key} className="rounded-2xl bg-hairline/50 p-2.5">
              <div className="flex items-center gap-2">
                <TimeField label="" value={i.time} onChange={(time) => edit(i.key, { time })} />
                <button
                  type="button"
                  aria-label="remove"
                  onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-hint active:bg-hairline"
                >
                  <IconX size={18} />
                </button>
              </div>
              <div className="flex flex-col gap-2 px-1 pb-1">
                <input
                  value={i.title}
                  maxLength={80}
                  placeholder={t.events.programTitle}
                  onChange={(ev) => edit(i.key, { title: ev.target.value })}
                  className={field}
                />
                <button
                  type="button"
                  onClick={() => setPick(i.key)}
                  className={`${field} text-left ${i.userId ? '' : 'text-hint'}`}
                >
                  {nameOf(i.userId) ?? t.events.programNoLeader}
                </button>
                <input
                  value={i.note}
                  maxLength={200}
                  placeholder={t.events.programNote}
                  onChange={(ev) => edit(i.key, { note: ev.target.value })}
                  className={field}
                />
                {e.endsAt && (
                  <div className="flex items-center gap-2 text-[13px] text-hint">
                    {t.events.programDay(i.day + 1)}
                    <button
                      type="button"
                      onClick={() => edit(i.key, { day: Math.max(0, i.day - 1) })}
                      className="px-2 text-[18px]"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => edit(i.key, { day: Math.min(13, i.day + 1) })}
                      className="px-2 text-[18px]"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <Button variant="glass" onClick={add}>
            <IconPlus size={18} /> {t.events.programAdd}
          </Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>
            {t.common.save}
          </Button>
        </div>
      </Sheet>
      <PersonPicker
        open={pick !== null}
        title={t.events.programLeader}
        people={people}
        value={items.find((x) => x.key === pick)?.userId ?? null}
        onClose={() => setPick(null)}
        onPick={(id) => {
          if (pick) edit(pick, { userId: id });
          setPick(null);
        }}
      />
    </>
  );
}
