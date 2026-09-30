import { useState } from 'react';
import {
  DEFAULT_PATTERN,
  PATTERN_KEYS,
  patternBackground,
  type GroupSummary,
  type PatternConfig,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { EnvCard } from '../screens/Hub';
import { Button } from './ui';

const QUICK_EMOJI = [
  '✝️',
  '🔥',
  '🕊️',
  '⭐',
  '❤️',
  '🙏',
  '📖',
  '🎵',
  '☀️',
  '🌿',
  '⛪',
  '👑',
  '🎸',
  '💧',
];

/**
 * Pick one icon (emoji, logo or shape) and tune how it repeats over the ministry's
 * colours: opacity, size and tilt. The card preview updates live.
 */
export function PatternDesigner({
  env,
  fallbackTheme,
  onSave,
  saving,
}: {
  env: GroupSummary;
  fallbackTheme: string;
  onSave: (p: PatternConfig | null) => void;
  saving: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<PatternConfig | null>(env.pattern);
  const [customEmoji, setCustomEmoji] = useState('');
  const current = draft ?? DEFAULT_PATTERN;
  const set = (patch: Partial<PatternConfig>) => setDraft({ ...current, ...patch });
  const pickIcon = (kind: PatternConfig['kind'], value: string) => {
    haptic.tap();
    setDraft({ ...current, kind, value });
  };
  const isOn = (kind: PatternConfig['kind'], value: string) =>
    draft !== null && draft.kind === kind && draft.value === value;
  const changed = JSON.stringify(draft) !== JSON.stringify(env.pattern);

  const chip = (on: boolean, onClick: () => void, children: React.ReactNode, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-[22px] transition active:scale-90 ${
        on ? 'bg-brand/15 ring-2 ring-[var(--brand)]' : 'bg-hairline'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="mx-auto w-1/2 min-w-[160px]">
        <EnvCard
          g={{ ...env, pattern: draft }}
          fallbackTheme={fallbackTheme}
          onClick={() => undefined}
        />
      </div>
      <p className="text-center text-[13px] text-hint">{t.env.patternHint}</p>

      <div>
        <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.env.patternIcon}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip(
            draft === null,
            () => setDraft(null),
            <span className="text-[13px] font-semibold text-hint">∅</span>,
            t.env.patternNone,
          )}
          {QUICK_EMOJI.map((e) => chip(isOn('emoji', e), () => pickIcon('emoji', e), e, e))}
          {env.logoUrl &&
            chip(
              isOn('logo', 'logo'),
              () => pickIcon('logo', 'logo'),
              <img src={env.logoUrl} alt="" className="h-7 w-7 rounded-md object-contain" />,
              t.env.patternLogo,
            )}
        </div>
        <label className="mt-2 flex items-center gap-2 rounded-xl bg-hairline px-3 py-2">
          <span className="text-[14px] text-hint">{t.env.patternEmoji}</span>
          <input
            value={customEmoji}
            maxLength={16}
            placeholder="😊"
            onChange={(e) => {
              const v = e.target.value.replace(/[<>&"'\s]/g, '');
              setCustomEmoji(v);
              if (v) setDraft({ ...current, kind: 'emoji', value: v });
            }}
            className="min-w-0 flex-1 bg-transparent text-[22px] outline-none"
          />
        </label>
      </div>

      <div>
        <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.env.patternShapes}
        </div>
        <div className="flex flex-wrap gap-2">
          {PATTERN_KEYS.map((k) => {
            const bg = patternBackground({
              ...DEFAULT_PATTERN,
              kind: 'preset',
              value: k,
              size: 22,
            });
            return chip(
              isOn('preset', k),
              () => pickIcon('preset', k),
              <span
                className="brand-gradient block h-7 w-7 rounded-md"
                style={{
                  backgroundImage: `${bg?.image}, linear-gradient(135deg, var(--brand), var(--brand-partner))`,
                  backgroundSize: `${bg?.size} ${bg?.size}, cover`,
                }}
              />,
              k,
            );
          })}
        </div>
      </div>

      {draft && (
        <div className="flex flex-col gap-3">
          <Slider
            label={t.env.opacity}
            value={Math.round(draft.opacity * 100)}
            min={3}
            max={80}
            suffix="%"
            onChange={(v) => set({ opacity: v / 100 })}
          />
          <Slider
            label={t.env.density}
            value={draft.size}
            min={16}
            max={120}
            suffix="px"
            onChange={(v) => set({ size: v })}
          />
          <Slider
            label={t.env.tilt}
            value={draft.angle}
            min={-45}
            max={45}
            suffix="°"
            onChange={(v) => set({ angle: v })}
            extra={
              <button
                type="button"
                onClick={() => set({ angle: 0 })}
                className="rounded-lg bg-hairline px-2.5 py-1 text-[13px] font-semibold"
              >
                {t.env.straight}
              </button>
            }
          />
        </div>
      )}

      <Button disabled={!changed || saving} onClick={() => onSave(draft)}>
        {saving ? t.common.saving : t.common.save}
      </Button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  extra,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (v: number) => void;
  extra?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-[14px]">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          {extra}
          <span className="w-12 text-right tabular-nums text-hint">
            {value}
            {suffix}
          </span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-[var(--brand)]"
      />
    </label>
  );
}
