import { useRef, useState, type ReactNode } from 'react';
import {
  SERVICE_ICONS,
  displayName,
  type MeetingDetail,
  type MeetingPerson,
  type MeetingService,
  type UpdateMeetingInput,
} from '@church/shared';
import { useEnv } from '../lib/env';
import { preparePhoto } from '../lib/image';
import { useT } from '../lib/i18n';
import {
  useGroup,
  useMe,
  useMeetingHelpers,
  useMeetingPeople,
  usePersonPhoto,
  useSaveMeetingServices,
  useUpdateMeeting,
  useUploadMedia,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';
import { initials } from './Avatar';
import { IconCamera, IconCheck, IconClock, IconPlus, IconTrash, IconX } from './icons';
import { Pill } from './LookControls';
import { BackdropLayer, PatternLayer } from './PatternLayer';
import { PersonPicker } from './PersonPicker';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, TextField, Toggle } from './ui';

type PeopleLookInput = NonNullable<UpdateMeetingInput['peopleLook']>;

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
  icon,
}: {
  person: MeetingPerson | null;
  /** What they do here, e.g. "Leader", "Snacks", "Worship". */
  role: string;
  /** The service's icon, shown with the role (and instead of an empty photo). */
  icon?: string | null;
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
            <span className="absolute inset-0 flex items-center justify-center text-[26px] text-white/40">
              {icon ?? <IconPlus size={24} />}
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
          <span className="flex items-center gap-1 self-end">
            {icon && <span className="text-[13px] leading-none">{icon}</span>}
            <span className="metal-text text-[10px] font-extrabold uppercase tracking-[0.14em]">
              {role}
            </span>
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

/** Card colours to choose from (null = the ministry's colour). */
const CARD_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#a8a29e',
];

/**
 * Who serves at the meeting, on a panel with the ministry's background (or a chosen
 * photo): the leader, then speakers one under another, the snack person (when there is
 * one), then the other services. "+" adds a person to a service — a speaker, snacks, a
 * saved service of the ministry or a new one with its icon.
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
  const { env } = useEnv();
  const myId = me.data?.user.id;
  const helpers = useMeetingHelpers(m.id);
  const photo = usePersonPhoto(m.id);
  const update = useUpdateMeeting();
  const upload = useUploadMedia(m.groupId, 'event');
  const [adding, setAdding] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);

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
  const speakers = m.helpers.filter((h) => h.speaker);
  const others = m.helpers.filter((h) => !h.speaker);
  const look = m.peopleLook;

  const helperCard = (h: MeetingDetail['helpers'][number]) => {
    const mine = h.person.id === myId && !h.acceptedAt;
    return (
      <PersonCard
        key={h.id}
        person={h.person}
        role={h.role}
        icon={h.icon}
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
              <CardAction onClick={() => helpers.answer.mutate({ helperId: h.id, agree: false })}>
                ✗
              </CardAction>
            </>
          ) : undefined
        }
      />
    );
  };

  return (
    <div
      className="people-panel relative overflow-hidden rounded-[24px] p-2.5 shadow-card"
      data-tinted={look?.color ? 'true' : undefined}
      style={{ '--card-tint': look?.color ?? 'var(--brand)' } as React.CSSProperties}
    >
      {look?.photoUrl ? (
        <img
          src={look.photoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <span aria-hidden="true" className="brand-gradient absolute inset-0 opacity-90" />
          <PatternLayer pattern={env?.pattern} logoUrl={env?.logoUrl} />
          <BackdropLayer backdrop={env?.backdrop} url={env?.backdropUrl} />
        </>
      )}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/25" />
      <div className="relative flex flex-col gap-2.5">
        {m.canManage && (
          <button
            type="button"
            aria-label={t.meetings.peopleLookTitle}
            onClick={() => setLookOpen(true)}
            className="metal-action self-end rounded-full px-3 py-1 text-[12px] font-semibold text-white"
          >
            🎨 {t.meetings.peopleLookTitle}
          </button>
        )}
        {(leader || m.canManage) && (
          <PersonCard
            person={leader}
            role={t.meetings.leader}
            icon="🎙"
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
        {speakers.map(helperCard)}
        {snack && (
          <PersonCard
            person={snack}
            role={t.meetings.forFood}
            icon="🍕"
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
                  {m.snackPerson ? (
                    <CardAction primary onClick={() => onNotify('snack', m.snackPerson)}>
                      {m.snackNotifiedAt ? t.meetings.askAgain : t.meetings.ask}
                    </CardAction>
                  ) : (
                    <CardAction onClick={() => void update.mutate({ id: m.id, snackUserId: null })}>
                      <IconTrash size={13} className="inline" />
                    </CardAction>
                  )}
                </>
              ) : undefined
            }
          />
        )}
        {others.map(helperCard)}
        {(m.canManage || (m.canEdit && !snack)) && (
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              setAdding(true);
            }}
            className="metal-add flex items-center justify-center gap-2 rounded-[18px] py-3 text-[15px] font-semibold active:scale-[0.98]"
          >
            <IconPlus size={18} /> {t.meetings.addPerson}
          </button>
        )}
      </div>
      {adding && (
        <AddServiceFlow
          m={m}
          snackFree={!m.snackPerson}
          onSnack={() => onAssign('snack')}
          onClose={() => setAdding(false)}
        />
      )}
      {lookOpen && (
        <PeopleLookSheet
          m={m}
          onClose={() => setLookOpen(false)}
          onSave={async (peopleLook, toSeries) => {
            try {
              await update.mutateAsync({
                id: m.id,
                peopleLook,
                ...(toSeries ? { applyToSeries: true } : {}),
              });
              haptic.success();
              setLookOpen(false);
            } catch {
              toast(t.common.saveFailed, 'error');
            }
          }}
          upload={async (f) => (await upload.mutateAsync(await preparePhoto(f))).id}
        />
      )}
    </div>
  );
}

/**
 * "+": first which service (speaker, snacks, one the ministry saved, or a new one with
 * a name and icon), then who. Snacks go to the meeting's snack slot (with its budget).
 */
function AddServiceFlow({
  m,
  snackFree,
  onSnack,
  onClose,
}: {
  m: MeetingDetail;
  snackFree: boolean;
  onSnack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const group = useGroup(m.groupId);
  const helpers = useMeetingHelpers(m.id);
  const saveServices = useSaveMeetingServices(m.groupId);
  const [service, setService] = useState<MeetingService | null>(null);
  const [draft, setDraft] = useState<MeetingService | null>(null);
  const people = useMeetingPeople(m.id, service !== null);
  const saved = group.data?.meetingServices ?? [];
  const builtIn: MeetingService[] = [
    { name: t.meetings.speakerService, icon: '🎤', speaker: true },
    ...saved.filter(
      (x) => x.name.toLocaleLowerCase() !== t.meetings.speakerService.toLocaleLowerCase(),
    ),
  ];

  async function add(userId: number) {
    if (!service) return;
    try {
      await helpers.add.mutateAsync({
        userId,
        role: service.name,
        icon: service.icon,
        speaker: service.speaker,
      });
      haptic.success();
      toast(t.meetings.helperAdded);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  if (service)
    return (
      <PersonPicker
        open
        title={`${service.icon} ${service.name}`}
        people={people.data}
        value={null}
        onClose={onClose}
        onPick={(id) => id && void add(id)}
      />
    );

  return (
    <Sheet open onClose={onClose} title={draft ? t.meetings.newService : t.meetings.pickService}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {draft ? (
          <>
            <div className="glass overflow-hidden rounded-2xl">
              <TextField
                label={t.meetings.serviceName}
                value={draft.name}
                onChange={(name) => setDraft({ ...draft, name })}
                maxLength={40}
                autoFocus
              />
            </div>
            <div className="text-[13px] text-hint">{t.meetings.serviceIcon}</div>
            <div className="grid grid-cols-8 gap-1.5">
              {SERVICE_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon })}
                  className={`flex aspect-square items-center justify-center rounded-xl text-[22px] active:scale-90 ${
                    draft.icon === icon ? 'bg-brand/20 ring-2 ring-[var(--brand)]' : 'bg-hairline'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
            <Toggle
              label={t.meetings.isSpeaker}
              checked={draft.speaker}
              onChange={(speaker) => setDraft({ ...draft, speaker })}
            />
            <Button
              disabled={!draft.name.trim()}
              onClick={() => setService({ ...draft, name: draft.name.trim() })}
            >
              {t.meetings.next}
            </Button>
          </>
        ) : (
          <>
            {builtIn.map((x) => (
              <div key={x.name} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setService(x)}
                  className="glass flex min-h-[48px] flex-1 items-center gap-3 rounded-2xl px-3.5 text-left shadow-card active:scale-[0.98]"
                >
                  <span className="text-[22px]">{x.icon}</span>
                  <span className="flex-1 text-[15px] font-semibold">{x.name}</span>
                  {x.speaker && <span className="text-[11px] text-hint">⬆︎</span>}
                </button>
                {saved.includes(x) && m.canManage && (
                  <button
                    type="button"
                    aria-label={t.meetings.removeService}
                    onClick={() =>
                      void confirmDialog(t.meetings.removeService).then(
                        (ok) => ok && saveServices.mutate(saved.filter((s) => s !== x)),
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-full text-hint active:bg-hairline"
                  >
                    <IconX size={16} />
                  </button>
                )}
              </div>
            ))}
            {snackFree && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSnack();
                }}
                className="glass flex min-h-[48px] items-center gap-3 rounded-2xl px-3.5 text-left shadow-card active:scale-[0.98]"
              >
                <span className="text-[22px]">🍕</span>
                <span className="flex-1 text-[15px] font-semibold">{t.meetings.forFood}</span>
              </button>
            )}
            <Button
              variant="glass"
              onClick={() => setDraft({ name: '', icon: SERVICE_ICONS[1], speaker: false })}
            >
              <IconPlus size={16} /> {t.meetings.newService}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Card colour and the panel's background (the ministry's, or a photo) of the people block. */
function PeopleLookSheet({
  m,
  onClose,
  onSave,
  upload,
}: {
  m: MeetingDetail;
  onClose: () => void;
  onSave: (look: PeopleLookInput | null, toSeries: boolean) => void;
  upload: (f: File) => Promise<number>;
}) {
  const t = useT();
  const toast = useToast();
  const [color, setColor] = useState<string | null>(m.peopleLook?.color ?? null);
  const [photo, setPhoto] = useState<{ id: number; url: string } | null>(
    m.peopleLook?.photoMediaId && m.peopleLook.photoUrl
      ? { id: m.peopleLook.photoMediaId, url: m.peopleLook.photoUrl }
      : null,
  );
  const [toSeries, setToSeries] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Sheet open onClose={onClose} title={t.meetings.peopleLookTitle}>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div>
          <div className="mb-2 text-[13px] text-hint">{t.meetings.cardColor}</div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              aria-label={t.meetings.bgMinistry}
              onClick={() => setColor(null)}
              className={`brand-gradient h-9 w-9 rounded-full ${color === null ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''}`}
            />
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-9 w-9 rounded-full ${color === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] text-hint">{t.meetings.panelBg}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill on={!photo} onClick={() => setPhoto(null)} label={t.meetings.bgMinistry} />
            <Pill
              on={!!photo}
              onClick={() => file.current?.click()}
              label={busy ? t.treasury.uploading : `📷 ${t.meetings.choosePhoto}`}
            />
            {photo && <img src={photo.url} alt="" className="h-10 w-14 rounded-lg object-cover" />}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              try {
                const id = await upload(f);
                setPhoto({ id, url: URL.createObjectURL(f) });
              } catch {
                toast(t.treasury.uploadFailed, 'error');
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        {m.seriesId && (
          <Toggle label={t.meetings.applyToSeries} checked={toSeries} onChange={setToSeries} />
        )}
        <Button
          disabled={busy}
          onClick={() =>
            onSave(color || photo ? { color, photoMediaId: photo?.id ?? null } : null, toSeries)
          }
        >
          {t.common.save}
        </Button>
      </div>
    </Sheet>
  );
}
