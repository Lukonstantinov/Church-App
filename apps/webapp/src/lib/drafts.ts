import { useEffect, useRef } from 'react';
import { storage } from './storage';

/**
 * Unfinished work kept on this phone (a poster being designed, the animated poster maker):
 * written a moment after every change, read back when the screen opens again — going back
 * to the menu, closing the app or a crash doesn't lose it. Removed when the work is saved.
 *
 * A draft can also be what closes the app: a heavy design brought back opens straight into
 * the same crash, every time, and the "discard" button is inside the screen that crashes.
 * So while a draft's screen is open it is marked; the mark goes when the screen or the app
 * is closed normally. A mark still there at the next start means
 * the app died with that draft on screen: it is then set aside (not opened by itself) and
 * can be deleted from the card that says so, or from Design → «Черновики на телефоне».
 */
const PREFIX = 'church.draft.';
const OPENING = 'church.draft-opening';

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
  // Its parts (the name, the photo) go with it.
  for (const k of draftKeys()) if (k.startsWith(`${key}.`)) storage.remove(PREFIX + k);
  setOpening(openingList().filter((k) => k !== key));
}

/** Every draft key kept on this phone. */
function draftKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    // storage blocked: nothing kept
  }
  return out;
}

export interface DraftInfo {
  key: string;
  at: number;
  /** Its size on the phone, in KB. */
  kb: number;
  /** The app closed while it was open. */
  suspect: boolean;
}

/** The drafts on this phone (main drafts only, their parts counted in), newest first. */
export function listDrafts(): DraftInfo[] {
  const keys = draftKeys();
  const suspects = new Set(openingList());
  const mains = keys.filter((k) => !keys.some((o) => o !== k && k.startsWith(`${o}.`)));
  return mains
    .map((key) => {
      const parts = keys.filter((k) => k === key || k.startsWith(`${key}.`));
      const kb = parts.reduce((s, k) => s + (storage.get(PREFIX + k)?.length ?? 0), 0) / 512;
      return { key, at: readDraft(key)?.at ?? 0, kb: Math.round(kb), suspect: suspects.has(key) };
    })
    .sort((a, b) => b.at - a.at);
}

export function dropAllDrafts(): void {
  for (const k of draftKeys()) storage.remove(PREFIX + k);
  storage.remove(OPENING);
}

// ---------- Drafts open when the app died ----------

function openingList(): string[] {
  try {
    const v = JSON.parse(storage.get(OPENING) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function setOpening(list: string[]) {
  if (list.length) storage.set(OPENING, JSON.stringify([...new Set(list)]));
  else storage.remove(OPENING);
}

/** Read once at start: the drafts that were on screen when the app last closed itself. */
const crashedWith = new Set(typeof window === 'undefined' ? [] : openingList());

/** The app closed itself while this draft was open (it is set aside until told otherwise). */
export const isSuspectDraft = (key: string) => crashedWith.has(key);

/** The person chose to open it anyway (or deleted it): it is no longer set aside. */
export function clearSuspect(key: string): void {
  crashedWith.delete(key);
}

/**
 * Marks `key` as open on screen while the screen is open and the app is in view. Leaving
 * the screen, hiding or closing the app normally takes the mark away; a crash doesn't, so
 * the next start sets the draft aside.
 */
export function useOpeningMark(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const on = () => setOpening([...openingList(), key]);
    const off = () => setOpening(openingList().filter((k) => k !== key));
    const seen = () => (document.visibilityState === 'hidden' ? off() : on());
    on();
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('pagehide', off);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('pagehide', off);
      off();
    };
  }, [key, active]);
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
