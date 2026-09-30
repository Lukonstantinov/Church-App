import { useState } from 'react';
import {
  REACTIONS,
  displayName,
  resolveBrand,
  type AnnouncementRow,
  type PosterLook,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useMe, useReact } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconMegaphone } from './icons';
import { PatternLayer, onBrandStyle } from './PatternLayer';

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
  onPhoto,
  tall,
}: {
  title: string | null;
  photos: { id: number; url: string }[];
  tint: { color: string; strength: number } | null;
  look: PosterLook | null;
  onPhoto?: (index: number) => void;
  tall?: boolean;
}) {
  const me = useMe();
  if (photos.length === 0 && !title) return null;
  const theme = resolveBrand(look?.brandColor ?? me.data?.church.brandColor);
  const on = onBrandStyle(look?.textColor ?? 'auto', photos.length > 0 || !!look?.pattern);
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
      className={`relative w-full overflow-hidden ${photos.length ? (tall ? 'aspect-[4/5]' : 'aspect-[4/3]') : 'aspect-[16/9]'}`}
      style={
        photos.length
          ? undefined
          : { background: `linear-gradient(145deg, ${theme.light}, ${theme.partner})` }
      }
    >
      {photos.length > 0 ? grid : <PatternLayer pattern={look?.pattern} logoUrl={look?.logoUrl} />}
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
      {!tint && photos.length > 0 && title && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent"
        />
      )}
      {title && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 p-4 ${on.className}`}
          style={
            photos.length
              ? { ...on.style, color: look?.textColor === 'dark' ? on.style.color : '#fff' }
              : on.style
          }
        >
          <div className="text-[24px] font-extrabold leading-tight tracking-tight">{title}</div>
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
  const hasPoster = post.photos.length > 0 || !!post.title;
  return (
    <article
      className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card"
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
          <span className="truncate">
            {showGroup ? `${post.groupName} · ` : ''}
            {post.author ? `${displayName(post.author)} · ` : ''}
            {f.shortDate(post.createdAt)} · {f.time(post.createdAt)}
          </span>
        </div>
        <p className="line-clamp-4 whitespace-pre-line text-[16px] leading-relaxed">{post.text}</p>
        <div className="flex items-center justify-between gap-2">
          <Reactions post={post} />
          <span className="shrink-0 text-[13px] font-medium text-hint">
            💬 {t.feed.comments(post.commentCount)}
          </span>
        </div>
      </div>
    </article>
  );
}
