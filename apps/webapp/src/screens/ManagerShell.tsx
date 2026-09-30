import { BrandHeader } from '../components/BrandHeader';
import { IconCalendar, IconHome, IconMenu, IconUsers } from '../components/icons';
import { TabBar, type TabDef } from '../components/TabBar';
import { Button, Card, EmptyState, ErrorState, Loading, Screen } from '../components/ui';
import { useManagedGroups } from '../lib/groups';
import { useT } from '../lib/i18n';
import { useNav, type Tab } from '../lib/nav';
import { useMe } from '../lib/queries';
import { Meetings } from './Meetings';
import { More } from './More';
import { Overview } from './Overview';
import { People } from './People';

/** Leaders and admins: four tabs around the active group. */
export function ManagerShell() {
  const { tab, setTab, push } = useNav();
  const t = useT();
  const me = useMe();
  const { managed, active, isLoading, isError, refetch } = useManagedGroups();

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const isAdmin = me.data?.user.isAdmin === true;
  const tabs: TabDef<Tab>[] = [
    { key: 'overview', label: t.nav.overview, icon: <IconHome /> },
    { key: 'meetings', label: t.nav.meetings, icon: <IconCalendar /> },
    { key: 'people', label: t.nav.people, icon: <IconUsers />, badge: active?.pendingCount },
    { key: 'more', label: t.nav.more, icon: <IconMenu /> },
  ];

  // An admin before the first group exists: guide them instead of showing empty tabs.
  const body =
    tab === 'more' ? (
      <More groups={managed} />
    ) : !active ? (
      <Screen tabs>
        <BrandHeader title={t.appName} />
        <Card>
          <EmptyState
            icon={<IconUsers size={26} />}
            title={t.groups.noGroupsTitle}
            action={
              isAdmin ? (
                <Button onClick={() => push({ name: 'createGroup' })}>{t.groups.create}</Button>
              ) : undefined
            }
          >
            {isAdmin ? t.groups.noGroupsAdmin : t.groups.noGroupsLeader}
          </EmptyState>
        </Card>
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
