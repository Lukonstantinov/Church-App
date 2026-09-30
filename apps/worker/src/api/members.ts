import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray } from 'drizzle-orm';
import {
  setAdminSchema,
  updateMembershipSchema,
  updateUserSchema,
  type ClaimCodeResponse,
  type MemberDetail,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { groups, memberships, users } from '../db/schema';
import { canManageGroup, canManageUser, ledGroupIds } from '../lib/access';
import { audit } from '../lib/audit';
import { issueClaimCode } from '../lib/claim';
import { announceJoinDecision, decideJoin } from '../lib/membership';
import { appUrlFor, botApi, claimLink, botUsername } from '../lib/telegram';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

// ---------- /api/memberships ----------

export const membershipRoutes = new Hono<App>();

/**
 * Approve/reject a pending request, remove a member (status "left"), re-add a former
 * member, or change role (admins only). Leaders can't remove other leaders.
 */
membershipRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const input = await parseBody(c, updateMembershipSchema);
  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.id, idParam(c)),
  });
  if (!membership || !(await canManageGroup(db, actor, membership.groupId))) {
    throw new HTTPException(404, { message: 'not_found' });
  }

  if (input.role !== undefined && input.role !== membership.role) {
    if (!actor.isAdmin) throw new HTTPException(403, { message: 'admin_only' });
    await db.update(memberships).set({ role: input.role }).where(eq(memberships.id, membership.id));
    await audit(db, {
      actorUserId: actor.id,
      action: 'role_changed',
      entity: 'membership',
      entityId: membership.id,
      groupId: membership.groupId,
      data: { from: membership.role, to: input.role },
    });
  }

  if (input.status !== undefined && input.status !== membership.status) {
    const now = new Date().toISOString();
    if (
      membership.status === 'pending' &&
      (input.status === 'active' || input.status === 'rejected')
    ) {
      const result = await decideJoin(db, actor, membership.id, input.status === 'active');
      if (result.kind === 'ok') {
        c.executionCtx.waitUntil(
          announceJoinDecision(botApi(c.env), db, result, actor, appUrlFor(c.env, c.req.url)),
        );
      }
    } else if (input.status === 'left' && membership.status === 'active') {
      const isSelf = membership.userId === actor.id;
      if (membership.role === 'leader' && !actor.isAdmin && !isSelf) {
        throw new HTTPException(403, { message: 'cannot_remove_leader' });
      }
      await db
        .update(memberships)
        .set({ status: 'left', leftAt: now, role: 'member' })
        .where(eq(memberships.id, membership.id));
      await audit(db, {
        actorUserId: actor.id,
        action: 'member_removed',
        entity: 'membership',
        entityId: membership.id,
        groupId: membership.groupId,
      });
    } else if (
      input.status === 'active' &&
      (membership.status === 'left' || membership.status === 'rejected')
    ) {
      await db
        .update(memberships)
        .set({ status: 'active', joinedAt: now, leftAt: null })
        .where(eq(memberships.id, membership.id));
      await audit(db, {
        actorUserId: actor.id,
        action: 'member_readded',
        entity: 'membership',
        entityId: membership.id,
        groupId: membership.groupId,
      });
    } else {
      throw new HTTPException(409, { message: 'invalid_transition' });
    }
  }
  return c.json({ ok: true });
});

// ---------- /api/users ----------

export const userRoutes = new Hono<App>();

userRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const id = idParam(c);
  const isSelf = id === actor.id;
  const canManage = await canManageUser(db, actor, id);
  if (!isSelf && !canManage) throw new HTTPException(404, { message: 'not_found' });

  const target = (await db.query.users.findFirst({ where: eq(users.id, id) }))!;
  // Leaders only see memberships in groups they lead; admins and the user see all.
  const visibleGroups = actor.isAdmin || isSelf ? null : await ledGroupIds(db, actor.id);
  const rows = await db
    .select({ m: memberships, groupName: groups.name })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(
        eq(memberships.userId, id),
        inArray(memberships.status, ['pending', 'active']),
        visibleGroups ? inArray(memberships.groupId, visibleGroups) : undefined,
      ),
    )
    .orderBy(groups.name);

  const now = new Date().toISOString();
  const detail: MemberDetail = {
    user: {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      username: target.username,
      offline: target.telegramId === null,
      isAdmin: target.isAdmin,
      isReachable: target.isReachable,
      guardianConsentAt: target.guardianConsentAt,
      hasActiveClaimCode: target.claimCode !== null && (target.claimExpiresAt ?? '') > now,
    },
    memberships: rows.map(({ m, groupName }) => ({
      membershipId: m.id,
      groupId: m.groupId,
      groupName,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
    permissions: {
      canEditProfile: canManage,
      canIssueClaimCode: canManage && target.telegramId === null,
      canSetAdmin: actor.isAdmin && !isSelf && target.telegramId !== null,
    },
  };
  return c.json(detail);
});

userRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const id = idParam(c);
  if (!(await canManageUser(db, actor, id))) throw new HTTPException(404, { message: 'not_found' });
  const input = await parseBody(c, updateUserSchema);
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.firstName !== undefined) patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
  if (input.guardianConsent !== undefined) {
    patch.guardianConsentAt = input.guardianConsent ? new Date().toISOString() : null;
    patch.guardianConsentBy = input.guardianConsent ? actor.id : null;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, id));
    await audit(db, {
      actorUserId: actor.id,
      action: 'user_updated',
      entity: 'user',
      entityId: id,
      data: input,
    });
  }
  return c.json({ ok: true });
});

userRoutes.post('/:id/claim-code', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const id = idParam(c);
  if (!(await canManageUser(db, actor, id))) throw new HTTPException(404, { message: 'not_found' });
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target || target.telegramId !== null)
    throw new HTTPException(409, { message: 'already_linked' });
  const { code, expiresAt } = await issueClaimCode(db, id);
  await audit(db, {
    actorUserId: actor.id,
    action: 'claim_code_issued',
    entity: 'user',
    entityId: id,
  });
  const body: ClaimCodeResponse = {
    code,
    expiresAt,
    link: claimLink(await botUsername(c.env), code),
  };
  return c.json(body);
});

/** Grant/revoke church admin. Admins can't change their own flag (prevents lock-out). */
userRoutes.post('/:id/admin', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  if (!actor.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const id = idParam(c);
  if (id === actor.id) throw new HTTPException(409, { message: 'cannot_change_self' });
  const { isAdmin } = await parseBody(c, setAdminSchema);
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw new HTTPException(404, { message: 'not_found' });
  if (target.telegramId === null) throw new HTTPException(409, { message: 'offline_user' });
  await db.update(users).set({ isAdmin }).where(eq(users.id, id));
  await audit(db, {
    actorUserId: actor.id,
    action: isAdmin ? 'admin_granted' : 'admin_revoked',
    entity: 'user',
    entityId: id,
  });
  return c.json({ ok: true });
});
