import { Hono } from 'hono';
import type { Env } from '../env';
import { requireTelegramAuth, type AuthVariables } from '../auth/middleware';
import { loadMe } from '../lib/users';
import { groupAnnouncementRoutes, myAnnouncementRoutes } from './announcements';
import { churchRoutes, meRoutes } from './church';
import { groupRoutes } from './groups';
import { groupMeetingRoutes, meetingRoutes, myAttendanceRoutes, scheduleRoutes } from './meetings';
import { membershipRoutes, userRoutes } from './members';
import { documentRoutes, groupReportRoutes } from './reports';
import { eventRoutes, groupEventRoutes, myEventRoutes } from './events';
import { groupTreasuryRoutes, myFinanceRoutes, transactionRoutes } from './treasury';

export const apiRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

apiRoutes.use('*', requireTelegramAuth);

apiRoutes.get('/me', async (c) => {
  return c.json(await loadMe(c.get('db'), c.get('user')));
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
apiRoutes.route('/transactions', transactionRoutes);
apiRoutes.route('/schedules', scheduleRoutes);
apiRoutes.route('/meetings', meetingRoutes);
apiRoutes.route('/me/attendance', myAttendanceRoutes);
apiRoutes.route('/memberships', membershipRoutes);
apiRoutes.route('/users', userRoutes);
