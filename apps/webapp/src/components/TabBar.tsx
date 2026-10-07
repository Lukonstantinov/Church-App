import type { ReactNode } from 'react';
import { SkinLayer, skinClass, skinStyle, useModuleLook } from './ModuleSkin';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
  badge?: number;
}

/** Floating glass tab bar. Big touch targets, safe-area aware, badge for pending work. */
export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (k: K) => void;
}) {
  const look = useModuleLook('tabbar');
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`glass-strong pointer-events-auto mx-auto flex max-w-xl gap-1 rounded-[26px] p-1.5 shadow-float ${skinClass(look)}`}
        style={skinStyle(look)}
      >
        <SkinLayer look={look} />
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-semibold transition-colors active:scale-95 ${
                on ? 'bg-brand/14 text-accent' : 'text-hint'
              }`}
            >
              <span className="relative">
                {t.icon}
                {t.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 min-w-[17px] rounded-full bg-absent px-1 text-center text-[10px] font-bold leading-[17px] text-white ring-2 ring-[var(--color-section)]">
                    {t.badge > 9 ? '9+' : t.badge}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate px-1">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
