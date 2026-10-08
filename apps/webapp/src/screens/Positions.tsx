import { useState } from 'react';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  normalizePermissions,
  type LabelLook,
  type Permission,
  type PositionRow,
} from '@church/shared';
import { IconCheck, IconChevronDown, IconPlus, IconTrash } from '../components/icons';
import { LabelChip } from '../components/LabelLook';
import { Pill } from '../components/LookControls';
import { LookEditor, defaultLook } from '../components/LookEditor';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Loading,
  Screen,
  Section,
  TextArea,
  TextField,
  Title,
  Toggle,
} from '../components/ui';
import { ApiError } from '../lib/api';
import { useEnv } from '../lib/env';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useDeletePosition,
  useGroup,
  usePositions,
  useReorderPositions,
  useSavePosition,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

/** List of the ministry's positions: who they are for, how many people, how many rights. */
export function Positions({ groupId }: { groupId: number }) {
  const t = useT();
  const { push } = useNav();
  const group = useGroup(groupId);
  const q = usePositions(groupId);
  const reorder = useReorderPositions(groupId);
  const { can } = useEnv();
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const list = q.data;
  // Moves a position one place up or down: members are listed in this order.
  const move = (i: number, by: -1 | 1) => {
    const ids = list.map((p) => p.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    haptic.tap();
    reorder.mutate(ids);
  };

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.positions.title}</Title>
      {can('positions') && list.length > 1 && (
        <p className="-mt-2 px-2 text-[13px] leading-snug text-hint">{t.positions.orderHint}</p>
      )}
      <div className="flex flex-col gap-3">
        {list.map((p, i) => (
          <div key={p.id} className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <Card
                onClick={() => push({ name: 'position', groupId, positionId: p.id })}
                className="p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">
                    {p.look ? <LabelChip label={{ ...p.look, name: p.name }} /> : p.name}
                  </span>
                  {p.isDefault && <Badge tone="hint">{t.positions.defaultBadge}</Badge>}
                  <span className="text-[13px] text-hint">{t.positions.people(p.memberCount)}</span>
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-[14px] text-hint">{p.description}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.permissions.length === 0 ? (
                    <Badge tone="hint">{t.positions.noRights}</Badge>
                  ) : p.permissions.length === PERMISSIONS.length ? (
                    <Badge>
                      {t.positions.rightsCount(p.permissions.length, PERMISSIONS.length)}
                    </Badge>
                  ) : (
                    p.permissions.map((perm) => (
                      <Badge key={perm} tone="accent">
                        {t.positions.perm[perm]}
                      </Badge>
                    ))
                  )}
                </div>
              </Card>
            </div>
            {can('positions') && list.length > 1 && (
              <span className="flex shrink-0 flex-col justify-center gap-1.5">
                <button
                  type="button"
                  aria-label={t.positions.moveUp}
                  disabled={i === 0 || reorder.isPending}
                  onClick={() => move(i, -1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline active:scale-90 disabled:opacity-30"
                >
                  <IconChevronDown size={16} className="rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={t.positions.moveDown}
                  disabled={i === list.length - 1 || reorder.isPending}
                  onClick={() => move(i, 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline active:scale-90 disabled:opacity-30"
                >
                  <IconChevronDown size={16} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <Button onClick={() => push({ name: 'position', groupId })}>
        <IconPlus size={18} /> {t.positions.new}
      </Button>
    </Screen>
  );
}

const TEMPLATES: {
  key: 'tplHelper' | 'tplTreasurer' | 'tplMedia' | 'tplHost' | 'tplDesigner';
  perms: Permission[];
}[] = [
  { key: 'tplHelper', perms: ['attendance.take'] },
  { key: 'tplTreasurer', perms: ['money.manage', 'reports'] },
  // Media publish themselves; a designer prepares posters and sends them for approval.
  { key: 'tplMedia', perms: ['events.manage', 'announce', 'design'] },
  { key: 'tplDesigner', perms: ['design'] },
  { key: 'tplHost', perms: ['attendance.take', 'meetings.manage', 'announce'] },
];

/** Create or edit one position: name, description, default flag and rights. */
export function PositionEditor({ groupId, positionId }: { groupId: number; positionId?: number }) {
  const q = usePositions(groupId);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const existing = positionId ? q.data.find((p) => p.id === positionId) : undefined;
  return <EditorBody groupId={groupId} existing={existing} />;
}

function EditorBody({ groupId, existing }: { groupId: number; existing?: PositionRow }) {
  const t = useT();
  const toast = useToast();
  const { back } = useNav();
  const { can } = useEnv();
  const save = useSavePosition(groupId);
  const del = useDeletePosition(groupId);
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [perms, setPerms] = useState<Permission[]>(existing?.permissions ?? []);
  // Null = the plain chip; otherwise the position looks like a label next to names.
  const [look, setLook] = useState<LabelLook | null>(existing?.look ?? null);
  // Rights the editor doesn't hold can be neither given nor taken away.
  const locked = (p: Permission) => !can(p);
  const editable = !existing || existing.permissions.every((p) => can(p));

  const toggle = (p: Permission) => {
    haptic.tap();
    setPerms((cur) =>
      cur.includes(p)
        ? cur.filter((x) => x !== p)
        : normalizePermissions([...cur, p]).filter((x) => !locked(x) || cur.includes(x)),
    );
  };

  const errorText = (err: unknown) =>
    err instanceof ApiError && err.code === 'escalation'
      ? t.positions.escalation
      : err instanceof ApiError && err.code === 'position_in_use'
        ? t.positions.inUse
        : t.common.saveFailed;

  async function submit() {
    try {
      await save.mutateAsync({
        id: existing?.id,
        name: name.trim(),
        description,
        permissions: normalizePermissions(perms),
        isDefault,
        look,
      });
      haptic.success();
      toast(t.common.saved);
      back();
    } catch (err) {
      haptic.error();
      toast(errorText(err), 'error');
    }
  }

  async function remove() {
    if (!existing || !(await confirmDialog(t.positions.confirmDelete))) return;
    try {
      await del.mutateAsync(existing.id);
      back();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  return (
    <Screen>
      <Title>{existing ? existing.name : t.positions.new}</Title>

      {!existing && (
        <section>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.positions.templates}
          </h2>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.filter((tpl) => tpl.perms.every((p) => can(p))).map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => {
                  setName(t.positions[tpl.key]);
                  setPerms(normalizePermissions(tpl.perms));
                }}
                className="glass min-h-[40px] rounded-full px-4 text-[15px] font-semibold active:scale-95"
              >
                {t.positions[tpl.key]}
              </button>
            ))}
          </div>
        </section>
      )}

      <Section>
        <TextField label={t.positions.name} value={name} onChange={setName} maxLength={40} />
      </Section>
      <Section title={t.positions.description}>
        <TextArea
          value={description}
          onChange={setDescription}
          placeholder={t.positions.descriptionPlaceholder}
          maxLength={300}
          rows={3}
        />
      </Section>
      <Section>
        <Toggle
          label={t.positions.isDefault}
          checked={isDefault}
          disabled={existing?.isDefault}
          onChange={setIsDefault}
        />
      </Section>

      <Section title={t.labels.positionLook} footer={t.labels.positionLookHint}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex gap-2">
            <Pill on={!look} onClick={() => setLook(null)} label={t.labels.plainLook} />
            <Pill
              on={!!look}
              onClick={() => setLook(look ?? { ...defaultLook(), animation: 'flow' })}
              label={t.labels.customLook}
            />
          </div>
          {look && (
            <LookEditor value={look} onChange={setLook} name={name.trim() || t.positions.name} />
          )}
        </div>
      </Section>

      <h2 className="-mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
        {t.positions.rights}
      </h2>
      {PERMISSION_GROUPS.map((g) => (
        <Section key={g.key} title={t.positions.groups[g.key as keyof typeof t.positions.groups]}>
          {g.items.map((p) => {
            const on = perms.includes(p);
            return (
              <button
                key={p}
                type="button"
                role="switch"
                aria-checked={on}
                disabled={locked(p) || !editable}
                onClick={() => toggle(p)}
                className="flex min-h-[54px] w-full items-center gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 disabled:opacity-45"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                    on ? 'brand-gradient text-white' : 'border-2 border-hint/40'
                  }`}
                >
                  {on && <IconCheck size={15} />}
                </span>
                <span className="flex-1 text-[16px]">{t.positions.perm[p]}</span>
              </button>
            );
          })}
        </Section>
      ))}

      <Button onClick={() => void submit()} disabled={!name.trim() || !editable || save.isPending}>
        {save.isPending ? t.common.saving : t.common.save}
      </Button>
      {existing && !existing.isDefault && editable && (
        <Button variant="destructive" onClick={() => void remove()} disabled={del.isPending}>
          <IconTrash size={18} /> {t.positions.delete}
        </Button>
      )}
    </Screen>
  );
}
