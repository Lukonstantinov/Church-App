import { useState, type FormEvent } from 'react';
import { Button, Screen, Section, TextField, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useAddOffline } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function AddOffline({ groupId }: { groupId: number }) {
  const { back } = useNav();
  const t = useT();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const add = useAddOffline(groupId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;
    await add.mutateAsync({ firstName, lastName });
    haptic.success();
    back();
  }

  return (
    <Screen>
      <Title>{t.member.addOfflineTitle}</Title>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section>
          <TextField
            label={t.member.firstName}
            value={firstName}
            onChange={setFirstName}
            autoFocus
          />
          <TextField label={t.member.lastName} value={lastName} onChange={setLastName} />
        </Section>
        {add.isError && <p className="px-4 text-destructive">{t.common.errorGeneric}</p>}
        <Button type="submit" disabled={!firstName.trim() || add.isPending}>
          {t.common.save}
        </Button>
      </form>
    </Screen>
  );
}
