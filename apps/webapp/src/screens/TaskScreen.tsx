import { useState } from 'react';
import { MEETING_KINDS, displayName, type MeetingDetail, type MeetingKind } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { GroupTheme } from '../components/GroupTheme';
import { IconCheck, IconChat, IconFood, IconMapPin, IconSend } from '../components/icons';
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
  Screen,
  Section,
  TextField,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useAnswerMeeting,
  useGroup,
  useMeeting,
  useMeetingPeople,
  useUpdateMeeting,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { MeetingView } from './MeetingScreen';

/**
 * Opens a meeting for the person who was given a job on it (lead / snacks) as exactly
 * that: a short form with what they have to fill in, whatever their rights elsewhere.
 * Anyone without a job here (or an administrator who asks) gets the full meeting page.
 */
export function TaskScreen({ meetingId }: { meetingId: number }) {
  const q = useMeeting(meetingId);
  const [full, setFull] = useState(false);
  if (q.isPending) return <Loading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  // Wears the ministry's own look, even when opened from a bot link.
  return (
    <GroupTheme groupId={q.data.groupId}>
      {!q.data.myRole || full ? (
        <MeetingView key={q.data.id} m={q.data} />
      ) : (
        <TaskView
          key={q.data.id}
          m={q.data}
          onFull={q.data.canManage ? () => setFull(true) : undefined}
        />
      )}
    </GroupTheme>
  );
}

function TaskView({ m, onFull }: { m: MeetingDetail; onFull?: () => void }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { back } = useNav();
  const group = useGroup(m.groupId);
  const update = useUpdateMeeting();
  const answer = useAnswerMeeting();
  const leader = m.myRole === 'leader';
  const cancelled = m.status === 'cancelled';
  // The usual place is offered until the leader writes their own.
  const [location, setLocation] = useState(m.location ?? m.defaultLocation);
  const [topic, setTopic] = useState(m.topic ?? '');
  const [kind, setKind] = useState<MeetingKind | null>(m.kind);
  const [picker, setPicker] = useState(false);
  const [notify, setNotify] = useState(false);
  const people = useMeetingPeople(m.id, leader && picker);
  const budget = m.budgetCents ?? m.defaultBudgetCents;

  async function save(snackUserId?: number | null) {
    try {
      await update.mutateAsync({
        id: m.id,
        location: location.trim() || null,
        topic: topic.trim() || null,
        kind,
        ...(snackUserId !== undefined ? { snackUserId } : {}),
      });
      haptic.success();
      toast(t.common.saved);
      return true;
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
      return false;
    }
  }

  async function reply(agree: boolean) {
    if (!agree && !(await confirmDialog(t.meetings.cantAsk))) return;
    try {
      await answer.mutateAsync({ id: m.id, role: m.myRole!, agree });
      haptic.success();
      toast(agree ? t.meetings.confirmed : t.meetings.declinedToast);
      if (!agree) back();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Screen>
      <HeroCard>
        <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-white/80">
          {leader ? t.meetings.youLeadShort : t.meetings.youSnackShort} · {m.groupName}
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
      </HeroCard>

      <Card className="flex flex-col gap-3 p-4">
        {m.myAcceptedAt ? (
          <div className="flex items-center gap-1.5 text-[15px] font-semibold text-present">
            <IconCheck size={18} /> {t.meetings.confirmed}
          </div>
        ) : (
          <>
            <p className="text-[14px]">{t.meetings.answerHint}</p>
            <div className="flex gap-2">
              <Button small disabled={answer.isPending} onClick={() => void reply(true)}>
                {t.meetings.agreeBtn}
              </Button>
              <Button
                small
                variant="glass"
                disabled={answer.isPending}
                onClick={() => void reply(false)}
              >
                {t.meetings.cantBtn}
              </Button>
            </div>
          </>
        )}
      </Card>

      {m.notes && (
        <Section title={t.meetings.notes}>
          <p className="whitespace-pre-line px-4 py-3 text-[15px]">{m.notes}</p>
        </Section>
      )}

      {leader ? (
        <>
          <p className="px-3 text-[13px] text-hint">{t.meetings.taskLeaderLine}</p>
          <Section title={t.meetings.taskPlace}>
            <div className="flex flex-col gap-2 p-3">
              <TextField
                label={t.meetings.taskPlace}
                value={location}
                onChange={setLocation}
                maxLength={120}
              />
              {m.defaultLocation && location.trim() !== m.defaultLocation && (
                <div>
                  <Pill
                    on={false}
                    onClick={() => setLocation(m.defaultLocation)}
                    label={`${t.meetings.taskDefaultPlace}: ${m.defaultLocation}`}
                  />
                </div>
              )}
            </div>
          </Section>
          <Section title={t.meetings.taskTopic}>
            <div className="p-3">
              <TextField
                label={t.meetings.taskTopic}
                value={topic}
                onChange={setTopic}
                maxLength={120}
              />
            </div>
          </Section>
          <Section title={t.meetings.kind}>
            <div className="flex flex-wrap gap-2 p-3">
              <Pill on={kind === null} onClick={() => setKind(null)} label={t.meetings.kindNone} />
              {MEETING_KINDS.map((k) => (
                <Pill
                  key={k}
                  on={kind === k}
                  onClick={() => setKind(k)}
                  label={t.meetings.kinds[k]}
                />
              ))}
            </div>
          </Section>
          <Section title={t.meetings.taskSnack}>
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-hairline"
            >
              {m.snackPerson ? (
                <Avatar
                  id={m.snackPerson.id}
                  firstName={m.snackPerson.firstName}
                  lastName={m.snackPerson.lastName}
                  size={36}
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-hint">
                  <IconFood size={18} />
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
              <span className="text-[14px] font-semibold text-link">
                {m.snackPerson ? t.common.edit : t.meetings.taskPickSnack}
              </span>
            </button>
            {m.snackPerson && (
              <div className="border-t border-hairline px-4 py-2.5">
                <Button small variant="glass" onClick={() => setNotify(true)}>
                  <IconSend size={15} />{' '}
                  {m.snackNotifiedAt ? t.meetings.sendAgain : t.meetings.sendMessage}
                </Button>
              </div>
            )}
          </Section>
          <Button disabled={update.isPending || cancelled} onClick={() => void save()}>
            {t.meetings.taskSave}
          </Button>
        </>
      ) : (
        <Card className="flex flex-col gap-2 p-4 text-[15px]">
          <p>{t.meetings.taskSnackLine}</p>
          <p className="flex items-center gap-2">
            <IconFood size={16} className="text-hint" /> {t.meetings.budget}: <b>{money(budget)}</b>
          </p>
          {m.location && (
            <p className="flex items-center gap-2">
              <IconMapPin size={16} className="text-hint" /> {m.location}
            </p>
          )}
          {m.topic && (
            <p className="flex items-center gap-2">
              <IconChat size={16} className="text-hint" /> {m.topic}
            </p>
          )}
        </Card>
      )}

      {onFull && (
        <button
          type="button"
          onClick={onFull}
          className="self-center text-[13px] font-semibold text-hint"
        >
          {t.meetings.taskAdminView}
        </button>
      )}

      <PersonPicker
        open={picker}
        title={t.meetings.taskSnack}
        people={people.data}
        value={m.snackPerson?.id ?? null}
        onClose={() => setPicker(false)}
        onPick={(id) => {
          // Saves the place and topic too; then offers to message the chosen person.
          void save(id).then((ok) => ok && id && setNotify(true));
        }}
      />
      {notify && m.snackPerson && (
        <NotifySheet
          meeting={m}
          group={group.data}
          role="snack"
          person={m.snackPerson}
          onClose={() => setNotify(false)}
        />
      )}
    </Screen>
  );
}
