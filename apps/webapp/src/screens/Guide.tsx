import { useState } from 'react';
import { IconChevronRight } from '../components/icons';
import { Screen, Section, Title } from '../components/ui';
import { GUIDE } from '../lib/guide';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';

/**
 * The developer's instructions: how to add, change and remove everything in the app,
 * and how to run the project. Grouped by topic, each how-to folds open; search filters.
 */
export function Guide() {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const needle = q.trim().toLocaleLowerCase();
  const sections = GUIDE.map((s) => ({
    ...s,
    items: s.items.filter(
      (i) =>
        !needle ||
        `${s.title} ${i.title} ${i.steps.join(' ')} ${i.note ?? ''}`
          .toLocaleLowerCase()
          .includes(needle),
    ),
  })).filter((s) => s.items.length > 0);

  return (
    <Screen>
      <Title subtitle={t.dev.guideEntry}>{t.dev.guideTitle}</Title>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.dev.guideSearch}
        className="glass w-full rounded-2xl px-4 py-3 text-[16px] shadow-card outline-none placeholder:text-hint"
      />
      {sections.map((s) => (
        <Section key={s.key} title={`${s.icon} ${s.title}`}>
          {s.items.map((item) => {
            const id = `${s.key}:${item.title}`;
            const shown = open === id || needle.length > 0;
            return (
              <div key={id} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  aria-expanded={shown}
                  onClick={() => {
                    haptic.tap();
                    setOpen(open === id ? null : id);
                  }}
                  className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2.5 text-left active:bg-hairline"
                >
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
                    {item.title}
                  </span>
                  <IconChevronRight
                    size={16}
                    className={`shrink-0 text-hint transition-transform ${shown ? 'rotate-90' : ''}`}
                  />
                </button>
                {shown && (
                  <div className="px-4 pb-3">
                    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-snug">
                      {item.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {item.note && (
                      <p className="mt-2 rounded-xl bg-hairline/70 px-3 py-2 text-[13px] text-hint">
                        💡 {item.note}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      ))}
      {sections.length === 0 && <p className="py-8 text-center text-[14px] text-hint">—</p>}
    </Screen>
  );
}
