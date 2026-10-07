import { useState } from 'react';
import {
  type BackdropConfig,
  type EnterAnimation,
  type GroupSummary,
  type PatternConfig,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { useSaveTemplate, useTemplates } from '../lib/queries';
import { useToast } from './Toast';
import { haptic } from '../lib/telegram';
import { EnvCard } from '../screens/Hub';
import { Button } from './ui';
import { Group, LookControls } from './LookControls';

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
  // The entrance animation is set in the Design tab; kept as it is when saving the look.
  const animation: EnterAnimation = env.animation;
  const [badgeColor, setBadgeColor] = useState<string | null>(env.badgeColor);
  const [brandColor, setBrandColor] = useState<string | null>(env.brandColor);
  const [backdrop, setBackdrop] = useState<BackdropConfig | null>(env.backdrop);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(env.backdropUrl);
  const [templateName, setTemplateName] = useState('');
  const templates = useTemplates();
  const saveTemplate = useSaveTemplate();
  const toast = useToast();
  const [replay, setReplay] = useState(0);
  const changed =
    JSON.stringify(pattern) !== JSON.stringify(env.pattern) ||
    textColor !== env.textColor ||
    animation !== env.animation ||
    badgeColor !== env.badgeColor ||
    brandColor !== env.brandColor ||
    JSON.stringify(backdrop) !== JSON.stringify(env.backdrop);

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

      <LookControls
        value={{ pattern, textColor, backdrop, backdropUrl }}
        onChange={(v) => {
          setPattern(v.pattern);
          setTextColor(v.textColor);
          setBackdrop(v.backdrop);
          setBackdropUrl(v.backdropUrl);
        }}
        groupId={env.id}
        logoUrl={env.logoUrl}
      />

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
