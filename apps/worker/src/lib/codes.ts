/** Lowercase letters and digits without look-alikes (no 0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Cryptographically random code, unbiased (rejection sampling). */
export function randomCode(length = 10): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

export const DEEP_LINK = {
  join: 'g_',
  claim: 'c_',
  /** ?startgroup=l_<code>: link a Telegram group chat to a ministry. */
  chat: 'l_',
  /** ?startgroup=e_<code>: link a Telegram group chat to an event. */
  eventChat: 'e_',
} as const;
