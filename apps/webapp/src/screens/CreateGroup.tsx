import { useState, type FormEvent } from 'react';
import { ru } from '@church/shared';
import { Button, Screen, Section, TextField, Title } from '../components/ui';
import { useNav } from '../lib/nav';
import { useCreateGroup } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function CreateGroup() {
  const { back, push } = useNav();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateGroup();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { id } = await create.mutateAsync({ name, description });
    haptic.success();
    back();
    push({ name: 'group', groupId: id });
  }

  return (
    <Screen>
      <Title>{ru.app.createGroup}</Title>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section>
          <TextField label={ru.app.groupName} value={name} onChange={setName} autoFocus />
          <TextField
            label={ru.app.groupDescription}
            value={description}
            onChange={setDescription}
            maxLength={300}
          />
        </Section>
        {create.isError && <p className="px-4 text-destructive">{ru.app.errorGeneric}</p>}
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {ru.app.createGroup}
        </Button>
      </form>
    </Screen>
  );
}
