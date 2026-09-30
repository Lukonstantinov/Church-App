import { ru } from '@church/shared';
import { IconCalendar, IconHome, IconMenu, IconUsers } from '../components/icons';
import { TabBar, type TabDef } from '../components/TabBar';
import { Button, EmptyState, ErrorState, Loading, Screen, Title } from '../components/ui';
import { useManagedGroups } from '../lib/groups';
import { useNav, type Tab } from '../lib/nav';
import { useMe } from '../lib/queries';
import { Meetings } from './Meetings';
import { More } from './More';
import { Overview } from './Overview';
import { People } from './People';

/** Leaders and admins: four tabs around the active group. */
export function ManagerShell() {
  const { tab, setTab, push } = useNav();
  const me = useMe();
  const { managed, active, isLoading, isError, refetch } = useManagedGroups();

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const isAdmin = me.data?.user.isAdmin === true;
  const tabs: TabDef<Tab>[] = [
    { key: 'overview', label: 'Обзор', icon: <IconHome /> },
    { key: 'meetings', label: 'Встречи', icon: <IconCalendar /> },
    { key: 'people', label: 'Люди', icon: <IconUsers />, badge: active?.pendingCount },
    { key: 'more', label: 'Ещё', icon: <IconMenu /> },
  ];

  // An admin before the first group exists: guide them instead of showing empty tabs.
  const body =
    tab === 'more' ? (
      <More groups={managed} />
    ) : !active ? (
      <Screen tabs>
        <Title>{ru.appName}</Title>
        <EmptyState
          title="Групп пока нет"
          action={
            isAdmin ? (
              <Button onClick={() => push({ name: 'createGroup' })}>Создать группу</Button>
            ) : undefined
          }
        >
          {isAdmin
            ? 'Создайте первую группу, чтобы начать.'
            : 'Администратор ещё не назначил вам группу.'}
        </EmptyState>
      </Screen>
    ) : tab === 'meetings' ? (
      <Meetings groups={managed} active={active} />
    ) : tab === 'people' ? (
      <People groups={managed} active={active} />
    ) : (
      <Overview groups={managed} active={active} />
    );

  return (
    <>
      {body}
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
    </>
  );
}
