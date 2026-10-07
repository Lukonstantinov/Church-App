import { useState } from 'react';
import {
  POST_KINDS,
  REACTIONS,
  displayName,
  fontFamily,
  resolveBrand,
  type AnnouncementRow,
  type PostDesign,
  type PosterLook,
  type Speaker,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useDeletePost,
  useMe,
  useMembers,
  usePinPost,
  useReact,
  useResendPost,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import {
  AudienceChoice,
  audienceEmpty,
  audienceIds,
  type Audience,
  type AudiencePreset,
} from './AudienceChoice';
import { IconEdit, IconMegaphone, IconMore, IconSend, IconTrash } from './icons';
import { Sheet, SheetOption } from './Sheet';
import { useToast } from './Toast';
import { Button, Toggle } from './ui';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';
import { PostBlocks } from './PostBlocks';
import { RichText } from './RichText';
import { SpeakerStrip } from './Speakers';

const TITLE_SIZE = { s: 'text-[20px]', m: 'text-[25px]', l: 'text-[31px]', xl: 'text-[39px]' };
const TITLE_POS = {
  top: 'top-0 pt-12',
  center: 'inset-y-0 flex flex-col justify-center',
  bottom: 'bottom-0',
};

/** Whether a post shows its cover: photos, a headline or the banner (on by default). */
export const hasCover = (p: Pick<AnnouncementRow, 'photos' | 'title' | 'design'>) =>
  p.photos.length > 0 || !!p.title || (p.design?.banner ?? true);

/** The post type as a small label (emoji and name). */
export function KindBadge({ kind, onCover }: { kind: PostDesign['kind']; onCover?: boolean }) {
  const t = useT();
  if (!kind) return null;
  const k = POST_KINDS[kind];
  const theme = resolveBrand(k.color);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${
        onCover ? 'bg-black/35 text-white backdrop-blur' : 'text-white'
      }`}
      style={onCover ? undefined : { background: theme.light }}
    >
      {k.emoji} {t.feed.kinds[kind]}
    </span>
  );
}

/**
 * The picture part of a post: a collage of up to four photos (with "+N" for more), a
 * colour tint for readability and the headline on top. Without photos the ministry's
 * look (or a design template) is the background.
 */
export function PosterMedia({
  title,
  photos,
  tint,
  look,
  design,
  onPhoto,
  tall,
  compact,
  speakers = [],
}: {
  title: string | null;
  photos: { id: number; url: string }[];
  tint: { color: string; strength: number } | null;
  look: PosterLook | null;
  design?: PostDesign | null;
  onPhoto?: (index: number) => void;
  tall?: boolean;
  /** Small tiles: smaller headline and padding. */
  compact?: boolean;
  /** Up to four speakers, along the bottom of the cover. */
  speakers?: Speaker[];
}) {
  const me = useMe();
  if (!hasCover({ photos, title, design: design ?? null })) return null;
  const theme = resolveBrand(look?.brandColor ?? me.data?.church.brandColor);
  const on = onBrandStyle(
    look?.textColor ?? 'auto',
    photos.length > 0 || !!look?.pattern || !!look?.backdropUrl,
  );
  const shown = photos.slice(0, 4);
  const extra = photos.length - shown.length;

  const cell = (p: { id: number; url: string }, i: number, cls: string) => (
    <button
      key={p.id}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onPhoto?.(i);
      }}
      className={`relative overflow-hidden bg-hairline ${cls}`}
    >
      <img
        src={p.url}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {i === shown.length - 1 && extra > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[24px] font-bold text-white">
          +{extra}
        </span>
      )}
    </button>
  );

  const grid =
    shown.length === 1 ? (
      <div className="grid h-full grid-cols-1">{cell(shown[0]!, 0, 'h-full')}</div>
    ) : shown.length === 2 ? (
      <div className="grid h-full grid-cols-2 gap-0.5">
        {shown.map((p, i) => cell(p, i, 'h-full'))}
      </div>
    ) : shown.length === 3 ? (
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-0.5">
        {cell(shown[0]!, 0, 'row-span-2 h-full')}
        {cell(shown[1]!, 1, 'h-full')}
        {cell(shown[2]!, 2, 'h-full')}
      </div>
    ) : (
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-0.5">
        {shown.map((p, i) => cell(p, i, 'h-full'))}
      </div>
    );

  return (
    <div
      className={`relative w-full overflow-hidden ${photos.length ? (tall ? 'aspect-[4/5]' : 'aspect-[4/3]') : speakers.length ? 'aspect-[4/3]' : title ? 'aspect-[16/9]' : 'aspect-[3/1]'}`}
      style={
        photos.length
          ? undefined
          : { background: `linear-gradient(145deg, ${theme.light}, ${theme.partner})` }
      }
    >
      {photos.length > 0 ? (
        grid
      ) : (
        <>
          <PatternLayer pattern={look?.pattern} logoUrl={look?.logoUrl} />
          <BackdropLayer backdrop={look?.backdrop} url={look?.backdropUrl} />
        </>
      )}
      {tint && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${tint.color} 0%, ${tint.color}00 75%)`,
            opacity: Math.min(1, tint.strength * 1.6),
          }}
        />
      )}
      {!tint && (photos.length > 0 || speakers.length > 0) && (title || speakers.length > 0) && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent"
        />
      )}
      {design?.kind && (
        <span className="pointer-events-none absolute left-3 top-3">
          <KindBadge kind={design.kind} onCover />
        </span>
      )}
      {title && (
        <div
          className={`pointer-events-none absolute inset-x-0 ${compact ? 'p-2.5' : 'p-4'} ${speakers.length > 0 && (design?.titlePos ?? 'bottom') === 'bottom' ? 'bottom-[26%]' : TITLE_POS[design?.titlePos ?? 'bottom']} ${
            design?.align === 'center' ? 'text-center' : ''
          } ${on.className}`}
          style={
            photos.length
              ? { ...on.style, color: look?.textColor === 'dark' ? on.style.color : '#fff' }
              : on.style
          }
        >
          <div
            className={`${compact ? 'line-clamp-3 text-[15px]' : TITLE_SIZE[design?.titleSize ?? 'm']} font-extrabold leading-tight tracking-tight`}
            style={{ fontFamily: fontFamily(design?.titleFont) }}
          >
            {title}
          </div>
        </div>
      )}
      {speakers.length > 0 && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 text-white ${compact ? 'p-1.5' : 'px-4 pb-4'}`}
        >
          <SpeakerStrip speakers={speakers} size={compact ? 'sm' : 'md'} onColor />
        </div>
      )}
    </div>
  );
}

/** Reaction chips under a post; tapping toggles your own. */
export function Reactions({ post }: { post: AnnouncementRow }) {
  const react = useReact(post.groupId);
  const [picker, setPicker] = useState(false);
  const toggle = (emoji: string) => {
    haptic.tap();
    setPicker(false);
    react.mutate({ postId: post.id, emoji });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {post.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-[14px] font-semibold transition active:scale-95 ${
            r.mine ? 'bg-brand/18 text-accent ring-1 ring-[var(--brand)]/40' : 'bg-hairline'
          }`}
        >
          <span className="text-[16px]">{r.emoji}</span>
          {r.count}
        </button>
      ))}
      {picker ? (
        <div className="flex gap-1 rounded-full bg-hairline px-1.5 py-1">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => toggle(e)}
              className="h-7 w-7 rounded-full text-[18px] active:scale-90"
            >
              {e}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          aria-label="react"
          onClick={() => setPicker(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline text-[16px] text-hint active:scale-95"
        >
          ☺︎
        </button>
      )}
    </div>
  );
}

/** "⋯" on a post: pin or unpin, edit, delete — whichever the viewer may do. */
export function PostMenu({ post, onDeleted }: { post: AnnouncementRow; onDeleted?: () => void }) {
  const t = useT();
  const toast = useToast();
  const { push } = useNav();
  const pin = usePinPost(post.groupId);
  const del = useDeletePost(post.groupId);
  const [open, setOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  if (!post.canPin && !post.canEdit && !post.canDelete) return null;
  const run = async (action: () => Promise<unknown>) => {
    setOpen(false);
    try {
      await action();
      haptic.success();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  };
  return (
    <span onClick={(e) => e.stopPropagation()} className="-my-1.5 -mr-2 shrink-0">
      <button
        type="button"
        aria-label={t.feed.postActions}
        onClick={() => {
          haptic.tap();
          setOpen(true);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full text-hint active:bg-hairline"
      >
        <IconMore size={22} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.feed.postActions}>
        {post.canPin && (
          <SheetOption
            icon={<span className="text-[18px]">📌</span>}
            label={post.pinned ? t.feed.unpinPost : t.feed.pinPost}
            onClick={() =>
              void run(() => pin.mutateAsync({ postId: post.id, pinned: !post.pinned }))
            }
          />
        )}
        {post.canEdit && (
          <SheetOption
            icon={<IconSend size={20} />}
            label={t.feed.resendPost}
            onClick={() => {
              setOpen(false);
              setResendOpen(true);
            }}
          />
        )}
        {post.canEdit && (
          <SheetOption
            icon={<IconEdit size={20} />}
            label={t.feed.editPost}
            onClick={() => {
              setOpen(false);
              push({ name: 'editPost', groupId: post.groupId, postId: post.id });
            }}
          />
        )}
        {post.canDelete && (
          <SheetOption
            icon={<IconTrash size={20} />}
            label={t.feed.deletePost}
            tone="destructive"
            onClick={async () => {
              setOpen(false);
              if (!(await confirmDialog(t.feed.confirmDeletePost))) return;
              await run(() => del.mutateAsync(post.id));
              onDeleted?.();
            }}
          />
        )}
      </Sheet>
      {resendOpen && <ResendSheet post={post} onClose={() => setResendOpen(false)} />}
    </span>
  );
}

/**
 * Send a post again: the text to read and change (the first line is the headline), its
 * picture on or off, and who gets it — everyone, the leaders or chosen people.
 */
function ResendSheet({ post, onClose }: { post: AnnouncementRow; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const resend = useResendPost();
  const members = useMembers(post.groupId);
  const original = [post.title, post.text].filter(Boolean).join('\n');
  const [text, setText] = useState(original);
  const picture = post.posterUrl ?? post.photos[0]?.url ?? null;
  const [withPoster, setWithPoster] = useState(true);
  const [audience, setAudience] = useState<Audience>({ kind: 'all', chosen: [] });
  const leaders = (members.data ?? [])
    .filter((m) => m.status === 'active' && m.role === 'leader')
    .map((m) => m.userId);
  const presets: AudiencePreset[] = [
    { key: 'all', label: t.meetings.everyone, ids: null },
    ...(members.data ? [{ key: 'leaders', label: t.meetings.leadersOnly, ids: leaders }] : []),
  ];

  async function send() {
    try {
      const edited = text.trim() !== original.trim();
      const res = await resend.mutateAsync({
        postId: post.id,
        userIds: audienceIds(audience, presets),
        // Unchanged: the post goes as it is (with all its text blocks).
        text: edited ? text.trim() : null,
        poster: withPoster,
      });
      haptic.success();
      toast(t.events.remindSent(res.sent));
      onClose();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={t.feed.resendTitle}>
      <div className="flex flex-col gap-3 px-5 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-hint">{t.events.remindText}</span>
          <button
            type="button"
            onClick={() => setText(original)}
            className="text-[13px] font-semibold text-link"
          >
            {t.meetings.resetText}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={3000}
          rows={7}
          className="w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] leading-snug outline-none"
        />
        {picture && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            <div className="px-1">
              <Toggle label={t.events.withPoster} checked={withPoster} onChange={setWithPoster} />
            </div>
            {withPoster && (
              <img
                src={picture}
                alt=""
                className="mx-4 mb-3 mt-1 max-h-48 w-[calc(100%-2rem)] rounded-lg object-cover"
              />
            )}
          </div>
        )}
        <AudienceChoice
          groupId={post.groupId}
          presets={presets}
          value={audience}
          onChange={setAudience}
        />
        <Button
          disabled={resend.isPending || !text.trim() || audienceEmpty(audience, presets)}
          onClick={() => void send()}
        >
          <IconSend size={16} /> {t.feed.resendSend}
        </Button>
      </div>
    </Sheet>
  );
}

/** A post in the feed: poster on top, text (collapsed to a few lines), reactions, comments. */
export function PosterCard({
  post,
  onOpen,
  showGroup,
}: {
  post: AnnouncementRow;
  onOpen: () => void;
  showGroup?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  const hasPoster = hasCover(post);
  const bodyFont = fontFamily(post.design?.bodyFont);
  return (
    <article
      className={`glass overflow-hidden rounded-[var(--radius-card)] shadow-card ${post.pinned ? 'ring-2 ring-[var(--brand)]/45' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
    >
      {hasPoster && (
        <PosterMedia
          title={post.title}
          photos={post.photos}
          tint={post.tint}
          look={post.look}
          design={post.design}
          onPhoto={onOpen}
        />
      )}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-[13px] text-hint">
          {!hasPoster && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/12 text-accent">
              <IconMegaphone size={15} />
            </span>
          )}
          {!hasPoster && <KindBadge kind={post.design?.kind} />}
          {post.pinned && (
            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[12px] font-bold text-accent">
              📌 {t.feed.pinnedPost}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {showGroup ? `${post.groupName} · ` : ''}
            {post.author ? `${displayName(post.author)} · ` : ''}
            {f.shortDate(post.createdAt)} · {f.time(post.createdAt)}
          </span>
          {post.editedAt && <span className="shrink-0 italic">{t.feed.edited}</span>}
          <PostMenu post={post} />
        </div>
        {post.text && (
          <RichText
            text={post.text}
            className="line-clamp-4 text-[16px] leading-relaxed"
            style={{ fontFamily: bodyFont }}
          />
        )}
        <PostBlocks postId={post.id} groupId={post.groupId} blocks={post.blocks} compact />
        <div className="flex items-center justify-between gap-2">
          <Reactions post={post} />
          <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-hint">
            💬 {t.feed.comments(post.commentCount)}
            {post.unreadComments > 0 && (
              <span className="min-w-[20px] rounded-full bg-[#ef4444] px-1.5 text-center text-[12px] font-bold leading-[20px] text-white">
                +{post.unreadComments > 99 ? '99' : post.unreadComments}
              </span>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
