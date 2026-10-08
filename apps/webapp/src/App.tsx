import { useEffect, useMemo } from 'react';
import { messages, type MeResponse } from '@church/shared';
import { ToastProvider, useToast } from './components/Toast';
import { CrashGuard } from './components/CrashGuard';
import { Button, CenterMessage, ErrorState, Loading } from './components/ui';
import { I18nProvider, useT } from './lib/i18n';
import { QUALITY_LOWERED, isSafeStart } from './lib/perf';
import { NavProvider, useNav, type Route } from './lib/nav';
import { applyBrand } from './lib/theme';
import { useGroups, useMe } from './lib/queries';
import { EnvProvider, soloEnvironment, useEnv } from './lib/env';
import { Hub } from './screens/Hub';
import { AppBackdrop } from './components/AppBackdrop';
import { AddPerson } from './screens/AddPerson';
import { PositionEditor, Positions } from './screens/Positions';
import { isInsideTelegram, telegramLanguage } from './lib/telegram';
import { AddOffline } from './screens/AddOffline';
import { Feed, PostScreen } from './screens/Feed';
import { PostEditor } from './screens/PostEditor';
import { Telemetry } from './screens/Telemetry';
import { Guide } from './screens/Guide';
import { ChurchSettings } from './screens/ChurchSettings';
import { CreateGroup } from './screens/CreateGroup';
import { ManagerShell } from './screens/ManagerShell';
import { MemberHome } from './screens/MemberHome';
import { MemberScreen } from './screens/MemberScreen';
import { NewMeeting } from './screens/NewMeeting';
import { Contacts } from './screens/Contacts';
import { MeetingScreen } from './screens/MeetingScreen';
import { Labels } from './screens/Labels';
import { Notifications } from './screens/Notifications';
import { Reminders } from './screens/Reminders';
import { TaskScreen } from './screens/TaskScreen';
import { NewTransaction } from './screens/NewTransaction';
import { EventForm } from './screens/EventForm';
import { EventScreen } from './screens/EventScreen';
import { GroupSettings } from './screens/GroupSettings';
import { Reports } from './screens/Reports';
import { Statistics } from './screens/Statistics';
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
  return manages ? (
    <ManagerShell env={env} />
  ) : (
    <div key={env.id} className={`env-anim-${env.animation}`}>
      <MemberHome me={me} groupId={env.id} />
    </div>
  );
}

/** Applies the open environment's theme (or the church one) and provides its rights. */
function Themed({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  const { envId } = useNav();
  const groups = useGroups();
  const id = envId ?? soloEnvironment(me);
  const env = groups.data?.find((g) => g.id === id) ?? null;
  const theme = env?.brandColor ?? me.church.brandColor;
  useEffect(() => applyBrand(theme), [theme]);
  // Inside a ministry: its background; on the main window: the church's.
  const bg = env ? env.pageBackground : me.church.appBackground;
  const look = env ?? {
    brandColor: me.church.brandColor,
    pattern: null,
    logoUrl: me.church.logoUrl,
  };
  return (
    <EnvProvider env={env}>
      <AppBackdrop bg={bg} look={look} />
      {children}
    </EnvProvider>
  );
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
      return <NewMeeting groupId={route.groupId} date={route.date} />;
    case 'member':
      return <MemberScreen key={route.userId} userId={route.userId} />;
    case 'createGroup':
      return <CreateGroup />;
    case 'addOffline':
      return <AddOffline groupId={route.groupId} />;
    case 'settings':
      return me.user.isAdmin ? <ChurchSettings /> : null;
    case 'newTransaction':
      return (
        <NewTransaction groupId={route.groupId} kind={route.kind} meetingId={route.meetingId} />
      );
    case 'contacts':
      return <Contacts key={route.groupId} groupId={route.groupId} />;
    case 'meeting':
      return <MeetingScreen key={route.meetingId} meetingId={route.meetingId} />;
    case 'task':
      return <TaskScreen key={route.meetingId} meetingId={route.meetingId} />;
    case 'notifications':
      return <Notifications />;
    case 'labels':
      return <Labels key={route.groupId} groupId={route.groupId} />;
    case 'reminders':
      return <Reminders key={route.groupId} groupId={route.groupId} />;
    case 'event':
      return <EventScreen key={route.eventId} eventId={route.eventId} />;
    case 'eventForm':
      return (
        <EventForm
          key={route.eventId ?? 'new'}
          groupId={route.groupId}
          eventId={route.eventId}
          date={route.date}
        />
      );
    case 'reports':
      return <Reports key={route.groupId} groupId={route.groupId} />;
    case 'stats':
      return <Statistics key={route.groupId} groupId={route.groupId} />;
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
      return <Feed key={route.groupId} groupId={route.groupId} />;
    case 'post':
      return <PostScreen key={route.postId} groupId={route.groupId} postId={route.postId} />;
    case 'telemetry':
      return me.user.isDeveloper ? <Telemetry /> : null;
    case 'guide':
      return me.user.isDeveloper ? <Guide /> : null;
    case 'newPost':
      return <PostEditor key={route.groupId} groupId={route.groupId} />;
    case 'editPost':
      return <PostEditor key={route.postId} groupId={route.groupId} postId={route.postId} />;
  }
}

/**
 * Bot buttons open a screen directly: `?roll=<id>` the roll call, `?meeting=<id>` a
 * meeting (sent to the person who leads it or buys snacks), `?stats=<ministry>` statistics.
 */
function initialRoute(me: MeResponse): Route | undefined {
  const params = new URLSearchParams(window.location.search);
  const meeting = Number(params.get('meeting'));
  if (Number.isSafeInteger(meeting) && meeting > 0) return { name: 'task', meetingId: meeting };
  const event = Number(params.get('event'));
  if (Number.isSafeInteger(event) && event > 0) return { name: 'event', eventId: event };
  const stats = Number(params.get('stats'));
  if (Number.isSafeInteger(stats) && stats > 0) return { name: 'stats', groupId: stats };
  const raw = params.get('roll');
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
          <QualityNotice />
          <GuardedRouter me={me.data} />
        </Themed>
      </NavProvider>
    </I18nProvider>
  );
}

export function App() {
  if (!isInsideTelegram())
    return <CenterMessage>{messages('ru').common.openInTelegram}</CenterMessage>;
  // Anything that breaks outside a screen (the background, the frame) shows a note with
  // "Reload" too, instead of leaving only the empty background.
  return (
    <CrashGuard resetKey="app" place="app" fallback={(error) => <AppCrashed error={error} />}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </CrashGuard>
  );
}

/** The whole app broke: what happened and a way out, in the phone's language. */
function AppCrashed({ error }: { error: Error }) {
  const t = messages(telegramLanguage()).common;
  return (
    <CenterMessage>
      <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
        <span className="text-[44px]">🛠</span>
        <div className="text-[18px] font-bold">{t.appCrashTitle}</div>
        <div className="text-[14px] text-hint">{t.appCrashHint}</div>
        <code className="max-w-full break-words rounded-xl bg-hairline px-3 py-2 text-[11px] text-hint">
          {error.message}
        </code>
        <Button onClick={() => window.location.reload()}>{t.crashReload}</Button>
      </div>
    </CenterMessage>
  );
}

/** Says once when "auto" made the animations lighter because the phone couldn't keep up. */
let toldSafeStart = false;
function QualityNotice() {
  const toast = useToast();
  const t = useT();
  useEffect(() => {
    if (isSafeStart() && !toldSafeStart) {
      toldSafeStart = true;
      toast(t.quality.safeStart);
    }
    const said = () => toast(t.quality.lowered);
    window.addEventListener(QUALITY_LOWERED, said);
    return () => window.removeEventListener(QUALITY_LOWERED, said);
  }, [toast, t]);
  return null;
}

/** The screens, guarded: a crash shows a short note instead of a white screen. */
function GuardedRouter({ me }: { me: MeResponse }) {
  const { route, back } = useNav();
  const t = useT();
  const key = JSON.stringify(route);
  return (
    <CrashGuard
      resetKey={key}
      place={key}
      fallback={(error, reset) => (
        <CenterMessage>
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <span className="text-[44px]">🛠</span>
            <div className="text-[18px] font-bold">{t.common.crashTitle}</div>
            <div className="text-[14px] text-hint">{t.common.crashHint}</div>
            <code className="max-w-full break-words rounded-xl bg-hairline px-3 py-2 text-[11px] text-hint">
              {error.message}
            </code>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  back();
                }}
              >
                {t.common.crashBack}
              </Button>
              <Button onClick={() => window.location.reload()}>{t.common.crashReload}</Button>
            </div>
          </div>
        </CenterMessage>
      )}
    >
      <Router me={me} />
    </CrashGuard>
  );
}
