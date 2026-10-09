import { useState } from 'react';
import type { MotionLayer } from '@church/shared';
import { useT } from '../lib/i18n';
import {
  useDeleteEffectTemplate,
  useEffectTemplates,
  useMe,
  useSaveEffectTemplate,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { useToast } from './Toast';

/**
 * Saved sets of effects: tap one to put its effects (with their settings) on what is being
 * designed, or save the effects now on it as a new set under a name. Sets are shared by
 * everyone who designs; the maker (or a church admin) deletes one with ✕.
 */
export function EffectSets({
  current,
  onApply,
}: {
  /** The effects on it now, in order (what "Save" stores). */
  current: MotionLayer[];
  onApply: (layers: MotionLayer[]) => void;
}) {
  const t = useT();
  const ts = t.effectSets;
  const toast = useToast();
  const me = useMe();
  const sets = useEffectTemplates();
  const save = useSaveEffectTemplate();
  const remove = useDeleteEffectTemplate();
  const [naming, setNaming] = useState<string | null>(null);
  // Those who may not use sets (the list refuses them) don't see the row at all.
  if (sets.isError) return null;
  const list = sets.data ?? [];
  const isAdmin = !!me.data?.user.isAdmin;

  const submit = async () => {
    const name = naming?.trim();
    if (!name || current.length === 0) return;
    try {
      await save.mutateAsync({
        name,
        effects: current.map((l) => ({ kind: l.kind, tune: l.tune ?? null })),
      });
      haptic.success();
      toast(ts.saved);
      setNaming(null);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-hairline/40 p-3">
      <div className="text-[13px] font-semibold">{ts.title}</div>
      <div className="text-[12px] leading-snug text-hint">{ts.hint}</div>
      {list.length === 0 && !sets.isLoading && (
        <div className="text-[12px] text-hint">{ts.none}</div>
      )}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((x) => (
            <span
              key={x.id}
              className="flex items-center overflow-hidden rounded-full bg-[var(--brand)]/15"
            >
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  onApply(x.effects);
                  toast(ts.applied(x.name));
                }}
                className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 text-[13px] font-semibold active:opacity-70"
              >
                ✨ {x.name}
                <span className="text-[11px] font-normal text-hint">
                  {ts.count(x.effects.length)}
                </span>
              </button>
              {(x.mine || isAdmin) && (
                <button
                  type="button"
                  aria-label={ts.remove(x.name)}
                  onClick={async () => {
                    if (!(await confirmDialog(ts.remove(x.name)))) return;
                    await remove
                      .mutateAsync(x.id)
                      .catch(() => toast(t.common.actionFailed, 'error'));
                  }}
                  className="py-1.5 pl-1 pr-3 text-[13px] text-hint active:opacity-70"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {naming === null ? (
        current.length > 0 && (
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              setNaming('');
            }}
            className="self-start text-[13px] font-semibold text-link active:opacity-70"
          >
            {ts.save}
          </button>
        )
      ) : (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={naming}
            maxLength={40}
            placeholder={ts.name}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="min-w-0 flex-1 rounded-lg bg-bg-secondary px-3 py-2 text-[14px] outline-none"
          />
          <button
            type="button"
            disabled={!naming.trim() || save.isPending}
            onClick={() => void submit()}
            className="rounded-lg bg-[var(--brand)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {ts.saveNow}
          </button>
          <button
            type="button"
            onClick={() => setNaming(null)}
            className="px-1 text-[13px] text-hint"
          >
            {ts.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
