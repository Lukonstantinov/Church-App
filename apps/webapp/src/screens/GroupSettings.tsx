import { useRef, useState } from 'react';
import type { GroupDetail } from '@church/shared';
import { IconImage, IconTelegram, IconTrash } from '../components/icons';
import { PatternDesigner } from '../components/PatternDesigner';
import { Pill } from '../components/LookControls';
import { ThemePicker } from '../components/ThemePicker';
import { useToast } from '../components/Toast';
import {
  ActionRow,
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
import {
  useArchiveGroup,
  useGroup,
  useLinkChat,
  useMe,
  useUnlinkChat,
  useUpdateGroup,
  useUploadMedia,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';

const CHAT_RE = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/;

/** Ministry settings: look (logo, theme, pattern), name, Telegram chat, deletion. */
export function GroupSettings({ groupId }: { groupId: number }) {
  const group = useGroup(groupId);
  if (group.isPending) return <Loading />;
  if (group.isError) return <ErrorState onRetry={() => void group.refetch()} />;
  return <Form g={group.data} />;
}

function Form({ g }: { g: GroupDetail }) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const { back } = useNav();
  const update = useUpdateGroup(g.id);
  const upload = useUploadMedia(g.id, 'event');
  const linkChat = useLinkChat(g.id);
  const unlinkChat = useUnlinkChat(g.id);
  const archive = useArchiveGroup();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(g.name);
  const [description, setDescription] = useState(g.description ?? '');
  const [place, setPlace] = useState(g.defaultLocation);
  const [chatUrl, setChatUrl] = useState(g.managedChat ? '' : (g.chatUrl ?? ''));
  const chatOk = !chatUrl.trim() || CHAT_RE.test(chatUrl.trim());
  const churchTheme = me.data?.church.brandColor ?? 'blue';

  async function patchNow(input: Parameters<typeof update.mutateAsync>[0]) {
    try {
      await update.mutateAsync(input);
      haptic.success();
      return true;
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
      return false;
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
    const ok = await patchNow({
      name: name.trim(),
      description,
      defaultLocation: place.trim(),
      ...(g.managedChat ? {} : { chatUrl: chatUrl.trim() || null }),
    });
    if (ok) {
      toast(t.common.saved);
      back();
    }
  }

  async function connectChat() {
    try {
      const { url } = await linkChat.mutateAsync();
      openTelegramLink(url);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  async function remove() {
    if (!(await confirmDialog(t.env.confirmDelete(g.name)))) return;
    try {
      await archive.mutateAsync(g.id);
      haptic.success();
      toast(t.env.deleted);
      // Back past this screen and the ministry itself, to the main page.
      back();
      setTimeout(back, 0);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={g.name}>{t.env.settings}</Title>

      <Section title={t.env.logo}>
        <div className="flex items-center gap-4 p-4">
          {g.logoUrl ? (
            <img
              src={g.logoUrl}
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
            {g.logoUrl && (
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
        <ThemePicker value={g.brandColor} onChange={(v) => v && void patchNow({ brandColor: v })} />
      </Section>

      <Section title={t.env.look} sticky>
        <PatternDesigner
          env={g}
          fallbackTheme={churchTheme}
          saving={update.isPending}
          onSave={(look) => void patchNow(look)}
        />
      </Section>

      <Section>
        <TextField label={t.events.name} value={name} onChange={setName} />
      </Section>
      <Section title={t.meetings.defaultPlace} footer={t.meetings.defaultPlaceHint}>
        <TextField label={t.meetings.taskPlace} value={place} onChange={setPlace} maxLength={120} />
      </Section>
      <Section title={t.events.remindAutoTitle} footer={t.events.remindAutoHint}>
        <div className="flex flex-wrap gap-2 p-3">
          <Pill
            on={g.eventReminderHours === null}
            onClick={() => void patchNow({ eventReminderHours: null })}
            label={t.events.remindAutoOff}
          />
          {[3, 24, 48, 72].map((h) => (
            <Pill
              key={h}
              on={g.eventReminderHours === h}
              onClick={() => void patchNow({ eventReminderHours: h })}
              label={t.events.remindAutoHours(h)}
            />
          ))}
        </div>
      </Section>
      <Section title={t.events.description}>
        <TextArea value={description} onChange={setDescription} maxLength={300} rows={3} />
      </Section>

      <Section title={t.env.chatSection} footer={t.env.chatManagedHint}>
        {g.managedChat ? (
          <>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white">
                <IconTelegram size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold">
                  {t.env.chatConnected(g.managedChat.title ?? '')}
                </div>
                {g.managedChat.pending && (
                  <div className="text-[13px] text-late">{t.env.chatPending}</div>
                )}
              </div>
            </div>
            {g.chatUrl && (
              <ActionRow onClick={() => openTelegramLink(g.chatUrl!)}>
                {t.groups.openGroupChat}
              </ActionRow>
            )}
            <ActionRow
              destructive
              disabled={unlinkChat.isPending}
              onClick={async () => {
                if (await confirmDialog(t.env.confirmDisconnect)) unlinkChat.mutate();
              }}
            >
              {t.env.disconnectChat}
            </ActionRow>
          </>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <p className="whitespace-pre-line text-[14px] leading-snug text-hint">
              {t.env.connectSteps}
            </p>
            <Button onClick={() => void connectChat()} disabled={linkChat.isPending}>
              <IconTelegram size={18} /> {t.env.connectChat}
            </Button>
            <div className="pt-1 text-[13px] text-hint">{t.env.manualLink}</div>
            <input
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              placeholder={t.events.chatPlaceholder}
              inputMode="url"
              className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
            />
            {!chatOk && <p className="text-[13px] text-absent">{t.events.chatInvalid}</p>}
          </div>
        )}
      </Section>

      <Button onClick={() => void save()} disabled={!name.trim() || !chatOk || update.isPending}>
        {update.isPending ? t.common.saving : t.common.save}
      </Button>

      {me.data?.user.isAdmin && (
        <Section footer={t.env.deleteHint}>
          <ActionRow destructive onClick={() => void remove()} disabled={archive.isPending}>
            <IconTrash size={18} /> {t.env.delete}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}
