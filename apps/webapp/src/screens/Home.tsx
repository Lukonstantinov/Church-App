import { displayName, plural, ru, type GroupSummary, type MeResponse } from '@church/shared';
import { ActionRow, Badge, EmptyText, Row, Screen, Section, Title } from '../components/ui';
import { useNav } from '../lib/nav';
import { useGroups } from '../lib/queries';

function membersLabel(g: GroupSummary) {
  return `${g.activeCount} ${plural(g.activeCount, ['участник', 'участника', 'участников'])}`;
}

function PendingBadge({ count }: { count: number }) {
  return count > 0 ? <Badge tone="danger">{count}</Badge> : null;
}

export function Home({ me }: { me: MeResponse }) {
  const { push } = useNav();
  const { user, memberships } = me;
  const leadsAny = memberships.some((m) => m.role === 'leader' && m.status === 'active');
  const groups = useGroups(user.isAdmin || leadsAny);
  const summaryById = new Map((groups.data ?? []).map((g) => [g.id, g]));

  return (
    <Screen>
      <Title subtitle={user.isAdmin ? <Badge>{ru.app.adminBadge}</Badge> : undefined}>
        {ru.app.hello(user.firstName)}
      </Title>

      {user.isAdmin && (
        <Section title={ru.app.churchGroups}>
          {(groups.data ?? []).map((g) => (
            <Row
              key={g.id}
              title={g.name}
              subtitle={[membersLabel(g), g.leaderNames.join(', ')].filter(Boolean).join(' · ')}
              after={<PendingBadge count={g.pendingCount} />}
              onClick={() => push({ name: 'group', groupId: g.id })}
            />
          ))}
          <ActionRow onClick={() => push({ name: 'createGroup' })}>
            + {ru.app.createGroup}
          </ActionRow>
        </Section>
      )}

      {!user.isAdmin && (
        <Section title={ru.app.myGroups}>
          {memberships.length === 0 ? (
            <EmptyText>{ru.app.noGroupsYet}</EmptyText>
          ) : (
            memberships.map((m) => {
              const leads = m.role === 'leader' && m.status === 'active';
              const summary = summaryById.get(m.groupId);
              return (
                <Row
                  key={m.groupId}
                  title={m.groupName}
                  subtitle={
                    m.status === 'pending'
                      ? ru.app.statusPending
                      : leads && summary
                        ? membersLabel(summary)
                        : undefined
                  }
                  after={
                    leads && summary?.pendingCount ? (
                      <PendingBadge count={summary.pendingCount} />
                    ) : m.role === 'leader' ? (
                      ru.app.roleLeader
                    ) : undefined
                  }
                  onClick={leads ? () => push({ name: 'group', groupId: m.groupId }) : undefined}
                />
              );
            })
          )}
        </Section>
      )}

      <Section title={ru.app.profile}>
        <Row
          title={displayName(user)}
          subtitle={user.username ? `@${user.username}` : undefined}
          onClick={() => push({ name: 'member', userId: user.id })}
        />
      </Section>
    </Screen>
  );
}
