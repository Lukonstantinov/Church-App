import { createContext, useContext, type CSSProperties } from 'react';
import type { MeetingMotion, ModuleLook, ScreenLook, ScreenModule } from '@church/shared';
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
  const moving = skinMotions(look).length ? ' skin-host' : '';
  return `${surface}${flow}${moving}`.trim();
}

/** Inline values a block needs: the own gradient (as a CSS variable). */
export function skinStyle(look: ModuleLook): CSSProperties | undefined {
  if (look.surface !== 'gradient' || !look.colors?.length) return undefined;
  const colors = look.flow ? [...look.colors, look.colors[0]!] : look.colors;
  return {
    '--skin-grad': `linear-gradient(${look.angle ?? 135}deg, ${colors.join(', ')})`,
  } as CSSProperties;
}

/** The part's living animations, stacked under the block's content. */
export function SkinLayer({ look }: { look: ModuleLook }) {
  return (
    <>
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
