import { useState, type FormEvent } from 'react';
import { Button, Screen, Section, TextField, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useCreateGroup } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function CreateGroup() {
  const { replace } = useNav();
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateGroup();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { id } = await create.mutateAsync({ name, description });
    haptic.success();
    // Straight into the new ministry, where its settings (theme, logo) are one tap away.
    replace({ name: 'env', groupId: id });
  }

  return (
    <Screen>
      <Title>{t.groups.create}</Title>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section>
          <TextField label={t.groups.name} value={name} onChange={setName} autoFocus />
          <TextField
            label={t.groups.description}
            value={description}
            onChange={setDescription}
            maxLength={300}
          />
        </Section>
        {create.isError && <p className="px-4 text-destructive">{t.common.errorGeneric}</p>}
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {t.groups.create}
        </Button>
      </form>
    </Screen>
  );
}
