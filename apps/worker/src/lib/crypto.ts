/** Constant-time string comparison for secrets. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

/**
 * Derives a Telegram-safe token (64 lowercase hex chars) from the configured
 * WEBHOOK_SECRET, so the secret itself can be any string. Telegram only accepts
 * A-Z a-z 0-9 _ - in a webhook secret_token, and HTTP headers are picky too.
 * `purpose` keeps the webhook token and the setup token different.
 * Shell equivalent: printf %s "purpose:$SECRET" | sha256sum
 */
export async function deriveToken(secret: string, purpose: 'webhook' | 'setup'): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${purpose}:${secret}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
