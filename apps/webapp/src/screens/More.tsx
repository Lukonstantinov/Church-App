import { plural, displayName, ru, type GroupSummary } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { Badge, ActionRow, Row, Screen, Section, Title } from '../components/ui';
import { useNav } from '../lib/nav';
import { useMe } from '../lib/queries';

/** Profile, and for admins the church-wide group list. */
export function More({ groups }: { groups: GroupSummary[] }) {
  const { push, setTab, setActiveGroupId } = useNav();
  const me = useMe();
  const user = me.data?.user;
  if (!user) return null;

  return (
    <Screen tabs>
      <Title>Ещё</Title>

      <Section title={ru.app.profile}>
        <button
          type="button"
          onClick={() => push({ name: 'member', userId: user.id })}
          className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left active:bg-bg-secondary"
        >
          <Avatar id={user.id} firstName={user.firstName} lastName={user.lastName} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-medium">{displayName(user)}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-hint">
              {user.username && <span>@{user.username}</span>}
              {user.isAdmin && <Badge>{ru.app.adminBadge}</Badge>}
            </div>
          </div>
        </button>
      </Section>

      {user.isAdmin && (
        <Section title={ru.app.churchGroups}>
          {groups.map((g) => (
            <Row
              key={g.id}
              title={g.name}
              subtitle={`${g.activeCount} ${plural(g.activeCount, ['участник', 'участника', 'участников'])}${
                g.leaderNames.length ? ` · ${g.leaderNames.join(', ')}` : ''
              }`}
              after={g.pendingCount > 0 ? <Badge tone="danger">{g.pendingCount}</Badge> : undefined}
              onClick={() => {
                setActiveGroupId(g.id);
                setTab('overview');
              }}
            />
          ))}
          <ActionRow onClick={() => push({ name: 'createGroup' })}>
            + {ru.app.createGroup}
          </ActionRow>
        </Section>
      )}

      <p className="px-4 text-[13px] leading-snug text-hint">
        Ваши данные видят только лидеры групп и администраторы церкви. Подробнее и запрос на
        удаление — команда /privacy в боте.
      </p>
    </Screen>
  );
}
