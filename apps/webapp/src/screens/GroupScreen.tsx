import { displayName, plural, ru, type MemberRow } from '@church/shared';
import { LinkShare } from '../components/LinkShare';
import {
  ActionRow,
  Badge,
  Button,
  EmptyText,
  ErrorState,
  Loading,
  Row,
  Screen,
  Section,
  Title,
} from '../components/ui';
import { useNav } from '../lib/nav';
import {
  useArchiveGroup,
  useGroup,
  useMe,
  useMembers,
  useRotateInvite,
  useUpdateMembership,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

function memberBadges(m: MemberRow) {
  return (
    <span className="flex gap-1">
      {m.offline && <Badge tone="hint">{ru.app.offline}</Badge>}
      {!m.offline && !m.isReachable && <Badge tone="danger">{ru.app.unreachable}</Badge>}
    </span>
  );
}

export function GroupScreen({ groupId }: { groupId: number }) {
  const { push, back } = useNav();
  const me = useMe();
  const group = useGroup(groupId);
  const members = useMembers(groupId, group.data?.canManage === true);
  const update = useUpdateMembership();
  const rotate = useRotateInvite();
  const archive = useArchiveGroup();

  if (group.isPending) return <Loading />;
  if (group.isError) return <ErrorState onRetry={() => void group.refetch()} />;
  const g = group.data;

  const list = members.data ?? [];
  const pending = list.filter((m) => m.status === 'pending');
  const leaders = list.filter((m) => m.status === 'active' && m.role === 'leader');
  const regular = list.filter((m) => m.status === 'active' && m.role === 'member');

  async function decide(m: MemberRow, approve: boolean) {
    await update.mutateAsync({
      membershipId: m.membershipId,
      status: approve ? 'active' : 'rejected',
    });
    if (approve) haptic.success();
  }

  const memberRow = (m: MemberRow) => (
    <Row
      key={m.membershipId}
      title={displayName(m)}
      subtitle={m.username ? `@${m.username}` : undefined}
      after={memberBadges(m)}
      onClick={() => push({ name: 'member', userId: m.userId, groupId })}
    />
  );

  return (
    <Screen>
      <Title
        subtitle={`${g.activeCount} ${plural(g.activeCount, ['участник', 'участника', 'участников'])}${
          g.description ? ` · ${g.description}` : ''
        }`}
      >
        {g.name}
      </Title>

      {pending.length > 0 && (
        <Section title={`${ru.app.pendingRequests} · ${pending.length}`}>
          {pending.map((m) => (
            <div
              key={m.membershipId}
              className="flex items-center gap-3 border-b border-bg-secondary px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px]">{displayName(m)}</div>
                {m.username && <div className="truncate text-[14px] text-hint">@{m.username}</div>}
              </div>
              <Button small onClick={() => void decide(m, true)} disabled={update.isPending}>
                {ru.app.approve}
              </Button>
              <Button
                small
                variant="destructive"
                onClick={() => void decide(m, false)}
                disabled={update.isPending}
              >
                {ru.app.reject}
              </Button>
            </div>
          ))}
        </Section>
      )}

      {g.inviteLink && (
        <Section title={ru.app.inviteLink} footer={ru.app.inviteHint}>
          <LinkShare link={g.inviteLink} shareText={`Присоединяйся к группе «${g.name}»`} />
          <ActionRow
            disabled={rotate.isPending}
            onClick={async () => {
              if (await confirmDialog(ru.app.rotateConfirm)) await rotate.mutateAsync(groupId);
            }}
          >
            {ru.app.rotateInvite}
          </ActionRow>
        </Section>
      )}

      {leaders.length > 0 && <Section title={ru.app.leaders}>{leaders.map(memberRow)}</Section>}

      <Section title={ru.app.members}>
        {members.isPending ? (
          <EmptyText>{ru.app.loading}</EmptyText>
        ) : regular.length === 0 ? (
          <EmptyText>{ru.app.noMembers}</EmptyText>
        ) : (
          regular.map(memberRow)
        )}
        <ActionRow onClick={() => push({ name: 'addOffline', groupId })}>
          + {ru.app.addOffline}
        </ActionRow>
      </Section>

      {me.data?.user.isAdmin && !g.archived && (
        <Section>
          <ActionRow
            destructive
            disabled={archive.isPending}
            onClick={async () => {
              if (await confirmDialog(ru.app.archiveConfirm)) {
                await archive.mutateAsync(groupId);
                back();
              }
            }}
          >
            {ru.app.archiveGroup}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}
