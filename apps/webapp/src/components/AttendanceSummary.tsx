import { plural, type MemberAttendance } from '@church/shared';
import { shortDate } from '../lib/format';
import { StatusDot, StatusLegend } from './Status';
import { Card, Ring } from './ui';

/** Gauge + recent-meetings strip for one member in one group. */
export function AttendanceSummary({
  data,
  tz,
  showStreak,
}: {
  data: MemberAttendance;
  tz: string;
  showStreak?: boolean;
}) {
  const strip = [...data.recent].reverse(); // oldest → newest, left → right
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-[17px] font-semibold">{data.groupName}</h2>
      <div className="flex items-center gap-4">
        <Ring percent={data.percent} label={`Посещаемость ${data.percent ?? 0}%`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">Посещаемость</div>
          <div className="text-[14px] text-hint">
            {data.counted === 0
              ? 'Ещё не было встреч с перекличкой'
              : `${data.attended} из ${data.counted} ${plural(data.counted, ['встречи', 'встреч', 'встреч'])}`}
          </div>
          {showStreak && data.streak >= 2 && (
            <div className="mt-1 text-[13px] font-medium text-absent">
              Пропущено подряд: {data.streak}
            </div>
          )}
        </div>
      </div>

      {strip.length > 0 && (
        <div className="mt-4">
          <div
            className="mb-1.5 flex items-center gap-1.5"
            role="list"
            aria-label="Последние встречи"
          >
            {strip.map((r) => (
              <div key={r.meetingId} role="listitem" className="flex flex-col items-center gap-1">
                <StatusDot status={r.status} title={`${shortDate(r.startsAt, tz)}`} />
                <span className="text-[10px] tabular-nums text-hint">
                  {new Intl.DateTimeFormat('ru-RU', {
                    timeZone: tz,
                    day: '2-digit',
                    month: '2-digit',
                  }).format(new Date(r.startsAt))}
                </span>
              </div>
            ))}
          </div>
          <StatusLegend />
        </div>
      )}
    </Card>
  );
}
