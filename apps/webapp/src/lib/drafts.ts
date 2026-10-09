import { useEffect, useRef } from 'react';
import { storage } from './storage';

/**
 * Unfinished work kept on this phone (a poster being designed, the animated poster maker):
 * written a moment after every change, read back when the screen opens again — going back
 * to the menu, closing the app or a crash doesn't lose it. Removed when the work is saved.
 */
const PREFIX = 'church.draft.';

export function readDraft<T>(key: string): { data: T; at: number } | null {
  try {
    const raw = storage.get(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { d: T; at: number };
    return { data: v.d, at: v.at };
  } catch {
    return null;
  }
}

export function writeDraft(key: string, data: unknown): void {
  storage.set(PREFIX + key, JSON.stringify({ d: data, at: Date.now() }));
}

export function dropDraft(key: string): void {
  storage.remove(PREFIX + key);
}

/** Keeps `value` as the draft under `key` (skipped while `skip`), half a second after changes. */
export function useDraft(key: string, value: unknown, skip = false): void {
  const first = useRef(true);
  const json = JSON.stringify(value);
  useEffect(() => {
    // Opening the screen isn't a change: only what the person does afterwards is kept.
    if (first.current) {
      first.current = false;
      return;
    }
    if (skip) return;
    const id = setTimeout(() => writeDraft(key, JSON.parse(json)), 500);
    return () => clearTimeout(id);
  }, [key, json, skip]);
}
