import { useEffect, useRef, useState } from 'react';
import { displayName } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { IconMegaphone, IconPlus, IconSend, IconTrash } from '../components/icons';
import { PosterCard, PosterMedia, Reactions } from '../components/Poster';
import { useToast } from '../components/Toast';
import { PhotoViewer } from '../components/TreasurySheets';
import { Button, Card, EmptyState, Loading, Screen, Skeleton, Title } from '../components/ui';
import { useEnv } from '../lib/env';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useDeletePost,
  useFeed,
  useGroup,
  useMarkFeedRead,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

/** The ministry's news feed: posters and announcements, newest first. */
export function Feed({ groupId }: { groupId: number }) {
  const t = useT();
  const { push } = useNav();
  const { can } = useEnv();
  const group = useGroup(groupId);
  const feed = useFeed(groupId);
  const markRead = useMarkFeedRead(groupId);
  const { mutate } = markRead;
  useEffect(() => mutate(), [mutate]);
  const posts = feed.data?.pages.flat() ?? [];
  const canPost = can('announce') || group.data?.myPermissions.includes('announce');

  return (
    <Screen>
      <Title
        subtitle={group.data?.name}
        action={
          canPost ? (
            <Button small onClick={() => push({ name: 'newPost', groupId })}>
              <IconPlus size={16} /> {t.feed.newPost}
            </Button>
          ) : undefined
        }
      >
        {t.feed.title}
      </Title>
      {feed.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : posts.length === 0 ? (
        <Card>
          <EmptyState icon={<IconMegaphone size={26} />} title={t.feed.empty}>
            {t.feed.emptyText}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {posts.map((p) => (
            <PosterCard
              key={p.id}
              post={p}
              onOpen={() => push({ name: 'post', groupId, postId: p.id })}
            />
          ))}
          {feed.hasNextPage && (
            <Button variant="glass" onClick={() => void feed.fetchNextPage()}>
              {t.treasury.loadMore}
            </Button>
          )}
        </div>
      )}
    </Screen>
  );
}

/** One post opened: all photos, the full text, reactions and its comment chat. */
export function PostScreen({ groupId, postId }: { groupId: number; postId: number }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const { back } = useNav();
  const feed = useFeed(groupId);
  const comments = useComments(postId);
  const add = useAddComment(groupId, postId);
  const delComment = useDeleteComment(groupId, postId);
  const delPost = useDeletePost(groupId);
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const post = feed.data?.pages.flat().find((p) => p.id === postId);
  const count = comments.data?.length ?? 0;
  useEffect(() => {
    if (count) endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  if (feed.isPending) return <Loading />;
  if (!post) return <Loading />;

  async function sendComment() {
    const body = text.trim();
    if (!body) return;
    try {
      await add.mutateAsync(body);
      haptic.success();
      setText('');
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Screen>
      <article className="glass -mx-1 overflow-hidden rounded-[var(--radius-card)] shadow-card">
        {(post.photos.length > 0 || post.title) && (
          <PosterMedia
            title={post.title}
            photos={post.photos.slice(0, 1)}
            tint={post.tint}
            look={post.look}
            onPhoto={() => post.photos[0] && setViewing(post.photos[0].url)}
            tall
          />
        )}
        {post.photos.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto p-2 [scrollbar-width:none]">
            {post.photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewing(p.url)}
                className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-hairline"
              >
                <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 p-4">
          <div className="text-[13px] text-hint">
            {post.author ? `${displayName(post.author)} · ` : ''}
            {f.weekdayDayMonth(post.createdAt)} · {f.time(post.createdAt)}
          </div>
          <p className="whitespace-pre-line text-[17px] leading-relaxed">{post.text}</p>
          <Reactions post={post} />
          {post.canDelete && (
            <button
              type="button"
              onClick={async () => {
                if (!(await confirmDialog(t.feed.confirmDeletePost))) return;
                await delPost.mutateAsync(post.id);
                back();
              }}
              className="flex items-center gap-1.5 self-start text-[14px] font-semibold text-destructive"
            >
              <IconTrash size={16} /> {t.feed.deletePost}
            </button>
          )}
        </div>
      </article>

      <section className="flex flex-col gap-2.5 pb-24">
        <h2 className="px-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          💬 {t.feed.comments(count)}
        </h2>
        {comments.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : count === 0 ? (
          <p className="px-2 text-[14px] text-hint">{t.feed.noComments}</p>
        ) : (
          comments.data!.map((c) => (
            <div key={c.id} className={`flex items-end gap-2 ${c.mine ? 'flex-row-reverse' : ''}`}>
              {!c.mine && (
                <Avatar
                  id={c.author.id}
                  firstName={c.author.firstName}
                  lastName={c.author.lastName}
                  size={30}
                />
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                  c.mine ? 'brand-gradient rounded-br-md text-white' : 'glass rounded-bl-md'
                }`}
              >
                {!c.mine && (
                  <div className="text-[12px] font-semibold text-accent">
                    {displayName(c.author)}
                  </div>
                )}
                <div className="whitespace-pre-line text-[15px] leading-snug">{c.text}</div>
                <div
                  className={`mt-0.5 flex items-center gap-2 text-[11px] ${c.mine ? 'text-white/75' : 'text-hint'}`}
                >
                  {f.time(c.createdAt)}
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => delComment.mutate(c.id)}
                      className="underline-offset-2 hover:underline"
                    >
                      {t.feed.deleteComment}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </section>

      <div className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-end gap-2 px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-float">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.feed.commentPlaceholder}
          maxLength={1000}
          rows={1}
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl bg-hairline px-3.5 py-2.5 text-[16px] outline-none placeholder:text-hint"
        />
        <button
          type="button"
          aria-label={t.feed.send}
          disabled={!text.trim() || add.isPending}
          onClick={() => void sendComment()}
          className="brand-gradient flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-white shadow-cta active:scale-95 disabled:opacity-45"
        >
          <IconSend size={19} />
        </button>
      </div>
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}
