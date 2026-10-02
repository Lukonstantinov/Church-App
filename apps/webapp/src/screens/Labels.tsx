import { useState } from 'react';
import {
  LABEL_ANIMATIONS,
  LABEL_STYLES,
  type LabelAnimation,
  type LabelRef,
  type LabelStyle,
} from '@church/shared';
import { LabelChip } from '../components/LabelChip';
import { Pill } from '../components/LookControls';
import { IconPlus } from '../components/icons';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  Loading,
  Screen,
  Section,
  TextField,
  Title,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useDeleteLabel, useGroup, useLabels, useSaveLabel } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

export const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

interface Draft {
  id?: number;
  name: string;
  color: string;
  color2: string | null;
  style: LabelStyle;
  animation: LabelAnimation;
}

/** A ministry's own labels: create, recolour, animate and remove them. */
export function Labels({ groupId }: { groupId: number }) {
  const t = useT();
  const toast = useToast();
  const group = useGroup(groupId);
  const labels = useLabels(groupId);
  const save = useSaveLabel(groupId);
  const del = useDeleteLabel(groupId);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (labels.isPending) return <Loading />;

  async function submit() {
    if (!draft || !draft.name.trim()) return;
    try {
      await save.mutateAsync({ ...draft, name: draft.name.trim() });
      haptic.success();
      setDraft(null);
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  async function remove(l: LabelRef) {
    if (!(await confirmDialog(t.labels.deleteConfirm))) return;
    try {
      await del.mutateAsync(l.id);
      setDraft(null);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.labels.title}</Title>

      {draft ? (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex min-h-[40px] items-center justify-center rounded-xl bg-hairline/60 py-3">
            <LabelChip label={{ ...draft, name: draft.name.trim() || t.labels.name }} />
          </div>
          <TextField
            label={t.labels.name}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            maxLength={24}
          />
          <div>
            <div className="mb-2 text-[13px] text-hint">{t.labels.fill}</div>
            <div className="flex flex-wrap gap-2">
              {LABEL_STYLES.map((st) => (
                <Pill
                  key={st}
                  on={draft.style === st}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      style: st,
                      color2: st === 'gradient' ? (draft.color2 ?? LABEL_COLORS[8]!) : draft.color2,
                    })
                  }
                  label={st === 'rainbow' ? t.labels.rainbowFill : t.labels[st]}
                />
              ))}
            </div>
          </div>
          {draft.style !== 'rainbow' && (
            <div>
              <div className="mb-2 text-[13px] text-hint">{t.labels.color}</div>
              <Swatches value={draft.color} onPick={(c) => setDraft({ ...draft, color: c })} />
            </div>
          )}
          {draft.style === 'gradient' && (
            <div>
              <div className="mb-2 text-[13px] text-hint">{t.labels.color2}</div>
              <Swatches
                value={draft.color2 ?? ''}
                onPick={(c) => setDraft({ ...draft, color2: c })}
              />
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] text-hint">{t.labels.animation}</div>
            <div className="flex flex-wrap gap-2">
              {LABEL_ANIMATIONS.map((a) => (
                <Pill
                  key={a}
                  on={draft.animation === a}
                  onClick={() => setDraft({ ...draft, animation: a })}
                  label={t.labels[a]}
                />
              ))}
            </div>
          </div>
          <Button disabled={!draft.name.trim() || save.isPending} onClick={() => void submit()}>
            {t.common.save}
          </Button>
          {draft.id && (
            <Button
              variant="destructive"
              onClick={() => void remove(labels.data!.find((l) => l.id === draft.id)!)}
            >
              {t.common.delete}
            </Button>
          )}
          <Button variant="glass" onClick={() => setDraft(null)}>
            {t.common.cancel}
          </Button>
        </Card>
      ) : (
        <>
          {(labels.data ?? []).length === 0 ? (
            <Card>
              <EmptyState icon={<IconPlus size={26} />} title={t.labels.title}>
                {t.labels.empty}
              </EmptyState>
            </Card>
          ) : (
            <Section>
              {labels.data!.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: l.id,
                      name: l.name,
                      color: l.color,
                      color2: l.color2,
                      style: l.style,
                      animation: l.animation,
                    })
                  }
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 active:bg-hairline"
                >
                  <LabelChip label={l} />
                  <span className="text-[13px] text-hint">{t.labels[l.animation]}</span>
                </button>
              ))}
            </Section>
          )}
          <Button
            onClick={() =>
              setDraft({
                name: '',
                color: LABEL_COLORS[5]!,
                color2: null,
                style: 'solid',
                animation: 'shimmer',
              })
            }
          >
            <IconPlus size={18} /> {t.labels.new}
          </Button>
        </>
      )}
    </Screen>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onPick(c)}
          className={`h-9 w-9 rounded-full transition active:scale-90 ${
            value === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
