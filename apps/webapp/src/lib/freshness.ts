/**
 * Telegram keeps a mini app's page in memory and may show an old version after an
 * update. On start and whenever the app comes back into view, compare our script with
 * the one the server now serves, and reload once when they differ.
 */
const SCRIPT = /\/assets\/index-[\w-]+\.js/;
const RELOADED = 'church.reloadedFor';

export function watchForNewVersion(): void {
  const mine = [...document.scripts].map((s) => s.src.match(SCRIPT)?.[0]).find(Boolean);
  if (!mine) return; // dev server: nothing to compare

  async function check() {
    try {
      const html = await (await fetch(`/?fresh=${Date.now()}`, { cache: 'no-store' })).text();
      const latest = html.match(SCRIPT)?.[0];
      if (!latest || latest === mine) return;
      // Never loop: reload at most once per new version.
      if (sessionStorage.getItem(RELOADED) === latest) return;
      sessionStorage.setItem(RELOADED, latest);
      window.location.reload();
    } catch {
      // Offline or storage blocked: keep the current version.
    }
  }

  void check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
