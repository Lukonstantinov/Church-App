import type { MemberAttendance } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { GroupDot } from './GroupSwitcher';
import { StatusDot, StatusLegend } from './Status';
import { Card, Ring } from './ui';

/** Gauge + recent-meetings strip for one member in one group. */
export function AttendanceSummary({
  data,
  showStreak,
}: {
  data: MemberAttendance;
  showStreak?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  const strip = [...data.recent].reverse(); // oldest → newest, left → right
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold">
        <GroupDot id={data.groupId} />
        {data.groupName}
      </h2>
      <div className="flex items-center gap-4">
        <Ring percent={data.percent} label={`${t.member.attendance} ${data.percent ?? 0}%`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{t.member.attendance}</div>
          <div className="text-[14px] text-hint">
            {data.counted === 0
              ? t.member.noRollYet
              : t.member.attendedOf(data.attended, data.counted)}
          </div>
          {showStreak && data.streak >= 2 && (
            <div className="mt-1 text-[13px] font-semibold text-absent">
              {t.member.streak(data.streak)}
            </div>
          )}
        </div>
      </div>

      {strip.length > 0 && (
        <div className="mt-4">
          <div
            className="mb-2 flex flex-wrap items-center gap-1.5"
            role="list"
            aria-label={t.roll.recent}
          >
            {strip.map((r) => (
              <div key={r.meetingId} role="listitem" className="flex flex-col items-center gap-1">
                <StatusDot status={r.status} title={f.shortDate(r.startsAt)} />
                <span className="text-[10px] tabular-nums text-hint">{f.ddmm(r.startsAt)}</span>
              </div>
            ))}
          </div>
          <StatusLegend />
        </div>
      )}
    </Card>
  );
}
