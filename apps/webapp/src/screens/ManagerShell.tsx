import type { GroupSummary } from '@church/shared';
import { IconCalendar, IconHome, IconMenu, IconUsers, IconWallet } from '../components/icons';
import { TabBar, type TabDef } from '../components/TabBar';
import { useEnv } from '../lib/env';
import { useT } from '../lib/i18n';
import { useNav, type Tab } from '../lib/nav';
import { Meetings } from './Meetings';
import { More } from './More';
import { Overview } from './Overview';
import { People } from './People';
import { Treasury } from './Treasury';

/** Inside an environment, for people with rights: tabs shown according to their position. */
export function ManagerShell({ env }: { env: GroupSummary }) {
  const { tab, setTab } = useNav();
  const { can } = useEnv();
  const t = useT();
  const groups = [env];

  const showMeetings = can('attendance.take') || can('meetings.manage') || can('events.manage');
  const tabs: TabDef<Tab>[] = [
    { key: 'overview', label: t.nav.overview, icon: <IconHome /> },
    ...(showMeetings
      ? [{ key: 'meetings' as const, label: t.nav.meetings, icon: <IconCalendar /> }]
      : []),
    ...(can('money.view')
      ? [{ key: 'treasury' as const, label: t.nav.treasury, icon: <IconWallet /> }]
      : []),
    ...(can('people.view')
      ? [
          {
            key: 'people' as const,
            label: t.nav.people,
            icon: <IconUsers />,
            badge: can('people.manage') ? env.pendingCount : undefined,
          },
        ]
      : []),
    { key: 'more', label: t.nav.more, icon: <IconMenu /> },
  ];
  const current = tabs.some((x) => x.key === tab) ? tab : 'overview';

  const body =
    current === 'more' ? (
      <More groups={groups} />
    ) : current === 'meetings' ? (
      <Meetings groups={groups} active={env} />
    ) : current === 'treasury' ? (
      <Treasury groups={groups} active={env} />
    ) : current === 'people' ? (
      <People groups={groups} active={env} />
    ) : (
      <Overview groups={groups} active={env} />
    );

  return (
    <>
      {body}
      <TabBar tabs={tabs} active={current} onChange={setTab} />
    </>
  );
}
