import { describe, expect, it } from 'vitest';
import { deriveToken } from '../src/lib/crypto';

describe('deriveToken', () => {
  it('matches the shell derivation used by the deploy workflow', async () => {
    // printf '%s' 'setup:pa ss/wörd!' | sha256sum
    expect(await deriveToken('pa ss/wörd!', 'setup')).toBe(
      'd0fbfc30e7460d7e1b1499d252e9e8e863e1813a170275a1736b9875167eb20a',
    );
  });

  it('always yields a Telegram-safe token, whatever the secret contains', async () => {
    const token = await deriveToken('spaces & symbols!\n', 'webhook');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives different tokens for different purposes', async () => {
    expect(await deriveToken('same', 'webhook')).not.toBe(await deriveToken('same', 'setup'));
  });
});
