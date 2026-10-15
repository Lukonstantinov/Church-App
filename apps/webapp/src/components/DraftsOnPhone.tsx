import { useState } from 'react';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { clearSuspect, dropAllDrafts, dropDraft, listDrafts, type DraftInfo } from '../lib/drafts';
import { confirmDialog, haptic } from '../lib/telegram';
import { Fold } from './Fold';

/** What a draft key is, in words ("poster.12" is poster 12 being edited, "free" the maker). */
function useKindOf() {
  const t = useT();
  const k = t.posters.draftKinds;
  return (key: string) =>
    key === 'poster.new'
      ? k.newPoster
      : key.startsWith('poster.')
        ? `${k.poster} #${key.slice(7)}`
        : key === 'free'
          ? k.free
          : k.other;
}

/**
 * Design → the unfinished work kept on this phone, each deletable without opening it. A
 * draft that was on screen when the app closed itself is marked — and then this list is
 * shown open at the very top of the Design tab, so it can be deleted before anything heavy
 * is drawn.
 */
export function DraftsOnPhone() {
  const t = useT();
  const f = useFmt();
  const kindOf = useKindOf();
  const [list, setList] = useState<DraftInfo[]>(() => listDrafts());
  const refresh = () => setList(listDrafts());
  const crashed = list.some((d) => d.suspect);
  if (list.length === 0 && !crashed) return null;

  const body = (
    <div className="flex flex-col gap-2">
      {list.length === 0 && <p className="text-[13px] text-hint">{t.posters.draftsEmpty}</p>}
      {list.map((d) => (
        <div
          key={d.key}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 ${d.suspect ? 'border border-amber-500/40 bg-amber-500/10' : 'bg-hairline'}`}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">
              {d.suspect && '⚠️ '}
              {kindOf(d.key)}
            </div>
            <div className="text-[12px] text-hint">
              {d.at
                ? `${f.weekdayDayMonth(new Date(d.at).toISOString())} ${f.time(new Date(d.at).toISOString())}`
                : ''}
              {` · ${d.kb} KB`}
              {d.suspect && ` · ${t.posters.draftsCrashed}`}
            </div>
          </div>
          <button
            type="button"
            aria-label={t.posters.draftDelete}
            onClick={async () => {
              if (!(await confirmDialog(t.posters.draftDeleteConfirm))) return;
              haptic.tap();
              dropDraft(d.key);
              clearSuspect(d.key);
              refresh();
            }}
            className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold text-[var(--color-destructive,#ef4444)] active:scale-95"
          >
            🗑
          </button>
        </div>
      ))}
      {list.length > 1 && (
        <button
          type="button"
          onClick={async () => {
            if (!(await confirmDialog(t.posters.draftsDeleteAllConfirm))) return;
            haptic.tap();
            for (const d of list) clearSuspect(d.key);
            dropAllDrafts();
            refresh();
          }}
          className="self-start rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold text-[var(--color-destructive,#ef4444)] active:scale-95"
        >
          🗑 {t.posters.draftsDeleteAll}
        </button>
      )}
    </div>
  );

  // After a crash: open, on top, nothing to unfold.
  if (crashed)
    return (
      <section className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 p-3">
        <div className="text-[15px] font-bold">📝 {t.posters.drafts}</div>
        <p className="text-[13px] text-hint">{t.posters.draftsHint}</p>
        {body}
      </section>
    );
  return (
    <Fold id="design.drafts" icon="📝" title={t.posters.drafts} hint={t.posters.draftsHint}>
      {body}
    </Fold>
  );
}
