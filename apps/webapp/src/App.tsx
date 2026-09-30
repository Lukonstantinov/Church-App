import { useEffect, useMemo } from 'react';
import { messages, type MeResponse } from '@church/shared';
import { ToastProvider } from './components/Toast';
import { CenterMessage, ErrorState, Loading } from './components/ui';
import { I18nProvider } from './lib/i18n';
import { NavProvider, useNav, type Route } from './lib/nav';
import { applyBrand } from './lib/theme';
import { useMe } from './lib/queries';
import { isInsideTelegram } from './lib/telegram';
import { AddOffline } from './screens/AddOffline';
import { Announcements } from './screens/Announcements';
import { ChurchSettings } from './screens/ChurchSettings';
import { CreateGroup } from './screens/CreateGroup';
import { ManagerShell } from './screens/ManagerShell';
import { MemberHome } from './screens/MemberHome';
import { MemberScreen } from './screens/MemberScreen';
import { NewMeeting } from './screens/NewMeeting';
import { NewTransaction } from './screens/NewTransaction';
import { RollCall } from './screens/RollCall';
import { Schedule } from './screens/Schedule';

const isManager = (me: MeResponse) =>
  me.user.isAdmin || me.memberships.some((m) => m.role === 'leader' && m.status === 'active');

function Router({ me }: { me: MeResponse }) {
  const { route } = useNav();
  switch (route.name) {
    case 'root':
      return isManager(me) ? <ManagerShell /> : <MemberHome me={me} />;
    case 'roll':
      return <RollCall key={route.meetingId} meetingId={route.meetingId} />;
    case 'schedule':
      return <Schedule key={route.groupId} groupId={route.groupId} />;
    case 'newMeeting':
      return <NewMeeting groupId={route.groupId} />;
    case 'member':
      return <MemberScreen key={route.userId} userId={route.userId} />;
    case 'createGroup':
      return <CreateGroup />;
    case 'addOffline':
      return <AddOffline groupId={route.groupId} />;
    case 'settings':
      return me.user.isAdmin ? <ChurchSettings /> : null;
    case 'newTransaction':
      return <NewTransaction groupId={route.groupId} kind={route.kind} />;
    case 'announcements':
      return <Announcements key={route.groupId} groupId={route.groupId} />;
  }
}

/** `?roll=<id>` (from the bot's reminder button) opens that roll call directly. */
function initialRoute(me: MeResponse): Route | undefined {
  const raw = new URLSearchParams(window.location.search).get('roll');
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id) || id <= 0 || !isManager(me)) return undefined;
  return { name: 'roll', meetingId: id };
}

function Gate() {
  const me = useMe();
  const initial = useMemo(() => (me.data ? initialRoute(me.data) : undefined), [me.data]);
  const brand = me.data?.church.brandColor;
  useEffect(() => applyBrand(brand), [brand]);
  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState onRetry={() => void me.refetch()} />;
  return (
    <I18nProvider locale={me.data.user.locale}>
      <NavProvider initial={initial}>
        <Router me={me.data} />
      </NavProvider>
    </I18nProvider>
  );
}

export function App() {
  if (!isInsideTelegram())
    return <CenterMessage>{messages('ru').common.openInTelegram}</CenterMessage>;
  return (
    <ToastProvider>
      <Gate />
    </ToastProvider>
  );
}
