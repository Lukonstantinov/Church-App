import { createContext, useContext, useEffect, useRef, type CSSProperties } from 'react';
import { watchOffscreen } from '../lib/perf';
import {
  fontFamily,
  type MeetingMotion,
  type ModuleLook,
  type ModulePhoto,
  type ScreenLook,
  type ScreenModule,
} from '@church/shared';
import { useEnv } from '../lib/env';
import { useGroups, useMe } from '../lib/queries';
import { LivingLayer } from './ui';

/** The Design studio shows its draft instead of what is saved. */
const PreviewLook = createContext<ScreenLook | null>(null);
export const ScreenLookPreview = PreviewLook.Provider;

/**
 * How one part of the current screen looks and moves, as set in the Design studio:
 * inside a ministry its page's settings, elsewhere (the main page) the church's.
 */
export function useModuleLook(module: ScreenModule): ModuleLook {
  const preview = useContext(PreviewLook);
  const { env } = useEnv();
  const me = useMe();
  const look = preview ?? (env ? env.screenLook : me.data?.church.screenLook);
  return look?.[module] ?? {};
}

/** The animations of a part, main one first (layers on top), without "off". */
export function skinMotions(look: ModuleLook): MeetingMotion[] {
  return [look.motion, ...(look.layers ?? [])].filter(
    (m): m is MeetingMotion => !!m && m !== 'off',
  );
}

/** Classes for a block of that part: its surface, and room for living layers. */
export function skinClass(look: ModuleLook): string {
  const surface = look.surface && look.surface !== 'default' ? ` skin skin-${look.surface}` : '';
  const flow = look.surface === 'gradient' && look.flow ? ' skin-flow' : '';
  const moving =
    skinMotions(look).length || look.photo || look.photo2 || look.surface === 'fire'
      ? ' skin-host'
      : '';
  const edge = look.edge && look.edge !== 'none' ? ` skin edge edge-${look.edge}` : '';
  const shine = look.shine && look.shine !== 'none' ? ' skin-host' : '';
  return `${surface}${flow}${moving}${edge}${shine}`.trim();
}

/** Inline values a block needs: the own gradient (as a CSS variable). */
export function skinStyle(look: ModuleLook): CSSProperties | undefined {
  const font = fontFamily(look.font);
  const fs = look.textScale && look.textScale !== 1 ? look.textScale : null;
  const grad =
    look.surface === 'gradient' && look.colors?.length
      ? (look.flow ? [...look.colors, look.colors[0]!] : look.colors).join(', ')
      : null;
  const r = look.radius ?? null;
  if (!font && !grad && !fs && r === null) return undefined;
  return {
    ...(font ? { fontFamily: font } : {}),
    // Corner shape: the block's own corners and the frame its pictures are clipped to.
    ...(r !== null ? { borderRadius: r, '--clip-r': `${r}px` } : {}),
    ...(fs ? { '--fs': fs } : {}),
    ...(grad ? { '--skin-grad': `linear-gradient(${look.angle ?? 135}deg, ${grad})` } : {}),
  } as CSSProperties;
}

/** The part's picture and living animations, stacked under the block's content. */
export function SkinLayer({ look }: { look: ModuleLook }) {
  // The block itself (edges, flowing surfaces) also pauses while off screen.
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const block = marker.current?.parentElement;
    return block ? watchOffscreen(block) : undefined;
  }, []);
  return (
    <>
      <span ref={marker} hidden />
      {look.photo?.url && <PartPhoto photo={look.photo} />}
      {look.photo2?.url && look.photo?.split && look.photo.split !== 'full' && (
        <PartPhoto photo={{ ...look.photo2, split: OTHER_HALF[look.photo.split] }} />
      )}
      {look.shine && look.shine !== 'none' && (
        <span aria-hidden="true" className={`shine shine-${look.shine}`} />
      )}
      {/* "Burning" really burns: low flames along the bottom. */}
      {look.surface === 'fire' && !skinMotions(look).includes('flames') && (
        <LivingLayer kind="flames" behind tune={{ size: 0.7, speed: 1 }} />
      )}
      {skinMotions(look).map((m, i) => (
        <LivingLayer key={`${m}${i}`} kind={m} behind tune={look.tune} icon={look.icon} />
      ))}
    </>
  );
}

/**
 * The tuning a ministry gives its meeting animation on the meeting screen (shared with the
 * tiles unless the tiles have their own).
 */
export function useMeetingTune(groupId: number): Pick<ModuleLook, 'tune' | 'icon'> {
  const groups = useGroups();
  const look = groups.data?.find((x) => x.id === groupId)?.screenLook.meetings;
  return look && !look.own ? { tune: look.tune, icon: look.icon } : {};
}

const OTHER_HALF = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;

/** Where a picture sits in its block, and the soft fade on the side facing the other half. */
const AREAS: Record<string, CSSProperties> = {
  full: { inset: 0 },
  left: { inset: '0 50% 0 0', maskImage: 'linear-gradient(90deg, #000 80%, transparent)' },
  right: { inset: '0 0 0 50%', maskImage: 'linear-gradient(270deg, #000 80%, transparent)' },
  top: { inset: '0 0 50% 0', maskImage: 'linear-gradient(180deg, #000 80%, transparent)' },
  bottom: { inset: '50% 0 0 0', maskImage: 'linear-gradient(0deg, #000 80%, transparent)' },
};

/** A part's own picture: placed on its chosen spot, zoomed, filling or whole, see-through. */
export function PartPhoto({ photo }: { photo: ModulePhoto }) {
  const x = photo.focusX ?? 50;
  const y = photo.focusY ?? 50;
  const area = AREAS[photo.split ?? 'full']!;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute overflow-hidden"
      style={{ ...area, WebkitMaskImage: area.maskImage, zIndex: -1, opacity: photo.opacity }}
    >
      <img
        src={photo.url ?? ''}
        alt=""
        className="h-full w-full"
        style={{
          objectFit: photo.fit ?? 'cover',
          objectPosition: `${x}% ${y}%`,
          transform: `scale(${photo.zoom ?? 1})`,
          transformOrigin: `${x}% ${y}%`,
        }}
      />
    </span>
  );
}

/** A text size that follows the part's "text size" from the Design studio. */
export const fs = (px: number): CSSProperties => ({ fontSize: `calc(${px}px * var(--fs, 1))` });
