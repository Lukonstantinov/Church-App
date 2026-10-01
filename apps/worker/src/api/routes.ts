import { Hono } from 'hono';
import { isDeveloper, type Env } from '../env';
import { requireTelegramAuth, type AuthVariables } from '../auth/middleware';
import { loadMe } from '../lib/users';
import {
  announcementRoutes,
  commentRoutes,
  groupAnnouncementRoutes,
  myAnnouncementRoutes,
  templateRoutes,
} from './announcements';
import { churchRoutes, meRoutes } from './church';
import { groupRoutes } from './groups';
import {
  calendarNoteRoutes,
  groupMeetingRoutes,
  meetingRoutes,
  myAttendanceRoutes,
  scheduleRoutes,
} from './meetings';
import { membershipRoutes, userRoutes } from './members';
import { groupPositionRoutes, positionRoutes } from './positions';
import { devRoutes } from './dev';
import { documentRoutes, groupReportRoutes } from './reports';
import { eventRoutes, groupEventRoutes, myEventRoutes } from './events';
import { groupTreasuryRoutes, myFinanceRoutes, transactionRoutes } from './treasury';

export const apiRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

apiRoutes.use('*', requireTelegramAuth);

apiRoutes.get('/me', async (c) => {
  const user = c.get('user');
  return c.json(await loadMe(c.get('db'), user, isDeveloper(c.env, user)));
});

apiRoutes.route('/me', meRoutes);
apiRoutes.route('/church', churchRoutes);
apiRoutes.route('/groups', groupRoutes);
apiRoutes.route('/groups', groupMeetingRoutes);
apiRoutes.route('/groups', groupAnnouncementRoutes);
apiRoutes.route('/groups', groupTreasuryRoutes);
apiRoutes.route('/me/announcements', myAnnouncementRoutes);
apiRoutes.route('/me/finance', myFinanceRoutes);
apiRoutes.route('/groups', groupEventRoutes);
apiRoutes.route('/events', eventRoutes);
apiRoutes.route('/me/events', myEventRoutes);
apiRoutes.route('/groups', groupReportRoutes);
apiRoutes.route('/me/document', documentRoutes);
apiRoutes.route('/groups', groupPositionRoutes);
apiRoutes.route('/positions', positionRoutes);
apiRoutes.route('/announcements', announcementRoutes);
apiRoutes.route('/comments', commentRoutes);
apiRoutes.route('/templates', templateRoutes);
apiRoutes.route('/dev', devRoutes);
apiRoutes.route('/transactions', transactionRoutes);
apiRoutes.route('/schedules', scheduleRoutes);
apiRoutes.route('/meetings', meetingRoutes);
apiRoutes.route('/calendar-notes', calendarNoteRoutes);
apiRoutes.route('/me/attendance', myAttendanceRoutes);
apiRoutes.route('/memberships', membershipRoutes);
apiRoutes.route('/users', userRoutes);
