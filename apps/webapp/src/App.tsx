import { useEffect, useMemo } from 'react';
import { messages, type MeResponse } from '@church/shared';
import { ToastProvider } from './components/Toast';
import { CenterMessage, ErrorState, Loading } from './components/ui';
import { I18nProvider } from './lib/i18n';
import { NavProvider, useNav, type Route } from './lib/nav';
import { applyBrand } from './lib/theme';
import { useGroups, useMe } from './lib/queries';
import { EnvProvider, soloEnvironment, useEnv } from './lib/env';
import { Hub } from './screens/Hub';
import { AddPerson } from './screens/AddPerson';
import { PositionEditor, Positions } from './screens/Positions';
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
import { EventForm } from './screens/EventForm';
import { EventScreen } from './screens/EventScreen';
import { GroupSettings } from './screens/GroupSettings';
import { Reports } from './screens/Reports';
import { RollCall } from './screens/RollCall';
import { Schedule } from './screens/Schedule';

/** May take attendance somewhere (for the bot's "open roll call" deep link). */
const canTakeRoll = (me: MeResponse) =>
  me.user.isAdmin ||
  me.memberships.some((m) => m.status === 'active' && m.permissions.includes('attendance.take'));

/** Inside one environment: the leader tabs if the position has any rights, else the member view. */
function EnvHome({ me, groupId }: { me: MeResponse; groupId: number }) {
  const { env, manages } = useEnv();
  const groups = useGroups();
  if (groups.isPending) return <Loading />;
  if (!env || env.id !== groupId) return <ErrorState onRetry={() => void groups.refetch()} />;
  return manages ? <ManagerShell env={env} /> : <MemberHome me={me} groupId={env.id} />;
}

/** Applies the open environment's theme (or the church one) and provides its rights. */
function Themed({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  const { envId } = useNav();
  const groups = useGroups();
  const id = envId ?? soloEnvironment(me);
  const env = groups.data?.find((g) => g.id === id) ?? null;
  const theme = env?.brandColor ?? me.church.brandColor;
  useEffect(() => applyBrand(theme), [theme]);
  return <EnvProvider env={env}>{children}</EnvProvider>;
}

function Router({ me }: { me: MeResponse }) {
  const { route } = useNav();
  switch (route.name) {
    case 'root': {
      const solo = soloEnvironment(me);
      return solo ? <EnvHome me={me} groupId={solo} /> : <Hub me={me} />;
    }
    case 'env':
      return <EnvHome key={route.groupId} me={me} groupId={route.groupId} />;
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
    case 'event':
      return <EventScreen key={route.eventId} eventId={route.eventId} />;
    case 'eventForm':
      return (
        <EventForm key={route.eventId ?? 'new'} groupId={route.groupId} eventId={route.eventId} />
      );
    case 'reports':
      return <Reports key={route.groupId} groupId={route.groupId} />;
    case 'positions':
      return <Positions key={route.groupId} groupId={route.groupId} />;
    case 'position':
      return (
        <PositionEditor
          key={`${route.groupId}:${route.positionId ?? 'new'}`}
          groupId={route.groupId}
          positionId={route.positionId}
        />
      );
    case 'addPerson':
      return <AddPerson key={route.groupId} groupId={route.groupId} />;
    case 'groupSettings':
      return <GroupSettings key={route.groupId} groupId={route.groupId} />;
    case 'announcements':
      return <Announcements key={route.groupId} groupId={route.groupId} />;
  }
}

/** `?roll=<id>` (from the bot's reminder button) opens that roll call directly. */
function initialRoute(me: MeResponse): Route | undefined {
  const raw = new URLSearchParams(window.location.search).get('roll');
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id) || id <= 0 || !canTakeRoll(me)) return undefined;
  return { name: 'roll', meetingId: id };
}

function Gate() {
  const me = useMe();
  const initial = useMemo(() => (me.data ? initialRoute(me.data) : undefined), [me.data]);
  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState onRetry={() => void me.refetch()} />;
  return (
    <I18nProvider locale={me.data.user.locale}>
      <NavProvider initial={initial}>
        <Themed me={me.data}>
          <Router me={me.data} />
        </Themed>
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
