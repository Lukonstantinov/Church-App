/** Escapes text for Telegram parse_mode: 'HTML'. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A person's name as a link to their Telegram (tap to write to them): their @username
 * when they have one, else their account id. People without Telegram stay plain text.
 */
export function personLink(
  name: string,
  p: { username?: string | null; telegramId?: number | null },
) {
  const text = escapeHtml(name);
  if (p.username) return `<a href="https://t.me/${encodeURIComponent(p.username)}">${text}</a>`;
  if (p.telegramId) return `<a href="tg://user?id=${p.telegramId}">${text}</a>`;
  return text;
}
