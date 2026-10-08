import { useState } from 'react';
import { displayName, type GroupSummary, type MemberRow } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { LabelPicker, PersonTags } from '../components/LabelChip';
import { PersonName } from '../components/LabelLook';
import { IconSearch, IconTag, IconTelegram, IconUserPlus, IconUsers } from '../components/icons';
import { LinkShare } from '../components/LinkShare';
import { PercentChip } from '../components/Status';
import { useToast } from '../components/Toast';
import {
  ActionRow,
  Badge,
  Button,
  Chevron,
  EmptyState,
  Screen,
  Section,
  Skeleton,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useEnv } from '../lib/env';
import { useNav } from '../lib/nav';
import {
  useGroup,
  useMemberDetail,
  useMembers,
  usePositions,
  useRotateInvite,
  useUpdateMembership,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';
import { useFmt } from '../lib/format';

export function People({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
  const t = useT();
  const toast = useToast();
  const group = useGroup(active.id);
  const members = useMembers(active.id);
  const update = useUpdateMembership();
  const rotate = useRotateInvite();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const { can } = useEnv();
  const positions = usePositions(active.id);
  const list = members.data ?? [];
  const pending = can('people.manage') ? list.filter((m) => m.status === 'pending') : [];
  const activeList = list.filter((m) => m.status === 'active');
  // One list for everyone, in the ministry's position order (leaders first), then by name;
  // chips filter it by position.
  const defaultId = positions.data?.find((p) => p.isDefault)?.id ?? null;
  const order = new Map((positions.data ?? []).map((p, i) => [p.id, p.isDefault ? 999 : i]));
  const rank = (m: MemberRow) => order.get(m.positionId ?? -1) ?? 999;
  const [byName, setByName] = useState(false);
  const sorted = [...activeList].sort(
    (a, b) => (byName ? 0 : rank(a) - rank(b)) || displayName(a).localeCompare(displayName(b)),
  );
  const chips = (positions.data ?? [])
    .map((p) => ({
      p,
      n: activeList.filter((m) =>
        p.isDefault ? m.positionId === p.id || m.positionId === null : m.positionId === p.id,
      ).length,
    }))
    .filter((x) => x.n > 0);
  const [only, setOnly] = useState<number | null>(null);
  const q = query.trim().toLocaleLowerCase();
  const filtered = sorted.filter(
    (m) =>
      (only === null || m.positionId === only || (only === defaultId && m.positionId === null)) &&
      (!q ||
        displayName(m).toLocaleLowerCase().includes(q) ||
        (m.username ?? '').toLocaleLowerCase().includes(q)),
  );

  async function decide(m: MemberRow, approve: boolean) {
    try {
      await update.mutateAsync({
        membershipId: m.membershipId,
        status: approve ? 'active' : 'rejected',
      });
      if (approve) haptic.success();
      toast(approve ? t.people.approved(displayName(m)) : t.people.rejected);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  const row = (m: MemberRow) => (
    <div key={m.membershipId} className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          setOpenId((id) => (id === m.membershipId ? null : m.membershipId));
        }}
        aria-expanded={openId === m.membershipId}
        className="flex min-h-[62px] w-full items-center gap-3 px-3 py-2 text-left active:bg-hairline"
      >
        <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} photoUrl={m.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <PersonName
              name={displayName(m)}
              labels={m.labels}
              positionLook={m.positionLook}
              isAdmin={m.isAdmin}
              className="min-w-0 truncate text-[17px] font-medium"
            />
            <PersonTags
              inline
              positionLook={m.positionLook}
              role={m.role}
              positionName={m.positionName}
              defaultPosition={m.positionId === defaultId}
              leaderText={t.roles.leader}
              labels={m.labels}
            />
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-hint">
            {m.username ? `@${m.username}` : m.offline ? t.common.offline : null}
            {!m.offline && !m.isReachable && <Badge tone="danger">{t.common.unreachable}</Badge>}
          </div>
        </div>
        <PercentChip percent={m.recentPercent} />
        <span className={`transition-transform ${openId === m.membershipId ? 'rotate-90' : ''}`}>
          <Chevron />
        </span>
      </button>
      {openId === m.membershipId && (
        <PersonDetails
          m={m}
          groupId={active.id}
          canLabel={can('people.manage')}
          onProfile={() => push({ name: 'member', userId: m.userId })}
        />
      )}
    </div>
  );

  return (
    <Screen tabs>
      <GroupSwitcher
        groups={groups}
        active={active}
        subtitle={t.common.members(active.activeCount)}
      />

      {members.isPending && <Skeleton className="h-48 w-full" />}

      {pending.length > 0 && (
        <Section title={`${t.people.requests} · ${pending.length}`}>
          {pending.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-2.5 border-b border-hairline px-3 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  id={m.userId}
                  firstName={m.firstName}
                  lastName={m.lastName}
                  photoUrl={m.photoUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-medium">{displayName(m)}</div>
                  {m.username && (
                    <div className="truncate text-[13px] text-hint">@{m.username}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Button onClick={() => void decide(m, true)} disabled={update.isPending}>
                    {t.people.approve}
                  </Button>
                </div>
                <div className="flex-1">
                  <Button
                    variant="destructive"
                    onClick={() => void decide(m, false)}
                    disabled={update.isPending}
                  >
                    {t.people.reject}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </Section>
      )}

      <div className="flex flex-col gap-3">
        {activeList.length > 5 && (
          <label className="glass flex min-h-[46px] items-center gap-2 rounded-2xl px-3 shadow-card">
            <IconSearch size={18} className="text-hint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.common.searchByName}
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-hint"
            />
          </label>
        )}
        {activeList.length > 1 && <SortSwitch byName={byName} onChange={setByName} />}
        {chips.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <FilterChip on={only === null} onClick={() => setOnly(null)}>
              {t.people.all} · {activeList.length}
            </FilterChip>
            {chips.map(({ p, n }) => (
              <FilterChip key={p.id} on={only === p.id} onClick={() => setOnly(p.id)}>
                {p.name} · {n}
              </FilterChip>
            ))}
          </div>
        )}
        <Section title={`${t.people.members} · ${filtered.length}`}>
          {members.isPending ? null : activeList.length === 0 ? (
            <EmptyState icon={<IconUsers size={26} />} title={t.people.emptyTitle}>
              {t.people.emptyText}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-5 text-center text-[14px] text-hint">{t.common.nothingFound}</p>
          ) : (
            filtered.map(row)
          )}
          {can('people.manage') && (
            <ActionRow
              icon={<IconUserPlus size={20} />}
              onClick={() => push({ name: 'addPerson', groupId: active.id })}
            >
              {t.env.addPerson}
            </ActionRow>
          )}
          {can('people.manage') && (
            <ActionRow
              icon={<IconTag size={20} />}
              onClick={() => push({ name: 'labels', groupId: active.id })}
            >
              {t.labels.manage}
            </ActionRow>
          )}
        </Section>
      </div>

      {group.data?.inviteLink && (
        <Section title={t.people.inviteLink} footer={t.people.inviteHint}>
          <LinkShare link={group.data.inviteLink} shareText={t.people.joinShare(active.name)} />
          <ActionRow
            disabled={rotate.isPending}
            onClick={async () => {
              if (await confirmDialog(t.people.rotateConfirm)) {
                await rotate.mutateAsync(active.id);
                toast(t.people.rotated);
              }
            }}
          >
            {t.people.rotate}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}

/** A member's row opened in place: attendance, where they serve, contact and profile. */
function PersonDetails({
  m,
  groupId,
  canLabel,
  onProfile,
}: {
  m: MemberRow;
  groupId: number;
  canLabel: boolean;
  onProfile: () => void;
}) {
  const t = useT();
  const f = useFmt();
  const detail = useMemberDetail(m.userId);
  const d = detail.data;
  const serving = (d?.memberships ?? []).filter((x) => x.status === 'active');
  return (
    <div className="flex flex-col gap-3 bg-hairline/40 px-4 pb-4 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[var(--color-section)] p-2.5">
          <div className="text-[12px] text-hint">{t.people.attendanceRate}</div>
          <div className="text-[20px] font-bold tabular-nums">
            {m.recentPercent === null ? '—' : `${m.recentPercent}%`}
          </div>
        </div>
        <div className="rounded-xl bg-[var(--color-section)] p-2.5">
          <div className="text-[12px] text-hint">{t.people.joined}</div>
          <div className="text-[15px] font-semibold">
            {m.joinedAt ? f.dayMonth(m.joinedAt) : '—'}
          </div>
        </div>
      </div>
      {detail.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        serving.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-hint">
              {t.people.serves}
            </div>
            <div className="flex flex-col gap-1">
              {serving.map((x) => {
                const att = d?.attendance.find((a) => a.groupId === x.groupId);
                return (
                  <div
                    key={x.groupId}
                    className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-section)] px-3 py-2 text-[14px]"
                  >
                    <span className="min-w-0 truncate font-medium">{x.groupName}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {x.positionName && <Badge>{x.positionName}</Badge>}
                      {att && att.percent !== null && (
                        <span className="text-[13px] tabular-nums text-hint">{att.percent}%</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}
      {canLabel && <LabelPicker groupId={groupId} userId={m.userId} current={m.labels} />}
      <div className="flex gap-2">
        {m.username && (
          <Button small onClick={() => openTelegramLink(`https://t.me/${m.username}`)}>
            <IconTelegram size={16} /> {t.people.write}
          </Button>
        )}
        <Button small variant="glass" onClick={onProfile}>
          {t.people.profile}
        </Button>
      </div>
    </div>
  );
}

export function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition active:scale-95 ${
        on ? 'brand-gradient text-white shadow-cta' : 'glass shadow-card'
      }`}
    >
      {children}
    </button>
  );
}

/** Members in the ministry's position order (Позиции, top first) or simply by name. */
export function SortSwitch({
  byName,
  onChange,
}: {
  byName: boolean;
  onChange: (byName: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="glass flex self-start rounded-full p-1 shadow-card">
      {[false, true].map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => {
            haptic.tap();
            onChange(v);
          }}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
            byName === v ? 'brand-gradient text-white' : 'text-hint'
          }`}
        >
          {v ? t.people.sortByName : t.people.sortByPosition}
        </button>
      ))}
    </div>
  );
}
