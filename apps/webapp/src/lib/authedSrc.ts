import { useEffect, useState } from 'react';
import { initDataRaw } from './telegram';

/** Videos are fetched with the sign-in header and played from a local blob (≤1.2 MB each). */
const blobs = new Map<string, Promise<string>>();

function blobUrl(path: string): Promise<string> {
  let p = blobs.get(path);
  if (!p) {
    p = fetch(path, { headers: { Authorization: `tma ${initDataRaw()}` } }).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      return URL.createObjectURL(await res.blob());
    });
    // A failed fetch is tried again next time.
    p.catch(() => blobs.delete(path));
    blobs.set(path, p);
  }
  return p;
}

/** A playable link for a protected media path; undefined until it has loaded. */
export function useAuthedSrc(path: string | null): string | undefined {
  const [src, setSrc] = useState<{ path: string; url: string }>();
  useEffect(() => {
    if (!path) return;
    let alive = true;
    blobUrl(path)
      .then((url) => alive && setSrc({ path, url }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return src?.path === path ? src.url : undefined;
}
