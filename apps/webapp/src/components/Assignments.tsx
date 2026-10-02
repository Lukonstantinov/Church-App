import { useState, type ReactNode } from 'react';
import { displayName, type AssignmentRow, type GroupSummary } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useAnswerMeeting, useAssignments, useGroups } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import type { HomeAction } from './HomeSections';
import { IconCheck, IconChat, IconFood, IconMapPin, IconTasks, IconX } from './icons';
import { LookTop } from './LookTop';
import { useMoney } from './money';
import { useToast } from './Toast';

/** A job is a task while the person hasn't agreed, or (the leader) something is still empty. */
const needsAttention = (a: AssignmentRow) => !a.acceptedAt || a.missing.length > 0;

/**
 * The person's open tasks folded into one icon: a "Tasks" shortcut with a red counter.
 * Tap it and the cards unfold below; fold them and it is the icon again. Finished jobs
 * (agreed, everything filled in) are not tasks any more; they stay in the calendar.
 * `action` goes into the home shortcut row, `panel` below it.
 */
export function useTasks(groupId?: number) {
  const t = useT();
  const q = useAssignments();
  const [open, setOpen] = useState(false);
  const list = (q.data ?? []).filter(
    (a) => needsAttention(a) && (groupId === undefined || a.groupId === groupId),
  );
  const toggle = () => setOpen((v) => !v);
  const action: HomeAction | null =
    list.length === 0
      ? null
      : {
          key: 'tasks',
          icon: <IconTasks size={18} />,
          label: t.meetings.tasks,
          onClick: toggle,
          badge: (
            <span className="breathe min-w-[22px] rounded-full bg-[#ef4444] px-1.5 text-center text-[12px] font-bold leading-[22px] text-white ring-2 ring-white/90">
              {list.length > 99 ? '99+' : list.length}
            </span>
          ),
        };
  const panel =
    open && list.length > 0 ? (
      <section className="flex flex-col gap-2.5">
        <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.meetings.myJobs}
        </h2>
        {list.map((a) => (
          <AssignmentCard
            key={`${a.meetingId}:${a.role}`}
            a={a}
            showGroup={groupId === undefined}
          />
        ))}
        <button
          type="button"
          onClick={toggle}
          className="self-center rounded-full bg-hairline px-3 py-1 text-[13px] font-semibold"
        >
          {t.overview.collapse}
        </button>
      </section>
    ) : null;
  return { action, panel };
}

/** The same folded tasks for screens without a shortcut row (the main page): a small pill. */
export function TasksPill() {
  const { action, panel } = useTasks();
  if (!action) return null;
  return (
    <>
      <div>
        <button
          type="button"
          onClick={action.onClick}
          className="glass relative inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-[14px] font-semibold shadow-card active:scale-95"
        >
          <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-full text-white">
            {action.icon}
          </span>
          {action.label}
          {action.badge && <span className="ml-0.5">{action.badge}</span>}
        </button>
      </div>
      {panel}
    </>
  );
}

function AssignmentCard({ a, showGroup }: { a: AssignmentRow; showGroup: boolean }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { push } = useNav();
  const answer = useAnswerMeeting();
  const groups = useGroups();
  const look: GroupSummary | null = groups.data?.find((g) => g.id === a.groupId) ?? null;
  const open = () => push({ name: 'task', meetingId: a.meetingId });
  const leader = a.role === 'leader';

  async function reply(agree: boolean) {
    if (!agree && !(await confirmDialog(t.meetings.cantAsk))) return;
    try {
      await answer.mutateAsync({ id: a.meetingId, role: a.role, agree });
      haptic.success();
      toast(agree ? t.meetings.confirmed : t.meetings.declinedToast);
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
      <button type="button" onClick={open} className="block w-full text-left">
        <LookTop look={look} className="p-3.5">
          <span className="flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-wider opacity-85">
            <span>{leader ? t.meetings.youLeadShort : t.meetings.youSnackShort}</span>
            {a.kind && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 normal-case tracking-normal">
                {t.meetings.kinds[a.kind]}
              </span>
            )}
          </span>
          <span className="mt-1 block text-[19px] font-bold leading-tight">{a.title}</span>
          <span className="block text-[14px] opacity-90">
            {f.weekdayDayMonth(a.startsAt)} · {f.timeRange(a.startsAt, a.endsAt)}
            {showGroup ? ` · ${a.groupName}` : ''}
          </span>
        </LookTop>
      </button>
      <div className="flex flex-col gap-2.5 p-3.5">
        {leader ? (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-hint">
              {a.missing.length > 0 ? t.meetings.toFill : t.meetings.allFilled}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[13px]">
              <Chip
                ok={!a.missing.includes('location')}
                label={a.location ?? t.meetings.needLocation}
                icon={<IconMapPin size={14} />}
              />
              <Chip
                ok={!a.missing.includes('topic')}
                label={a.topic ? `«${a.topic}»` : t.meetings.needTopic}
                icon={<IconChat size={14} />}
              />
              <Chip
                ok={!a.missing.includes('snack')}
                label={a.snackPerson ? displayName(a.snackPerson) : t.meetings.needSnack}
                icon={<IconFood size={14} />}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[14px]">
            <IconFood size={16} className="text-hint" /> {t.meetings.budget}:{' '}
            <b>{money(a.budgetCents)}</b>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {a.acceptedAt ? (
            <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-present">
              <IconCheck size={16} /> {t.meetings.confirmed}
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => void reply(true)}
                className="brand-gradient inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[14px] font-semibold text-white active:scale-95 disabled:opacity-60"
              >
                <IconCheck size={16} /> {t.meetings.agreeBtn}
              </button>
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => void reply(false)}
                className="inline-flex items-center gap-1 rounded-full bg-hairline px-3.5 py-2 text-[14px] font-semibold active:scale-95 disabled:opacity-60"
              >
                <IconX size={16} /> {t.meetings.cantBtn}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={open}
            className="ml-auto rounded-full bg-hairline px-3.5 py-2 text-[14px] font-semibold text-link active:scale-95"
          >
            {leader && a.missing.length > 0 ? t.meetings.fillIn : t.meetings.openIt}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ ok, label, icon }: { ok: boolean; label: string; icon: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 ${
        ok ? 'bg-present/15 text-present' : 'bg-hairline text-hint ring-1 ring-dashed ring-hint/40'
      }`}
    >
      {ok ? <IconCheck size={14} /> : icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
