import { labelLookSchema, type LabelLook } from './labels';
import { z } from 'zod';

/**
 * Rights a position inside an environment can grant. Church admins have all of them
 * everywhere. Anyone with an active membership can see the environment itself (its
 * meetings, events, announcements and their own data).
 */
export const PERMISSIONS = [
  'people.view',
  'people.manage',
  'attendance.take',
  'meetings.manage',
  'money.view',
  'money.manage',
  'events.manage',
  'announce',
  'reports',
  'settings',
  'positions',
  'design',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Rights that only make sense together with another one (granting them grants these too). */
export const IMPLIES: Partial<Record<Permission, Permission[]>> = {
  'people.manage': ['people.view'],
  'attendance.take': ['people.view'],
  'money.manage': ['money.view', 'people.view'],
  reports: ['money.view'],
  positions: ['people.view'],
};

/** Adds implied rights and drops unknown ones; stable order. */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  const add = (p: Permission) => {
    if (set.has(p)) return;
    set.add(p);
    for (const q of IMPLIES[p] ?? []) add(q);
  };
  for (const p of list) if ((PERMISSIONS as readonly string[]).includes(p)) add(p as Permission);
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Grouped for the rights editor. */
export const PERMISSION_GROUPS: { key: string; items: Permission[] }[] = [
  { key: 'people', items: ['people.view', 'people.manage'] },
  { key: 'meetings', items: ['attendance.take', 'meetings.manage'] },
  { key: 'money', items: ['money.view', 'money.manage', 'reports'] },
  { key: 'events', items: ['events.manage', 'announce'] },
  { key: 'admin', items: ['settings', 'positions'] },
  { key: 'design', items: ['design'] },
];

/** True when the rights allow using the leader app (any management right). */
export const hasManagerRights = (perms: readonly Permission[]) => perms.length > 0;

export interface PositionRow {
  id: number;
  groupId: number;
  name: string;
  description: string | null;
  permissions: Permission[];
  /** New members get this position. */
  isDefault: boolean;
  memberCount: number;
  /** How its chip looks next to people's names (null = the plain chip). */
  look: LabelLook | null;
}

export const positionInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => (v ? v : null)),
  permissions: z
    .array(z.string())
    .max(PERMISSIONS.length * 2)
    .transform(normalizePermissions),
  isDefault: z.boolean().optional(),
  look: labelLookSchema.nullish(),
});
export type PositionInput = z.input<typeof positionInputSchema>;

export const setPositionSchema = z.object({ positionId: z.number().int().positive() });

/** The ministry's positions top to bottom: the order of the member lists. */
export const positionOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});
