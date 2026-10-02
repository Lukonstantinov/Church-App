import { useEffect, useRef, useState } from 'react';
import { displayName, type EventDetail } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  useDeleteEventChat,
  useEventChat,
  useLinkEventChat,
  usePostEventChat,
  useUnlinkEventChat,
} from '../lib/queries';
import { confirmDialog, haptic, openTelegramLink } from '../lib/telegram';
import { Avatar } from './Avatar';
import { IconSend, IconTelegram, IconTrash } from './icons';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { ActionRow, Button, Section } from './ui';

/**
 * The event's chats: a Telegram chat dedicated to it (open it, or — for leaders —
 * create and link one through the bot) and the in-app chat for the ministry's members.
 */
export function EventChat({ e }: { e: EventDetail }) {
  const t = useT();
  return (
    <>
      <TelegramChat e={e} />
      {e.member && (
        <Section title={t.events.chatInApp} footer={t.events.chatInAppHint}>
          <InAppChat e={e} />
        </Section>
      )}
    </>
  );
}

function TelegramChat({ e }: { e: EventDetail }) {
  const t = useT();
  const toast = useToast();
  const link = useLinkEventChat(e.id);
  const unlink = useUnlinkEventChat(e.id);
  const [howTo, setHowTo] = useState(false);
  if (!e.chatUrl && !e.canManage) return null;

  async function connect() {
    try {
      const { url } = await link.mutateAsync();
      setHowTo(false);
      openTelegramLink(url);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Section title={t.events.chatTelegram}>
      {e.chatUrl && (
        <ActionRow icon={<IconTelegram size={20} />} onClick={() => openTelegramLink(e.chatUrl!)}>
          {t.events.chatTelegramOpen}
        </ActionRow>
      )}
      {e.managedChat && (
        <div className="px-4 py-2.5 text-[13px] text-hint">
          {t.events.chatTelegramManaged(e.managedChat.title ?? '')}
          {e.managedChat.pending && <div className="text-late">{t.env.chatPending}</div>}
        </div>
      )}
      {e.canManage && !e.managedChat && (
        <ActionRow icon={<IconTelegram size={20} />} onClick={() => setHowTo(true)}>
          {t.events.chatTelegramCreate}
        </ActionRow>
      )}
      {e.canManage && e.managedChat && (
        <ActionRow
          destructive
          disabled={unlink.isPending}
          onClick={async () => {
            if (await confirmDialog(t.events.chatTelegramDisconnectConfirm)) unlink.mutate();
          }}
        >
          {t.events.chatTelegramDisconnect}
        </ActionRow>
      )}
      <Sheet open={howTo} onClose={() => setHowTo(false)} title={t.events.chatTelegramCreate}>
        <div className="flex flex-col gap-3 px-5 pb-4">
          <p className="whitespace-pre-line text-[15px] leading-snug">
            {t.events.chatTelegramSteps}
          </p>
          <Button disabled={link.isPending} onClick={() => void connect()}>
            <IconTelegram size={18} /> {t.events.chatTelegramCreate}
          </Button>
        </div>
      </Sheet>
    </Section>
  );
}

function InAppChat({ e }: { e: EventDetail }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const chat = useEventChat(e.id);
  const post = usePostEventChat(e.id);
  const del = useDeleteEventChat(e.id);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const count = chat.data?.length ?? 0;

  // Newest at the bottom: follow it when messages arrive.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      await post.mutateAsync(body);
      haptic.tap();
    } catch {
      setText(body);
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex max-h-[360px] min-h-[96px] flex-col gap-2 overflow-y-auto px-3 py-3">
        {count === 0 && !chat.isPending && (
          <p className="py-5 text-center text-[14px] text-hint">{t.events.chatEmpty}</p>
        )}
        {(chat.data ?? []).map((m) => (
          <div key={m.id} className={`flex items-end gap-2 ${m.mine ? 'flex-row-reverse' : ''}`}>
            {!m.mine && (
              <Avatar
                id={m.user.id}
                firstName={m.user.firstName}
                lastName={m.user.lastName}
                size={28}
              />
            )}
            <div
              className={`group max-w-[78%] rounded-2xl px-3 py-2 text-[15px] leading-snug ${
                m.mine ? 'brand-gradient rounded-br-md text-white' : 'bg-hairline rounded-bl-md'
              }`}
            >
              {!m.mine && (
                <div className="text-[12px] font-semibold text-accent">{displayName(m.user)}</div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div
                className={`mt-0.5 flex items-center justify-end gap-2 text-[11px] ${m.mine ? 'text-white/75' : 'text-hint'}`}
              >
                {f.time(m.createdAt)}
                {m.canDelete && (
                  <button
                    type="button"
                    aria-label={t.events.chatDeleteMessage}
                    onClick={async () => {
                      if (await confirmDialog(t.events.chatDeleteMessage)) del.mutate(m.id);
                    }}
                  >
                    <IconTrash size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-hairline p-2.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          placeholder={t.events.chatWrite}
          rows={1}
          maxLength={1000}
          className="max-h-28 min-h-[40px] min-w-0 flex-1 resize-none rounded-2xl bg-hairline px-3.5 py-2.5 text-[15px] outline-none"
        />
        <button
          type="submit"
          aria-label={t.events.chatSend}
          disabled={!text.trim() || post.isPending}
          className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
        >
          <IconSend size={18} />
        </button>
      </form>
    </div>
  );
}
