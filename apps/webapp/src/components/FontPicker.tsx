import { useState } from 'react';
import { FONT_GROUPS, FONT_KEYS, FONTS, fontFamily, type FontKey } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Sheet } from './Sheet';

/** A font choice: the button shows the current font; the sheet lists all of them by kind. */
export function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FontKey | null | undefined;
  onChange: (v: FontKey | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pick = (v: FontKey | null) => {
    haptic.tap();
    onChange(v);
    setOpen(false);
  };
  const option = (key: FontKey | null, name: string) => (
    <button
      key={key ?? 'default'}
      type="button"
      onClick={() => pick(key)}
      className={`flex min-h-[64px] flex-col items-start justify-center rounded-2xl px-3 py-2 text-left transition active:scale-95 ${
        (value ?? null) === key ? 'bg-brand/15 ring-2 ring-[var(--brand)]' : 'bg-hairline'
      }`}
    >
      <span className="text-[22px] leading-tight" style={{ fontFamily: fontFamily(key) }}>
        Аа Бб Ąą
      </span>
      <span className="text-[12px] text-hint">{name}</span>
    </button>
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-hairline px-3.5 py-2.5 text-left"
      >
        <span className="text-[14px] text-hint">{label}</span>
        <span className="truncate text-[18px]" style={{ fontFamily: fontFamily(value) }}>
          {value ? FONTS[value].family : t.feed.defaultFont}
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="grid grid-cols-2 gap-2">{option(null, t.feed.defaultFont)}</div>
          {FONT_GROUPS.map((group) => (
            <div key={group}>
              <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
                {t.feed.fontGroups[group]}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FONT_KEYS.filter((k) => FONTS[k].group === group).map((k) =>
                  option(k, FONTS[k].family),
                )}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
