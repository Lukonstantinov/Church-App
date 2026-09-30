import { useEffect, useRef, useState } from 'react';
import { BRAND_COLOR_KEYS, BRAND_COLORS, resolveBrand } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';

/**
 * Theme swatches (two-tone gradients) plus a custom colour. For a ministry, `inherit`
 * adds a "same as the church" choice (value null).
 */
export function ThemePicker({
  value,
  onChange,
  inherit,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  inherit?: { label: string; theme: string };
}) {
  const t = useT();
  // The colour wheel fires on every drag step: preview locally, save once it settles.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const shown = draft ?? value;
  const custom = shown && shown.startsWith('#') ? shown : null;
  const ring = 'ring-[3px] ring-text/80 ring-offset-2 ring-offset-[var(--color-section)]';
  const pick = (v: string | null) => {
    haptic.tap();
    onChange(v);
  };
  const swatch = (
    key: string,
    background: string,
    on: boolean,
    label: string,
    v: string | null,
  ) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={() => pick(v)}
      className={`flex aspect-square items-center justify-center rounded-2xl text-[17px] font-bold text-white shadow-card transition active:scale-90 ${on ? ring : ''}`}
      style={{ background }}
    >
      {on && '✓'}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-6 gap-2.5">
        {inherit &&
          (() => {
            const c = resolveBrand(inherit.theme);
            return swatch(
              'inherit',
              `linear-gradient(135deg, ${c.light}, ${c.partner})`,
              shown === null,
              inherit.label,
              null,
            );
          })()}
        {BRAND_COLOR_KEYS.map((key) => {
          const c = BRAND_COLORS[key];
          return swatch(
            key,
            `linear-gradient(135deg, ${c.light}, ${c.partner})`,
            shown === key,
            key,
            key,
          );
        })}
        <label
          aria-label={t.env.customColor}
          className={`relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl text-[17px] font-bold text-white shadow-card ${custom ? ring : ''}`}
          style={{
            background: custom
              ? `linear-gradient(135deg, ${resolveBrand(custom).light}, ${resolveBrand(custom).partner})`
              : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)',
          }}
        >
          {custom ? '✓' : '+'}
          <input
            type="color"
            value={custom ?? '#6366f1'}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => {
                setDraft(null);
                onChange(v);
              }, 500);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      {inherit && shown === null && <p className="text-[13px] text-hint">{inherit.label}</p>}
    </div>
  );
}
