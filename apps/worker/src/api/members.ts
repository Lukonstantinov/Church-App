import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  PERMISSIONS,
  personPhotoSchema,
  setAdminSchema,
  updateMembershipSchema,
  updateUserSchema,
  type ClaimCodeResponse,
  type MemberDetail,
  type Permission,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import {
  groupLabels,
  groups,
  media,
  memberLabels,
  memberships,
  positions,
  users,
} from '../db/schema';
import { toLabelRef } from './labels';
import { accessIn, canManageUser, visibleGroupIds } from '../lib/access';
import { defaultPositionId, effectivePermissions, permsOf, roleFor } from '../lib/positions';
import { groupLogoUrl } from '../lib/groups';
import { signedMediaUrl } from '../lib/media';
import { removeFromChat } from '../lib/chats';
import { audit } from '../lib/audit';
import { getChurch } from '../lib/church';
import { memberAttendance } from '../lib/meetings';
import { issueClaimCode } from '../lib/claim';
import { announceJoinDecision, decideJoin } from '../lib/membership';
import { appUrlFor, botApi, claimLink, botUsername } from '../lib/telegram';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

// ---------- /api/memberships ----------

export const membershipRoutes = new Hono<App>();

/**
 * Approve/reject a pending request, remove a member (status "left"), re-add a former
 * member, or change their position. Nobody can remove or re-position someone who holds
 * rights they don't have themselves, or hand out rights they don't hold.
 */
membershipRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const input = await parseBody(c, updateMembershipSchema);
  const membership = await db.query.memberships.findFirst({
    where: eq(memberships.id, idParam(c)),
  });
  if (!membership) throw new HTTPException(404, { message: 'not_found' });
  const access = await accessIn(db, actor, membership.groupId);
  // Like before rights existed: someone without the right doesn't learn the request exists.
  const need = (p: Permission) => {
    if (!access.member || !access.perms.has(p))
      throw new HTTPException(404, { message: 'not_found' });
  };
  // Rights of the person being changed: only someone holding all of them may touch them.
  const current = membership.positionId
    ? await db.query.positions.findFirst({ where: eq(positions.id, membership.positionId) })
    : undefined;
  const targetPerms = current
    ? permsOf(current)
    : membership.role === 'leader'
      ? [...PERMISSIONS]
      : [];
  // Strictly more rights (or the target has none): equal leaders can't remove each other.
  const outranks =
    actor.isAdmin ||
    targetPerms.length === 0 ||
    (targetPerms.every((p) => access.perms.has(p)) && targetPerms.length < access.perms.size);

  if (input.positionId !== undefined && input.positionId !== membership.positionId) {
    need('positions');
    const next = await db.query.positions.findFirst({ where: eq(positions.id, input.positionId) });
    if (!next || next.groupId !== membership.groupId) {
      throw new HTTPException(400, { message: 'invalid_position' });
    }
    const nextPerms = permsOf(next);
    if (!actor.isAdmin) {
      if (membership.userId === actor.id) throw new HTTPException(403, { message: 'own_position' });
      if (!outranks || nextPerms.some((p) => !access.perms.has(p))) {
        throw new HTTPException(403, { message: 'escalation' });
      }
    }
    await db
      .update(memberships)
      .set({ positionId: next.id, role: roleFor(nextPerms) })
      .where(eq(memberships.id, membership.id));
    await audit(db, {
      actorUserId: actor.id,
      action: 'position_assigned',
      entity: 'membership',
      entityId: membership.id,
      groupId: membership.groupId,
      data: { from: membership.positionId, to: next.id },
    });
  }

  if (input.status !== undefined && input.status !== membership.status) {
    const isSelf = membership.userId === actor.id;
    if (!(isSelf && input.status === 'left')) need('people.manage');
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
      if (!outranks && !isSelf) throw new HTTPException(403, { message: 'cannot_remove_leader' });
      await db
        .update(memberships)
        .set({
          status: 'left',
          leftAt: now,
          role: 'member',
          positionId: await defaultPositionId(db, membership.groupId),
        })
        .where(eq(memberships.id, membership.id));
      await removeFromChat(db, membership.groupId, membership.userId);
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
  const visibleGroups = actor.isAdmin || isSelf ? null : await visibleGroupIds(db, actor.id);
  const rows = await db
    .select({
      m: memberships,
      groupName: groups.name,
      openAttendance: groups.membersSeeAttendance,
      brandColor: groups.brandColor,
      logoMediaId: groups.logoMediaId,
      positionName: positions.name,
      positionLook: positions.look,
      permissions: positions.permissions,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(
      and(
        eq(memberships.userId, id),
        inArray(memberships.status, ['pending', 'active']),
        visibleGroups ? inArray(memberships.groupId, visibleGroups) : undefined,
      ),
    )
    .orderBy(groups.name);

  const now = new Date().toISOString();
  const church = await getChurch(db);
  const attendance = await Promise.all(
    rows
      .filter(({ m }) => m.status === 'active')
      .map(async ({ m, groupName, openAttendance }) => ({
        ...(await memberAttendance(db, {
          userId: id,
          groupId: m.groupId,
          groupName,
          joinedAt: m.joinedAt,
          timezone: church.timezone,
        })),
        // Those who manage the person always see it; plain members their own only when
        // the ministry allows it.
        visible:
          canManage || openAttendance || (await accessIn(db, actor, m.groupId)).perms.size > 0,
      })),
  );
  const labelRows = rows.length
    ? await db
        .select({ groupId: groupLabels.groupId, label: groupLabels })
        .from(memberLabels)
        .innerJoin(groupLabels, eq(groupLabels.id, memberLabels.labelId))
        .where(
          and(
            eq(memberLabels.userId, id),
            inArray(
              groupLabels.groupId,
              rows.map((r) => r.m.groupId),
            ),
          ),
        )
        .orderBy(asc(groupLabels.sort), asc(groupLabels.id))
    : [];
  const detail: MemberDetail = {
    attendance,
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
      photoUrl: target.photoMediaId
        ? await signedMediaUrl(c.env.WEBHOOK_SECRET, target.photoMediaId)
        : null,
    },
    memberships: rows.map(
      ({ m, groupName, brandColor, logoMediaId, positionName, positionLook, permissions }) => ({
        membershipId: m.id,
        groupId: m.groupId,
        groupName,
        brandColor,
        logoUrl: groupLogoUrl({ id: m.groupId, logoMediaId }),
        positionName,
        positionLook: positionLook ?? null,
        permissions: effectivePermissions(false, { role: m.role, permissions }),
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
        labels: labelRows.filter((l) => l.groupId === m.groupId).map((l) => toLabelRef(l.label)),
      }),
    ),
    permissions: {
      canEditProfile: canManage,
      canEditPhoto: canManage || isSelf,
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

/**
 * A person's profile photo — on meeting cards and the speakers of generated posters. The
 * person sets their own, whoever manages them anyone's. The picture must be an upload of
 * a ministry the person is in.
 */
userRoutes.put('/:id/photo', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const id = idParam(c);
  if (id !== actor.id && !(await canManageUser(db, actor, id)))
    throw new HTTPException(404, { message: 'not_found' });
  const { mediaId } = await parseBody(c, personPhotoSchema);
  if (mediaId) {
    const [ok] = await db
      .select({ id: media.id })
      .from(media)
      .innerJoin(
        memberships,
        and(eq(memberships.groupId, media.groupId), eq(memberships.userId, id)),
      )
      .where(eq(media.id, mediaId))
      .limit(1);
    if (!ok) throw new HTTPException(400, { message: 'invalid_media' });
  }
  await db.update(users).set({ photoMediaId: mediaId }).where(eq(users.id, id));
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
