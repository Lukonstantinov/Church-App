import { fontFamily, type FontKey } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { FontPicker } from './FontPicker';

/**
 * The text written on a poster: the design's own (a designed poster shows its title, date
 * and place), own words (first line big, the rest small, in a chosen font, size and
 * place — prepared as what / when / where and changed freely), or none at all: just the
 * picture and its effects.
 */
export type PosterTextMode = 'design' | 'custom' | 'none';

export interface PosterTextValue {
  mode: PosterTextMode;
  text: string;
  font: FontKey | null;
  size: 's' | 'm' | 'l';
  place: 'top' | 'middle' | 'bottom';
}

export const posterText = (text: string, mode: PosterTextMode = 'custom'): PosterTextValue => ({
  mode,
  text,
  font: null,
  size: 'm',
  place: 'bottom',
});

const SCALE = { s: 0.8, m: 1, l: 1.3 } as const;

/** The words over the picture, with a shade behind them so they read on any photo. */
export function PosterTextLayer({ value, scale = 1 }: { value: PosterTextValue; scale?: number }) {
  if (value.mode !== 'custom' || !value.text.trim()) return null;
  const [head, ...rest] = value.text.trim().split('\n');
  const k = SCALE[value.size] * scale;
  const shade =
    value.place === 'bottom'
      ? 'bg-gradient-to-t from-black/75 via-black/25 to-transparent'
      : value.place === 'top'
        ? 'bg-gradient-to-b from-black/75 via-black/25 to-transparent'
        : 'bg-black/35';
  return (
    <>
      <span className={`absolute inset-0 ${shade}`} />
      <div
        className={`absolute inset-0 flex flex-col text-white ${
          value.place === 'bottom'
            ? 'justify-end'
            : value.place === 'top'
              ? 'justify-start'
              : 'items-center justify-center text-center'
        }`}
        style={{
          fontFamily: fontFamily(value.font),
          textShadow: '0 1px 8px rgba(0,0,0,0.45)',
          padding: 20 * scale,
        }}
      >
        <div className="font-bold leading-tight tracking-tight" style={{ fontSize: 26 * k }}>
          {head}
        </div>
        {rest
          .filter((l) => l.trim())
          .map((line, i) => (
            <div key={i} className="mt-1 opacity-90" style={{ fontSize: 15 * k }}>
              {line}
            </div>
          ))}
      </div>
    </>
  );
}

/** The choices for the words on the poster. `preset` brings the prepared words back. */
export function PosterTextControls({
  value,
  onChange,
  preset,
  modes = ['custom', 'none'],
}: {
  value: PosterTextValue;
  onChange: (v: PosterTextValue) => void;
  preset: string;
  /** The choices this poster has ('design' only when it shows text of its own). */
  modes?: PosterTextMode[];
}) {
  const t = useT();
  const tt = t.posterText;
  const set = (patch: Partial<PosterTextValue>) => onChange({ ...value, ...patch });
  const pill = (on: boolean, label: string, act: () => void) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        haptic.tap();
        act();
      }}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
        on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold text-hint">{tt.title}</div>
      <div className="flex flex-wrap gap-1.5">
        {modes.map((m) => pill(value.mode === m, tt.mode[m], () => set({ mode: m })))}
      </div>
      {value.mode === 'custom' && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-hint">{tt.hint}</span>
            <button
              type="button"
              onClick={() => set({ text: preset })}
              className="text-[12px] font-semibold text-link"
            >
              {t.meetings.resetText}
            </button>
          </div>
          <textarea
            value={value.text}
            onChange={(e) => set({ text: e.target.value })}
            rows={4}
            maxLength={400}
            className="w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] leading-snug outline-none"
            style={{ fontFamily: fontFamily(value.font) }}
          />
          <FontPicker label={tt.font} value={value.font} onChange={(font) => set({ font })} />
          <div className="flex flex-wrap gap-1.5">
            {(['s', 'm', 'l'] as const).map((s) =>
              pill(value.size === s, tt.size[s], () => set({ size: s })),
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['top', 'middle', 'bottom'] as const).map((p) =>
              pill(value.place === p, tt.place[p], () => set({ place: p })),
            )}
          </div>
        </>
      )}
    </div>
  );
}
