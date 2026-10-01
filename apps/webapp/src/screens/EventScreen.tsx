import { CountdownBadge, CountdownOnCover, hasCountdown } from '../components/Countdown';
import { EventCover } from '../components/EventCard';
import { useRef, useState } from 'react';
import {
  displayName,
  parseAmount,
  type EventDetail,
  type EventRole,
  type PersonRef,
  type RsvpStatus,
} from '@church/shared';
import { Avatar } from '../components/Avatar';
import { useEventWhen } from '../components/EventCard';
import {
  IconCheck,
  IconCoins,
  IconEdit,
  IconImage,
  IconMapPin,
  IconPlus,
  IconTelegram,
  IconTrash,
  IconUsers,
  IconX,
} from '../components/icons';
import { KindIcon, mergeDues, useMoney, type LedgerEntry } from '../components/money';
import { Sheet, SheetOption } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { PhotoPicker, PhotoViewer, TransactionSheet } from '../components/TreasurySheets';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  HeroCard,
  Loading,
  ProgressBar,
  Screen,
  Section,
  Toggle,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useNav } from '../lib/nav';
import {
  useAddPhotos,
  useDeletePhoto,
  useEvent,
  useEventExpense,
  useEventPayment,
  useMembers,
  useRsvp,
  useSetRoles,
  useUpdateEvent,
  useUploadMedia,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';

export function EventScreen({ eventId }: { eventId: number }) {
  const q = useEvent(eventId);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return <EventBody e={q.data} />;
}

function EventBody({ e }: { e: EventDetail }) {
  const t = useT();
  const toast = useToast();
  const when = useEventWhen();
  const { push } = useNav();
  const update = useUpdateEvent(e.id);
  const cancelled = e.status === 'cancelled';

  async function toggleCancelled() {
    if (!cancelled && !(await confirmDialog(t.events.confirmCancel))) return;
    try {
      await update.mutateAsync({ status: cancelled ? 'scheduled' : 'cancelled' });
      haptic.success();
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  const header = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wider opacity-80">
          {e.groupName}
        </span>
        {cancelled && <Badge tone="danger">{t.events.cancelled}</Badge>}
      </div>
      <h1
        className={`mt-1 text-[26px] font-bold leading-tight tracking-tight ${cancelled ? 'line-through' : ''}`}
      >
        {e.title}
      </h1>
      <div className="mt-1.5 text-[15px] opacity-90">{when(e)}</div>
      {e.location && (
        <div className="mt-0.5 flex items-center gap-1.5 text-[15px] opacity-90">
          <IconMapPin size={16} className="shrink-0" /> {e.location}
        </div>
      )}
    </>
  );

  return (
    <Screen>
      {e.coverUrl ? (
        <div className="relative -mx-4 -mt-4 overflow-hidden">
          <img src={e.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white">{header}</div>
          <CountdownOnCover e={e} />
        </div>
      ) : e.design?.banner ? (
        <>
          <div className="relative -mx-1 overflow-hidden rounded-[var(--radius-card)] shadow-card">
            <EventCover e={e} />
            <CountdownOnCover e={e} />
          </div>
          <HeroCard>{header}</HeroCard>
        </>
      ) : (
        <HeroCard>
          {hasCountdown(e) && (
            <div className="mb-3">
              <CountdownBadge startsAt={e.startsAt} design={e.design} />
            </div>
          )}
          {header}
        </HeroCard>
      )}

      {(e.canManage || e.chatUrl) && (
        <div className="flex gap-2">
          {e.chatUrl && (
            <Button small variant="secondary" onClick={() => openTelegramLink(e.chatUrl!)}>
              <IconTelegram size={17} /> {t.events.openChat}
            </Button>
          )}
          {e.canManage && (
            <Button
              small
              variant="glass"
              onClick={() => push({ name: 'eventForm', groupId: e.groupId, eventId: e.id })}
            >
              <IconEdit size={16} /> {t.common.edit}
            </Button>
          )}
        </div>
      )}

      {e.myRoles.length > 0 && (
        <Card className="flex items-center gap-3 p-4">
          <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <IconUsers size={20} />
          </span>
          <span className="text-[16px] font-semibold">
            {t.events.yourDuty(e.myRoles.join(', '))}
          </span>
        </Card>
      )}

      {e.description && (
        <Card className="whitespace-pre-line p-4 text-[16px] leading-relaxed">{e.description}</Card>
      )}

      {e.features.rsvp && e.member && <RsvpBlock e={e} />}
      {e.features.duties && <DutiesBlock e={e} />}
      {e.features.gallery && <GalleryBlock e={e} />}
      {e.features.cost && (e.canManage ? <MoneyBlock e={e} /> : <MyCost e={e} />)}

      {e.canManage && (
        <Section footer={t.feed.pinnedHint}>
          <Toggle
            label={`📌 ${t.feed.pin}`}
            checked={e.pinned}
            disabled={update.isPending}
            onChange={(pinned) => update.mutate({ pinned })}
          />
        </Section>
      )}

      {e.canManage && (
        <Button
          variant={cancelled ? 'secondary' : 'destructive'}
          onClick={() => void toggleCancelled()}
          disabled={update.isPending}
        >
          {cancelled ? t.events.restoreEvent : t.events.cancelEvent}
        </Button>
      )}
    </Screen>
  );
}

function People({ people }: { people: PersonRef[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-hairline py-1 pl-1 pr-3 text-[14px]"
        >
          <Avatar id={p.id} firstName={p.firstName} lastName={p.lastName} size={24} />
          {displayName(p)}
        </span>
      ))}
    </div>
  );
}

function RsvpBlock({ e }: { e: EventDetail }) {
  const t = useT();
  const toast = useToast();
  const rsvp = useRsvp(e.id);
  const [forPerson, setForPerson] = useState<PersonRef | null>(null);
  const disabled = e.status === 'cancelled' || rsvp.isPending;

  async function answer(status: RsvpStatus | null, userId?: number) {
    try {
      await rsvp.mutateAsync({ status, userId });
      haptic.success();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  const choice = (status: RsvpStatus, label: string) => {
    const on = e.myRsvp === status;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void answer(on ? null : status)}
        className={`flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${
          on
            ? status === 'going'
              ? 'bg-present text-white shadow-cta'
              : 'bg-absent text-white'
            : 'glass'
        }`}
      >
        {status === 'going' ? <IconCheck size={19} /> : <IconX size={19} />}
        {label}
      </button>
    );
  };

  const group = (title: string, people: PersonRef[]) =>
    people.length > 0 && (
      <div>
        <div className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {title}
        </div>
        {e.canManage ? (
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setForPerson(p)}
                className="inline-flex items-center gap-1.5 rounded-full bg-hairline py-1 pl-1 pr-3 text-[14px] active:scale-95"
              >
                <Avatar id={p.id} firstName={p.firstName} lastName={p.lastName} size={24} />
                {displayName(p)}
              </button>
            ))}
          </div>
        ) : (
          <People people={people} />
        )}
      </div>
    );

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        {choice('going', t.events.going)}
        {choice('not_going', t.events.notGoing)}
      </div>
      {group(t.events.goingTitle(e.rsvps.going.length), e.rsvps.going)}
      {group(t.events.notGoingTitle(e.rsvps.notGoing.length), e.rsvps.notGoing)}
      {e.canManage && group(t.events.noAnswerTitle(e.rsvps.noAnswer.length), e.rsvps.noAnswer)}

      <Sheet
        open={forPerson !== null}
        onClose={() => setForPerson(null)}
        title={forPerson ? displayName(forPerson) : ''}
      >
        <SheetOption
          icon={<IconCheck size={20} className="text-present" />}
          label={t.events.going}
          onClick={() => {
            void answer('going', forPerson!.id);
            setForPerson(null);
          }}
        />
        <SheetOption
          icon={<IconX size={20} className="text-absent" />}
          label={t.events.notGoing}
          onClick={() => {
            void answer('not_going', forPerson!.id);
            setForPerson(null);
          }}
        />
        <SheetOption
          label={t.events.clearAnswer}
          onClick={() => {
            void answer(null, forPerson!.id);
            setForPerson(null);
          }}
        />
      </Sheet>
    </Card>
  );
}

function DutiesBlock({ e }: { e: EventDetail }) {
  const t = useT();
  const { push } = useNav();
  const [editing, setEditing] = useState<EventRole | null>(null);
  return (
    <Section title={t.events.duties}>
      {e.roles.length === 0 ? (
        <p className="px-4 py-4 text-[15px] text-hint">{t.events.noRoles}</p>
      ) : (
        e.roles.map((r) => {
          const full = r.assignees.length >= r.slots;
          const content = (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">{r.name}</span>
                <span
                  className={`text-[13px] font-semibold ${full ? 'text-present' : 'text-late'}`}
                >
                  {t.events.assigned(r.assignees.length, r.slots)}
                </span>
              </div>
              <div className="mt-2">
                {r.assignees.length ? (
                  <People people={r.assignees} />
                ) : (
                  <span className="text-[14px] text-hint">{t.events.nobody}</span>
                )}
              </div>
            </>
          );
          return e.canManage ? (
            <button
              key={r.id}
              type="button"
              onClick={() => setEditing(r)}
              className="block w-full border-b border-hairline px-4 py-3 text-left last:border-b-0 active:bg-hairline"
            >
              {content}
            </button>
          ) : (
            <div key={r.id} className="border-b border-hairline px-4 py-3 last:border-b-0">
              {content}
            </div>
          );
        })
      )}
      {e.canManage && e.roles.length === 0 && (
        <button
          type="button"
          onClick={() => push({ name: 'eventForm', groupId: e.groupId, eventId: e.id })}
          className="flex min-h-[52px] w-full items-center gap-2 border-t border-hairline px-4 text-[17px] text-accent active:bg-hairline"
        >
          <IconPlus size={20} /> {t.events.addRole}
        </button>
      )}
      {e.canManage && <AssignSheet e={e} role={editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

/** Pick the people for one duty. */
function AssignSheet({
  e,
  role,
  onClose,
}: {
  e: EventDetail;
  role: EventRole | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const members = useMembers(e.groupId, role !== null);
  const setRoles = useSetRoles(e.id);
  const [picked, setPicked] = useState<number[]>([]);
  const [forRole, setForRole] = useState<number | null>(null);
  if (role && forRole !== role.id) {
    setForRole(role.id);
    setPicked(role.assignees.map((a) => a.id));
  }
  const active = (members.data ?? []).filter((m) => m.status === 'active');
  // People who said "going" first — they are the ones who can serve.
  const going = new Set(e.rsvps.going.map((p) => p.id));
  const sorted = [...active].sort(
    (a, b) => Number(going.has(b.userId)) - Number(going.has(a.userId)),
  );

  async function save() {
    if (!role) return;
    try {
      await setRoles.mutateAsync(
        e.roles.map((r) => ({
          id: r.id,
          name: r.name,
          slots: r.slots,
          userIds: r.id === role.id ? picked : r.assignees.map((a) => a.id),
        })),
      );
      haptic.success();
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open={role !== null} onClose={onClose} title={role?.name}>
      {role && (
        <>
          <p className="px-5 pb-2 text-[14px] text-hint">
            {t.events.assigned(picked.length, role.slots)}
          </p>
          {sorted.map((m) => {
            const on = picked.includes(m.userId);
            return (
              <SheetOption
                key={m.userId}
                icon={
                  <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} size={30} />
                }
                label={displayName(m)}
                hint={going.has(m.userId) ? t.events.going : undefined}
                selected={on}
                onClick={() => {
                  haptic.tap();
                  setPicked((p) => (on ? p.filter((x) => x !== m.userId) : [...p, m.userId]));
                }}
              />
            );
          })}
          <div className="px-5 pt-2">
            <Button onClick={() => void save()} disabled={setRoles.isPending}>
              {t.common.save}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function GalleryBlock({ e }: { e: EventDetail }) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia(e.groupId, 'event');
  const add = useAddPhotos(e.id);
  const del = useDeletePhoto(e.id);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [viewing, setViewing] = useState<{ id: number; url: string } | null>(null);

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 20);
    const ids: number[] = [];
    try {
      for (const [i, file] of list.entries()) {
        setProgress([i + 1, list.length]);
        ids.push((await upload.mutateAsync(await preparePhoto(file))).id);
      }
      await add.mutateAsync(ids);
      haptic.success();
    } catch {
      haptic.error();
      toast(t.treasury.uploadFailed, 'error');
      if (ids.length) await add.mutateAsync(ids).catch(() => undefined);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!viewing || !(await confirmDialog(t.events.confirmDeletePhoto))) return;
    await del.mutateAsync(viewing.id).catch(() => toast(t.common.actionFailed, 'error'));
    setViewing(null);
  }

  return (
    <Section title={t.events.gallery}>
      <div className="p-3">
        {e.photos.length === 0 ? (
          <p className="px-1 py-2 text-[15px] text-hint">{t.events.noPhotos}</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {e.photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewing(p)}
                className="overflow-hidden rounded-xl bg-hairline"
              >
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {e.canManage && (
          <div className="mt-3">
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(ev) => void onPick(ev.target.files)}
            />
            <Button
              variant="secondary"
              disabled={progress !== null}
              onClick={() => input.current?.click()}
            >
              <IconImage size={18} />
              {progress ? t.events.uploadingN(progress[0], progress[1]) : t.events.addPhotos}
            </Button>
          </div>
        )}
      </div>
      <PhotoViewer url={viewing?.url ?? null} onClose={() => setViewing(null)} />
      {viewing && e.canManage && (
        <div className="fixed inset-x-0 bottom-0 z-[80] flex justify-center p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => void remove()}
            className="flex h-12 items-center gap-2 rounded-full bg-white/15 px-5 text-[15px] font-semibold text-white backdrop-blur"
          >
            <IconTrash size={18} /> {t.events.deletePhoto}
          </button>
        </div>
      )}
    </Section>
  );
}

function MyCost({ e }: { e: EventDetail }) {
  const t = useT();
  const money = useMoney();
  if (!e.priceCents) return null;
  const done = e.myPaidCents >= e.priceCents;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${done ? 'bg-present/15 text-present' : 'bg-brand/12 text-accent'}`}
      >
        {done ? <IconCheck size={20} /> : <IconCoins size={20} />}
      </span>
      <span className="text-[16px] font-medium">
        {e.myPaidCents > 0
          ? t.events.youPaid(money(e.myPaidCents), money(e.priceCents))
          : t.events.youOwe(money(e.priceCents))}
      </span>
    </Card>
  );
}

function MoneyBlock({ e }: { e: EventDetail }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const pay = useEventPayment(e.id);
  const [payFor, setPayFor] = useState<PersonRef | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [openTx, setOpenTx] = useState<LedgerEntry | null>(null);
  const fin = e.finance;
  if (!fin) return null;
  const net = fin.collectedCents - fin.expenseCents;
  const price = fin.priceCents ?? 0;
  const paidCount = fin.people.filter((p) => price > 0 && p.paidCents >= price).length;

  async function markPaid(p: PersonRef, cents?: number) {
    try {
      await pay.mutateAsync({ userId: p.id, amountCents: cents });
      haptic.success();
      setPayFor(null);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <>
      <Card className="p-4">
        <h2 className="mb-3 text-[17px] font-semibold">{t.events.money}</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile label={t.events.collected} value={money(fin.collectedCents)} tone="text-present" />
          <Tile label={t.events.spent} value={money(fin.expenseCents)} tone="text-absent" />
          <Tile
            label={t.events.net}
            value={money(net, { sign: true })}
            tone={net >= 0 ? 'text-present' : 'text-absent'}
          />
        </div>
        {price > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[13px] text-hint">
              <span>
                {money(price)} {t.events.perPerson}
              </span>
              <span>{t.events.paidOf(String(paidCount), String(fin.people.length))}</span>
            </div>
            <ProgressBar value={paidCount} max={fin.people.length} />
          </div>
        )}
        <p className="mt-3 text-[12px] text-hint">{t.events.countsInBalance}</p>
      </Card>

      {fin.people.length > 0 && (
        <Section title={t.events.payments}>
          {fin.people.map((p) => {
            const done = price > 0 && p.paidCents >= price;
            return (
              <button
                key={p.member.id}
                type="button"
                onClick={() => setPayFor(p.member)}
                className="flex min-h-[56px] w-full items-center gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 active:bg-hairline"
              >
                <Avatar
                  id={p.member.id}
                  firstName={p.member.firstName}
                  lastName={p.member.lastName}
                  size={34}
                />
                <span className="min-w-0 flex-1 truncate text-[16px]">{displayName(p.member)}</span>
                <Badge tone={done ? 'success' : p.paidCents > 0 ? 'accent' : 'hint'}>
                  {done
                    ? t.events.paid
                    : p.paidCents > 0
                      ? t.events.paidOf(money(p.paidCents), money(price))
                      : t.events.notPaid}
                </Badge>
              </button>
            );
          })}
        </Section>
      )}

      <Section title={t.events.expenses}>
        {fin.expenses.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-hint">{t.events.noExpenses}</p>
        ) : (
          mergeDues(fin.expenses).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setOpenTx(x)}
              className="flex min-h-[56px] w-full items-center gap-3 border-b border-hairline px-4 py-2 text-left active:bg-hairline"
            >
              <KindIcon kind={x.kind} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{x.note ?? t.events.spent}</span>
                <span className="block text-[13px] text-hint">{f.dayMonthShort(x.occurredOn)}</span>
              </span>
              <span className="font-semibold tabular-nums text-absent">
                {money(-x.amountCents, { sign: true })}
              </span>
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => setExpenseOpen(true)}
          className="flex min-h-[52px] w-full items-center gap-2 px-4 text-[17px] text-accent active:bg-hairline"
        >
          <IconPlus size={20} /> {t.events.addExpense}
        </button>
      </Section>

      <PaySheet
        person={payFor}
        price={price}
        paid={fin.people.find((p) => p.member.id === payFor?.id)?.paidCents ?? 0}
        payments={mergeDues(fin.payments).filter((x) => x.member?.id === payFor?.id)}
        onPay={(cents) => payFor && void markPaid(payFor, cents)}
        onOpenTx={(x) => {
          setPayFor(null);
          setOpenTx(x);
        }}
        onClose={() => setPayFor(null)}
        busy={pay.isPending}
      />
      <ExpenseSheet e={e} open={expenseOpen} onClose={() => setExpenseOpen(false)} />
      <TransactionSheet tx={openTx} groupId={e.groupId} onClose={() => setOpenTx(null)} />
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-hairline px-1 py-2.5">
      <div className={`text-[17px] font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[12px] text-hint">{label}</div>
    </div>
  );
}

function PaySheet({
  person,
  price,
  paid,
  payments,
  onPay,
  onOpenTx,
  onClose,
  busy,
}: {
  person: PersonRef | null;
  price: number;
  paid: number;
  payments: LedgerEntry[];
  onPay: (cents?: number) => void;
  onOpenTx: (x: LedgerEntry) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const [amount, setAmount] = useState('');
  const left = Math.max(0, price - paid);
  const cents = amount.trim() ? parseAmount(amount) : left || null;
  return (
    <Sheet open={person !== null} onClose={onClose} title={person ? displayName(person) : ''}>
      <div className="flex flex-col gap-3 px-5 pb-2">
        {price > 0 && (
          <p className="text-[15px] text-hint">{t.events.paidOf(money(paid), money(price))}</p>
        )}
        <label className="glass flex items-center gap-2 rounded-2xl px-4 py-3">
          <input
            inputMode="decimal"
            placeholder={left ? String(left / 100).replace('.', ',') : '0'}
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[26px] font-bold tabular-nums outline-none placeholder:text-hint/60"
          />
          <span className="text-[20px] font-semibold text-hint">{money.symbol}</span>
        </label>
        <Button
          disabled={busy || cents === null}
          onClick={() => {
            onPay(cents ?? undefined);
            setAmount('');
          }}
        >
          {t.events.markPaid}
          {cents ? ` · ${money(cents)}` : ''}
        </Button>
        {payments.length > 0 && (
          <div className="glass overflow-hidden rounded-2xl">
            {payments.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => onOpenTx(x)}
                className="flex min-h-[48px] w-full items-center justify-between border-b border-hairline px-4 text-left text-[15px] last:border-b-0 active:bg-hairline"
              >
                <span className="text-hint">{f.dayMonthShort(x.occurredOn)}</span>
                <span className="font-semibold tabular-nums text-present">
                  {money(x.amountCents, { sign: true })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ExpenseSheet({
  e,
  open,
  onClose,
}: {
  e: EventDetail;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const money = useMoney();
  const toast = useToast();
  const add = useEventExpense(e.id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ id: number; url: string } | null>(null);
  const cents = parseAmount(amount);

  async function save() {
    if (cents === null) return;
    try {
      await add.mutateAsync({ amountCents: cents, note, receiptMediaId: receipt?.id ?? null });
      haptic.success();
      setAmount('');
      setNote('');
      setReceipt(null);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t.events.addExpense}>
      <div className="flex flex-col gap-3 px-5 pb-2">
        <label className="glass flex items-center gap-2 rounded-2xl px-4 py-3">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[26px] font-bold tabular-nums text-absent outline-none placeholder:text-hint/60"
          />
          <span className="text-[20px] font-semibold text-hint">{money.symbol}</span>
        </label>
        <input
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder={t.treasury.notePlaceholder}
          maxLength={300}
          className="glass rounded-2xl px-4 py-3 text-[17px] outline-none placeholder:text-hint"
        />
        {receipt ? (
          <div className="flex items-center gap-3">
            <img src={receipt.url} alt="" className="h-16 w-16 rounded-xl object-cover" />
            <Button small variant="glass" onClick={() => setReceipt(null)}>
              {t.treasury.removeReceipt}
            </Button>
          </div>
        ) : (
          <PhotoPicker groupId={e.groupId} label={t.treasury.addReceipt} onUploaded={setReceipt} />
        )}
        <Button disabled={cents === null || add.isPending} onClick={() => void save()}>
          {t.treasury.save}
          {cents ? ` · ${money(cents)}` : ''}
        </Button>
      </div>
    </Sheet>
  );
}
