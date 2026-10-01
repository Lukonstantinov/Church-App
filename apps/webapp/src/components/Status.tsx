import type { AttendanceStatus } from '@church/shared';
import { useT } from '../lib/i18n';
import { IconCheck, IconClock, IconInfo, IconX } from './icons';

const STATUS_TEXT: Record<AttendanceStatus, string> = {
  present: 'text-present',
  late: 'text-late',
  excused: 'text-excused',
  absent: 'text-absent',
};
const STATUS_BG: Record<AttendanceStatus, string> = {
  present: 'bg-present/15',
  late: 'bg-late/15',
  excused: 'bg-excused/15',
  absent: 'bg-absent/15',
};

export function useStatusLabel() {
  const t = useT();
  return (s: AttendanceStatus) => t.status[s];
}

export function StatusIcon({ status, size = 18 }: { status: AttendanceStatus; size?: number }) {
  const Icon = { present: IconCheck, late: IconClock, excused: IconInfo, absent: IconX }[status];
  return <Icon size={size} />;
}

/** Icon + label, never color alone. */
export function StatusChip({ status }: { status: AttendanceStatus }) {
  const label = useStatusLabel();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[12px] font-semibold ${STATUS_TEXT[status]} ${STATUS_BG[status]}`}
    >
      <StatusIcon status={status} size={13} />
      {label(status)}
    </span>
  );
}

/** A small square for a history strip; the icon keeps it readable without color. */
export function StatusDot({ status, title }: { status: AttendanceStatus | null; title?: string }) {
  const label = useStatusLabel();
  if (status === null) {
    return (
      <span title={title} className="inline-block h-[18px] w-[18px] rounded-[6px] bg-hairline" />
    );
  }
  return (
    <span
      title={title ?? label(status)}
      className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] ${STATUS_TEXT[status]} ${STATUS_BG[status]}`}
    >
      <StatusIcon status={status} size={12} />
    </span>
  );
}

/** Key for the history strip: the same icons, spelled out. */
export function StatusLegend() {
  const label = useStatusLabel();
  const items: AttendanceStatus[] = ['present', 'absent'];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-hint">
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <StatusDot status={s} title="" />
          {label(s).toLocaleLowerCase()}
        </span>
      ))}
    </div>
  );
}

/** Percentage as a chip whose tone follows the value; the number itself carries the meaning. */
export function PercentChip({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-[13px] text-hint">—</span>;
  const tone = percent >= 75 ? 'present' : percent >= 50 ? 'late' : 'absent';
  return (
    <span
      className={`inline-flex min-w-[48px] justify-center rounded-full px-2 py-0.5 text-[13px] font-bold tabular-nums ${STATUS_TEXT[tone]} ${STATUS_BG[tone]}`}
    >
      {percent}%
    </span>
  );
}
