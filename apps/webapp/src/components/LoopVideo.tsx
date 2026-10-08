import { useEffect, useRef } from 'react';
import { loopUrl } from '@church/shared';
import { getMotion } from '../lib/motion';
import { useQuality } from '../lib/perf';

/**
 * A recorded loop (a part's or a cover's effects as one video, lib/recorder.ts): muted,
 * looping, inline, filling its frame. It plays only while on screen and while no sheet
 * covers the page; on "still" phones and with motion off it shows its first frame.
 */
export function LoopVideo({ mediaId }: { mediaId: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const quality = useQuality();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const still = () => quality === 'still' || getMotion() === 'off' || reduced;
    let seen = true;
    const update = () => {
      if (seen && !still() && !document.documentElement.dataset.sheet)
        void v.play().catch(() => undefined);
      else v.pause();
    };
    const io = new IntersectionObserver(([e]) => {
      seen = !!e?.isIntersecting;
      update();
    });
    io.observe(v);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sheet', 'data-motion'],
    });
    update();
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [quality]);
  return (
    <video
      ref={ref}
      src={loopUrl(mediaId)}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
