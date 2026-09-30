import { useRef, useState, type ReactNode } from 'react';
import {
  BACKDROP_SPLITS,
  DEFAULT_BACKDROP,
  DEFAULT_PATTERN,
  ENTER_ANIMATIONS,
  PATTERN_ALTERNATES,
  PATTERN_KEYS,
  PATTERN_LAYOUTS,
  patternBackground,
  type BackdropConfig,
  type EnterAnimation,
  type GroupSummary,
  type PatternConfig,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useSaveTemplate, useTemplates, useUploadMedia } from '../lib/queries';
import { useToast } from './Toast';
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

export interface Look {
  pattern: PatternConfig | null;
  textColor: string;
  animation: EnterAnimation;
  badgeColor: string | null;
  brandColor?: string | null;
  backdrop: BackdropConfig | null;
}

const BADGE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#6366f1', '#d946ef', '#111418'];

/**
 * The ministry's look, previewed live on its card: the repeated icon (emoji, logo or
 * shape) with layout, size, spacing, tilt, icon rotation, alternation, opacity and a
 * darken/lighten veil; the text colour; and the opening animation.
 */
export function PatternDesigner({
  env,
  fallbackTheme,
  onSave,
  saving,
}: {
  env: GroupSummary;
  fallbackTheme: string;
  onSave: (look: Look) => void;
  saving: boolean;
}) {
  const t = useT();
  const [pattern, setPattern] = useState<PatternConfig | null>(env.pattern);
  const [textColor, setTextColor] = useState(env.textColor);
  const [animation, setAnimation] = useState<EnterAnimation>(env.animation);
  const [badgeColor, setBadgeColor] = useState<string | null>(env.badgeColor);
  const [brandColor, setBrandColor] = useState<string | null>(env.brandColor);
  const [backdrop, setBackdrop] = useState<BackdropConfig | null>(env.backdrop);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(env.backdropUrl);
  const upload = useUploadMedia(env.id, 'event');
  const photoInput = useRef<HTMLInputElement>(null);
  const [templateName, setTemplateName] = useState('');
  const templates = useTemplates();
  const saveTemplate = useSaveTemplate();
  const toast = useToast();
  const [customEmoji, setCustomEmoji] = useState('');
  const [replay, setReplay] = useState(0);
  const current: PatternConfig = { ...DEFAULT_PATTERN, ...(pattern ?? {}) };
  const set = (patch: Partial<PatternConfig>) => setPattern({ ...current, ...patch });
  const pickIcon = (kind: PatternConfig['kind'], value: string) => {
    haptic.tap();
    setPattern({ ...current, kind, value });
  };
  const isOn = (kind: PatternConfig['kind'], value: string) =>
    pattern !== null && pattern.kind === kind && pattern.value === value;
  const changed =
    JSON.stringify(pattern) !== JSON.stringify(env.pattern) ||
    textColor !== env.textColor ||
    animation !== env.animation ||
    badgeColor !== env.badgeColor ||
    brandColor !== env.brandColor ||
    JSON.stringify(backdrop) !== JSON.stringify(env.backdrop);
  const setB = (patch: Partial<BackdropConfig>) => setBackdrop((b) => (b ? { ...b, ...patch } : b));
  async function pickPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const m = await upload.mutateAsync(await preparePhoto(file, 1400));
      setBackdrop((b) => ({ ...DEFAULT_BACKDROP, ...(b ?? {}), mediaId: m.id }));
      setBackdropUrl(m.url);
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (photoInput.current) photoInput.current.value = '';
    }
  }
  const customText = textColor.startsWith('#') ? textColor : null;

  const chip = (on: boolean, onClick: () => void, children: ReactNode, label: string) => (
    <button
      key={label}
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
  const pill = (on: boolean, onClick: () => void, label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={`min-h-[36px] rounded-full px-3.5 text-[14px] font-semibold transition active:scale-95 ${
        on ? 'brand-gradient text-white shadow-cta' : 'bg-hairline'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Stays on screen while scrolling through the settings below. */}
      <div className="glass-strong sticky top-0 z-10 -mx-4 -mt-4 rounded-b-[26px] px-4 pb-3 pt-4">
        <div className="mx-auto w-1/2 min-w-[170px]">
          <div key={replay} className={`env-anim-${animation}`}>
            <EnvCard
              g={{
                ...env,
                pattern,
                textColor,
                animation,
                badgeColor,
                brandColor,
                backdrop,
                backdropUrl,
                unreadPosts: env.unreadPosts || 3,
                unreadComments: env.unreadComments || 1,
              }}
              fallbackTheme={fallbackTheme}
              onClick={() => setReplay((r) => r + 1)}
            />
          </div>
        </div>
      </div>

      {(templates.data ?? []).length > 0 && (
        <Group title={t.feed.templates}>
          <div className="flex flex-wrap gap-2">
            {templates.data!.map((tpl) =>
              pill(
                false,
                () => {
                  setPattern(tpl.pattern);
                  setTextColor(tpl.textColor);
                  setBrandColor(tpl.brandColor);
                  if (tpl.backdrop) {
                    setBackdrop(tpl.backdrop);
                    setBackdropUrl(tpl.backdropUrl);
                  }
                },
                tpl.name,
              ),
            )}
          </div>
        </Group>
      )}

      <Group title={t.env.photo}>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void pickPhoto(e.target.files)}
        />
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => photoInput.current?.click()}>
            {upload.isPending
              ? t.common.saving
              : backdrop
                ? t.env.photoChange
                : `＋ ${t.env.photoAdd}`}
          </SmallButton>
          {backdrop && (
            <SmallButton onClick={() => setBackdrop(null)}>{t.env.photoRemove}</SmallButton>
          )}
        </div>
        {!backdrop && <p className="mt-2 text-[13px] text-hint">{t.env.photoHint}</p>}
        {backdrop && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {BACKDROP_SPLITS.map((sp) =>
                pill(backdrop.split === sp, () => setB({ split: sp }), t.env.splits[sp]),
              )}
            </div>
            {backdrop.split !== 'full' && (
              <>
                <Slider
                  label={t.env.photoShare}
                  value={Math.round(backdrop.amount * 100)}
                  min={20}
                  max={80}
                  suffix="%"
                  onChange={(v) => setB({ amount: v / 100 })}
                />
                <Slider
                  label={t.env.photoSoft}
                  value={Math.round(backdrop.soft * 100)}
                  min={0}
                  max={40}
                  suffix="%"
                  onChange={(v) => setB({ soft: v / 100 })}
                />
              </>
            )}
            <Slider
              label={t.env.photoZoom}
              value={Math.round(backdrop.zoom * 100)}
              min={100}
              max={300}
              suffix="%"
              onChange={(v) => setB({ zoom: v / 100 })}
            />
            <Slider
              label={t.env.photoX}
              value={backdrop.focusX}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => setB({ focusX: v })}
            />
            <Slider
              label={t.env.photoY}
              value={backdrop.focusY}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => setB({ focusY: v })}
            />
            <Slider
              label={t.env.shade}
              value={Math.round(backdrop.dim * 100)}
              min={-80}
              max={70}
              suffix="%"
              onChange={(v) => setB({ dim: v / 100 })}
              extra={<SmallButton onClick={() => setB({ dim: 0 })}>{t.env.reset}</SmallButton>}
            />
          </div>
        )}
      </Group>

      <Group title={t.env.patternIcon}>
        <div className="flex flex-wrap gap-2">
          {chip(
            pattern === null,
            () => setPattern(null),
            <span className="text-[15px] text-hint">∅</span>,
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
              if (v) setPattern({ ...current, kind: 'emoji', value: v });
            }}
            className="min-w-0 flex-1 bg-transparent text-[22px] outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
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
                className="block h-7 w-7 rounded-md"
                style={{
                  backgroundImage: `${bg?.image}, linear-gradient(135deg, var(--brand), var(--brand-partner))`,
                  backgroundSize: `${bg?.size}, cover`,
                }}
              />,
              k,
            );
          })}
        </div>
      </Group>

      {pattern && (
        <>
          <Group title={t.env.layout}>
            <div className="flex flex-wrap gap-2">
              {PATTERN_LAYOUTS.map((l) =>
                pill((current.layout ?? 'grid') === l, () => set({ layout: l }), t.env.layouts[l]),
              )}
            </div>
          </Group>

          <div className="flex flex-col gap-3">
            <Slider
              label={t.env.density}
              value={current.size}
              min={16}
              max={160}
              suffix="px"
              onChange={(v) => set({ size: v })}
            />
            <Slider
              label={t.env.spacing}
              value={Math.round((current.scale ?? 0.6) * 100)}
              min={20}
              max={120}
              suffix="%"
              onChange={(v) => set({ scale: v / 100 })}
            />
            <Slider
              label={t.env.opacity}
              value={Math.round(current.opacity * 100)}
              min={3}
              max={100}
              suffix="%"
              onChange={(v) => set({ opacity: v / 100 })}
            />
            <Slider
              label={t.env.tilt}
              value={current.angle}
              min={-90}
              max={90}
              suffix="°"
              onChange={(v) => set({ angle: v })}
              extra={<SmallButton onClick={() => set({ angle: 0 })}>{t.env.straight}</SmallButton>}
            />
            <Slider
              label={t.env.iconRotation}
              value={current.iconAngle ?? 0}
              min={-180}
              max={180}
              suffix="°"
              onChange={(v) => set({ iconAngle: v })}
              extra={<SmallButton onClick={() => set({ iconAngle: 0 })}>{t.env.reset}</SmallButton>}
            />
            <Slider
              label={t.env.shade}
              value={Math.round((current.shade ?? 0) * 100)}
              min={-70}
              max={70}
              suffix="%"
              onChange={(v) => set({ shade: v / 100 })}
              extra={<SmallButton onClick={() => set({ shade: 0 })}>{t.env.reset}</SmallButton>}
            />
          </div>

          <Group title={t.env.alternate}>
            <div className="flex flex-wrap gap-2">
              {PATTERN_ALTERNATES.map((a) =>
                pill(
                  (current.alternate ?? 'none') === a,
                  () => set({ alternate: a }),
                  t.env.alternates[a],
                ),
              )}
            </div>
          </Group>
        </>
      )}

      <Group title={t.env.textColor}>
        <div className="flex flex-wrap items-center gap-2">
          {pill(textColor === 'auto', () => setTextColor('auto'), t.env.textColors.auto)}
          {pill(textColor === 'light', () => setTextColor('light'), t.env.textColors.light)}
          {pill(textColor === 'dark', () => setTextColor('dark'), t.env.textColors.dark)}
          <label
            className={`relative flex min-h-[36px] cursor-pointer items-center gap-2 rounded-full px-3.5 text-[14px] font-semibold ${
              customText ? 'ring-2 ring-[var(--brand)]' : 'bg-hairline'
            }`}
          >
            <span
              className="h-4 w-4 rounded-full border border-hint/40"
              style={{
                background:
                  customText ??
                  'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
              }}
            />
            {t.env.textColors.custom}
            <input
              type="color"
              value={customText ?? '#ffffff'}
              onChange={(e) => setTextColor(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        <p className="mt-2 text-[13px] text-hint">{t.env.textColorHint}</p>
      </Group>

      <Group title={t.feed.badgeColor}>
        <div className="flex flex-wrap items-center gap-2">
          {pill(badgeColor === null, () => setBadgeColor(null), t.feed.badgeAuto)}
          {BADGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setBadgeColor(c)}
              className={`h-8 w-8 rounded-full ${badgeColor === c ? 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--color-section)]' : ''}`}
              style={{ background: c }}
            />
          ))}
          <label
            className={`relative h-8 w-8 cursor-pointer overflow-hidden rounded-full ${badgeColor && !BADGE_COLORS.includes(badgeColor) ? 'ring-2 ring-[var(--brand)]' : ''}`}
            style={{
              background:
                badgeColor && !BADGE_COLORS.includes(badgeColor)
                  ? badgeColor
                  : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
            }}
          >
            <input
              type="color"
              value={badgeColor ?? '#6366f1'}
              onChange={(e) => setBadgeColor(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </Group>

      <Group title={t.env.animation}>
        <div className="flex flex-wrap gap-2">
          {ENTER_ANIMATIONS.map((a) =>
            pill(
              animation === a,
              () => {
                setAnimation(a);
                setReplay((r) => r + 1);
              },
              t.env.animations[a],
            ),
          )}
        </div>
        <div className="mt-2">
          <SmallButton onClick={() => setReplay((r) => r + 1)}>▶ {t.env.play}</SmallButton>
        </div>
      </Group>

      <Button
        disabled={!changed || saving}
        onClick={() => onSave({ pattern, textColor, animation, badgeColor, brandColor, backdrop })}
      >
        {saving ? t.common.saving : t.common.save}
      </Button>

      <Group title={t.feed.saveTemplate}>
        <div className="flex gap-2">
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t.feed.templateName}
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
          />
          <Button
            small
            variant="secondary"
            disabled={!templateName.trim() || saveTemplate.isPending}
            onClick={async () => {
              try {
                await saveTemplate.mutateAsync({
                  name: templateName.trim(),
                  brandColor,
                  pattern,
                  textColor,
                  logoMediaId: env.logoMediaId,
                  backdrop,
                });
                setTemplateName('');
                toast(t.feed.templateSaved);
              } catch {
                toast(t.common.saveFailed, 'error');
              }
            }}
          >
            {t.common.save}
          </Button>
        </div>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
        {title}
      </div>
      {children}
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-hairline px-2.5 py-1 text-[13px] font-semibold active:scale-95"
    >
      {children}
    </button>
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
  extra?: ReactNode;
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
