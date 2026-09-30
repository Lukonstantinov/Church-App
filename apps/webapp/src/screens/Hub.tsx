import { displayName, resolveBrand, type GroupSummary, type MeResponse } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { BrandHeader } from '../components/BrandHeader';
import { IconPlus, IconSettings, IconUsers } from '../components/icons';
import { Badge, Card, EmptyState, Loading, Row, Screen, Section } from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useGroups } from '../lib/queries';

/** Main page: every ministry the person belongs to (admins: all), two per row. */
export function Hub({ me }: { me: MeResponse }) {
  const t = useT();
  const { push } = useNav();
  const groups = useGroups();
  if (groups.isPending) return <Loading />;
  const list = groups.data ?? [];
  const pending = me.memberships.filter((m) => m.status === 'pending');
  const isAdmin = me.user.isAdmin;

  return (
    <Screen>
      <BrandHeader title={t.env.hubTitle} subtitle={t.env.hubSubtitle(list.length)} />

      {list.length === 0 && !isAdmin ? (
        <Card>
          <EmptyState icon={<IconUsers size={26} />} title={t.env.noEnvs}>
            {t.env.noEnvsText}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {list.map((g) => (
            <EnvCard
              key={g.id}
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

      <Section>
        <Row
          before={
            <Avatar id={me.user.id} firstName={me.user.firstName} lastName={me.user.lastName} />
          }
          title={displayName(me.user)}
          subtitle={me.user.username ? `@${me.user.username}` : undefined}
          onClick={() => push({ name: 'member', userId: me.user.id })}
        />
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
function EnvCard({
  g,
  fallbackTheme,
  onClick,
}: {
  g: GroupSummary;
  fallbackTheme: string;
  onClick: () => void;
}) {
  const t = useT();
  const theme = resolveBrand(g.brandColor ?? fallbackTheme);
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
      className="relative flex min-h-[168px] flex-col overflow-hidden rounded-[26px] p-3.5 text-left text-white shadow-cta transition active:scale-[0.97]"
      style={{ background: `linear-gradient(145deg, ${theme.light} 0%, ${theme.partner} 100%)` }}
    >
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
        {g.pendingCount > 0 && (
          <span className="min-w-[22px] rounded-full bg-white px-1.5 text-center text-[12px] font-bold leading-[22px] text-[var(--brand)]">
            +{g.pendingCount}
          </span>
        )}
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
