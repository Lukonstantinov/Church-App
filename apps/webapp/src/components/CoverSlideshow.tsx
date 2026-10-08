import { useEffect, useState, type CSSProperties } from 'react';
import type { EventSummary } from '@church/shared';
import { CoverEffectLayers } from './CoverEffects';

/** Which photo of a slideshow shows now: the next one every `seconds` (paused while hidden). */
export function useSlide(count: number, seconds: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => {
      if (!document.hidden) setI((x) => (x + 1) % count);
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [count, seconds]);
  return count ? i % count : 0;
}

/** All cover photos of an event: the cover first, then the slideshow's. */
export const coverPhotos = (
  e: Pick<EventSummary, 'coverUrl'> & Partial<Pick<EventSummary, 'coverSlides'>>,
): string[] => (e.coverUrl ? [e.coverUrl, ...(e.coverSlides?.urls ?? [])] : []);

/**
 * An event's cover photo filling its frame — or, with a slideshow, its photos in turn: each
 * fades in and slowly settles from a little larger to its size — with the event's effects
 * over it (a glitch tears whichever photo shows). The parent is relative and clips.
 */
export function CoverPicture({
  e,
  photos = coverPhotos(e),
  seconds = e.coverSlides?.seconds ?? 5,
}: {
  e: Partial<Pick<EventSummary, 'motion' | 'motionTune' | 'motionLayers' | 'coverSlides'>> &
    Pick<EventSummary, 'coverUrl'>;
  photos?: string[];
  seconds?: number;
}) {
  const i = useSlide(photos.length, seconds);
  if (photos.length === 0) return <CoverEffectLayers e={e} />;
  return (
    <>
      {photos.length === 1 ? (
        <img src={photos[0]} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        photos.map((url, k) => (
          <img
            key={url}
            src={url}
            alt=""
            loading={k === 0 ? 'eager' : 'lazy'}
            className={`cover-slide absolute inset-0 h-full w-full object-cover ${k === i ? 'on' : ''}`}
            style={{ '--slide-d': `${seconds + 1}s` } as CSSProperties}
          />
        ))
      )}
      <CoverEffectLayers e={e} image={photos[i]} />
    </>
  );
}
