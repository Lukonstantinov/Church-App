import { useMemo, useState, type ReactNode } from 'react';
import {
  displayName,
  resolveBrand,
  type GroupStatistics,
  type MeetingKind,
  type StatPerson,
} from '@church/shared';
import { AttendanceChart } from '../components/AttendanceChart';
import { Avatar } from '../components/Avatar';
import { PeriodPicker, usePeriod } from '../components/PeriodPicker';
import { PercentChip } from '../components/Status';
import {
  IconCalendar,
  IconChart,
  IconChevronRight,
  IconClock,
  IconHeart,
  IconSearch,
  IconSend,
  IconStar,
  IconUsers,
} from '../components/icons';
import { useToast } from '../components/Toast';
import { Card, Screen, Segmented, Skeleton, Title } from '../components/ui';
import { ApiError } from '../lib/api';
import { useEnv } from '../lib/env';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { sendDocumentToChat, useGroup, useMe, useStatistics } from '../lib/queries';
import { haptic } from '../lib/telegram';

type Tab = 'overview' | 'people' | 'meetings' | 'events';
type Sort = 'rate' | 'streak' | 'name' | 'serve';

/**
 * The ministry's statistics for a year, a month or any range: an overview, every person,
 * every meeting and every event, with a PDF / Excel download (sent to the bot chat).
 */
export function Statistics({ groupId }: { groupId: number }) {
  const t = useT();
  const group = useGroup(groupId);
  const p = usePeriod('year');
  const q = useStatistics(groupId, p.period, p.ok);
  const [tab, setTab] = useState<Tab>('overview');
  const s = q.data;

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.stats.title}</Title>
      <PeriodPicker p={p} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { key: 'overview', label: t.stats.tabOverview },
          { key: 'people', label: t.stats.tabPeople },
          { key: 'meetings', label: t.stats.tabMeetings },
          { key: 'events', label: t.stats.tabEvents },
        ]}
      />
      {!s ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
        </>
      ) : (
        <div className={q.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {tab === 'overview' && <OverviewTab s={s} onTab={setTab} />}
          {tab === 'people' && <PeopleTab s={s} />}
          {tab === 'meetings' && <MeetingsTab s={s} />}
          {tab === 'events' && <EventsTab s={s} />}
        </div>
      )}
      {s && <Download s={s} label={p.label} />}
    </Screen>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'bad';
  onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} className="flex min-w-0 flex-col gap-1 p-3.5">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-xl ${
          tone === 'good'
            ? 'bg-present/15 text-present'
            : tone === 'bad'
              ? 'bg-absent/15 text-absent'
              : 'bg-brand/12 text-accent'
        }`}
      >
        {icon}
      </span>
      <span className="text-[24px] font-bold leading-tight tabular-nums">{value}</span>
      <span className="text-[13px] font-semibold leading-tight">{label}</span>
      {hint && <span className="text-[12px] leading-tight text-hint">{hint}</span>}
    </Card>
  );
}

function OverviewTab({ s, onTab }: { s: GroupStatistics; onTab: (t: Tab) => void }) {
  const t = useT();
  const { push } = useNav();
  const x = s.summary;
  const active = s.people.filter((p) => p.active && p.counted > 0);
  const top = [...active].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0)).slice(0, 3);
  const care = s.people
    .filter((p) => p.active && p.streak >= 2)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5);
  const kindMax = Math.max(1, ...s.kinds.map((k) => k.meetings));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={<IconUsers size={17} />}
          label={t.stats.members}
          value={x.activeMembers}
          hint={t.stats.newLeft(x.newMembers, x.leftMembers)}
          onClick={() => onTab('people')}
        />
        <Tile
          icon={<IconChart size={17} />}
          label={t.stats.attendance}
          value={x.averageRate === null ? '—' : `${x.averageRate}%`}
          tone={x.averageRate === null ? undefined : x.averageRate >= 60 ? 'good' : 'bad'}
        />
        <Tile
          icon={<IconCalendar size={17} />}
          label={t.stats.meetingsHeld}
          value={x.meetingsHeld}
          hint={x.meetingsCancelled ? t.stats.cancelled(x.meetingsCancelled) : undefined}
          onClick={() => onTab('meetings')}
        />
        <Tile
          icon={<IconUsers size={17} />}
          label={t.stats.perMeeting}
          value={x.averagePeople ?? '—'}
          hint={t.stats.perMeetingHint}
        />
        <Tile icon={<IconStar size={17} />} label={t.stats.guests} value={x.guests} />
        <Tile
          icon={<IconClock size={17} />}
          label={t.stats.late}
          value={x.late}
          hint={`${t.stats.excused}: ${x.excused}`}
        />
        <Tile
          icon={<IconHeart size={17} />}
          label={t.stats.faithful}
          value={x.faithful}
          hint={t.stats.faithfulHint}
          tone="good"
          onClick={() => onTab('people')}
        />
        <Tile
          icon={<IconHeart size={17} />}
          label={t.stats.atRisk}
          value={x.atRisk}
          hint={t.stats.atRiskHint}
          tone={x.atRisk ? 'bad' : undefined}
          onClick={() => onTab('people')}
        />
        <Tile
          icon={<IconCalendar size={17} />}
          label={t.stats.events}
          value={x.events}
          onClick={() => onTab('events')}
        />
        <Tile
          icon={<IconUsers size={17} />}
          label={t.stats.duties}
          value={x.dutySlots ? `${Math.round((x.dutiesFilled / x.dutySlots) * 100)}%` : '—'}
          hint={t.stats.dutiesHint(x.dutiesFilled, x.dutySlots)}
          onClick={() => onTab('events')}
        />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-[17px] font-semibold">{t.stats.chart}</h2>
        {s.series.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-hint">{t.stats.noData}</p>
        ) : (
          <AttendanceChart series={s.series} average={x.averageRate} />
        )}
      </Card>

      {s.kinds.length > 0 && (
        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-[17px] font-semibold">{t.stats.byKind}</h2>
          {s.kinds.map((k) => (
            <div key={k.kind ?? 'none'}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[14px]">
                <span className="font-medium">
                  {k.kind ? t.meetings.kinds[k.kind as MeetingKind] : t.stats.noKind}
                </span>
                <span className="text-hint">
                  {t.common.meetings(k.meetings)} ·{' '}
                  <b className="text-text">{k.averageRate === null ? '—' : `${k.averageRate}%`}</b>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-hairline">
                <div
                  className="brand-gradient h-full rounded-full"
                  style={{ width: `${(k.meetings / kindMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      {top.length > 0 && (
        <PeopleCard
          title={t.stats.top}
          people={top}
          onOpen={(id) => push({ name: 'member', userId: id })}
        />
      )}
      {care.length > 0 && (
        <PeopleCard
          title={t.stats.needCare}
          people={care}
          warn
          onOpen={(id) => push({ name: 'member', userId: id })}
        />
      )}
    </div>
  );
}

function PeopleCard({
  title,
  people,
  warn,
  onOpen,
}: {
  title: string;
  people: StatPerson[];
  warn?: boolean;
  onOpen: (id: number) => void;
}) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <h2 className="px-4 pb-1 pt-3.5 text-[17px] font-semibold">{title}</h2>
      {people.map((p) => (
        <button
          key={p.userId}
          type="button"
          onClick={() => onOpen(p.userId)}
          className="flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left last:border-b-0 active:bg-hairline"
        >
          <Avatar id={p.userId} firstName={p.firstName} lastName={p.lastName} size={34} />
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[15px] font-medium ${p.isAdmin ? 'admin-name' : ''}`}
            >
              {displayName(p)}
            </span>
            {warn && (
              <span className="block text-[12px] text-absent">{t.stats.streak(p.streak)}</span>
            )}
          </span>
          <PercentChip percent={p.percent} />
        </button>
      ))}
    </Card>
  );
}

function PeopleTab({ s }: { s: GroupStatistics }) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const [sort, setSort] = useState<Sort>('rate');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = s.people.filter(
      (p) =>
        !needle ||
        displayName(p).toLowerCase().includes(needle) ||
        (p.username ?? '').toLowerCase().includes(needle),
    );
    const by: Record<Sort, (a: StatPerson, b: StatPerson) => number> = {
      rate: (a, b) => (b.percent ?? -1) - (a.percent ?? -1),
      streak: (a, b) => b.streak - a.streak,
      name: (a, b) => displayName(a).localeCompare(displayName(b)),
      serve: (a, b) => b.duties + b.led + b.snacks - (a.duties + a.led + a.snacks),
    };
    return [...rows].sort((a, b) => by[sort](a, b) || displayName(a).localeCompare(displayName(b)));
  }, [s.people, sort, query]);

  return (
    <div className="flex flex-col gap-3">
      <label className="glass flex items-center gap-2 rounded-2xl px-3.5 py-2.5 shadow-card">
        <IconSearch size={18} className="text-hint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.stats.search}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </label>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {(
          [
            ['rate', t.stats.sortRate],
            ['streak', t.stats.sortStreak],
            ['serve', t.stats.sortServe],
            ['name', t.stats.sortName],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSort(k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-semibold ${
              sort === k ? 'brand-gradient text-white' : 'bg-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {list.length === 0 && <p className="px-4 py-6 text-center text-hint">{t.stats.noData}</p>}
        {list.map((p) => {
          const total = p.present + p.late + p.absent + p.excused;
          const seg = (n: number, cls: string) =>
            n > 0 ? <span className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
          return (
            <div key={p.userId} className="border-b border-hairline last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === p.userId ? null : p.userId))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hairline"
              >
                <Avatar id={p.userId} firstName={p.firstName} lastName={p.lastName} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-[16px] font-medium ${p.isAdmin ? 'admin-name' : ''}`}
                    >
                      {displayName(p)}
                    </span>
                    {!p.active && (
                      <span className="shrink-0 rounded-full bg-hairline px-1.5 text-[11px] text-hint">
                        {t.stats.leftMinistry}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-hint">
                    {[
                      p.positionName,
                      p.streak >= 2 ? t.stats.streak(p.streak) : null,
                      p.lastSeen ? t.stats.lastSeen(f.dayMonth(p.lastSeen)) : t.stats.never,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {total > 0 && (
                    <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-hairline">
                      {seg(p.present, 'bg-present')}
                      {seg(p.late, 'bg-late')}
                      {seg(p.excused, 'bg-excused')}
                      {seg(p.absent, 'bg-absent')}
                    </span>
                  )}
                </span>
                <PercentChip percent={p.percent} />
              </button>
              {open === p.userId && (
                <div className="flex flex-col gap-2 bg-hairline/40 px-4 pb-3 pt-1">
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {(
                      [
                        [t.status.present, p.present, 'text-present'],
                        [t.status.late, p.late, 'text-late'],
                        [t.status.excused, p.excused, 'text-excused'],
                        [t.status.absent, p.absent, 'text-absent'],
                      ] as const
                    ).map(([label, n, cls]) => (
                      <div key={label} className="rounded-xl bg-[var(--color-section)] py-1.5">
                        <div className={`text-[18px] font-bold tabular-nums ${cls}`}>{n}</div>
                        <div className="truncate px-1 text-[11px] text-hint">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {(
                      [
                        [t.stats.led, p.led],
                        [t.stats.snacks, p.snacks],
                        [t.stats.dutiesShort, p.duties],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label} className="rounded-xl bg-[var(--color-section)] py-1.5">
                        <div className="text-[18px] font-bold tabular-nums">{n}</div>
                        <div className="truncate px-1 text-[11px] text-hint">{label}</div>
                      </div>
                    ))}
                  </div>
                  {p.joinedAt && (
                    <div className="text-[13px] text-hint">
                      {t.stats.joined} {f.dayMonth(p.joinedAt)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => push({ name: 'member', userId: p.userId })}
                    className="flex items-center justify-center gap-1 rounded-xl bg-[var(--color-section)] py-2 text-[14px] font-semibold text-link"
                  >
                    {t.stats.profile} <IconChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function MeetingsTab({ s }: { s: GroupStatistics }) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  if (s.meetings.length === 0)
    return (
      <Card>
        <p className="px-4 py-8 text-center text-hint">{t.stats.noData}</p>
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      {[...s.meetings].reverse().map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => push({ name: 'meeting', meetingId: m.id })}
          className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 active:bg-hairline"
        >
          <span className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-hairline py-1 leading-tight">
            <span className="text-[17px] font-bold tabular-nums">
              {f.ddmm(m.startsAt).slice(0, 2)}
            </span>
            <span className="text-[11px] text-hint">{f.ddmm(m.startsAt).slice(3)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">
              {m.title}
              {m.topic ? ` «${m.topic}»` : ''}
            </span>
            <span className="block truncate text-[12px] text-hint">
              {[
                m.kind ? t.meetings.kinds[m.kind as MeetingKind] : null,
                m.leaderName ? `${t.stats.leader}: ${m.leaderName}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="mt-1 flex gap-2 text-[12px] font-semibold tabular-nums">
              <span className="text-present">✓ {m.present}</span>
              <span className="text-late">◷ {m.late}</span>
              <span className="text-excused">○ {m.excused}</span>
              <span className="text-absent">✕ {m.absent}</span>
              {m.guests > 0 && <span className="text-hint">+{m.guests}</span>}
            </span>
          </span>
          <PercentChip percent={m.rate} />
        </button>
      ))}
    </Card>
  );
}

function EventsTab({ s }: { s: GroupStatistics }) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  if (s.events.length === 0)
    return (
      <Card>
        <p className="px-4 py-8 text-center text-hint">{t.stats.noData}</p>
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      {s.events.map((e) => {
        const fill = e.slots ? Math.round((e.filled / e.slots) * 100) : null;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => push({ name: 'event', eventId: e.id })}
            className="flex w-full flex-col gap-1.5 border-b border-hairline px-4 py-3 text-left last:border-b-0 active:bg-hairline"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-semibold">{e.title}</span>
              <span className="shrink-0 text-[12px] text-hint">
                {f.weekdayDayMonth(e.startsAt)}
              </span>
            </span>
            <span className="flex gap-3 text-[13px]">
              <span className="text-present">
                {e.going} {t.stats.going}
              </span>
              <span className="text-hint">
                {e.notGoing} {t.stats.notGoing}
              </span>
            </span>
            {e.slots > 0 && (
              <span className="flex items-center gap-2">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-hairline">
                  <span
                    className="brand-gradient block h-full rounded-full"
                    style={{ width: `${fill}%` }}
                  />
                </span>
                <span className="text-[12px] tabular-nums text-hint">
                  {t.stats.duties}: {e.filled}/{e.slots}
                </span>
              </span>
            )}
          </button>
        );
      })}
    </Card>
  );
}

/** PDF / Excel of the period's statistics, sent by the bot to the user's chat. */
function Download({ s, label }: { s: GroupStatistics; label: string }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const me = useMe();
  const { env } = useEnv();
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function make(format: 'xlsx' | 'pdf') {
    const church = me.data?.church;
    if (!church || busy) return;
    setBusy(format);
    setSent(null);
    try {
      const reports = await import('../lib/reports');
      const ctx = {
        t,
        f,
        currency: church.currency,
        brandHex: resolveBrand(env?.brandColor ?? church.brandColor).light,
      };
      const blob =
        format === 'xlsx'
          ? await reports.statisticsXlsx(ctx, s, label)
          : await reports.statisticsPdf(ctx, s, label);
      const name = t.stats.file(s.groupName, label);
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

  const btn = (fmt: 'xlsx' | 'pdf', text: string) => (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => void make(fmt)}
      className={`flex min-h-[48px] flex-1 items-center justify-center rounded-2xl text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${
        fmt === 'pdf' ? 'bg-absent/12 text-absent' : 'bg-present/14 text-present'
      }`}
    >
      {busy === fmt ? t.reports.generating : text}
    </button>
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[17px] font-semibold">{t.stats.download}</div>
      <div className="flex gap-2">
        {btn('xlsx', 'Excel')}
        {btn('pdf', 'PDF')}
      </div>
      {sent ? (
        <div className="flex items-center gap-2 text-[13px] text-present">
          <IconSend size={15} /> {t.reports.sent}
        </div>
      ) : (
        <p className="text-[12px] leading-snug text-hint">{t.reports.howItWorks}</p>
      )}
    </Card>
  );
}
