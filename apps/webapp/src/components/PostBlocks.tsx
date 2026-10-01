import { useState, type CSSProperties } from 'react';
import type { PostBlockView } from '@church/shared';
import { useT } from '../lib/i18n';
import { useVote } from '../lib/queries';
import { haptic, openTelegramLink } from '../lib/telegram';
import { RichText } from './RichText';
import { useToast } from './Toast';

type Poll = Extract<PostBlockView, { type: 'poll' }>;
type Quiz = Extract<PostBlockView, { type: 'quiz' }>;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const FILE_ICON: Record<string, string> = {
  'application/pdf': '📕',
  'text/plain; charset=utf-8': '📄',
};
const fileIcon = (mime: string) =>
  FILE_ICON[mime] ??
  (mime.startsWith('image/')
    ? '🖼️'
    : mime.includes('spreadsheet')
      ? '📗'
      : mime.includes('presentation')
        ? '📙'
        : '📘');

/** Opens an attachment in Telegram's browser (PDFs and pictures preview there). */
const openFile = (url: string) => openTelegramLink(new URL(url, location.origin).toString());

/** A post's content after its text, in order. `compact` (feed cards) shows polls in full
 * and the rest as small chips. */
export function PostBlocks({
  postId,
  groupId,
  blocks,
  bodyStyle,
  onImage,
  compact,
}: {
  postId: number;
  groupId: number;
  blocks: PostBlockView[];
  bodyStyle?: CSSProperties;
  onImage?: (url: string) => void;
  compact?: boolean;
}) {
  const t = useT();
  if (blocks.length === 0) return null;
  if (compact) {
    const interactive = blocks.filter((b) => b.type === 'poll' || b.type === 'quiz');
    const others = blocks.filter(
      (b) => b.type !== 'poll' && b.type !== 'quiz' && b.type !== 'text',
    );
    const icons = { image: '🖼️', table: '📊', file: '📎', text: '', poll: '', quiz: '' };
    return (
      <div className="flex flex-col gap-3">
        {interactive
          .slice(0, 1)
          .map((b) =>
            b.type === 'poll' ? (
              <PollView key={b.id} postId={postId} groupId={groupId} poll={b} />
            ) : (
              <QuizView key={b.id} postId={postId} groupId={groupId} quiz={b as Quiz} />
            ),
          )}
        {others.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {others.map((b) => (
              <span
                key={b.id}
                className="max-w-full truncate rounded-full bg-hairline px-2.5 py-1 text-[13px] font-medium"
              >
                {icons[b.type]} {b.type === 'file' ? b.name : t.feed.blockTypes[b.type]}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
      {blocks.map((b) => {
        switch (b.type) {
          case 'text':
            return (
              <RichText
                key={b.id}
                text={b.text}
                className="text-[17px] leading-relaxed"
                style={bodyStyle}
              />
            );
          case 'image':
            return (
              <figure key={b.id} className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onImage?.(b.url)}
                  className="overflow-hidden rounded-2xl bg-hairline"
                >
                  <img src={b.url} alt={b.caption ?? ''} loading="lazy" className="w-full" />
                </button>
                {b.caption && (
                  <figcaption className="px-1 text-[13px] text-hint">{b.caption}</figcaption>
                )}
              </figure>
            );
          case 'table':
            return (
              <div key={b.id} className="-mx-1 overflow-x-auto rounded-2xl ring-1 ring-hairline">
                <table className="w-full border-collapse text-[14px]">
                  <tbody>
                    {b.rows.map((row, i) => {
                      const head = b.header && i === 0;
                      return (
                        <tr
                          key={i}
                          className={
                            head ? 'bg-brand/12 font-semibold' : i % 2 ? 'bg-hairline/40' : ''
                          }
                        >
                          {row.map((c, j) =>
                            head ? (
                              <th key={j} className="px-3 py-2 text-left align-top">
                                {c}
                              </th>
                            ) : (
                              <td key={j} className="px-3 py-2 align-top">
                                {c}
                              </td>
                            ),
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          case 'file':
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => openFile(b.url)}
                className="flex items-center gap-3 rounded-2xl bg-hairline p-3 text-left active:scale-[0.98]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-section)] text-[24px]">
                  {fileIcon(b.mime)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{b.name}</span>
                  <span className="block text-[13px] text-hint">{kb(b.bytes)}</span>
                </span>
                <span className="shrink-0 text-[14px] font-semibold text-link">
                  {t.feed.openFile}
                </span>
              </button>
            );
          case 'poll':
            return <PollView key={b.id} postId={postId} groupId={groupId} poll={b} />;
          case 'quiz':
            return <QuizView key={b.id} postId={postId} groupId={groupId} quiz={b} />;
        }
      })}
    </div>
  );
}

function Bar({
  label,
  count,
  total,
  mine,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  mine: boolean;
  tone?: 'good' | 'bad';
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  const fill =
    tone === 'good' ? 'bg-[#22c55e]/30' : tone === 'bad' ? 'bg-[#ef4444]/25' : 'bg-brand/20';
  return (
    <div className="relative overflow-hidden rounded-xl bg-hairline">
      <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${pct}%` }} />
      <div className="relative flex items-center justify-between gap-2 px-3 py-2.5 text-[15px]">
        <span className={`min-w-0 ${mine ? 'font-semibold' : ''}`}>
          {tone === 'good' ? '✅ ' : tone === 'bad' ? '❌ ' : mine ? '✓ ' : ''}
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-hint">{pct}%</span>
      </div>
    </div>
  );
}

function PollView({ postId, groupId, poll }: { postId: number; groupId: number; poll: Poll }) {
  const t = useT();
  const toast = useToast();
  const vote = useVote(groupId);
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const voted = poll.results.mine.length > 0 && !changing;
  const total = poll.results.counts.reduce((a, b) => a + b, 0);
  const send = async (options: number[]) => {
    try {
      await vote.mutateAsync({ postId, blockId: poll.id, options });
      haptic.success();
      setChanging(false);
      setPicked([]);
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  };
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl bg-brand/8 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">
        📊 {t.feed.blockTypes.poll}
      </div>
      <div className="text-[16px] font-semibold">{poll.question}</div>
      {voted
        ? poll.options.map((o, i) => (
            <Bar
              key={i}
              label={o}
              count={poll.results.counts[i] ?? 0}
              total={total}
              mine={poll.results.mine.includes(i)}
            />
          ))
        : poll.options.map((o, i) => {
            const on = picked.includes(i);
            return (
              <button
                key={i}
                type="button"
                disabled={vote.isPending}
                onClick={() => {
                  haptic.tap();
                  if (!poll.multiple) return void send([i]);
                  setPicked((p) => (on ? p.filter((x) => x !== i) : [...p, i]));
                }}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[15px] transition active:scale-[0.98] ${
                  on ? 'bg-brand/20 ring-2 ring-[var(--brand)]' : 'bg-hairline'
                }`}
              >
                <span
                  className={`h-5 w-5 shrink-0 border-2 border-[var(--brand)] ${poll.multiple ? 'rounded-md' : 'rounded-full'} ${on ? 'bg-[var(--brand)]' : ''}`}
                />
                {o}
              </button>
            );
          })}
      <div className="flex items-center justify-between gap-2 text-[13px] text-hint">
        <span>{t.feed.votes(poll.results.voters)}</span>
        {voted ? (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="font-semibold text-link"
          >
            {t.feed.changeVote}
          </button>
        ) : (
          poll.multiple && (
            <button
              type="button"
              disabled={picked.length === 0 || vote.isPending}
              onClick={() => void send(picked)}
              className="brand-gradient rounded-full px-4 py-1.5 text-[14px] font-semibold text-white disabled:opacity-45"
            >
              {t.feed.vote}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function QuizView({ postId, groupId, quiz }: { postId: number; groupId: number; quiz: Quiz }) {
  const t = useT();
  const toast = useToast();
  const vote = useVote(groupId);
  const answered = quiz.results.mine.length > 0;
  const mine = quiz.results.mine[0];
  const total = quiz.results.counts.reduce((a, b) => a + b, 0);
  const answer = async (i: number) => {
    try {
      await vote.mutateAsync({ postId, blockId: quiz.id, options: [i] });
      if (i === quiz.correct || quiz.correct === null) haptic.success();
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  };
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl bg-brand/8 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">
        ❓ {t.feed.blockTypes.quiz}
      </div>
      <div className="text-[16px] font-semibold">{quiz.question}</div>
      {answered
        ? quiz.options.map((o, i) => (
            <Bar
              key={i}
              label={o}
              count={quiz.results.counts[i] ?? 0}
              total={total}
              mine={i === mine}
              tone={i === quiz.correct ? 'good' : i === mine ? 'bad' : undefined}
            />
          ))
        : quiz.options.map((o, i) => (
            <button
              key={i}
              type="button"
              disabled={vote.isPending}
              onClick={() => {
                haptic.tap();
                void answer(i);
              }}
              className="rounded-xl bg-hairline px-3 py-2.5 text-left text-[15px] transition active:scale-[0.98]"
            >
              {o}
            </button>
          ))}
      {answered && (
        <div className="text-[14px]">
          <span className="font-semibold">
            {mine === quiz.correct ? t.feed.correct : t.feed.wrong}
          </span>
          {quiz.explanation && <span className="text-hint"> · {quiz.explanation}</span>}
        </div>
      )}
      {answered && (
        <div className="text-[13px] text-hint">{t.feed.answered(quiz.results.voters)}</div>
      )}
    </div>
  );
}
