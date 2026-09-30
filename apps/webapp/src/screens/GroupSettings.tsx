import { useState } from 'react';
import { IconTelegram } from '../components/icons';
import { useToast } from '../components/Toast';
import {
  Button,
  ErrorState,
  Loading,
  Screen,
  Section,
  TextArea,
  TextField,
  Title,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useGroup, useUpdateGroup } from '../lib/queries';
import { haptic } from '../lib/telegram';

const CHAT_RE = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/;

export function GroupSettings({ groupId }: { groupId: number }) {
  const group = useGroup(groupId);
  if (group.isPending) return <Loading />;
  if (group.isError) return <ErrorState onRetry={() => void group.refetch()} />;
  return (
    <Form
      groupId={groupId}
      initial={{
        name: group.data.name,
        description: group.data.description ?? '',
        chatUrl: group.data.chatUrl ?? '',
      }}
    />
  );
}

function Form({
  groupId,
  initial,
}: {
  groupId: number;
  initial: { name: string; description: string; chatUrl: string };
}) {
  const t = useT();
  const toast = useToast();
  const { back } = useNav();
  const update = useUpdateGroup(groupId);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [chatUrl, setChatUrl] = useState(initial.chatUrl);
  const chatOk = !chatUrl.trim() || CHAT_RE.test(chatUrl.trim());

  async function save() {
    try {
      await update.mutateAsync({ name: name.trim(), description, chatUrl: chatUrl.trim() || null });
      haptic.success();
      toast(t.common.saved);
      back();
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={initial.name}>{t.groups.groupSettings}</Title>
      <Section>
        <TextField label={t.events.name} value={name} onChange={setName} />
      </Section>
      <Section title={t.events.description}>
        <TextArea value={description} onChange={setDescription} maxLength={300} rows={3} />
      </Section>
      <Section
        title={t.groups.chatTitle}
        footer={chatOk ? t.groups.chatHint : t.events.chatInvalid}
      >
        <label className="flex items-center gap-3 px-4 py-3">
          <IconTelegram size={20} className="shrink-0 text-accent" />
          <input
            value={chatUrl}
            onChange={(e) => setChatUrl(e.target.value)}
            placeholder={t.events.chatPlaceholder}
            inputMode="url"
            className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-hint"
          />
        </label>
      </Section>
      <Button onClick={() => void save()} disabled={!name.trim() || !chatOk || update.isPending}>
        {update.isPending ? t.common.saving : t.common.save}
      </Button>
    </Screen>
  );
}
