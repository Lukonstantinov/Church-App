import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TestAsInput, TestAsOptions } from '@church/shared';
import { apiFetch } from '../lib/api';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Sheet, SheetOption } from './Sheet';
import { useToast } from './Toast';

/**
 * Switches who the app works as (the server's lib/testing.ts) and starts the app afresh,
 * so every screen, cache and right is the new role's.
 */
async function switchRole(input: TestAsInput | null) {
  await apiFetch(
    '/dev/test-as',
    input
      ? { method: 'POST', body: JSON.stringify(input) }
      : {
          method: 'DELETE',
        },
  );
  window.location.reload();
}

/**
 * «🧪 Открыть как другая роль» (developers only): every ministry's positions, a member
 * waiting for approval, a newcomer, a church admin — and the way back.
 */
export function TestAsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const opts = useQuery({
    queryKey: ['test-as'],
    queryFn: () => apiFetch<TestAsOptions>('/dev/test-as'),
    enabled: open,
  });

  async function pick(input: TestAsInput | null) {
    if (busy) return;
    setBusy(true);
    haptic.tap();
    try {
      await switchRole(input);
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
      setBusy(false);
    }
  }

  const tt = t.testAs;
  const data = opts.data;
  return (
    <Sheet open={open} onClose={onClose} title={tt.title}>
      <p className="px-5 pb-2 text-[13px] leading-snug text-hint">{tt.hint}</p>
      {data?.current && (
        <div className="mx-5 mb-2 rounded-2xl bg-[var(--brand)]/12 px-4 py-2.5 text-[14px]">
          <span className="text-hint">{tt.now}: </span>
          <span className="font-semibold">{data.current}</span>
        </div>
      )}
      {data?.groups.map((g) => (
        <div key={g.id}>
          <div className="px-5 pb-1 pt-3 text-[12px] font-bold uppercase tracking-wider text-hint">
            ⛪ {g.name}
          </div>
          {g.positions.map((p) => (
            <SheetOption
              key={p.id}
              icon={<span>🪪</span>}
              label={p.name}
              hint={tt.rights(p.rights)}
              disabled={busy}
              onClick={() => void pick({ kind: 'position', positionId: p.id })}
            />
          ))}
          <SheetOption
            icon={<span>👤</span>}
            label={tt.member}
            disabled={busy}
            onClick={() => void pick({ kind: 'member', groupId: g.id })}
          />
          <SheetOption
            icon={<span>⏳</span>}
            label={tt.pending}
            disabled={busy}
            onClick={() => void pick({ kind: 'pending', groupId: g.id })}
          />
        </div>
      ))}
      {data && (
        <>
          <div className="px-5 pb-1 pt-3 text-[12px] font-bold uppercase tracking-wider text-hint">
            {tt.church}
          </div>
          <SheetOption
            icon={<span>🙋</span>}
            label={tt.newcomer}
            disabled={busy}
            onClick={() => void pick({ kind: 'newcomer' })}
          />
          <SheetOption
            icon={<span>👑</span>}
            label={tt.admin}
            hint={tt.adminHint}
            disabled={busy}
            onClick={() => void pick({ kind: 'admin' })}
          />
        </>
      )}
      {data?.current && (
        <SheetOption
          icon={<span>↩️</span>}
          label={tt.exit}
          disabled={busy}
          onClick={() => void pick(null)}
        />
      )}
      {opts.isPending && <p className="px-5 py-4 text-center text-hint">{t.common.loading}</p>}
    </Sheet>
  );
}

/**
 * While a developer tries another role: what it is, with "Change" and "Back to me", at
 * the top of every screen so it is never mistaken for their own view.
 */
export function TestingBanner({ label }: { label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="relative z-20 flex items-center gap-2 bg-[#f59e0b] px-3 py-1.5 text-[13px] font-semibold text-black">
        <span className="line-clamp-2 min-w-0 flex-1 leading-tight">{t.testAs.banner(label)}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-full bg-black/12 px-2.5 py-1 active:scale-95"
        >
          {t.testAs.change}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void switchRole(null).catch(() => setBusy(false));
          }}
          className="shrink-0 rounded-full bg-black px-2.5 py-1 text-white active:scale-95 disabled:opacity-50"
        >
          ↩️ {t.testAs.exitShort}
        </button>
      </div>
      <TestAsSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
