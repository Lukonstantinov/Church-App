import { useState } from 'react';
import {
  APP_BG_ANIMATIONS,
  APP_BG_SOURCES,
  APP_BG_TEXTURES,
  type AppBackground,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { AppBackdrop, backgroundColors, type BackdropLook } from './AppBackdrop';
import { Pill } from './LookControls';
import { LABEL_COLORS } from './LookEditor';
import { IconMinus, IconPlus } from './icons';
import { useToast } from './Toast';
import { Button } from './ui';

const START: AppBackground = {
  source: 'theme',
  colors: null,
  strength: 0.35,
  texture: 'pattern',
  animation: 'drift',
};

/**
 * Background of the main window or of a ministry's screens: its own look or chosen
 * colours, strength, pattern and movement — with a live preview, saved with one button.
 */
export function BackgroundEditor({
  value,
  look,
  church,
  saving,
  onSave,
}: {
  value: AppBackground | null;
  look: BackdropLook;
  /** The main window (the church) rather than a ministry. */
  church?: boolean;
  saving: boolean;
  onSave: (bg: AppBackground | null) => Promise<void>;
}) {
  const t = useT();
  const toast = useToast();
  const [bg, setBg] = useState<AppBackground>(value ?? { ...START, source: 'none' });
  const [slot, setSlot] = useState(0);
  const set = (patch: Partial<AppBackground>) => setBg((b) => ({ ...b, ...patch }));
  const colors = bg.colors?.length ? bg.colors : backgroundColors({ ...bg, source: 'theme' }, look);

  const pickSource = (source: AppBackground['source']) =>
    set(
      source === 'color'
        ? { source, colors: colors.slice(0, 2) }
        : source === 'theme' && bg.source === 'none'
          ? { ...START }
          : { source },
    );
  const pick = (c: string) => {
    const next = colors.map((x, i) => (i === slot ? c : x));
    set({ colors: next });
  };

  async function save() {
    try {
      await onSave(bg.source === 'none' ? null : bg);
      haptic.success();
      toast(t.appBg.saved);
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[13px] leading-snug text-hint">
        {church ? t.appBg.churchHint : t.appBg.groupHint}
      </p>
      {/* A small phone-like preview of the background. */}
      <div className="relative mx-auto h-48 w-full max-w-[260px] overflow-hidden rounded-2xl bg-[var(--color-bg-secondary)] ring-1 ring-hairline">
        <AppBackdrop bg={bg.source === 'none' ? null : bg} look={look} preview />
        <div className="relative flex h-full flex-col gap-2 p-3">
          <div className="h-8 w-2/3 rounded-xl bg-white/80 shadow-sm" />
          <div className="h-14 rounded-xl bg-white/85 shadow-sm" />
          <div className="h-14 rounded-xl bg-white/85 shadow-sm" />
        </div>
      </div>

      <Group title={t.appBg.source}>
        {APP_BG_SOURCES.map((s) => (
          <Pill
            key={s}
            on={bg.source === s}
            onClick={() => pickSource(s)}
            label={s === 'theme' && church ? t.appBg.themeChurch : t.appBg[s]}
          />
        ))}
      </Group>

      {bg.source !== 'none' && (
        <>
          {bg.source === 'color' && (
            <div>
              <div className="mb-2 text-[13px] text-hint">{t.appBg.colors}</div>
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="h-9 flex-1 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }}
                />
                {colors.map((c, i) => (
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
                  aria-label="add"
                  disabled={colors.length >= 3}
                  onClick={() => {
                    set({ colors: [...colors, LABEL_COLORS[(colors.length * 5) % 22]!] });
                    setSlot(colors.length);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
                >
                  <IconPlus size={16} />
                </button>
                <button
                  type="button"
                  aria-label="remove"
                  disabled={colors.length <= 1}
                  onClick={() => {
                    set({ colors: colors.filter((_, i) => i !== slot) });
                    setSlot(0);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline disabled:opacity-30"
                >
                  <IconMinus size={16} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => pick(c)}
                    className={`h-9 w-9 rounded-full transition active:scale-90 ${
                      colors[slot] === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                    }`}
                    style={{ background: c }}
                  />
                ))}
                <label
                  className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full"
                  style={{
                    background:
                      'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
                  }}
                >
                  <span className="h-4 w-4 rounded-full bg-white/90" />
                  <input
                    type="color"
                    value={colors[slot] ?? '#3b82f6'}
                    onChange={(e) => pick(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex justify-between text-[13px] text-hint">
              <span>{t.appBg.strength}</span>
              <span>{Math.round(bg.strength * 100)}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(bg.strength * 100)}
              onChange={(e) => set({ strength: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--brand)]"
            />
          </div>

          <Group title={t.appBg.texture}>
            {APP_BG_TEXTURES.map((x) => (
              <Pill
                key={x}
                on={bg.texture === x}
                onClick={() => set({ texture: x })}
                label={t.appBg.textures[x]}
              />
            ))}
          </Group>

          <Group title={t.appBg.animation}>
            {APP_BG_ANIMATIONS.map((a) => (
              <Pill
                key={a}
                on={bg.animation === a}
                onClick={() => set({ animation: a })}
                label={t.appBg.animations[a]}
              />
            ))}
          </Group>
        </>
      )}

      <Button disabled={saving} onClick={() => void save()}>
        {saving ? t.common.saving : t.common.save}
      </Button>
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
