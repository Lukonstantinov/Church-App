import { forwardRef } from 'react';
import { displayName, type ChurchInfo, type EventDetail, type GroupSummary } from '@church/shared';
import { useEventWhen } from './EventCard';
import { useT } from '../lib/i18n';
import { LookTop } from './LookTop';
import { ProgramList } from './EventProgram';

/** Width the poster is drawn at (and captured at, twice over). */
export const SHEET_WIDTH = 720;

/**
 * The event as one tall poster: cover with title, when and where; the church's label
 * top right; the full description; the programme; and who is responsible for what, with
 * each duty's leader. Drawn once and captured as a picture (and from it a PDF).
 */
export const EventSheet = forwardRef<
  HTMLDivElement,
  { e: EventDetail; g: GroupSummary | undefined; church: ChurchInfo }
>(function EventSheet({ e, g, church }, ref) {
  const t = useT();
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
        {e.description && (
          <p className="whitespace-pre-line text-[21px] leading-relaxed">{e.description}</p>
        )}

        {e.program.length > 0 && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">{t.events.program}</h2>
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] text-[19px]">
              <ProgramList items={e.program} />
            </div>
          </section>
        )}

        {e.roles.length > 0 && (
          <section>
            <h2 className="mb-3 text-[24px] font-extrabold">{t.events.sheetTitle}</h2>
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb]">
              {e.roles.map((r) => (
                <div key={r.id} className="border-b border-[#e5e7eb] px-5 py-4 last:border-b-0">
                  <div className="text-[21px] font-bold">{r.name}</div>
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

        <footer className="flex items-center justify-between border-t border-[#e5e7eb] pt-5 text-[15px] text-[#9ca3af]">
          <span>{label}</span>
          <span>{t.events.sheetMade}</span>
        </footer>
      </div>
    </div>
  );
});
