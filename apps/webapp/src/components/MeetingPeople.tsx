import { useRef, useState, type ReactNode } from 'react';
import { displayName, type MeetingDetail, type MeetingPerson } from '@church/shared';
import { preparePhoto } from '../lib/image';
import { useT } from '../lib/i18n';
import {
  useMe,
  useMeetingHelpers,
  useMeetingPeople,
  usePersonPhoto,
  useUploadMedia,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';
import { initials } from './Avatar';
import { IconCamera, IconCheck, IconClock, IconPlus, IconTrash, IconX } from './icons';
import { Pill } from './LookControls';
import { PersonPicker } from './PersonPicker';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, TextField } from './ui';

export type PersonStatus = 'accepted' | 'declined' | 'waiting' | 'none';

/** The answer as a round mark: green ✓, red ✗, yellow clock while waiting. */
function StatusMark({ status }: { status: PersonStatus }) {
  const t = useT();
  if (status === 'none') return null;
  const look = {
    accepted: { bg: '#22c55e', icon: <IconCheck size={14} />, label: t.meetings.statusAccepted },
    declined: { bg: '#ef4444', icon: <IconX size={14} />, label: t.meetings.statusDeclined },
    waiting: { bg: '#f59e0b', icon: <IconClock size={13} />, label: t.meetings.statusWaiting },
  }[status];
  return (
    <span
      role="img"
      aria-label={look.label}
      title={look.label}
      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-card ring-2 ring-black/30"
      style={{ background: look.bg }}
    >
      {look.icon}
    </span>
  );
}

/** A small button in the right-hand column of a person card. */
export function CardAction({
  onClick,
  children,
  primary,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={`metal-action whitespace-nowrap rounded-xl px-2.5 py-1.5 text-[12px] font-semibold active:scale-95 ${
        primary ? 'text-[var(--brand)]' : 'text-white'
      }`}
      data-primary={primary ? 'true' : undefined}
    >
      {children}
    </button>
  );
}

/**
 * One person with a job at a meeting, on a dark card with metal edges: their photo on
 * the left (tap to add or change it, when allowed), name with the answer mark at the
 * top right, what they do at the bottom right, and compact buttons on the right.
 */
export function PersonCard({
  person,
  role,
  status,
  empty,
  onPhoto,
  actions,
}: {
  person: MeetingPerson | null;
  /** What they do here, e.g. "Leader", "Snacks", "Worship". */
  role: string;
  status: PersonStatus;
  /** Shown instead of the name when nobody is chosen. */
  empty?: string;
  /** Allowed to set the photo: called with the picked file. */
  onPhoto?: (file: File) => void;
  actions?: ReactNode;
}) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-stretch gap-2">
      <div className="metal-card flex min-w-0 flex-1 items-stretch overflow-hidden rounded-[18px]">
        <button
          type="button"
          disabled={!onPhoto || !person}
          aria-label={t.meetings.addPhoto}
          onClick={() => file.current?.click()}
          className="relative w-[76px] shrink-0 overflow-hidden bg-white/8"
        >
          {person?.photoUrl ? (
            <img
              src={person.photoUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : person ? (
            <span className="absolute inset-0 flex items-center justify-center text-[24px] font-bold text-white/80">
              {initials(person.firstName, person.lastName)}
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-white/40">
              <IconPlus size={24} />
            </span>
          )}
          {onPhoto && person && (
            <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
              <IconCamera size={13} />
            </span>
          )}
          <span aria-hidden="true" className="metal-divider absolute inset-y-0 right-0 w-px" />
        </button>
        {onPhoto && (
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhoto(f);
              e.target.value = '';
            }}
          />
        )}
        <button
          type="button"
          disabled={!person?.username}
          onClick={() => person?.username && openTelegramLink(`https://t.me/${person.username}`)}
          className="relative flex min-h-[76px] min-w-0 flex-1 flex-col justify-between px-3 py-2.5 pr-9 text-left text-white"
        >
          <span
            className={`line-clamp-2 text-[17px] font-bold leading-tight ${person ? '' : 'text-white/60'}`}
          >
            {person ? displayName(person) : empty}
          </span>
          <span className="metal-text self-end text-[10px] font-extrabold uppercase tracking-[0.14em]">
            {role}
          </span>
          <StatusMark status={status} />
        </button>
      </div>
      {actions && (
        <div className="flex w-[88px] shrink-0 flex-col justify-center gap-1.5">{actions}</div>
      )}
    </div>
  );
}

const statusOf = (p: {
  person: unknown;
  acceptedAt: string | null;
  notifiedAt: string | null;
  declined?: boolean;
}): PersonStatus =>
  p.declined
    ? 'declined'
    : !p.person
      ? 'none'
      : p.acceptedAt
        ? 'accepted'
        : p.notifiedAt
          ? 'waiting'
          : 'none';

const ROLE_IDEAS = ['🎸', '🙏', '🤝', '🎛', '📸'];

/**
 * Who serves at the meeting: the leader, the snack person and anyone else added (each
 * with their photo and answer), and a way to add more people.
 */
export function MeetingPeople({
  m,
  onAssign,
  onNotify,
}: {
  m: MeetingDetail;
  onAssign: (role: 'leader' | 'snack') => void;
  onNotify: (role: 'leader' | 'snack', person: MeetingPerson | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const myId = me.data?.user.id;
  const helpers = useMeetingHelpers(m.id);
  const photo = usePersonPhoto(m.id);
  const upload = useUploadMedia(m.groupId, 'event');
  const [adding, setAdding] = useState<{ userId: number | null; role: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const people = useMeetingPeople(m.id, m.canManage && (picking || adding !== null));

  const photoFor = (person: MeetingPerson | null) =>
    person && (m.canManage || person.id === myId)
      ? async (f: File) => {
          try {
            const media = await upload.mutateAsync(await preparePhoto(f, 600));
            await photo.mutateAsync({ userId: person.id, mediaId: media.id });
            haptic.success();
          } catch {
            toast(t.treasury.uploadFailed, 'error');
          }
        }
      : undefined;

  const leader = m.leader ?? m.leaderDeclined;
  const snack = m.snackPerson ?? m.snackDeclined;

  async function addHelper() {
    if (!adding?.userId || !adding.role.trim()) return;
    try {
      await helpers.add.mutateAsync({ userId: adding.userId, role: adding.role.trim() });
      haptic.success();
      toast(t.meetings.helperAdded);
      setAdding(null);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {(leader || m.canManage) && (
        <PersonCard
          person={leader}
          role={t.meetings.leader}
          empty={t.meetings.noLeader}
          status={statusOf({
            person: m.leader,
            acceptedAt: m.leaderAcceptedAt,
            notifiedAt: m.leaderNotifiedAt,
            declined: !m.leader && !!m.leaderDeclined,
          })}
          onPhoto={photoFor(leader)}
          actions={
            m.canManage ? (
              <>
                <CardAction onClick={() => onAssign('leader')}>
                  {m.leader ? t.common.edit : t.meetings.pickPerson}
                </CardAction>
                {m.leader && (
                  <CardAction primary onClick={() => onNotify('leader', m.leader)}>
                    {m.leaderNotifiedAt ? t.meetings.askAgain : t.meetings.ask}
                  </CardAction>
                )}
              </>
            ) : undefined
          }
        />
      )}
      {(snack || m.canEdit) && (
        <PersonCard
          person={snack}
          role={t.meetings.forFood}
          empty={t.meetings.snackNone}
          status={statusOf({
            person: m.snackPerson,
            acceptedAt: m.snackAcceptedAt,
            notifiedAt: m.snackNotifiedAt,
            declined: !m.snackPerson && !!m.snackDeclined,
          })}
          onPhoto={photoFor(snack)}
          actions={
            m.canEdit ? (
              <>
                <CardAction onClick={() => onAssign('snack')}>
                  {m.snackPerson ? t.common.edit : t.meetings.pickPerson}
                </CardAction>
                {m.snackPerson && (
                  <CardAction primary onClick={() => onNotify('snack', m.snackPerson)}>
                    {m.snackNotifiedAt ? t.meetings.askAgain : t.meetings.ask}
                  </CardAction>
                )}
              </>
            ) : undefined
          }
        />
      )}
      {m.helpers.map((h) => {
        const mine = h.person.id === myId && !h.acceptedAt;
        return (
          <PersonCard
            key={h.id}
            person={h.person}
            role={h.role}
            status={statusOf({
              person: h.person,
              acceptedAt: h.acceptedAt,
              notifiedAt: h.notifiedAt,
              declined: !!h.declinedAt,
            })}
            onPhoto={photoFor(h.person)}
            actions={
              m.canManage ? (
                <>
                  <CardAction
                    primary
                    onClick={() =>
                      void helpers.notify
                        .mutateAsync(h.id)
                        .then((r) => toast(r.sent ? t.meetings.messageSent : t.common.actionFailed))
                        .catch(() => toast(t.common.actionFailed, 'error'))
                    }
                  >
                    {h.notifiedAt ? t.meetings.askAgain : t.meetings.ask}
                  </CardAction>
                  <CardAction
                    onClick={() =>
                      void confirmDialog(t.meetings.removeHelper).then(
                        (ok) => ok && helpers.remove.mutate(h.id),
                      )
                    }
                  >
                    <IconTrash size={13} className="inline" />
                  </CardAction>
                </>
              ) : mine ? (
                <>
                  <CardAction
                    primary
                    onClick={() => helpers.answer.mutate({ helperId: h.id, agree: true })}
                  >
                    ✓
                  </CardAction>
                  <CardAction
                    onClick={() => helpers.answer.mutate({ helperId: h.id, agree: false })}
                  >
                    ✗
                  </CardAction>
                </>
              ) : undefined
            }
          />
        );
      })}
      {m.canManage && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            setPicking(true);
          }}
          className="metal-add flex items-center justify-center gap-2 rounded-[18px] py-3 text-[15px] font-semibold active:scale-[0.98]"
        >
          <IconPlus size={18} /> {t.meetings.addPerson}
        </button>
      )}
      <PersonPicker
        open={picking}
        title={t.meetings.addPerson}
        people={people.data}
        value={null}
        onClose={() => setPicking(false)}
        onPick={(id) => id && setAdding({ userId: id, role: '' })}
      />
      <Sheet open={adding !== null} onClose={() => setAdding(null)} title={t.meetings.helperRole}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="glass overflow-hidden rounded-2xl">
            <TextField
              label={t.meetings.helperRole}
              value={adding?.role ?? ''}
              onChange={(role) => adding && setAdding({ ...adding, role })}
              maxLength={40}
              autoFocus
            />
          </div>
          <p className="text-[13px] text-hint">{t.meetings.helperRoleHint}</p>
          <div className="flex flex-wrap gap-2">
            {ROLE_IDEAS.map((emoji) => (
              <Pill
                key={emoji}
                on={false}
                onClick={() =>
                  adding && setAdding({ ...adding, role: `${emoji} ${adding.role}`.trim() })
                }
                label={emoji}
              />
            ))}
          </div>
          <Button
            disabled={!adding?.role.trim() || helpers.add.isPending}
            onClick={() => void addHelper()}
          >
            {t.common.save}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
