import { forwardRef } from 'react';
import {
  displayName,
  dutyColor,
  type ChurchInfo,
  type EventDetail,
  type GroupSummary,
} from '@church/shared';
import { useEventWhen } from './EventCard';
import { useT } from '../lib/i18n';
import { LookTop } from './LookTop';
import { ProgramList } from './EventProgram';
import { useMoney } from './money';

/** Width the poster is drawn at (and captured at, twice over). */
export const SHEET_WIDTH = 720;

/** The parts of the sheet below the poster that can be shown or left out. */
export const SHEET_PARTS = ['description', 'program', 'roles', 'going', 'finance'] as const;
export type SheetPart = (typeof SHEET_PARTS)[number];

/** Which parts this event has anything for (finance only for people who see the money). */
export const availableParts = (e: EventDetail): SheetPart[] =>
  SHEET_PARTS.filter((p) =>
    p === 'description'
      ? !!e.description
      : p === 'program'
        ? e.program.length > 0
        : p === 'roles'
          ? e.roles.length > 0
          : p === 'going'
            ? e.rsvps.going.length > 0
            : e.finance !== null,
  );

/**
 * The event as one tall poster: cover with title, when and where; the church's label
 * top right; the full description; the programme; and who is responsible for what, with
 * each duty's leader. Drawn once and captured as a picture (and from it a PDF).
 */
export const EventSheet = forwardRef<
  HTMLDivElement,
  {
    e: EventDetail;
    g: GroupSummary | undefined;
    church: ChurchInfo;
    /** What to show under the poster (default: everything the event has). */
    parts?: readonly SheetPart[];
  }
>(function EventSheet({ e, g, church, parts = SHEET_PARTS }, ref) {
  const t = useT();
  const money = useMoney();
  const show = (p: SheetPart) => parts.includes(p);
  const when = useEventWhen();
  const label = church.sheetLabel || church.name;
  return (
    <div
      ref={ref}
      style={{ width: SHEET_WIDTH }}
      className="overflow-hidden bg-white text-[#111827]"
    >
      <LookTop look={e.look ?? g ?? null} className="relative px-9 pb-9 pt-8">
        {e.coverUrl && (
          <>
            <img src={e.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/20" />
          </>
        )}
        <div className="relative flex min-h-[330px] flex-col justify-between">
          <div className="flex items-start justify-between gap-4">
            <span className="text-[15px] font-bold uppercase tracking-[0.14em] opacity-90">
              {e.groupName}
            </span>
            <span className="flex shrink-0 items-center gap-2.5 rounded-full bg-white py-1.5 pl-2 pr-4 text-[#111827] shadow-md">
              {church.logoUrl && (
                <img src={church.logoUrl} alt="" className="h-8 w-8 rounded-full object-contain" />
              )}
              <span className="text-[17px] font-extrabold tracking-tight">{label}</span>
            </span>
          </div>
          <div className="mt-16">
            <h1 className="text-[52px] font-extrabold leading-[1.05] tracking-tight">{e.title}</h1>
            <div className="mt-4 text-[22px] font-semibold opacity-95">{when(e)}</div>
            {e.location && <div className="mt-1 text-[20px] opacity-90">📍 {e.location}</div>}
          </div>
        </div>
      </LookTop>

      <div className="flex flex-col gap-8 px-9 py-9">
        {show('description') && e.description && (
          <p className="whitespace-pre-line text-[21px] leading-relaxed">{e.description}</p>
        )}

        {show('program') && e.program.length > 0 && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">{t.events.program}</h2>
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] text-[19px]">
              <ProgramList items={e.program} />
            </div>
          </section>
        )}

        {show('roles') && e.roles.length > 0 && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">{t.events.sheetTitle}</h2>
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb]">
              {e.roles.map((r, i) => (
                <div
                  key={r.id}
                  className="border-b border-[#e5e7eb] px-5 py-4 last:border-b-0"
                  style={{ boxShadow: `inset 6px 0 0 ${dutyColor(i).hex}` }}
                >
                  <div className="flex items-center gap-2.5 text-[21px] font-bold">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ background: dutyColor(i).hex }}
                    />
                    {r.name}
                  </div>
                  {r.description && (
                    <div className="mt-0.5 text-[17px] leading-snug text-[#6b7280]">
                      {r.description}
                    </div>
                  )}
                  {r.assignees.length === 0 ? (
                    <div className="mt-2 text-[17px] text-[#9ca3af]">—</div>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {[...r.assignees]
                        .sort(
                          (a, b) => Number(b.id === r.leader?.id) - Number(a.id === r.leader?.id),
                        )
                        .map((a) => (
                          <span
                            key={a.id}
                            className={`rounded-full px-3.5 py-1 text-[17px] font-semibold ${
                              a.id === r.leader?.id
                                ? 'bg-[#fef3c7] text-[#92400e] ring-1 ring-[#f59e0b]'
                                : 'bg-[#f3f4f6]'
                            }`}
                          >
                            {a.id === r.leader?.id ? '★ ' : ''}
                            {displayName(a)}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {e.roles.some((r) => r.leader) && (
              <p className="mt-2 text-[15px] text-[#6b7280]">★ — {t.events.colLeader}</p>
            )}
          </section>
        )}

        {show('going') && e.rsvps.going.length > 0 && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">
              {t.events.sheetGoing} · {e.rsvps.going.length}
            </h2>
            <div className="flex flex-wrap gap-2">
              {e.rsvps.going.map((p) => (
                <span
                  key={p.id}
                  className="rounded-full bg-[#f3f4f6] px-3.5 py-1 text-[17px] font-semibold"
                >
                  {displayName(p)}
                </span>
              ))}
            </div>
          </section>
        )}

        {show('finance') && e.finance && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">{t.events.sheetFinance}</h2>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  [t.events.sheetPrice, e.finance.priceCents],
                  [t.events.sheetCollected, e.finance.collectedCents],
                  [t.events.sheetSpent, e.finance.expenseCents],
                ] as const
              ).map(([label, cents]) => (
                <div key={label} className="rounded-2xl bg-[#f3f4f6] px-4 py-3">
                  <div className="text-[15px] text-[#6b7280]">{label}</div>
                  <div className="text-[24px] font-extrabold">
                    {cents === null ? '—' : money(cents)}
                  </div>
                </div>
              ))}
            </div>
            {e.finance.people.some((p) => p.paidCents > 0) && (
              <div className="mt-3 text-[17px]">
                <b>{t.events.sheetPaid}:</b>{' '}
                {e.finance.people
                  .filter((p) => p.paidCents > 0)
                  .map((p) => `${displayName(p.member)} (${money(p.paidCents)})`)
                  .join(', ')}
              </div>
            )}
          </section>
        )}

        <footer className="flex items-center justify-between border-t border-[#e5e7eb] pt-5 text-[15px] text-[#9ca3af]">
          <span>{label}</span>
          <span>{t.events.sheetMade}</span>
        </footer>
      </div>
    </div>
  );
});
