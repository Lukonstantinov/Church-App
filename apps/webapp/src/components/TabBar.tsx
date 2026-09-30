import type { ReactNode } from 'react';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
  badge?: number;
}

/** Fixed bottom navigation. Big touch targets, safe-area aware, badge for pending work. */
export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (k: K) => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-section/90 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium active:opacity-70 ${
                on ? 'text-accent' : 'text-hint'
              }`}
            >
              <span className="relative">
                {t.icon}
                {t.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-absent px-1 text-center text-[10px] font-bold leading-4 text-white">
                    {t.badge > 9 ? '9+' : t.badge}
                  </span>
                ) : null}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
