import { useState, type ReactNode } from 'react';
import { resolveBrand } from '@church/shared';
import { IconCalendar, IconChevronRight, IconSend, IconWallet } from '../components/icons';
import { useToast } from '../components/Toast';
import { Card, Screen, Segmented, TextField, Title } from '../components/ui';
import { ApiError } from '../lib/api';
import { useEnv } from '../lib/env';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  fetchAttendanceExport,
  fetchTreasuryExport,
  sendDocumentToChat,
  useGroup,
  useMe,
  type ReportPeriod,
} from '../lib/queries';
import { haptic } from '../lib/telegram';

type Kind = 'treasury' | 'attendance';
type Mode = 'year' | 'month' | 'range';

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (d: string) => d.split('-').reverse().join('.');
/** First and last day of a "YYYY-MM" month. */
const monthSpan = (ym: string): ReportPeriod => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
};
type Format = 'xlsx' | 'pdf';

/** PDF / Excel reports, built on the phone and delivered by the bot as a chat file. */
export function Reports({ groupId }: { groupId: number }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const me = useMe();
  const { env } = useEnv();
  const group = useGroup(groupId);
  const thisYear = Number(f.todayInput().slice(0, 4));
  const today = f.todayInput();
  const [mode, setMode] = useState<Mode>('year');
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const period: ReportPeriod =
    mode === 'year'
      ? { from: `${year}-01-01`, to: `${year}-12-31` }
      : mode === 'month'
        ? monthSpan(month)
        : { from, to };
  // Title of the period in file and sheet names.
  const label =
    mode === 'year'
      ? String(year)
      : mode === 'month'
        ? f.periodLong(month)
        : `${dmy(from)}–${dmy(to)}`;
  const rangeOk = mode !== 'range' || (from <= to && from.length === 10 && to.length === 10);
  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function make(kind: Kind, format: Format) {
    const church = me.data?.church;
    if (!church || busy || !rangeOk) return;
    const key = `${kind}.${format}`;
    setBusy(key);
    setSent(null);
    try {
      const reports = await import('../lib/reports');
      const ctx = {
        t,
        f,
        currency: church.currency,
        brandHex: resolveBrand(env?.brandColor ?? church.brandColor).light,
      };
      let blob: Blob;
      let name: string;
      if (kind === 'treasury') {
        const data = { ...(await fetchTreasuryExport(groupId, period)), label };
        name = t.reports.fileTreasury(data.groupName, label);
        blob =
          format === 'xlsx'
            ? await reports.treasuryXlsx(ctx, data, null)
            : await reports.treasuryPdf(ctx, data, null);
      } else {
        const data = { ...(await fetchAttendanceExport(groupId, period)), label };
        name = t.reports.fileAttendance(data.groupName, label);
        blob =
          format === 'xlsx'
            ? await reports.attendanceXlsx(ctx, data)
            : await reports.attendancePdf(ctx, data);
      }
      const fileName = `${name.replace(/[^\p{L}\p{N} ._()«»–—-]/gu, '').slice(0, 75)}.${format}`;
      await sendDocumentToChat(blob, fileName);
      haptic.success();
      setSent(fileName);
    } catch (err) {
      haptic.error();
      toast(
        err instanceof ApiError && err.code === 'bot_blocked'
          ? t.reports.botBlocked
          : t.reports.failed,
        'error',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.reports.title}</Title>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { key: 'year', label: t.reports.year },
          { key: 'month', label: t.reports.month },
          { key: 'range', label: t.reports.range },
        ]}
      />

      {mode === 'range' ? (
        <div className="glass flex gap-3 rounded-2xl p-3 shadow-card">
          <div className="min-w-0 flex-1">
            <TextField label={t.reports.from} type="date" value={from} onChange={setFrom} />
          </div>
          <div className="min-w-0 flex-1">
            <TextField label={t.reports.to} type="date" value={to} onChange={setTo} />
          </div>
        </div>
      ) : (
        <div className="glass flex items-center justify-between rounded-2xl p-1.5 shadow-card">
          <button
            type="button"
            aria-label="previous"
            className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline"
            onClick={() => (mode === 'year' ? setYear((y) => y - 1) : shiftMonth(-1))}
          >
            <IconChevronRight size={18} className="rotate-180" />
          </button>
          <span className="text-[17px] font-semibold tabular-nums">
            {mode === 'year' ? `${t.reports.year} ${year}` : f.periodLong(month)}
          </span>
          <button
            type="button"
            aria-label="next"
            disabled={mode === 'year' ? year >= thisYear : month >= today.slice(0, 7)}
            className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline disabled:opacity-30"
            onClick={() => (mode === 'year' ? setYear((y) => y + 1) : shiftMonth(1))}
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
      {!rangeOk && (
        <p className="px-3 text-[13px] text-absent">
          {t.reports.from} ≤ {t.reports.to}
        </p>
      )}

      <ReportCard
        icon={<IconWallet size={22} />}
        title={t.reports.treasury}
        hint={t.reports.treasuryHint}
        busy={busy?.startsWith('treasury') ? busy : null}
        onMake={(fmt) => void make('treasury', fmt)}
        disabled={busy !== null || !rangeOk}
      />
      <ReportCard
        icon={<IconCalendar size={22} />}
        title={t.reports.attendance}
        hint={t.reports.attendanceHint}
        busy={busy?.startsWith('attendance') ? busy : null}
        onMake={(fmt) => void make('attendance', fmt)}
        disabled={busy !== null || !rangeOk}
      />

      {sent ? (
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-present/15 text-present">
            <IconSend size={19} />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">{t.reports.sent}</div>
            <div className="truncate text-[13px] text-hint">{sent}</div>
          </div>
        </Card>
      ) : (
        <p className="px-3 text-[13px] leading-snug text-hint">{t.reports.howItWorks}</p>
      )}
    </Screen>
  );
}

function ReportCard({
  icon,
  title,
  hint,
  busy,
  disabled,
  onMake,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  busy: string | null;
  disabled: boolean;
  onMake: (f: Format) => void;
}) {
  const t = useT();
  const btn = (fmt: Format, label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onMake(fmt)}
      className={`flex min-h-[48px] flex-1 items-center justify-center rounded-2xl text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${
        fmt === 'pdf' ? 'bg-absent/12 text-absent' : 'bg-present/14 text-present'
      }`}
    >
      {busy?.endsWith(fmt) ? t.reports.generating : label}
    </button>
  );
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-cta">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold">{title}</div>
          <div className="text-[13px] text-hint">{hint}</div>
        </div>
      </div>
      <div className="flex gap-2">
        {btn('xlsx', 'Excel')}
        {btn('pdf', 'PDF')}
      </div>
    </Card>
  );
}
