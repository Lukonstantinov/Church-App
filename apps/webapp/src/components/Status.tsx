import type { AttendanceStatus } from '@church/shared';
import { IconCheck, IconClock, IconInfo, IconX } from './icons';

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Был',
  late: 'Опоздал',
  excused: 'Уважительная',
  absent: 'Не был',
};

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

export function StatusIcon({ status, size = 18 }: { status: AttendanceStatus; size?: number }) {
  const Icon = { present: IconCheck, late: IconClock, excused: IconInfo, absent: IconX }[status];
  return <Icon size={size} />;
}

/** Icon + label, never color alone. */
export function StatusChip({ status, label }: { status: AttendanceStatus; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[12px] font-medium ${STATUS_TEXT[status]} ${STATUS_BG[status]}`}
    >
      <StatusIcon status={status} size={13} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

/** A small square for a history strip; the icon keeps it readable without color. */
export function StatusDot({ status, title }: { status: AttendanceStatus | null; title?: string }) {
  if (status === null) {
    return (
      <span title={title} className="inline-block h-[18px] w-[18px] rounded-[5px] bg-hairline" />
    );
  }
  return (
    <span
      title={title ?? STATUS_LABEL[status]}
      className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] ${STATUS_TEXT[status]} ${STATUS_BG[status]}`}
    >
      <StatusIcon status={status} size={12} />
    </span>
  );
}

/** Percentage as a chip whose tone follows the value; the number itself carries the meaning. */
export function PercentChip({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-[13px] text-hint">—</span>;
  const tone = percent >= 75 ? 'present' : percent >= 50 ? 'late' : 'absent';
  return (
    <span
      className={`inline-flex min-w-[46px] justify-center rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums ${STATUS_TEXT[tone]} ${STATUS_BG[tone]}`}
    >
      {percent}%
    </span>
  );
}

/** Key for the history strip: the same icons, spelled out. */
export function StatusLegend() {
  const items: AttendanceStatus[] = ['present', 'late', 'excused', 'absent'];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-hint">
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <StatusDot status={s} title="" />
          {STATUS_LABEL[s].toLowerCase()}
        </span>
      ))}
    </div>
  );
}
