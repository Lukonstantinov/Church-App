import { useSyncExternalStore } from 'react';
import { storage } from './storage';

/** How much moves: nothing, entrances only, or everything. */
export type Motion = 'off' | 'calm' | 'lively';
export const MOTIONS: Motion[] = ['off', 'calm', 'lively'];

const KEY = 'church.motion';
const listeners = new Set<() => void>();

export function getMotion(): Motion {
  const v = storage.get(KEY);
  return v === 'off' || v === 'calm' || v === 'lively' ? v : 'lively';
}

/** Puts the person's choice on <html> so the CSS can follow it. */
export function applyMotion(m: Motion = getMotion()): void {
  document.documentElement.dataset.motion = m;
}

export function setMotion(m: Motion): void {
  storage.set(KEY, m);
  applyMotion(m);
  listeners.forEach((l) => l());
}

export const useMotion = () =>
  useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getMotion);
