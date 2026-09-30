import { displayName, ru, type MeResponse } from '@church/shared';
import { Badge, Row, Screen, Section } from '../components/ui';

export function Home({ me }: { me: MeResponse }) {
  const { user, memberships } = me;
  return (
    <Screen>
      <header className="px-1 pt-2">
        <h1 className="text-[28px] font-bold leading-tight">{ru.app.hello(user.firstName)}</h1>
        {user.isAdmin && (
          <div className="mt-2">
            <Badge>{ru.app.adminBadge}</Badge>
          </div>
        )}
      </header>

      <Section title="Мои группы">
        {memberships.length === 0 ? (
          <p className="px-4 py-4 text-[15px] text-hint">{ru.app.noGroupsYet}</p>
        ) : (
          memberships.map((m) => (
            <Row
              key={m.groupId}
              title={m.groupName}
              subtitle={m.status === 'pending' ? ru.app.statusPending : undefined}
              after={m.role === 'leader' ? ru.app.roleLeader : ru.app.roleMember}
            />
          ))
        )}
      </Section>

      <Section title="Профиль">
        <Row title={displayName(user)} subtitle={user.username ? `@${user.username}` : undefined} />
      </Section>
    </Screen>
  );
}
