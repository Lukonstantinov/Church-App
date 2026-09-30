import { useState, type ReactNode } from 'react';
import { BRAND_COLORS } from '@church/shared';
import { IconCalendar, IconChevronRight, IconSend, IconWallet } from '../components/icons';
import { useToast } from '../components/Toast';
import { Card, Screen, Title } from '../components/ui';
import { ApiError } from '../lib/api';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  fetchAttendanceExport,
  fetchDues,
  fetchTreasuryExport,
  sendDocumentToChat,
  useGroup,
  useMe,
} from '../lib/queries';
import { haptic } from '../lib/telegram';

type Kind = 'treasury' | 'attendance';
type Format = 'xlsx' | 'pdf';

/** PDF / Excel reports, built on the phone and delivered by the bot as a chat file. */
export function Reports({ groupId }: { groupId: number }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const me = useMe();
  const group = useGroup(groupId);
  const thisYear = Number(f.todayInput().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function make(kind: Kind, format: Format) {
    const church = me.data?.church;
    if (!church || busy) return;
    const key = `${kind}.${format}`;
    setBusy(key);
    setSent(null);
    try {
      const reports = await import('../lib/reports');
      const ctx = {
        t,
        f,
        currency: church.currency,
        brandHex: BRAND_COLORS[church.brandColor].light,
      };
      let blob: Blob;
      let name: string;
      if (kind === 'treasury') {
        const [data, dues] = await Promise.all([
          fetchTreasuryExport(groupId, year),
          fetchDues(groupId, year).catch(() => null),
        ]);
        name = t.reports.fileTreasury(data.groupName, year);
        blob =
          format === 'xlsx'
            ? await reports.treasuryXlsx(ctx, data, dues)
            : await reports.treasuryPdf(ctx, data, dues);
      } else {
        const data = await fetchAttendanceExport(groupId, year);
        name = t.reports.fileAttendance(data.groupName, year);
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

      <div className="glass flex items-center justify-between rounded-2xl p-1.5 shadow-card">
        <button
          type="button"
          aria-label="previous year"
          className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline"
          onClick={() => setYear((y) => y - 1)}
        >
          <IconChevronRight size={18} className="rotate-180" />
        </button>
        <span className="text-[17px] font-semibold tabular-nums">
          {t.reports.year} {year}
        </span>
        <button
          type="button"
          aria-label="next year"
          disabled={year >= thisYear}
          className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline disabled:opacity-30"
          onClick={() => setYear((y) => y + 1)}
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      <ReportCard
        icon={<IconWallet size={22} />}
        title={t.reports.treasury}
        hint={t.reports.treasuryHint}
        busy={busy?.startsWith('treasury') ? busy : null}
        onMake={(fmt) => void make('treasury', fmt)}
        disabled={busy !== null}
      />
      <ReportCard
        icon={<IconCalendar size={22} />}
        title={t.reports.attendance}
        hint={t.reports.attendanceHint}
        busy={busy?.startsWith('attendance') ? busy : null}
        onMake={(fmt) => void make('attendance', fmt)}
        disabled={busy !== null}
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
