import { useState } from 'react';
import {
  MEETING_KINDS,
  displayName,
  type MeetingDetail,
  type MeetingKind,
  type MeetingPerson,
  type UpdateMeetingInput,
} from '@church/shared';
import { Avatar } from '../components/Avatar';
import { AudiencePicker } from '../components/AudiencePicker';
import { IconCalendar, IconClock, IconMapPin, IconPlus, IconUsers } from '../components/icons';
import { Pill } from '../components/LookControls';
import { useMoney } from '../components/money';
import { NotifySheet } from '../components/NotifySheet';
import { PersonPicker } from '../components/PersonPicker';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  DateBadge,
  ErrorState,
  HeroCard,
  Loading,
  ProgressBar,
  Screen,
  Section,
  TextArea,
  TextField,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useMeeting, useMeetingPeople, useUpdateMeeting } from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';
import { canRollNow } from './Overview';

export const KIND_EMOJI: Record<MeetingKind, string> = {
  prayer: '🙏',
  worship: '🎶',
  outside: '🌳',
  guest: '🎤',
  prophetic: '🔥',
};

/** Topic, place and leader under a meeting's title on a coloured hero card. */
export function MeetingHeroLines({
  meeting,
}: {
  meeting: Pick<MeetingDetail, 'topic' | 'location' | 'leader' | 'kind'>;
}) {
  const t = useT();
  if (!meeting.topic && !meeting.location && !meeting.leader && !meeting.kind) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-[14px]">
      {meeting.topic && <div className="text-[16px] font-semibold">«{meeting.topic}»</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        {meeting.leader && (
          <span className="rounded-full bg-white px-2.5 py-1 text-[13px] font-bold text-[var(--brand)]">
            🎤 {displayName(meeting.leader)}
          </span>
        )}
        {meeting.kind && (
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[13px] font-semibold">
            {KIND_EMOJI[meeting.kind]} {t.meetings.kinds[meeting.kind]}
          </span>
        )}
        {meeting.location && (
          <span className="inline-flex items-center gap-1 text-white/90">
            <IconMapPin size={14} /> {meeting.location}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One meeting. Everyone sees when, where, the topic, the type and who leads. People
 * who take the roll see attendance; people who see the money see the snack budget and
 * expenses. Managers change everything; the meeting's leader fills in place, topic,
 * type and who buys snacks.
 */
export function MeetingScreen({ meetingId }: { meetingId: number }) {
  const q = useMeeting(meetingId);
  if (q.isPending) return <Loading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return <MeetingView key={q.data.id} m={q.data} />;
}

function MeetingView({ m }: { m: MeetingDetail }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { push } = useNav();
  const update = useUpdateMeeting();
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<'leader' | 'snack' | null>(null);
  const [notify, setNotify] = useState<{
    role: 'leader' | 'snack';
    person: MeetingPerson | null;
  } | null>(null);
  const people = useMeetingPeople(m.id, m.canEdit && (editing || picker !== null));
  const cancelled = m.status === 'cancelled';
  const budget = m.budgetCents ?? m.defaultBudgetCents;
  const spent = (m.expenses ?? []).reduce((a, e) => a + e.amountCents, 0);

  async function save(input: UpdateMeetingInput) {
    try {
      await update.mutateAsync({ id: m.id, ...input });
      haptic.success();
      toast(t.common.saved);
      return true;
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
      return false;
    }
  }

  return (
    <Screen>
      <HeroCard>
        <div className="mb-3 flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-wider text-white/80">
          <span className="truncate">{m.groupName}</span>
          {m.kind && (
            <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 normal-case tracking-normal">
              {KIND_EMOJI[m.kind]} {t.meetings.kinds[m.kind]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3.5">
          <DateBadge {...f.dateBadge(m.startsAt)} onBrand />
          <div className="min-w-0">
            <div
              className={`text-[22px] font-bold leading-tight ${cancelled ? 'line-through' : ''}`}
            >
              {m.title}
            </div>
            <div className="text-[15px] text-white/85">
              {f.relativeDay(m.startsAt)} · {f.timeRange(m.startsAt, m.endsAt)}
            </div>
          </div>
        </div>
        {m.topic && <div className="mt-3 text-[17px] font-semibold">«{m.topic}»</div>}
        {m.audience && (
          <div className="mt-2 inline-flex rounded-full bg-white/20 px-2.5 py-1 text-[13px] font-semibold">
            🔒 {t.meetings.chosenCount(m.audience.length)}
          </div>
        )}
        {m.location && (
          <div className="mt-2 flex items-center gap-1.5 text-[15px] text-white/90">
            <IconMapPin size={16} /> {m.location}
          </div>
        )}
      </HeroCard>

      <LeaderCard
        person={m.leader}
        canAssign={m.canManage}
        onAssign={() => setPicker('leader')}
        notifiedAt={m.leaderNotifiedAt}
        onNotify={m.canManage ? () => setNotify({ role: 'leader', person: m.leader }) : undefined}
      />

      {m.canEdit && !m.canManage && !m.topic && !m.location && (
        <Card className="p-4 text-[14px]">{t.meetings.youLead}</Card>
      )}

      {m.notes && !editing && (
        <Section title={t.meetings.notes}>
          <p className="whitespace-pre-line px-4 py-3 text-[15px]">{m.notes}</p>
        </Section>
      )}

      {m.canEdit &&
        (editing ? (
          <EditForm
            m={m}
            saving={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              if (await save(input)) setEditing(false);
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t.meetings.edit}
          </Button>
        ))}

      {(m.canEdit || m.expenses) && (
        <Section title={t.meetings.snackPerson}>
          <button
            type="button"
            disabled={!m.canEdit}
            onClick={() => setPicker('snack')}
            className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-hairline disabled:active:bg-transparent"
          >
            {m.snackPerson ? (
              <Avatar
                id={m.snackPerson.id}
                firstName={m.snackPerson.firstName}
                lastName={m.snackPerson.lastName}
                size={36}
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-[18px]">
                🍕
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium">
                {m.snackPerson ? displayName(m.snackPerson) : t.meetings.snackNone}
              </span>
              <span className="block text-[13px] text-hint">
                {t.meetings.budget}: {money(budget)}
              </span>
            </span>
            {m.canEdit && (
              <span className="text-[14px] font-semibold text-link">{t.common.edit}</span>
            )}
          </button>
          {m.snackPerson && m.canEdit && (
            <div className="border-t border-hairline px-4 py-2.5">
              <NotifyRow
                notifiedAt={m.snackNotifiedAt}
                onNotify={() => setNotify({ role: 'snack', person: m.snackPerson })}
              />
            </div>
          )}
          {m.expenses && (
            <div className="border-t border-hairline px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[14px]">
                <span className="font-semibold">{t.meetings.expenses}</span>
                <span className={spent > budget ? 'font-semibold text-absent' : 'text-hint'}>
                  {t.meetings.spentOf(money(spent), money(budget))}
                </span>
              </div>
              <ProgressBar value={Math.min(spent, budget)} max={budget || 1} />
              {m.expenses.map((e) => (
                <div
                  key={e.id}
                  className="mt-2 flex items-center justify-between gap-2 text-[14px]"
                >
                  <span className="min-w-0 truncate">
                    {e.note || e.category || '—'}
                    {e.member && <span className="text-hint"> · {displayName(e.member)}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-absent">
                    −{money(e.amountCents)}
                  </span>
                </div>
              ))}
              <div className="mt-3">
                <Button
                  small
                  variant="glass"
                  onClick={() =>
                    push({
                      name: 'newTransaction',
                      groupId: m.groupId,
                      kind: 'expense',
                      meetingId: m.id,
                    })
                  }
                >
                  <IconPlus size={16} /> {t.meetings.addExpense}
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}

      {m.attendance && (
        <Section
          title={t.meetings.attendance}
          action={
            !cancelled && canRollNow(m) ? (
              <button
                type="button"
                onClick={() => push({ name: 'roll', meetingId: m.id })}
                className="text-[14px] font-semibold text-link"
              >
                {t.meetings.openRoll}
              </button>
            ) : undefined
          }
        >
          {m.attendance.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-[14px] text-hint">
              <IconClock size={16} /> {t.meetings.noRollYet}
            </p>
          ) : (
            (['present', 'absent'] as const).map((k) => {
              const list = m.attendance!.filter((a) => a.present === (k === 'present'));
              if (list.length === 0) return null;
              return (
                <div key={k} className="border-b border-hairline px-4 py-3 last:border-b-0">
                  <div
                    className={`mb-2 text-[13px] font-semibold ${k === 'present' ? 'text-present' : 'text-absent'}`}
                  >
                    {k === 'present' ? t.meetings.wasThere : t.meetings.wasNotThere} · {list.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((a) => (
                      <span
                        key={a.userId}
                        className="rounded-full bg-hairline px-2.5 py-1 text-[13px]"
                      >
                        {displayName(a)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </Section>
      )}

      {m.canManage && (
        <Button
          variant={cancelled ? 'secondary' : 'destructive'}
          disabled={update.isPending || m.status === 'done'}
          onClick={async () => {
            if (!cancelled && !(await confirmDialog(t.meetings.cancelConfirm))) return;
            await save({ status: cancelled ? 'scheduled' : 'cancelled' });
          }}
        >
          {cancelled ? t.meetings.restore : t.meetings.cancelMeeting}
        </Button>
      )}

      <PersonPicker
        open={picker !== null}
        title={picker === 'leader' ? t.meetings.assignLeader : t.meetings.snackPerson}
        people={people.data}
        value={picker === 'leader' ? (m.leader?.id ?? null) : (m.snackPerson?.id ?? null)}
        onClose={() => setPicker(null)}
        onPick={(id) => {
          const role = picker;
          // Choosing someone doesn't message them; then offer notes and "send".
          void save(role === 'leader' ? { leaderUserId: id } : { snackUserId: id }).then(
            (ok) =>
              ok &&
              id &&
              role &&
              setNotify({ role, person: people.data?.find((p) => p.id === id) ?? null }),
          );
        }}
      />
      {notify && (
        <NotifySheet
          meetingId={m.id}
          role={notify.role}
          person={notify.person}
          notes={m.notes}
          onClose={() => setNotify(null)}
        />
      )}
    </Screen>
  );
}

/** The meeting's leader, in the theme colour so it stands out; tap to write to them. */
function LeaderCard({
  person,
  canAssign,
  onAssign,
  notifiedAt,
  onNotify,
}: {
  person: MeetingPerson | null;
  canAssign: boolean;
  onAssign: () => void;
  notifiedAt: string | null;
  onNotify?: () => void;
}) {
  const t = useT();
  if (!person && !canAssign) return null;
  return (
    <div className="brand-gradient flex flex-col gap-3 rounded-[var(--radius-card)] p-4 text-white shadow-cta">
      <div className="flex items-center gap-3">
        {person ? (
          <Avatar
            id={person.id}
            firstName={person.firstName}
            lastName={person.lastName}
            size={44}
          />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
            <IconUsers size={22} />
          </span>
        )}
        <button
          type="button"
          disabled={!person?.username}
          onClick={() => person?.username && openTelegramLink(`https://t.me/${person.username}`)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block text-[12px] font-bold uppercase tracking-wider text-white/80">
            {t.meetings.leader}
          </span>
          <span className="block truncate text-[19px] font-bold">
            {person ? displayName(person) : t.meetings.noLeader}
          </span>
        </button>
        {canAssign && (
          <button
            type="button"
            onClick={onAssign}
            className="shrink-0 rounded-full bg-white/22 px-3.5 py-2 text-[14px] font-semibold active:scale-95"
          >
            {person ? t.common.edit : t.meetings.assignLeader}
          </button>
        )}
      </div>
      {person && onNotify && <NotifyRow notifiedAt={notifiedAt} onNotify={onNotify} onBrand />}
    </div>
  );
}

/** "Message sent" state and the button to send (again). */
function NotifyRow({
  notifiedAt,
  onNotify,
  onBrand,
}: {
  notifiedAt: string | null;
  onNotify: () => void;
  onBrand?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[13px] ${onBrand ? 'text-white/85' : 'text-hint'}`}>
        {notifiedAt
          ? `✓ ${t.meetings.messageSent} · ${f.dayMonth(notifiedAt)} ${f.time(notifiedAt)}`
          : t.meetings.notSentYet}
      </span>
      <button
        type="button"
        onClick={onNotify}
        className={`shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold active:scale-95 ${
          onBrand ? 'bg-white text-[var(--brand)]' : 'brand-gradient text-white'
        }`}
      >
        📨 {notifiedAt ? t.meetings.sendAgain : t.meetings.sendMessage}
      </button>
    </div>
  );
}

function EditForm({
  m,
  saving,
  onSave,
  onCancel,
}: {
  m: MeetingDetail;
  saving: boolean;
  onSave: (input: UpdateMeetingInput) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const [title, setTitle] = useState(m.title);
  const [date, setDate] = useState(f.dateInput(m.startsAt));
  const [time, setTime] = useState(f.timeInput(m.startsAt));
  const [duration, setDuration] = useState(
    String(Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000)),
  );
  const [location, setLocation] = useState(m.location ?? '');
  const [topic, setTopic] = useState(m.topic ?? '');
  const [kind, setKind] = useState<MeetingKind | null>(m.kind);
  const [notes, setNotes] = useState(m.notes ?? '');
  const [audience, setAudience] = useState<number[] | null>(m.audience);
  const [budget, setBudget] = useState(((m.budgetCents ?? m.defaultBudgetCents) / 100).toFixed(2));

  function submit() {
    const input: UpdateMeetingInput = {
      location: location.trim() || null,
      topic: topic.trim() || null,
      kind,
      notes: notes.trim() || null,
    };
    if (m.canManage) {
      input.title = title.trim() || m.title;
      if (date !== f.dateInput(m.startsAt)) input.date = date;
      if (time !== f.timeInput(m.startsAt)) input.startTime = time;
      const d = Number(duration);
      if (Number.isFinite(d) && d >= 15 && d <= 600) input.durationMin = Math.round(d);
      const cents = Math.round(Number(budget.replace(',', '.')) * 100);
      if (Number.isFinite(cents) && cents >= 0 && cents !== (m.budgetCents ?? m.defaultBudgetCents))
        input.budgetCents = cents;
      if (JSON.stringify(audience) !== JSON.stringify(m.audience))
        input.audience = audience?.length ? audience : null;
    }
    onSave(input);
  }

  const input =
    'w-full rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint';
  return (
    <Card className="flex flex-col gap-4 p-4">
      {m.canManage && (
        <>
          <TextField label={t.events.name} value={title} onChange={setTitle} maxLength={64} />
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 flex flex-col gap-1 sm:col-span-1">
              <span className="text-[13px] text-hint">{t.meetings.date}</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={input}
              />
            </label>
            <label className="col-span-3 flex flex-col gap-1 sm:col-span-1">
              <span className="text-[13px] text-hint">{t.meetings.start}</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={input}
              />
            </label>
            <label className="col-span-3 flex flex-col gap-1 sm:col-span-1">
              <span className="text-[13px] text-hint">{t.meetings.duration}</span>
              <input
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
                className={input}
              />
            </label>
          </div>
        </>
      )}
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[13px] text-hint">
          <IconMapPin size={14} /> {t.meetings.place}
        </span>
        <input
          value={location}
          maxLength={120}
          onChange={(e) => setLocation(e.target.value)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] text-hint">{t.meetings.topic}</span>
        <input
          value={topic}
          maxLength={200}
          onChange={(e) => setTopic(e.target.value)}
          className={input}
        />
      </label>
      <div>
        <div className="mb-2 text-[13px] text-hint">{t.meetings.kind}</div>
        <div className="flex flex-wrap gap-2">
          <Pill on={kind === null} onClick={() => setKind(null)} label={t.meetings.kindNone} />
          {MEETING_KINDS.map((k) => (
            <Pill
              key={k}
              on={kind === k}
              onClick={() => setKind(k)}
              label={`${KIND_EMOJI[k]} ${t.meetings.kinds[k]}`}
            />
          ))}
        </div>
      </div>
      {m.canManage && (
        <label className="flex items-center gap-3">
          <span className="flex-1 text-[15px]">{t.meetings.budget}</span>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-24 rounded-lg bg-hairline px-2 py-1.5 text-right text-[16px] tabular-nums outline-none"
          />
          <span className="text-hint">{money.symbol}</span>
        </label>
      )}
      {m.canManage && (
        <div>
          <div className="mb-2 text-[13px] text-hint">{t.meetings.audience}</div>
          <AudiencePicker groupId={m.groupId} value={audience} onChange={setAudience} />
        </div>
      )}
      <div>
        <div className="mb-1 text-[13px] text-hint">{t.meetings.notes}</div>
        <TextArea value={notes} onChange={setNotes} maxLength={500} rows={3} />
      </div>
      <div className="flex gap-2">
        <Button variant="glass" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button disabled={saving} onClick={submit}>
          <IconCalendar size={18} /> {saving ? t.common.saving : t.common.save}
        </Button>
      </div>
    </Card>
  );
}
