import { useState } from 'react';
import { displayName } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useDeleteMeetingComment, useMeetingComments, usePostMeetingComment } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { Avatar } from './Avatar';
import { IconChevronDown, IconSend, IconTrash } from './icons';
import { useToast } from './Toast';

/**
 * Comments under a meeting, folded away by default (the count shows on the fold): anyone
 * who sees the meeting reads and writes; the author, its managers and roll takers delete.
 * The list is fetched only while open.
 */
export function MeetingComments({ meetingId, count }: { meetingId: number; count: number }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const list = useMeetingComments(meetingId, open);
  const post = usePostMeetingComment(meetingId);
  const del = useDeleteMeetingComment(meetingId);
  const [text, setText] = useState('');

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
    <section className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-hairline"
      >
        <span className="text-[18px]">💬</span>
        <span className="flex-1 text-[16px] font-semibold">{t.meetings.comments}</span>
        {count > 0 && (
          <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[12px] font-bold text-white tabular-nums">
            {count}
          </span>
        )}
        <IconChevronDown
          size={18}
          className={`text-hint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-hairline">
          <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto px-3 py-3">
            {(list.data?.length ?? 0) === 0 && !list.isPending && (
              <p className="py-4 text-center text-[14px] text-hint">{t.meetings.commentsEmpty}</p>
            )}
            {(list.data ?? []).map((m) => (
              <div
                key={m.id}
                className={`flex items-end gap-2 ${m.mine ? 'flex-row-reverse' : ''}`}
              >
                {!m.mine && (
                  <Avatar
                    id={m.user.id}
                    firstName={m.user.firstName}
                    lastName={m.user.lastName}
                    size={28}
                  />
                )}
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 text-[15px] leading-snug ${
                    m.mine ? 'brand-gradient rounded-br-md text-white' : 'rounded-bl-md bg-hairline'
                  }`}
                >
                  {!m.mine && (
                    <div className="text-[12px] font-semibold text-accent">
                      {displayName(m.user)}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div
                    className={`mt-0.5 flex items-center justify-end gap-2 text-[11px] ${m.mine ? 'text-white/75' : 'text-hint'}`}
                  >
                    {f.weekdayDayMonth(m.createdAt)} {f.time(m.createdAt)}
                    {m.canDelete && (
                      <button
                        type="button"
                        aria-label={t.meetings.commentDelete}
                        onClick={async () => {
                          if (await confirmDialog(t.meetings.commentDelete)) del.mutate(m.id);
                        }}
                      >
                        <IconTrash size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
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
              placeholder={t.meetings.commentWrite}
              rows={1}
              maxLength={1000}
              className="max-h-28 min-h-[40px] min-w-0 flex-1 resize-none rounded-2xl bg-hairline px-3.5 py-2.5 text-[16px] outline-none"
            />
            <button
              type="submit"
              aria-label={t.meetings.commentSend}
              disabled={!text.trim() || post.isPending}
              className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
            >
              <IconSend size={18} />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
