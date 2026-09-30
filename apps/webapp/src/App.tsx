import { ru } from '@church/shared';
import { CenterMessage, ErrorState, Loading } from './components/ui';
import { NavProvider, useNav } from './lib/nav';
import { useMe } from './lib/queries';
import { isInsideTelegram } from './lib/telegram';
import { AddOffline } from './screens/AddOffline';
import { CreateGroup } from './screens/CreateGroup';
import { GroupScreen } from './screens/GroupScreen';
import { Home } from './screens/Home';
import { MemberScreen } from './screens/MemberScreen';

function Router() {
  const { route } = useNav();
  const me = useMe();

  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState onRetry={() => void me.refetch()} />;

  switch (route.name) {
    case 'home':
      return <Home me={me.data} />;
    case 'group':
      return <GroupScreen key={route.groupId} groupId={route.groupId} />;
    case 'member':
      return <MemberScreen key={route.userId} userId={route.userId} />;
    case 'createGroup':
      return <CreateGroup />;
    case 'addOffline':
      return <AddOffline groupId={route.groupId} />;
  }
}

export function App() {
  if (!isInsideTelegram()) return <CenterMessage>{ru.app.openInTelegram}</CenterMessage>;
  return (
    <NavProvider>
      <Router />
    </NavProvider>
  );
}
