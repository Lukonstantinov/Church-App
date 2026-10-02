import { useEffect, useRef } from 'react';
import type { EventDetail } from '@church/shared';
import { capturePoster } from '../lib/poster';
import { useUpdateEvent, useUploadMedia } from '../lib/queries';
import { PosterMedia } from './Poster';

/**
 * Events made before posters existed have none for the bot to send. When someone who can
 * edit the event opens it, the cover (photo, design, or the ministry's look) is drawn off
 * screen and saved as its poster, once, quietly.
 */
export function PosterBackfill({ e }: { e: EventDetail }) {
  const node = useRef<HTMLDivElement>(null);
  const tried = useRef(false);
  const upload = useUploadMedia(e.groupId, 'event');
  const update = useUpdateEvent(e.id);
  const needed = e.canManage && e.posterMediaId === null && e.status !== 'cancelled';
  // The mutations change on every render; the effect must not restart because of them.
  const fns = useRef({ upload, update });
  useEffect(() => {
    fns.current = { upload, update };
  });

  useEffect(() => {
    if (!needed || tried.current) return;
    tried.current = true;
    // Let the photo and fonts load first.
    const timer = setTimeout(() => {
      void (async () => {
        if (!node.current) return;
        const blob = await capturePoster(node.current);
        if (!blob) return;
        const media = await fns.current.upload.mutateAsync(blob).catch(() => null);
        if (media)
          await fns.current.update.mutateAsync({ posterMediaId: media.id }).catch(() => undefined);
      })();
    }, 1200);
    return () => clearTimeout(timer);
  }, [needed]);

  if (!needed) return null;
  return (
    <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 720 }}>
      <div ref={node}>
        <PosterMedia
          title={e.title}
          photos={e.coverUrl && e.coverMediaId ? [{ id: e.coverMediaId, url: e.coverUrl }] : []}
          tint={null}
          look={e.look}
          design={e.design ? { ...e.design, banner: true } : null}
        />
      </div>
    </div>
  );
}
