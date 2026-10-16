import {
  isFontKey,
  MOTION_KNOBS,
  type MeetingMotion,
  type MotionKnob,
  type MotionTune,
  type ShineTune,
} from '@church/shared';
import { useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { SHADER_KINDS } from './ShaderEffect';
import { FontPicker } from './FontPicker';
import { Pill } from './LookControls';
import { Toggle } from './ui';

export const PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#111418',
  '#ffffff',
];
const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** A labelled slider showing its value (×1.25, 45°, 80%…). */
export function Knob({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[14px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-hint">{show(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--brand)]"
      />
    </label>
  );
}

const times = (v: number) => `×${v.toFixed(2)}`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The settings of one animation, opened right under it when it is picked: speed, size,
 * strength, what only it has (how many / how far apart, how thick, how sharp — see
 * MOTION_KNOBS), its turn (arrows or any angle) and colour.
 */
export function MotionTuneControls({
  kind,
  tune,
  onChange,
}: {
  kind: MeetingMotion;
  tune: MotionTune;
  onChange: (t: MotionTune | null) => void;
}) {
  const t = useT();
  const k = t.studio.knob;
  const set = (patch: Partial<MotionTune>) => onChange({ ...tune, ...patch });
  // An own effect: only how fast and how strong here; its layers change in the Effect studio.
  if (kind === 'custom')
    return (
      <div className="flex flex-col gap-4">
        <Knob
          label={t.studio.speed}
          value={tune.speed ?? 1}
          min={0.25}
          max={3}
          step={0.25}
          show={times}
          onChange={(speed) => set({ speed })}
        />
        <Knob
          label={k.strength}
          value={tune.strength ?? 1}
          min={0.2}
          max={1}
          step={0.05}
          show={percent}
          onChange={(strength) => set({ strength })}
        />
        <p className="text-[12px] text-hint">{t.effectStudio.editInStudio}</p>
      </div>
    );
  const knobs = MOTION_KNOBS[kind] ?? [];
  const lined = kind === 'lines' || kind === 'grid';
  const shader = SHADER_KINDS.has(kind);
  // What "how many" and "how thick" mean for this animation.
  const lineKinds = ['topo', 'streaks', 'ribbons', 'wordwall'];
  const label: Record<'density' | 'weight' | 'sharp', string> = {
    density:
      kind === 'lines'
        ? k.gap
        : kind === 'grid'
          ? k.cells
          : kind === 'sun' || kind === 'sunburst'
            ? k.rays
            : lineKinds.includes(kind)
              ? k.lines
              : kind === 'silk'
                ? k.folds
                : kind === 'marble'
                  ? k.veins
                  : shader
                    ? k.bands
                    : k.count,
    weight: lined
      ? k.thick
      : kind === 'sun' || kind === 'halo'
        ? k.discSize
        : kind === 'wordwall'
          ? k.letterSize
          : kind === 'flames'
            ? k.strength
            : lineKinds.includes(kind) || kind === 'marble'
              ? kind === 'marble'
                ? k.veinWidth
                : k.thick
              : shader
                ? k.gloss
                : kind.startsWith('icon')
                  ? k.iconSize
                  : k.particle,
    sharp: k.clarity,
  };
  const knob: Record<MotionKnob, ReactNode> = {
    density: (
      <Knob
        key="density"
        label={label.density}
        value={tune.density ?? 1}
        min={0.3}
        max={2.5}
        step={0.1}
        show={times}
        onChange={(density) => set({ density })}
      />
    ),
    weight: (
      <Knob
        key="weight"
        label={label.weight}
        value={tune.weight ?? 1}
        min={0.3}
        max={3}
        step={0.1}
        show={times}
        onChange={(weight) => set({ weight })}
      />
    ),
    sharp: (
      <Knob
        key="sharp"
        label={label.sharp}
        value={tune.sharp ?? (kind === 'marble' ? 0.45 : 0)}
        min={0}
        max={1}
        step={0.05}
        show={percent}
        onChange={(sharp) => set({ sharp })}
      />
    ),
    chaos: (
      <Knob
        key="chaos"
        label={k.chaos}
        value={tune.chaos ?? (kind === 'liquid' ? 0.45 : kind === 'marble' ? 0.35 : 0.3)}
        min={0}
        max={1}
        step={0.05}
        show={percent}
        onChange={(chaos) => set({ chaos })}
      />
    ),
    seed: (
      <div key="seed" className="flex items-center justify-between gap-3">
        <span className="text-[14px]">
          {k.seed} <span className="font-semibold tabular-nums text-hint">#{tune.seed ?? 0}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            set({ seed: Math.floor(Math.random() * 10000) });
          }}
          className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold active:scale-95"
        >
          {k.shuffle}
        </button>
      </div>
    ),
    colors: (
      <ColorsRow
        key="colors"
        value={tune.colors ?? []}
        onChange={(colors) => set({ colors: colors.length ? colors : null })}
      />
    ),
    glow: (
      <Knob
        key="glow"
        label={k.glow}
        value={tune.glow ?? 0}
        min={0}
        max={1}
        step={0.05}
        show={percent}
        onChange={(glow) => set({ glow })}
      />
    ),
    place: (
      <div key="place" className="flex flex-col gap-2">
        <div className="text-[14px]">{k.place}</div>
        {/* Nine quick spots, then fine sliders. */}
        <div className="grid w-[132px] grid-cols-3 gap-1">
          {[0.15, 0.5, 0.85].flatMap((y) =>
            [0.15, 0.5, 0.85].map((x) => {
              const on =
                Math.abs((tune.x ?? 0.72) - x) < 0.05 && Math.abs((tune.y ?? 0.28) - y) < 0.05;
              return (
                <button
                  key={`${x}${y}`}
                  type="button"
                  aria-label={`${Math.round(x * 100)}% ${Math.round(y * 100)}%`}
                  onClick={() => {
                    haptic.tap();
                    set({ x, y });
                  }}
                  className={`h-9 rounded-lg ${on ? 'bg-[var(--brand)]' : 'bg-hairline'}`}
                />
              );
            }),
          )}
        </div>
        <Knob
          label={k.placeX}
          value={tune.x ?? (kind === 'fur' ? 0.8 : 0.72)}
          min={0}
          max={1}
          step={0.01}
          show={percent}
          onChange={(x) => set({ x })}
        />
        <Knob
          label={k.placeY}
          value={tune.y ?? (kind === 'fur' ? 0.15 : 0.28)}
          min={0}
          max={1}
          step={0.01}
          show={percent}
          onChange={(y) => set({ y })}
        />
        {(kind === 'sun' || kind === 'halo') && (
          <Toggle label={k.drift} checked={!!tune.drift} onChange={(drift) => set({ drift })} />
        )}
      </div>
    ),
    words: (
      <WordsRow
        key="words"
        hint={kind === 'matrix' ? k.wordsHintRain : k.wordsHintWall}
        value={tune.words ?? []}
        onChange={(words) => set({ words: words.length ? words : null })}
      />
    ),
    font: (
      <FontPicker
        key="font"
        label={k.font}
        value={isFontKey(tune.font) ? tune.font : null}
        onChange={(font) => set({ font })}
      />
    ),
    wordStyle: (
      <div key="wordStyle" className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 text-[14px]">{k.wordStyle}</div>
          <div className="flex flex-wrap gap-1.5">
            {(['fill', 'outline', 'mix'] as const).map((v) => (
              <Pill
                key={v}
                on={(tune.wordStyle ?? 'fill') === v}
                onClick={() => set({ wordStyle: v })}
                label={k.wordStyles[v]}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[14px]">{k.wordFlow}</div>
          <div className="flex flex-wrap gap-1.5">
            {(['alt', 'same', 'still'] as const).map((v) => (
              <Pill
                key={v}
                on={(tune.wordFlow ?? 'alt') === v}
                onClick={() => set({ wordFlow: v })}
                label={k.wordFlows[v]}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    symbols: (
      <label key="symbols" className="flex flex-col gap-1">
        <span className="text-[14px]">{k.symbols}</span>
        <input
          value={tune.symbols ?? ''}
          maxLength={60}
          onChange={(e) => set({ symbols: e.target.value || null })}
          placeholder="ｱ1ｶ0ﾀ7 …"
          className="rounded-xl bg-hairline px-3 py-2 text-[16px] outline-none placeholder:text-hint"
        />
        <span className="text-[12px] text-hint">{k.symbolsHint}</span>
      </label>
    ),
  };
  return (
    <div className="flex flex-col gap-4">
      {knobs.map((x) => knob[x])}
      <Knob
        label={t.studio.speed}
        value={tune.speed ?? 1}
        min={0.25}
        max={3}
        step={0.25}
        show={times}
        onChange={(speed) => set({ speed })}
      />
      <Knob
        label={t.studio.size}
        value={tune.size ?? 1}
        min={0.5}
        max={2}
        step={0.1}
        show={times}
        onChange={(size) => set({ size })}
      />
      <Knob
        label={k.strength}
        value={tune.strength ?? 1}
        min={0.2}
        max={lined ? 2 : 1}
        step={0.05}
        show={percent}
        onChange={(strength) => set({ strength })}
      />
      <div className="flex flex-col gap-2">
        <Knob
          label={lined ? k.slant : t.studio.direction}
          value={tune.angle ?? 0}
          min={0}
          max={355}
          step={5}
          show={(v) => `${v}°`}
          onChange={(angle) => set({ angle })}
        />
        <div className="flex flex-wrap gap-1.5">
          {DIRECTIONS.map((a, i) => (
            <Pill
              key={a}
              on={(tune.angle ?? 0) === a}
              onClick={() => set({ angle: a })}
              label={ARROWS[i]!}
            />
          ))}
        </div>
      </div>
      {!knobs.includes('colors') && (
        <ColorRow value={tune.color ?? null} onChange={(color) => set({ color })} />
      )}
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          onChange(null);
        }}
        className="self-start rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold text-hint active:scale-95"
      >
        {k.reset}
      </button>
    </div>
  );
}

/** Up to 10 words of one's own (digital rain, word wall), each in its own field. */
function WordsRow({
  value,
  hint,
  onChange,
}: {
  value: string[];
  hint: string;
  onChange: (w: string[]) => void;
}) {
  const t = useT();
  const k = t.studio.knob;
  // While typing an empty field stays (the stored list drops empty words).
  const [list, setList] = useState<string[]>(() => (value.length ? value : ['']));
  const put = (next: string[]) => {
    setList(next);
    onChange(next.map((w) => w.trim()).filter(Boolean));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[14px]">{k.words}</span>
      {list.map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={w}
            maxLength={30}
            placeholder={`${k.wordPlaceholder} ${i + 1}`}
            onChange={(e) => put(list.map((x, j) => (j === i ? e.target.value : x)))}
            className="min-w-0 flex-1 rounded-xl bg-hairline px-3 py-2 text-[16px] outline-none placeholder:text-hint"
          />
          {list.length > 1 && (
            <button
              type="button"
              aria-label="×"
              onClick={() => put(list.filter((_, j) => j !== i))}
              className="h-9 w-9 shrink-0 rounded-full bg-hairline text-hint"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {list.length < 10 && (
        <button
          type="button"
          onClick={() => setList([...list, ''])}
          className="self-start rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold active:scale-95"
        >
          {k.addWord}
        </button>
      )}
      <span className="text-[12px] text-hint">{hint}</span>
    </div>
  );
}

/** Up to four colours of one's own for the shader effects (empty = the ministry's). */
function ColorsRow({ value, onChange }: { value: string[]; onChange: (c: string[]) => void }) {
  const t = useT();
  const k = t.studio.knob;
  return (
    <div>
      <div className="mb-1 text-[14px]">{k.colors}</div>
      <div className="mb-2 text-[12px] text-hint">{k.colorsHint}</div>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((c, i) => (
          <span key={i} className="relative">
            <label
              className="block h-9 w-9 cursor-pointer overflow-hidden rounded-full ring-1 ring-black/10"
              style={{ background: c }}
            >
              <input
                type="color"
                value={c}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <button
              type="button"
              aria-label="×"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-text)] text-[10px] leading-none text-[var(--color-bg)]"
            >
              ×
            </button>
          </span>
        ))}
        {value.length < 4 && (
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onChange([...value, PALETTE[(value.length * 3 + 6) % PALETTE.length]!]);
            }}
            className="rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold active:scale-95"
          >
            {k.addColor}
          </button>
        )}
      </div>
    </div>
  );
}

/** Its colour: as the ministry's, one of the palette, or any colour. */
function ColorRow({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="mb-2 text-[14px]">{t.studio.color}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill on={!value} onClick={() => onChange(null)} label={t.studio.colorAuto} />
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onChange(value === c ? null : c)}
            className={`h-8 w-8 rounded-full ring-1 ring-black/10 active:scale-90 ${
              value === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
            }`}
            style={{ background: c }}
          />
        ))}
        <label
          className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full"
          style={{
            background:
              value && !PALETTE.includes(value)
                ? value
                : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
          }}
        >
          <input
            type="color"
            value={value ?? '#6366f1'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/** The light passing over a part: strength, speed and slant. */
export function ShineTuneControls({
  tune,
  onChange,
}: {
  tune: ShineTune;
  onChange: (t: ShineTune) => void;
}) {
  const t = useT();
  const k = t.studio.knob;
  const set = (patch: Partial<ShineTune>) => onChange({ ...tune, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <Knob
        label={k.strength}
        value={tune.strength ?? 1}
        min={0.2}
        max={1}
        step={0.05}
        show={percent}
        onChange={(strength) => set({ strength })}
      />
      <Knob
        label={t.studio.speed}
        value={tune.speed ?? 1}
        min={0.25}
        max={3}
        step={0.25}
        show={times}
        onChange={(speed) => set({ speed })}
      />
      <Knob
        label={k.slant}
        value={tune.angle ?? 115}
        min={0}
        max={180}
        step={5}
        show={(v) => `${v}°`}
        onChange={(angle) => set({ angle })}
      />
    </div>
  );
}

/** A tuned panel as an expanded card under the picked animation. */
export function TunePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="animate-fade-in rounded-2xl border border-[var(--brand)]/30 bg-[color-mix(in_srgb,var(--brand)_7%,transparent)] p-3.5">
      <div className="mb-3 text-[13px] font-bold uppercase tracking-wide text-accent">{title}</div>
      {children}
    </div>
  );
}
