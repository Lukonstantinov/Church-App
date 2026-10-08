import { useState, type ReactNode } from 'react';
import { storage } from '../lib/storage';
import { haptic } from '../lib/telegram';
import { IconChevronDown } from './icons';

/**
 * A section that folds away: icon, title and what it is for; open or closed as the person
 * left it on this phone. Its content isn't drawn while closed (lighter for the phone).
 */
export function Fold({
  id,
  icon,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  /** Where its open state is kept on this phone. */
  id: string;
  icon: ReactNode;
  title: string;
  hint: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `church.fold.${id}`;
  const [open, setOpen] = useState(() => {
    const v = storage.get(key);
    return v === null ? defaultOpen : v === '1';
  });
  const toggle = () => {
    haptic.tap();
    storage.set(key, open ? '0' : '1');
    setOpen(!open);
  };
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-card active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hairline text-[20px]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">{title}</span>
          <span
            className={`block text-[13px] leading-snug text-hint ${open ? '' : 'line-clamp-2'}`}
          >
            {hint}
          </span>
        </span>
        <IconChevronDown
          size={20}
          className={`shrink-0 text-hint transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}
