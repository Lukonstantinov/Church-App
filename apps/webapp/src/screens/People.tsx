import { useState } from 'react';
import { displayName, type GroupSummary, type MemberRow } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconSearch, IconUserPlus, IconUsers } from '../components/icons';
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
import { useNav } from '../lib/nav';
import { useGroup, useMembers, useRotateInvite, useUpdateMembership } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

export function People({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
  const t = useT();
  const toast = useToast();
  const group = useGroup(active.id);
  const members = useMembers(active.id);
  const update = useUpdateMembership();
  const rotate = useRotateInvite();
  const [query, setQuery] = useState('');

  const list = members.data ?? [];
  const pending = list.filter((m) => m.status === 'pending');
  const leaders = list.filter((m) => m.status === 'active' && m.role === 'leader');
  const regular = list.filter((m) => m.status === 'active' && m.role === 'member');
  const q = query.trim().toLocaleLowerCase();
  const filtered = q
    ? regular.filter((m) => displayName(m).toLocaleLowerCase().includes(q))
    : regular;

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
    <button
      key={m.membershipId}
      type="button"
      onClick={() => push({ name: 'member', userId: m.userId })}
      className="flex min-h-[62px] w-full items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 active:bg-hairline"
    >
      <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-medium">{displayName(m)}</div>
        <div className="flex items-center gap-1.5 text-[13px] text-hint">
          {m.username ? `@${m.username}` : m.offline ? t.common.offline : null}
          {!m.offline && !m.isReachable && <Badge tone="danger">{t.common.unreachable}</Badge>}
        </div>
      </div>
      {m.role === 'member' && <PercentChip percent={m.recentPercent} />}
      <Chevron />
    </button>
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
                <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} />
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

      {leaders.length > 0 && <Section title={t.people.leaders}>{leaders.map(row)}</Section>}

      <div className="flex flex-col gap-3">
        {regular.length > 8 && (
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
        <Section title={t.people.members}>
          {members.isPending ? null : regular.length === 0 ? (
            <EmptyState icon={<IconUsers size={26} />} title={t.people.emptyTitle}>
              {t.people.emptyText}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-5 text-center text-[14px] text-hint">{t.common.nothingFound}</p>
          ) : (
            filtered.map(row)
          )}
          <ActionRow
            icon={<IconUserPlus size={20} />}
            onClick={() => push({ name: 'addOffline', groupId: active.id })}
          >
            {t.people.addOffline}
          </ActionRow>
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
