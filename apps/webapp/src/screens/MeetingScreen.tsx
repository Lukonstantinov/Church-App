import { useState } from 'react';
import {
  MEETING_KINDS,
  displayName,
  type MeetingDetail,
  type MeetingKind,
  type MeetingNotice,
  type MeetingPerson,
  type MeetingRsvpStatus,
  type UpdateMeetingInput,
} from '@church/shared';
import { GroupTheme } from '../components/GroupTheme';
import { LiveNow, SoonPulse, SoonTimer } from '../components/Live';
import { SpeakerStrip } from '../components/Speakers';
import { AudiencePicker } from '../components/AudiencePicker';
import { IconCalendar, IconClock, IconMapPin, IconPlus, IconSend } from '../components/icons';
import { Pill } from '../components/LookControls';
import { useMoney } from '../components/money';
import { NotifySheet } from '../components/NotifySheet';
import { MeetingAnnounceSheet } from '../components/MeetingAnnounceSheet';
import { MeetingPeople } from '../components/MeetingPeople';
import { TeamChips, meetingLook } from '../components/TeamChips';
import { useCoverLook } from '../components/CoverDesigner';
import {
  MeetingPosterDesigner,
  initMeetingPoster,
  meetingPosterPayload,
} from '../components/MeetingPosterDesigner';
import { PersonPicker } from '../components/PersonPicker';
import { Sheet } from '../components/Sheet';
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
  Toggle,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { isLiveWindow, useNowSecond } from '../lib/live';
import { useNav } from '../lib/nav';
import {
  useAnswerMeeting,
  useGroup,
  useMeeting,
  useMeetingPeople,
  useMeetingRsvp,
  useDeleteMeeting,
  useUpdateMeeting,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { canRollNow } from './Overview';

/** Topic, place and leader under a meeting's title on a coloured hero card. */
export function MeetingHeroLines({
  meeting,
}: {
  meeting: Pick<MeetingDetail, 'topic' | 'location' | 'leader' | 'kind'> &
    Partial<Pick<MeetingDetail, 'snackPerson' | 'helpers' | 'peopleLook'>>;
}) {
  const t = useT();
  if (!meeting.topic && !meeting.location && !meeting.leader && !meeting.kind) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-[14px]">
      {meeting.topic && <div className="text-[16px] font-semibold">«{meeting.topic}»</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <TeamChips m={meeting} />
        {meeting.kind && (
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[13px] font-semibold">
            {t.meetings.kinds[meeting.kind]}
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
  return (
    <GroupTheme groupId={q.data.groupId}>
      <MeetingView key={q.data.id} m={q.data} />
    </GroupTheme>
  );
}

export function MeetingView({ m }: { m: MeetingDetail }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { push } = useNav();
  const update = useUpdateMeeting();
  // The assigned leader lands straight in the form while the place or topic is missing.
  const [editing, setEditing] = useState(
    m.canEdit &&
      !m.canManage &&
      m.status === 'scheduled' &&
      (!m.topic || !m.location || !m.snackPerson),
  );
  const group = useGroup(m.groupId);
  const [picker, setPicker] = useState<'leader' | 'snack' | null>(null);
  const [notify, setNotify] = useState<{
    role: 'leader' | 'snack';
    person: MeetingPerson | null;
  } | null>(null);
  // The message window: about the meeting, its new time, or its cancellation.
  const [sheet, setSheet] = useState<{ notice: MeetingNotice; previous?: string } | null>(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const people = useMeetingPeople(m.id, m.canEdit && (editing || picker !== null));
  const cancelled = m.status === 'cancelled';
  useNowSecond();
  const live = !cancelled && isLiveWindow(m.startsAt, m.endsAt);
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
      <SoonPulse startsAt={m.startsAt} cancelled={cancelled} motion={m.motion}>
        <HeroCard living={cancelled ? 'off' : m.motion} live={live} look={meetingLook(m)}>
          <div className="mb-3 flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-wider text-white/80">
            <span className="truncate">{m.groupName}</span>
            <span className="flex shrink-0 items-center gap-1.5 normal-case tracking-normal">
              <LiveNow startsAt={m.startsAt} endsAt={m.endsAt} cancelled={cancelled} />
              <SoonTimer startsAt={m.startsAt} cancelled={cancelled} compact />
              {m.seriesId && (
                <span className="rounded-full bg-white/20 px-2.5 py-1">
                  🔁 {t.meetings.seriesBadge}
                </span>
              )}
              {m.kind && (
                <span className="rounded-full bg-white/20 px-2.5 py-1">
                  {t.meetings.kinds[m.kind]}
                </span>
              )}
            </span>
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
              {t.meetings.chosenCount(m.audience.length)}
            </div>
          )}
          {m.location && (
            <div className="mt-2 flex items-center gap-1.5 text-[15px] text-white/90">
              <IconMapPin size={16} /> {m.location}
            </div>
          )}
          {m.speakers.length > 0 && (
            <SpeakerStrip speakers={m.speakers} size="md" onColor className="mt-4" />
          )}
          {m.canDesign && (
            <button
              type="button"
              onClick={() => setPosterOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/22 px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur active:scale-95"
            >
              🎨 {t.meetings.editPoster}
            </button>
          )}
        </HeroCard>
      </SoonPulse>
      {posterOpen && <PosterSheet m={m} onClose={() => setPosterOpen(false)} />}

      {m.myRole && !m.myAcceptedAt && !cancelled && <AnswerCard meetingId={m.id} role={m.myRole} />}

      <MeetingPeople
        m={m}
        onAssign={setPicker}
        onNotify={(role, person) => setNotify({ role, person })}
      />

      {m.canManage && !cancelled && (
        <Button onClick={() => setSheet({ notice: 'announce' })}>
          <IconSend size={17} />{' '}
          {m.announcedAt ? t.meetings.announceAgain : t.meetings.announceMeeting}
        </Button>
      )}
      {m.canManage && cancelled && (
        <Button variant="secondary" onClick={() => setSheet({ notice: 'cancelled' })}>
          <IconSend size={17} /> {t.meetings.noticeCancelled}
        </Button>
      )}

      {(m.rsvp.asked || m.rsvp.going.length > 0 || m.rsvp.notGoing.length > 0) && (
        <RsvpCard m={m} />
      )}

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
              const moved = input.date !== undefined || input.startTime !== undefined;
              const before = m.startsAt;
              if (await save(input)) {
                setEditing(false);
                // A new time: offer to tell people right away.
                if (moved && m.canManage && !cancelled)
                  setSheet({ notice: 'changed', previous: before });
              }
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t.meetings.edit}
          </Button>
        ))}

      {m.expenses && (
        <Section title={t.meetings.snackPerson}>
          {m.expenses && (
            <div className="px-4 py-3">
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
            !cancelled && canRollNow(m) ? (
              // The meeting has begun or is over: mark who was there right here.
              <div className="p-3">
                <Button onClick={() => push({ name: 'roll', meetingId: m.id })}>
                  ✅ {t.meetings.rollHere}
                </Button>
              </div>
            ) : (
              <p className="flex items-center gap-2 px-4 py-3 text-[14px] text-hint">
                <IconClock size={16} /> {t.meetings.noRollYet}
              </p>
            )
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
            const ok = await save({ status: cancelled ? 'scheduled' : 'cancelled' });
            // Cancelled: offer to tell people.
            if (ok && !cancelled) setSheet({ notice: 'cancelled' });
          }}
        >
          {cancelled ? t.meetings.restore : t.meetings.cancelMeeting}
        </Button>
      )}
      {m.canManage && <DeleteForever meetingId={m.id} />}

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
          meeting={m}
          group={group.data}
          role={notify.role}
          person={notify.person}
          onClose={() => setNotify(null)}
        />
      )}
      {sheet && (
        <MeetingAnnounceSheet
          key={sheet.notice}
          meeting={m}
          group={group.data}
          notice={sheet.notice}
          previousStartsAt={sheet.previous}
          onClose={() => setSheet(null)}
        />
      )}
    </Screen>
  );
}

/**
 * The only way a meeting disappears: deleted for good after two confirmations. Past
 * meetings otherwise stay for the calendar, roll call and statistics.
 */
function DeleteForever({ meetingId }: { meetingId: number }) {
  const t = useT();
  const toast = useToast();
  const { back } = useNav();
  const remove = useDeleteMeeting();
  return (
    <button
      type="button"
      disabled={remove.isPending}
      onClick={async () => {
        if (!(await confirmDialog(t.meetings.deleteForeverConfirm))) return;
        if (!(await confirmDialog(t.meetings.deleteForeverAgain))) return;
        try {
          await remove.mutateAsync(meetingId);
          haptic.success();
          toast(t.meetings.deletedForever);
          back();
        } catch {
          toast(t.common.actionFailed, 'error');
        }
      }}
      className="mx-auto py-2 text-[14px] font-semibold text-absent active:opacity-60"
    >
      🗑 {t.meetings.deleteForever}
    </button>
  );
}

/** Shown to the person who was given a job on this meeting until they answer. */
function AnswerCard({ meetingId, role }: { meetingId: number; role: 'leader' | 'snack' }) {
  const t = useT();
  const toast = useToast();
  const answer = useAnswerMeeting();
  const { back } = useNav();
  async function reply(agree: boolean) {
    if (!agree && !(await confirmDialog(t.meetings.cantAsk))) return;
    try {
      await answer.mutateAsync({ id: meetingId, role, agree });
      haptic.success();
      toast(agree ? t.meetings.confirmed : t.meetings.declinedToast);
      if (!agree) back();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-[14px]">{t.meetings.answerHint}</p>
      <div className="flex gap-2">
        <Button small disabled={answer.isPending} onClick={() => void reply(true)}>
          {t.meetings.agreeBtn}
        </Button>
        <Button small variant="glass" disabled={answer.isPending} onClick={() => void reply(false)}>
          {t.meetings.cantBtn}
        </Button>
      </div>
    </Card>
  );
}

/** The meeting's leader, in the theme colour so it stands out; tap to write to them. */
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
  const group = useGroup(m.groupId);
  const [designing, setDesigning] = useState(false);
  const [poster, setPoster] = useState(() => initMeetingPoster(m));
  const { templateId } = useCoverLook(poster.cover, group.data);
  const [toSeries, setToSeries] = useState(false);

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
      if (designing) Object.assign(input, meetingPosterPayload(poster, templateId));
      if (m.seriesId && toSeries) input.applyToSeries = true;
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
            <Pill key={k} on={kind === k} onClick={() => setKind(k)} label={t.meetings.kinds[k]} />
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
      {m.canManage && (
        <Toggle label={t.meetings.posterTitle} checked={designing} onChange={setDesigning} />
      )}
      {m.canManage && designing && (
        <MeetingPosterDesigner
          g={group.data}
          groupId={m.groupId}
          meeting={{
            ...m,
            title: title || m.title,
            topic: topic || null,
            location: location || null,
            kind,
          }}
          state={poster}
          onChange={setPoster}
        />
      )}
      {m.canManage && m.seriesId && (
        <Toggle label={t.meetings.applyToSeries} checked={toSeries} onChange={setToSeries} />
      )}
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

/** "Will you come?": the viewer answers; managers see who is coming and who can't. */
function RsvpCard({ m }: { m: MeetingDetail }) {
  const t = useT();
  const toast = useToast();
  const answer = useMeetingRsvp(m.id);
  const reply = async (status: MeetingRsvpStatus) => {
    try {
      await answer.mutateAsync(status);
      haptic.success();
      toast(status === 'going' ? t.bot.rsvpThanksYes : t.bot.rsvpThanksNo);
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  };
  const names = (list: MeetingPerson[]) => list.map((p) => displayName(p)).join(', ');
  return (
    <Section title={t.meetings.rsvpTitle}>
      <div className="flex flex-col gap-3 px-4 py-3">
        {m.status !== 'cancelled' && (
          <div className="flex gap-2">
            {(['going', 'not_going'] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={answer.isPending}
                onClick={() => void reply(s)}
                className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-semibold transition active:scale-[0.98] ${
                  m.rsvp.mine === s
                    ? s === 'going'
                      ? 'bg-present text-white'
                      : 'bg-absent text-white'
                    : 'bg-hairline'
                }`}
              >
                {s === 'going' ? `✅ ${t.meetings.rsvpGoingBtn}` : `❌ ${t.meetings.rsvpNoBtn}`}
              </button>
            ))}
          </div>
        )}
        {m.canManage &&
          (m.rsvp.going.length + m.rsvp.notGoing.length === 0 ? (
            <p className="text-[14px] text-hint">{t.meetings.rsvpNobody}</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-[14px]">
              <div>
                <b className="text-present">
                  {t.meetings.rsvpGoing} · {m.rsvp.going.length}
                </b>
                {m.rsvp.going.length > 0 && <span> — {names(m.rsvp.going)}</span>}
              </div>
              <div>
                <b className="text-absent">
                  {t.meetings.rsvpNotGoing} · {m.rsvp.notGoing.length}
                </b>
                {m.rsvp.notGoing.length > 0 && <span> — {names(m.rsvp.notGoing)}</span>}
              </div>
            </div>
          ))}
      </div>
    </Section>
  );
}

/** The meeting's poster, designed and saved on its own (look, layout, fonts, speakers). */
function PosterSheet({ m, onClose }: { m: MeetingDetail; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const group = useGroup(m.groupId);
  const update = useUpdateMeeting();
  const [poster, setPoster] = useState(() => initMeetingPoster(m));
  const { templateId } = useCoverLook(poster.cover, group.data);
  const [toSeries, setToSeries] = useState(false);
  async function save() {
    try {
      await update.mutateAsync({
        id: m.id,
        ...meetingPosterPayload(poster, templateId),
        ...(toSeries ? { applyToSeries: true } : {}),
      });
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }
  return (
    <Sheet open onClose={onClose} title={`🎨 ${t.meetings.editPoster}`}>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <MeetingPosterDesigner
          g={group.data}
          groupId={m.groupId}
          meeting={m}
          state={poster}
          onChange={setPoster}
        />
        {m.seriesId && (
          <Toggle label={t.meetings.applyToSeries} checked={toSeries} onChange={setToSeries} />
        )}
        <Button disabled={update.isPending} onClick={() => void save()}>
          {t.common.save}
        </Button>
      </div>
    </Sheet>
  );
}
