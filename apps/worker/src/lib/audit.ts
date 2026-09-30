import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entity: 'church' | 'group' | 'membership' | 'user';
  entityId: number;
  groupId?: number | null;
  data?: Record<string, unknown>;
}

export function audit(db: Db, entry: AuditEntry) {
  return db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    groupId: entry.groupId ?? null,
    data: entry.data ?? null,
  });
}
