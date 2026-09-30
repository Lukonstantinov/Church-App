import { useState } from 'react';
import { displayName, plural, ru, type GroupSummary, type MemberRow } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { IconChevronRight, IconSearch, IconUsers } from '../components/icons';
import { LinkShare } from '../components/LinkShare';
import { PercentChip } from '../components/Status';
import { useToast } from '../components/Toast';
import { ActionRow, Badge, Button, EmptyState, Screen, Section, Skeleton } from '../components/ui';
import { useNav } from '../lib/nav';
import { useGroup, useMembers, useRotateInvite, useUpdateMembership } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

export function People({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const { push } = useNav();
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
  const q = query.trim().toLowerCase();
  const filtered = q ? regular.filter((m) => displayName(m).toLowerCase().includes(q)) : regular;

  async function decide(m: MemberRow, approve: boolean) {
    try {
      await update.mutateAsync({
        membershipId: m.membershipId,
        status: approve ? 'active' : 'rejected',
      });
      if (approve) haptic.success();
      toast(approve ? `${displayName(m)} принят(а)` : 'Заявка отклонена');
    } catch {
      toast('Не удалось выполнить действие', 'error');
    }
  }

  const row = (m: MemberRow) => (
    <button
      key={m.membershipId}
      type="button"
      onClick={() => push({ name: 'member', userId: m.userId })}
      className="flex min-h-[60px] w-full items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 active:bg-bg-secondary"
    >
      <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px]">{displayName(m)}</div>
        <div className="flex items-center gap-1.5 text-[13px] text-hint">
          {m.username ? `@${m.username}` : m.offline ? ru.app.offline : null}
          {!m.offline && !m.isReachable && <Badge tone="danger">{ru.app.unreachable}</Badge>}
        </div>
      </div>
      {m.role === 'member' && <PercentChip percent={m.recentPercent} />}
      <IconChevronRight size={18} className="shrink-0 text-hint" />
    </button>
  );

  return (
    <Screen tabs>
      <GroupSwitcher
        groups={groups}
        active={active}
        subtitle={`${active.activeCount} ${plural(active.activeCount, ['участник', 'участника', 'участников'])}`}
      />

      {members.isPending && <Skeleton className="h-48 w-full" />}

      {pending.length > 0 && (
        <Section title={`${ru.app.pendingRequests} · ${pending.length}`}>
          {pending.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-2.5 border-b border-hairline px-3 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <Avatar id={m.userId} firstName={m.firstName} lastName={m.lastName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px]">{displayName(m)}</div>
                  {m.username && (
                    <div className="truncate text-[13px] text-hint">@{m.username}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Button onClick={() => void decide(m, true)} disabled={update.isPending}>
                    {ru.app.approve}
                  </Button>
                </div>
                <div className="flex-1">
                  <Button
                    variant="destructive"
                    onClick={() => void decide(m, false)}
                    disabled={update.isPending}
                  >
                    {ru.app.reject}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </Section>
      )}

      {leaders.length > 0 && <Section title={ru.app.leaders}>{leaders.map(row)}</Section>}

      <div className="flex flex-col gap-2">
        {regular.length > 8 && (
          <label className="flex min-h-[44px] items-center gap-2 rounded-xl bg-section px-3 shadow-card">
            <IconSearch size={18} className="text-hint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-hint"
            />
          </label>
        )}
        <Section title={ru.app.members}>
          {members.isPending ? null : regular.length === 0 ? (
            <EmptyState icon={<IconUsers size={26} />} title="Пока никого нет">
              {ru.app.noMembers}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-5 text-center text-[14px] text-hint">Никого не найдено</p>
          ) : (
            filtered.map(row)
          )}
          <ActionRow onClick={() => push({ name: 'addOffline', groupId: active.id })}>
            + {ru.app.addOffline}
          </ActionRow>
        </Section>
      </div>

      {group.data?.inviteLink && (
        <Section title={ru.app.inviteLink} footer={ru.app.inviteHint}>
          <LinkShare
            link={group.data.inviteLink}
            shareText={`Присоединяйся к группе «${active.name}»`}
          />
          <ActionRow
            disabled={rotate.isPending}
            onClick={async () => {
              if (await confirmDialog(ru.app.rotateConfirm)) {
                await rotate.mutateAsync(active.id);
                toast('Новая ссылка создана');
              }
            }}
          >
            {ru.app.rotateInvite}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}
