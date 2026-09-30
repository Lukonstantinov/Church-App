import { useState, type FormEvent } from 'react';
import { ru } from '@church/shared';
import { Button, Screen, Section, TextField, Title, Toggle } from '../components/ui';
import { useNav } from '../lib/nav';
import { useAddOffline } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function AddOffline({ groupId }: { groupId: number }) {
  const { back } = useNav();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [consent, setConsent] = useState(false);
  const add = useAddOffline(groupId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;
    await add.mutateAsync({ firstName, lastName, guardianConsent: consent });
    haptic.success();
    back();
  }

  return (
    <Screen>
      <Title>{ru.app.addOffline}</Title>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section>
          <TextField label={ru.app.firstName} value={firstName} onChange={setFirstName} autoFocus />
          <TextField label={ru.app.lastName} value={lastName} onChange={setLastName} />
        </Section>
        <Section footer={ru.app.guardianConsentHint}>
          <Toggle label={ru.app.guardianConsent} checked={consent} onChange={setConsent} />
        </Section>
        {add.isError && <p className="px-4 text-destructive">{ru.app.errorGeneric}</p>}
        <Button type="submit" disabled={!firstName.trim() || add.isPending}>
          {ru.app.save}
        </Button>
      </form>
    </Screen>
  );
}
