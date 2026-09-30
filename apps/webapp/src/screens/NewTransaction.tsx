import { useState } from 'react';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  displayName,
  parseAmount,
  type MemberRow,
} from '@church/shared';
import { Avatar } from '../components/Avatar';
import { IconHeart, IconSearch, IconX } from '../components/icons';
import { categoryLabel, useMoney } from '../components/money';
import { Sheet, SheetOption } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { PhotoPicker, PhotoViewer } from '../components/TreasurySheets';
import { Button, Pill, Row, Screen, Section, Segmented, TextField, Title } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useCreateTransaction, useGroup, useMembers } from '../lib/queries';
import { haptic } from '../lib/telegram';

type Kind = 'income' | 'expense' | 'donation';

export function NewTransaction({ groupId, kind: initialKind }: { groupId: number; kind: Kind }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { back } = useNav();
  const group = useGroup(groupId);
  const create = useCreateTransaction(groupId);

  const [kind, setKind] = useState<Kind>(initialKind);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(f.todayInput());
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [donor, setDonor] = useState<MemberRow | null>(null);
  const [pickDonor, setPickDonor] = useState(false);
  const [receipt, setReceipt] = useState<{ id: number; url: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const cents = parseAmount(amount);
  const categories = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  async function save() {
    if (cents === null) {
      toast(t.treasury.invalidAmount, 'error');
      return;
    }
    try {
      await create.mutateAsync({
        kind,
        amountCents: cents,
        occurredOn: date,
        category: kind === 'donation' ? null : category,
        note,
        memberUserId: kind === 'donation' ? (donor?.userId ?? null) : null,
        receiptMediaId: receipt?.id ?? null,
      });
      haptic.success();
      toast(t.treasury.recorded);
      back();
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.treasury.newTitle[kind]}</Title>

      <Segmented
        options={[
          { key: 'income', label: t.treasury.income },
          { key: 'expense', label: t.treasury.expense },
          { key: 'donation', label: t.treasury.donation },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategory(null);
        }}
      />

      <label className="glass flex flex-col items-center rounded-[var(--radius-card)] px-4 py-5 shadow-card">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-hint">
          {t.treasury.amount}
        </span>
        <span className="mt-1 flex items-baseline justify-center gap-1.5">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))}
            style={{ width: `${Math.max(1, amount.length) + 0.6}ch` }}
            className={`max-w-[240px] bg-transparent text-center text-[48px] font-bold leading-tight tabular-nums outline-none placeholder:text-hint/50 ${
              kind === 'expense' ? 'text-absent' : 'text-present'
            }`}
          />
          <span className="text-[26px] font-semibold text-hint">{money.symbol}</span>
        </span>
      </label>

      {kind === 'donation' ? (
        <Section title={t.treasury.donor}>
          <Row
            before={
              donor ? (
                <Avatar
                  id={donor.userId}
                  firstName={donor.firstName}
                  lastName={donor.lastName}
                  size={36}
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-late/15 text-late">
                  <IconHeart size={18} />
                </span>
              )
            }
            title={donor ? displayName(donor) : t.treasury.anonymous}
            after={t.treasury.choose}
            onClick={() => setPickDonor(true)}
          />
        </Section>
      ) : (
        <section>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.treasury.category}
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Pill
                key={c}
                selected={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {categoryLabel(t, c)}
              </Pill>
            ))}
          </div>
        </section>
      )}

      <Section>
        <TextField label={t.treasury.date} type="date" value={date} onChange={setDate} />
        <TextField label={t.treasury.note} value={note} onChange={setNote} maxLength={300} />
      </Section>

      <section className="flex flex-col gap-2">
        {receipt ? (
          <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-hairline shadow-card">
            <button type="button" className="block w-full" onClick={() => setViewing(receipt.url)}>
              <img
                src={receipt.url}
                alt={t.treasury.receipt}
                className="max-h-56 w-full object-cover"
              />
            </button>
            <button
              type="button"
              aria-label={t.treasury.removeReceipt}
              onClick={() => setReceipt(null)}
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white"
            >
              <IconX size={18} />
            </button>
          </div>
        ) : (
          <PhotoPicker groupId={groupId} label={t.treasury.addReceipt} onUploaded={setReceipt} />
        )}
      </section>

      <Button onClick={() => void save()} disabled={cents === null || create.isPending}>
        {create.isPending
          ? t.common.saving
          : cents !== null
            ? `${t.treasury.save} · ${money(cents)}`
            : t.treasury.save}
      </Button>

      <DonorSheet
        groupId={groupId}
        open={pickDonor}
        onClose={() => setPickDonor(false)}
        onPick={(m) => {
          setDonor(m);
          setPickDonor(false);
        }}
      />
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

function DonorSheet({
  groupId,
  open,
  onClose,
  onPick,
}: {
  groupId: number;
  open: boolean;
  onClose: () => void;
  onPick: (m: MemberRow | null) => void;
}) {
  const t = useT();
  const members = useMembers(groupId, open);
  const [q, setQ] = useState('');
  const list = (members.data ?? [])
    .filter((m) => m.status === 'active')
    .filter((m) => displayName(m).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title={t.treasury.donor}>
      <div className="px-4 pb-2">
        <label className="glass flex items-center gap-2 rounded-xl px-3 py-2">
          <IconSearch size={18} className="text-hint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.common.searchByName}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
          />
        </label>
      </div>
      <SheetOption
        icon={<IconHeart size={20} className="text-late" />}
        label={t.treasury.anonymous}
        onClick={() => onPick(null)}
      />
      {list.map((m) => (
        <SheetOption
          key={m.userId}
          icon={<Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} size={30} />}
          label={displayName(m)}
          onClick={() => onPick(m)}
        />
      ))}
    </Sheet>
  );
}
