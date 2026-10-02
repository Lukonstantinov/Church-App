import { useState } from 'react';
import type { LabelLook, LabelRef } from '@church/shared';
import { LabelChip } from '../components/LabelChip';
import { LookEditor, defaultLook } from '../components/LookEditor';
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

interface Draft extends LabelLook {
  id?: number;
  name: string;
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
          <TextField
            label={t.labels.name}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            maxLength={24}
          />
          <LookEditor
            value={draft}
            onChange={(look) => setDraft({ ...draft, ...look })}
            name={draft.name.trim() || t.labels.name}
          />
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
                  onClick={() => setDraft({ ...l })}
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 active:bg-hairline"
                >
                  <LabelChip label={l} />
                  <span className="text-[13px] text-hint">{t.labels[l.animation] as string}</span>
                </button>
              ))}
            </Section>
          )}
          <Button onClick={() => setDraft({ ...defaultLook(), name: '' })}>
            <IconPlus size={18} /> {t.labels.new}
          </Button>
        </>
      )}
    </Screen>
  );
}
