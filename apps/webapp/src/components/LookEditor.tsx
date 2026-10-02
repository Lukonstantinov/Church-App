import { useState } from 'react';
import {
  LABEL_ANIMATIONS,
  LABEL_FONTS,
  LABEL_STYLES,
  LABEL_TEXTURES,
  type LabelLook,
  type LabelStyle,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { LabelChip, StyledName } from './LabelLook';
import { Pill } from './LookControls';
import { IconMinus, IconPlus } from './icons';
import { Switch } from './ui';

export const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#78350f',
  '#64748b',
  '#111827',
  '#d4af37',
  '#c0c0c0',
];

const EMOJIS = ['⭐', '🔥', '🙏', '🎵', '🎤', '👑', '💎', '🛠️', '❤️', '✨', '🕊️', '📖'];

export const defaultLook = (): LabelLook => ({
  color: '#3b82f6',
  color2: null,
  colors: null,
  style: 'solid',
  animation: 'shimmer',
  texture: 'none',
  font: 'default',
  caps: false,
  italic: false,
  emoji: null,
  nameStyle: false,
});

/** The gradient's colours (2–5), starting from what the look has. */
const gradientOf = (l: LabelLook) =>
  l.colors?.length ? l.colors : [l.color, l.color2 ?? LABEL_COLORS[15]!];

/**
 * Everything about a label's look: fill (one colour, a gradient of up to five, rainbow,
 * metal, neon, glass, outline), pattern, animation, font and emoji, and whether the
 * person's name takes the same look.
 */
export function LookEditor({
  value,
  onChange,
  name,
  nameOption = true,
}: {
  value: LabelLook;
  onChange: (l: LabelLook) => void;
  /** The text shown in the preview chip. */
  name: string;
  nameOption?: boolean;
}) {
  const t = useT();
  const [slot, setSlot] = useState(0);
  const set = (patch: Partial<LabelLook>) => onChange({ ...value, ...patch });
  const grad = gradientOf(value);

  const setStyle = (style: LabelStyle) =>
    set(
      style === 'gradient' ? { style, colors: grad, color: grad[0]!, color2: grad[1]! } : { style },
    );
  const pick = (c: string) => {
    if (value.style !== 'gradient') return set({ color: c });
    const colors = grad.map((x, i) => (i === slot ? c : x));
    set({ colors, color: colors[0]!, color2: colors[1]! });
  };
  const current = value.style === 'gradient' ? (grad[slot] ?? grad[0]!) : value.color;
  const fillName = (s: LabelStyle) =>
    s === 'rainbow' ? t.labels.rainbowFill : (t.labels[s] as string);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[84px] flex-col items-center justify-center gap-3 rounded-xl bg-hairline/60 px-3 py-4">
        {/* Shown larger so the fill, pattern and movement are easy to see. */}
        <span className="inline-flex scale-[1.6] py-1.5">
          <LabelChip label={{ ...value, name }} />
        </span>
        {value.nameStyle && (
          <StyledName look={value} className="text-[20px] font-bold">
            {t.labels.sampleName}
          </StyledName>
        )}
      </div>

      <Group title={t.labels.fill}>
        {LABEL_STYLES.map((s) => (
          <Pill key={s} on={value.style === s} onClick={() => setStyle(s)} label={fillName(s)} />
        ))}
      </Group>

      {value.style !== 'rainbow' && (
        <div>
          <div className="mb-2 text-[13px] text-hint">
            {value.style === 'gradient' ? t.labels.colors : t.labels.color}
          </div>
          {value.style === 'gradient' && (
            <div className="mb-3 flex items-center gap-2">
              <div
                className="h-9 flex-1 rounded-full"
                style={{ background: `linear-gradient(90deg, ${grad.join(', ')})` }}
              />
              {grad.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={c}
                  onClick={() => setSlot(i)}
                  className={`h-8 w-8 shrink-0 rounded-full ${
                    i === slot ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                aria-label={t.labels.addColor}
                disabled={grad.length >= 5}
                onClick={() => {
                  const colors = [...grad, LABEL_COLORS[(grad.length * 4) % LABEL_COLORS.length]!];
                  set({ colors });
                  setSlot(colors.length - 1);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
              >
                <IconPlus size={16} />
              </button>
              <button
                type="button"
                aria-label="remove"
                disabled={grad.length <= 2}
                onClick={() => {
                  const colors = grad.filter((_, i) => i !== slot);
                  set({ colors, color: colors[0]!, color2: colors[1]! });
                  setSlot(Math.max(0, slot - 1));
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
              >
                <IconMinus size={16} />
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => pick(c)}
                className={`h-9 w-9 rounded-full transition active:scale-90 ${
                  current === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                }`}
                style={{ background: c }}
              />
            ))}
            {/* Any colour at all. */}
            <label
              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full"
              style={{
                background:
                  'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
              }}
              aria-label={t.labels.customColor}
            >
              <span className="h-4 w-4 rounded-full bg-white/90" />
              <input
                type="color"
                value={current}
                onChange={(e) => pick(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      )}

      <Group title={t.labels.texture}>
        {LABEL_TEXTURES.map((x) => (
          <Pill
            key={x}
            on={value.texture === x}
            onClick={() => set({ texture: x })}
            label={t.labels.textures[x]}
          />
        ))}
      </Group>

      <Group title={t.labels.animation}>
        {LABEL_ANIMATIONS.map((a) => (
          <Pill
            key={a}
            on={value.animation === a}
            onClick={() => set({ animation: a })}
            label={t.labels[a] as string}
          />
        ))}
      </Group>

      <div>
        <div className="mb-2 text-[13px] text-hint">{t.labels.text}</div>
        <div className="flex flex-wrap gap-2">
          {LABEL_FONTS.map((fnt) => (
            <button
              key={fnt}
              type="button"
              onClick={() => set({ font: fnt })}
              className={`rounded-full px-3.5 py-1.5 text-[14px] ${
                fnt !== 'default' ? `lk-font-${fnt}` : ''
              } ${value.font === fnt ? 'brand-gradient text-white shadow-cta' : 'bg-hairline'}`}
            >
              {t.labels.fonts[fnt]}
            </button>
          ))}
          <Pill on={value.caps} onClick={() => set({ caps: !value.caps })} label={t.labels.caps} />
          <Pill
            on={value.italic}
            onClick={() => set({ italic: !value.italic })}
            label={t.labels.italic}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[13px] text-hint">{t.labels.emoji}</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => set({ emoji: null })}
            className={`h-9 min-w-9 rounded-full px-2 text-[13px] ${
              !value.emoji ? 'brand-gradient text-white' : 'bg-hairline'
            }`}
          >
            —
          </button>
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => set({ emoji: e })}
              className={`h-9 w-9 rounded-full text-[18px] ${
                value.emoji === e ? 'ring-2 ring-[var(--text)] ring-offset-1' : 'bg-hairline'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {nameOption && (
        <button
          type="button"
          role="switch"
          aria-checked={value.nameStyle}
          onClick={() => set({ nameStyle: !value.nameStyle })}
          className="flex items-center gap-3 rounded-xl bg-hairline/60 px-3.5 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{t.labels.nameStyle}</span>
            <span className="block text-[12px] text-hint">{t.labels.nameStyleHint}</span>
          </span>
          <Switch on={value.nameStyle} />
        </button>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[13px] text-hint">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
