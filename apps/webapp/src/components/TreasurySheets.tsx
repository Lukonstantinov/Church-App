import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayName, parseAmount, type DuesSheet, type TransactionRow } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import {
  usePayDues,
  useSetDuesExempt,
  useTransactions,
  useUpdateTransaction,
  useUploadMedia,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { Avatar } from './Avatar';
import { IconCamera, IconCheck, IconTrash, IconX } from './icons';
import {
  Amount,
  KindIcon,
  categoryLabel,
  useMoney,
  usePeriodRange,
  useTxText,
  type LedgerEntry,
} from './money';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Skeleton, Toggle } from './ui';

/** Full-screen photo; tap anywhere to close. */
export function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-black/90 p-3"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
      <button
        type="button"
        aria-label="close"
        className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <IconX size={20} />
      </button>
    </div>,
    document.body,
  );
}

/**
 * Picks a photo from the camera or gallery, shrinks it on the phone and uploads it.
 * Calls `onUploaded` with the stored media id and a URL to preview it.
 */
export function PhotoPicker({
  groupId,
  kind = 'receipt',
  label,
  onUploaded,
  compact,
}: {
  groupId: number;
  kind?: 'receipt' | 'event';
  label: string;
  onUploaded: (m: { id: number; url: string }) => void;
  compact?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia(groupId, kind);

  async function onPick(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await preparePhoto(file);
      const res = await upload.mutateAsync(blob);
      haptic.success();
      onUploaded(res);
    } catch {
      haptic.error();
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <Button
        variant="secondary"
        small={compact}
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
      >
        <IconCamera size={18} /> {upload.isPending ? t.treasury.uploading : label}
      </Button>
    </>
  );
}

/** Details of one cash-book entry: receipt photo, attach a receipt, cancel the entry. */
export function TransactionSheet({
  tx,
  groupId,
  onClose,
}: {
  tx: LedgerEntry | null;
  groupId: number;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const text = useTxText();
  const range = usePeriodRange();
  const update = useUpdateTransaction(groupId);
  const [viewing, setViewing] = useState<string | null>(null);
  const [current, setCurrent] = useState<LedgerEntry | null>(tx);
  if (tx && current?.id !== tx.id) setCurrent(tx);
  const row = current;

  async function voidIt() {
    if (!row || !(await confirmDialog(t.treasury.confirmVoid))) return;
    try {
      for (const id of row.ids) await update.mutateAsync({ id, voided: true });
      haptic.success();
      toast(t.treasury.voided);
      onClose();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  async function attach(mediaId: number) {
    if (!row) return;
    try {
      const updated = await update.mutateAsync({ id: row.id, receiptMediaId: mediaId });
      setCurrent({ ...row, receiptUrl: updated.receiptUrl, receiptMediaId: mediaId });
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  const info = row ? text(row) : null;
  return (
    <Sheet open={tx !== null} onClose={onClose}>
      {row && info && (
        <div className="flex flex-col gap-4 px-5 pb-2 pt-2">
          <div className="flex items-center gap-3">
            <KindIcon kind={row.kind} size={46} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-hint">
                {t.treasury.kinds[row.kind]}
              </div>
              <div className="truncate text-[19px] font-semibold">{info.title}</div>
            </div>
          </div>
          <Amount kind={row.kind} cents={row.amountCents} className="text-[34px] leading-none" />
          <dl className="glass divide-y divide-hairline overflow-hidden rounded-2xl text-[15px]">
            <Detail label={t.treasury.date} value={f.dayMonth(`${row.occurredOn}T12:00:00Z`)} />
            {row.periods.length > 0 && (
              <Detail label={t.treasury.kinds.dues} value={range(row.periods)} />
            )}
            {(row.kind === 'income' || row.kind === 'expense') && (
              <Detail label={t.treasury.category} value={categoryLabel(t, row.category)} />
            )}
            {row.member && <Detail label={t.nav.people} value={displayName(row.member)} />}
            {row.note && <Detail label={t.treasury.note} value={row.note} />}
          </dl>

          {row.receiptUrl ? (
            <button
              type="button"
              onClick={() => setViewing(row.receiptUrl)}
              className="overflow-hidden rounded-2xl bg-hairline"
            >
              <img
                src={row.receiptUrl}
                alt={t.treasury.receipt}
                className="max-h-64 w-full object-cover"
              />
            </button>
          ) : (
            <PhotoPicker
              groupId={groupId}
              label={t.treasury.addReceipt}
              onUploaded={(m) => void attach(m.id)}
            />
          )}

          {row.createdBy && (
            <p className="text-[13px] text-hint">
              {t.treasury.recordedBy(displayName(row.createdBy), f.dayMonth(row.createdAt))}
            </p>
          )}
          <Button variant="destructive" onClick={() => void voidIt()} disabled={update.isPending}>
            <IconTrash size={18} /> {t.treasury.voidEntry}
          </Button>
        </div>
      )}
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-hint">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}

const MONTH_TONE = {
  paid: 'bg-present/15 text-present',
  partial: 'bg-late/15 text-late',
  unpaid: 'bg-absent/10 text-absent ring-1 ring-inset ring-absent/30',
  none: 'bg-hairline text-hint',
  future: 'glass text-text',
} as const;

/** One member's year: tap months to mark them paid, see and undo payments, exempt toggle. */
export function MemberDuesSheet({
  groupId,
  sheet,
  userId,
  onClose,
}: {
  groupId: number;
  sheet: DuesSheet;
  userId: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const pay = usePayDues(groupId);
  const exempt = useSetDuesExempt(groupId);
  const update = useUpdateTransaction(groupId);
  const [selected, setSelected] = useState<string[]>([]);
  const [forUser, setForUser] = useState(userId);
  if (forUser !== userId) {
    setForUser(userId);
    setSelected([]);
  }
  const row = sheet.rows.find((r) => r.member.id === userId) ?? null;
  const payments = useTransactions(groupId, 'dues', {
    member: userId ?? undefined,
    enabled: userId !== null,
  });
  const paymentRows = (payments.data?.pages.flatMap((p) => p.items) ?? []).filter((p) =>
    p.period?.startsWith(String(sheet.year)),
  );

  const toggle = (period: string) => {
    haptic.tap();
    setSelected((s) => (s.includes(period) ? s.filter((p) => p !== period) : [...s, period]));
  };

  async function submit() {
    if (!row || selected.length === 0) return;
    try {
      const res = await pay.mutateAsync({ userId: row.member.id, periods: selected });
      haptic.success();
      toast(t.treasury.paidSaved(res.created.length));
      setSelected([]);
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  async function undo(tx: TransactionRow) {
    if (!(await confirmDialog(t.treasury.confirmVoid))) return;
    try {
      await update.mutateAsync({ id: tx.id, voided: true });
      toast(t.treasury.voided);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Sheet open={row !== null} onClose={onClose}>
      {row && (
        <div className="flex flex-col gap-4 px-5 pb-2 pt-1">
          <div className="flex items-center gap-3">
            <Avatar
              id={row.member.id}
              firstName={row.member.firstName}
              lastName={row.member.lastName}
              size={44}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[19px] font-semibold">{displayName(row.member)}</div>
              <div className="text-[14px] text-hint">
                {t.treasury.segDues} · {sheet.year}
                {row.paidCents > 0 && ` · ${money(row.paidCents)}`}
              </div>
            </div>
          </div>

          {!row.exempt && sheet.feeCents > 0 && (
            <p className="text-[14px] text-hint">{t.treasury.pickMonths}</p>
          )}
          <div className="grid grid-cols-4 gap-2">
            {row.cells.map((c) => {
              const isSel = selected.includes(c.period);
              const paid = c.state === 'paid';
              return (
                <button
                  key={c.period}
                  type="button"
                  disabled={paid || row.exempt || sheet.feeCents === 0}
                  onClick={() => toggle(c.period)}
                  aria-pressed={isSel}
                  className={`flex min-h-[54px] flex-col items-center justify-center rounded-2xl text-[14px] font-semibold transition active:scale-95 disabled:active:scale-100 ${
                    isSel ? 'brand-gradient text-white shadow-cta' : MONTH_TONE[c.state]
                  }`}
                >
                  <span className="capitalize">{f.monthShort(c.period)}</span>
                  <span className="flex h-4 items-center text-[11px] font-medium opacity-85">
                    {paid ? (
                      <IconCheck size={14} />
                    ) : c.paidCents > 0 ? (
                      money(c.paidCents)
                    ) : isSel ? (
                      money(sheet.feeCents)
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {selected.length > 0 && (
            <Button onClick={() => void submit()} disabled={pay.isPending}>
              {t.treasury.markPaid(selected.length, money(selected.length * sheet.feeCents))}
            </Button>
          )}

          <div className="glass overflow-hidden rounded-2xl">
            <Toggle
              label={t.treasury.exemptToggle}
              checked={row.exempt}
              disabled={exempt.isPending}
              onChange={(v) => exempt.mutate({ userId: row.member.id, exempt: v })}
            />
          </div>

          <div>
            <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {t.treasury.payments}
            </h3>
            {payments.isPending ? (
              <Skeleton className="h-14 w-full" />
            ) : paymentRows.length === 0 ? (
              <p className="px-1 text-[14px] text-hint">{t.treasury.noPayments}</p>
            ) : (
              <div className="glass overflow-hidden rounded-2xl">
                {paymentRows.map((p) => (
                  <div
                    key={p.id}
                    className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium">
                        {p.period ? f.periodLong(p.period) : ''}
                      </div>
                      <div className="text-[13px] text-hint">
                        {f.dayMonthShort(p.occurredOn)} · {money(p.amountCents)}
                      </div>
                    </div>
                    <Button small variant="glass" onClick={() => void undo(p)}>
                      {t.treasury.undo}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Edit the monthly dues amount. */
export function FeeSheet({
  open,
  feeCents,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  feeCents: number;
  onClose: () => void;
  onSave: (cents: number) => void;
  saving: boolean;
}) {
  const t = useT();
  const money = useMoney();
  const [value, setValue] = useState(() => String(feeCents / 100).replace('.', ','));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(String(feeCents / 100).replace('.', ','));
  }
  const cents = value.trim() === '0' ? 0 : parseAmount(value);
  return (
    <Sheet open={open} onClose={onClose} title={t.treasury.feeTitle}>
      <div className="flex flex-col gap-4 px-5 pb-2">
        <label className="glass flex items-center gap-2 rounded-2xl px-4 py-3">
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[28px] font-bold tabular-nums outline-none"
            autoFocus
          />
          <span className="text-[22px] font-semibold text-hint">{money.symbol}</span>
        </label>
        <p className="text-[14px] leading-snug text-hint">{t.treasury.feeHint}</p>
        <Button disabled={cents === null || saving} onClick={() => cents !== null && onSave(cents)}>
          {saving ? t.common.saving : t.common.save}
        </Button>
      </div>
    </Sheet>
  );
}
