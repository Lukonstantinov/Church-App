import { useRef, useState } from 'react';
import { IconImage, IconTelegram, IconTrash } from '../components/icons';
import { ThemePicker } from '../components/ThemePicker';
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
import { prepareLogo } from '../lib/image';
import { useNav } from '../lib/nav';
import { useGroup, useMe, useUpdateGroup, useUploadMedia } from '../lib/queries';
import { haptic } from '../lib/telegram';

const CHAT_RE = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/;

/** Ministry settings: name, description, theme, logo and Telegram chat. */
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
      brandColor={group.data.brandColor}
      logoUrl={group.data.logoUrl}
    />
  );
}

function Form({
  groupId,
  initial,
  brandColor,
  logoUrl,
}: {
  groupId: number;
  initial: { name: string; description: string; chatUrl: string };
  brandColor: string | null;
  logoUrl: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const { back } = useNav();
  const update = useUpdateGroup(groupId);
  const upload = useUploadMedia(groupId, 'event');
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [chatUrl, setChatUrl] = useState(initial.chatUrl);
  const chatOk = !chatUrl.trim() || CHAT_RE.test(chatUrl.trim());

  async function patchNow(input: Parameters<typeof update.mutateAsync>[0]) {
    try {
      await update.mutateAsync(input);
      haptic.success();
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    try {
      const media = await upload.mutateAsync(await prepareLogo(file));
      await patchNow({ logoMediaId: media.id });
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

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
      <Title subtitle={initial.name}>{t.env.settings}</Title>

      <Section title={t.env.logo}>
        <div className="flex items-center gap-4 p-4">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-card"
            />
          ) : (
            <span className="brand-gradient flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-cta">
              <IconImage size={26} />
            </span>
          )}
          <div className="flex flex-1 flex-col gap-2">
            <Button
              small
              variant="secondary"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending ? t.treasury.uploading : t.env.uploadLogo}
            </Button>
            {logoUrl && (
              <Button small variant="glass" onClick={() => void patchNow({ logoMediaId: null })}>
                <IconTrash size={15} /> {t.env.removeLogo}
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onLogo(e.target.files?.[0])}
          />
        </div>
      </Section>

      <Section title={t.env.theme}>
        <ThemePicker
          value={brandColor}
          onChange={(v) => void patchNow({ brandColor: v })}
          inherit={{
            label: me.data?.church.name ?? '',
            theme: me.data?.church.brandColor ?? 'blue',
          }}
        />
      </Section>

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
