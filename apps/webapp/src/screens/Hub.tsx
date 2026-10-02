import { useState } from 'react';
import {
  displayName,
  resolveBrand,
  type EventSummary,
  type GroupSummary,
  type MeResponse,
} from '@church/shared';
import { Avatar } from '../components/Avatar';
import { CountdownBadge, hasCountdown } from '../components/Countdown';
import { LookTop } from '../components/LookTop';
import { TasksPill } from '../components/Assignments';
import { BrandHeader } from '../components/BrandHeader';
import { BackdropLayer, PatternLayer, onBrandStyle } from '../components/PatternLayer';
import { UnreadBadges } from '../components/FeedEntry';
import { IconChevronDown, IconPlus, IconSettings, IconUsers } from '../components/icons';
import { MyAssignments } from '../components/MyAssignments';
import { Badge, Card, EmptyState, Loading, Row, Screen, Section } from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useAssignments, useGroups, useMyEvents, usePinnedEvents } from '../lib/queries';
import { useEventWhen } from '../components/EventCard';

/** Main page: every ministry the person belongs to (admins: all), two per row. */
export function Hub({ me }: { me: MeResponse }) {
  const t = useT();
  const { push } = useNav();
  const groups = useGroups();
  const pinned = usePinnedEvents();
  const myEvents = useMyEvents();
  const myJobs = useAssignments();
  const [showMine, setShowMine] = useState(false);
  // Open duties: at events, plus meetings that still need an answer.
  const mine =
    (myEvents.data ?? []).filter((e) => e.myDuties.length > 0 && e.status !== 'cancelled').length +
    (myJobs.data ?? []).length;
  if (groups.isPending) return <Loading />;
  const list = groups.data ?? [];
  const pending = me.memberships.filter((m) => m.status === 'pending');
  const isAdmin = me.user.isAdmin;

  return (
    <Screen>
      <BrandHeader title={t.env.hubTitle} subtitle={t.env.hubSubtitle(list.length)} />

      <TasksPill />

      {(pinned.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            📌 {t.feed.pinned}
          </h2>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {pinned.data!.map((e) => (
              <PinnedEventCard
                key={e.id}
                e={e}
                fallbackTheme={me.church.brandColor}
                onClick={() => push({ name: 'event', eventId: e.id })}
              />
            ))}
          </div>
        </section>
      )}

      {list.length === 0 && !isAdmin ? (
        <Card>
          <EmptyState icon={<IconUsers size={26} />} title={t.env.noEnvs}>
            {t.env.noEnvsText}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {list.map((g, i) => (
            <EnvCard
              key={g.id}
              index={i}
              g={g}
              fallbackTheme={me.church.brandColor}
              onClick={() => push({ name: 'env', groupId: g.id })}
            />
          ))}
          {isAdmin && (
            <button
              type="button"
              onClick={() => push({ name: 'createGroup' })}
              className="glass flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-[26px] border-2 border-dashed border-hint/30 text-hint transition active:scale-[0.98]"
            >
              <span className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-cta">
                <IconPlus size={24} />
              </span>
              <span className="px-2 text-center text-[14px] font-semibold">{t.env.new}</span>
            </button>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <Section>
          {pending.map((m) => (
            <Row
              key={m.groupId}
              title={m.groupName}
              subtitle={t.member.statusPending}
              after={<Badge tone="hint">{t.home.pending}</Badge>}
            />
          ))}
        </Section>
      )}

      {showMine && <MyAssignments me={me} onClose={() => setShowMine(false)} />}

      <Section>
        <Row
          before={
            <Avatar id={me.user.id} firstName={me.user.firstName} lastName={me.user.lastName} />
          }
          title={displayName(me.user)}
          subtitle={me.user.username ? `@${me.user.username}` : undefined}
          after={
            <span className="flex items-center gap-1.5">
              {mine > 0 && (
                <span className="min-w-[22px] rounded-full bg-[#ef4444] px-1.5 text-center text-[12px] font-bold leading-[22px] text-white">
                  {mine}
                </span>
              )}
              <IconChevronDown
                size={18}
                className={`text-hint transition ${showMine ? 'rotate-180' : ''}`}
              />
            </span>
          }
          onClick={() => setShowMine((v) => !v)}
        />
        {me.user.isDeveloper && (
          <Row
            before={
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-text/85 text-[17px] text-[var(--color-section)]">
                📊
              </span>
            }
            title={t.dev.title}
            subtitle={t.dev.entry}
            onClick={() => push({ name: 'telemetry' })}
          />
        )}
        {isAdmin && (
          <Row
            before={
              <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
                <IconSettings size={19} />
              </span>
            }
            title={t.settings.title}
            subtitle={t.settings.entry}
            onClick={() => push({ name: 'settings' })}
          />
        )}
      </Section>
      <p className="px-4 text-[13px] leading-snug text-hint">{t.home.privacyNote}</p>
    </Screen>
  );
}

/** A tile in the ministry's own colours, with its logo and the person's position. */
export function EnvCard({
  g,
  fallbackTheme,
  onClick,
  index = 0,
}: {
  g: GroupSummary;
  fallbackTheme: string;
  onClick: () => void;
  index?: number;
}) {
  const t = useT();
  const theme = resolveBrand(g.brandColor ?? fallbackTheme);
  const on = onBrandStyle(g.textColor, !!g.pattern || !!g.backdropUrl);
  const initials = g.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`reveal sheen spring relative flex min-h-[168px] flex-col overflow-hidden rounded-[26px] p-3.5 text-left shadow-cta ${on.className}`}
      style={
        {
          ...on.style,
          '--i': index,
          background: `linear-gradient(145deg, ${theme.light} 0%, ${theme.partner} 100%)`,
        } as React.CSSProperties
      }
    >
      <PatternLayer pattern={g.pattern} logoUrl={g.logoUrl} />
      <BackdropLayer backdrop={g.backdrop} url={g.backdropUrl} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl"
      />
      <div className="relative flex items-start justify-between">
        {g.logoUrl ? (
          <img
            src={g.logoUrl}
            alt=""
            className="h-12 w-12 rounded-2xl bg-white object-contain p-0.5 shadow-md"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/22 text-[17px] font-bold backdrop-blur">
            {initials || '•'}
          </span>
        )}
        <span className="flex items-center gap-1">
          {g.pendingCount > 0 && (
            <span className="min-w-[22px] rounded-full bg-white px-1.5 text-center text-[12px] font-bold leading-[22px] text-[var(--brand)]">
              +{g.pendingCount}
            </span>
          )}
          <UnreadBadges g={g} fallbackTheme={fallbackTheme} />
        </span>
      </div>
      <div className="relative mt-auto pt-4">
        <div className="line-clamp-2 text-[18px] font-bold leading-tight">{g.name}</div>
        <div className="mt-1 text-[13px] text-white/80">{t.common.members(g.activeCount)}</div>
        {g.positionName && (
          <span className="mt-2 inline-block max-w-full truncate rounded-full bg-white/20 px-2.5 py-0.5 text-[12px] font-semibold backdrop-blur">
            {g.positionName}
          </span>
        )}
      </div>
    </button>
  );
}

/** A pinned church-wide event on the main page, in its ministry's colours. */
function PinnedEventCard({
  e,
  fallbackTheme,
  onClick,
}: {
  e: EventSummary;
  fallbackTheme: string;
  onClick: () => void;
}) {
  const when = useEventWhen();
  const groups = useGroups();
  // The event's own look, else its ministry's (colour, pattern, photo).
  const look = e.look ?? groups.data?.find((g) => g.id === e.groupId) ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block h-[150px] w-[78%] max-w-[320px] shrink-0 snap-start overflow-hidden rounded-[24px] text-left shadow-cta transition active:scale-[0.98]"
    >
      <LookTop look={look} fallbackColor={e.brandColor ?? fallbackTheme} className="h-full p-4">
        {e.coverUrl && (
          <>
            <img
              src={e.coverUrl}
              alt=""
              className="absolute inset-0 -z-0 h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          </>
        )}
        {hasCountdown(e) ? (
          <span className="self-start">
            <CountdownBadge startsAt={e.startsAt} design={e.design} />
          </span>
        ) : (
          <span />
        )}
        <span className="relative flex flex-col">
          <span className="text-[12px] font-bold uppercase tracking-wider opacity-80">
            {e.groupName}
          </span>
          <span className="line-clamp-2 text-[19px] font-bold leading-tight">{e.title}</span>
          <span className="text-[13px] opacity-85">{when(e)}</span>
        </span>
      </LookTop>
    </button>
  );
}
