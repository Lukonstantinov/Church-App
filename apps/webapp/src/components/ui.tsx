import type { ReactNode } from 'react';
import { resolveBrand, type PosterLook } from '@church/shared';
import { useEnv } from '../lib/env';
import { useT } from '../lib/i18n';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';

/** Page container. `tabs` leaves room for the floating tab bar. */
export function Screen({ children, tabs }: { children: ReactNode; tabs?: boolean }) {
  return (
    <main
      className={`mx-auto flex min-h-dvh max-w-xl animate-rise flex-col gap-5 px-4 pt-4 ${tabs ? 'pb-32' : 'pb-10'}`}
    >
      {children}
    </main>
  );
}

/** Title for detail screens (root screens use BrandHeader). */
export function Title({
  children,
  subtitle,
  action,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3 px-1 pt-2">
      <div className="min-w-0 flex-1">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{children}</h1>
        {subtitle && <div className="mt-1 text-[15px] text-hint">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

/** Glass list group with an optional small heading and footnote. */
export function Section({
  title,
  footer,
  children,
  action,
  sticky,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /** Clip with overflow: clip, which (unlike hidden) lets a sticky child stay stuck. */
  sticky?: boolean;
}) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between px-3">
          {title && (
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      <div
        className={`glass rounded-[var(--radius-card)] shadow-card ${sticky ? 'overflow-clip' : 'overflow-hidden'}`}
      >
        {children}
      </div>
      {footer && <p className="mt-2 px-3 text-[13px] leading-snug text-hint">{footer}</p>}
    </section>
  );
}

interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
  before?: ReactNode;
  onClick?: () => void;
}

export function Row({ title, subtitle, after, before, onClick }: RowProps) {
  const content = (
    <>
      {before}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px]">{title}</div>
        {subtitle && <div className="truncate text-[14px] text-hint">{subtitle}</div>}
      </div>
      {after && <div className="shrink-0 text-[15px] text-hint">{after}</div>}
      {onClick && <Chevron />}
    </>
  );
  const cls =
    'flex min-h-[56px] w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left last:border-b-0';
  return onClick ? (
    <button type="button" className={`${cls} active:bg-hairline`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

export function Chevron() {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      className="shrink-0 text-hint/70"
      aria-hidden="true"
    >
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A full-width tappable row styled as an action (brand or red text). */
export function ActionRow({
  children,
  onClick,
  destructive,
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center gap-2.5 border-b border-hairline px-4 py-3 text-left text-[17px] last:border-b-0 active:bg-hairline disabled:opacity-50 ${
        destructive ? 'text-destructive' : 'text-accent'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

type Tone = 'accent' | 'hint' | 'danger' | 'success';

export function Badge({ children, tone = 'accent' }: { children: ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    accent: 'bg-brand/15 text-accent',
    hint: 'bg-hairline text-hint',
    danger: 'bg-absent/15 text-absent',
    success: 'bg-present/15 text-present',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  small,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'glass' | 'white';
  disabled?: boolean;
  type?: 'button' | 'submit';
  small?: boolean;
}) {
  const variants = {
    primary: 'brand-gradient text-white shadow-cta',
    secondary: 'bg-brand/12 text-accent',
    destructive: 'bg-absent/12 text-absent',
    glass: 'glass text-text',
    white: 'bg-white text-[var(--brand)] shadow-float',
  };
  const size = small
    ? 'min-h-[38px] rounded-xl px-3.5 text-[14px]'
    : 'min-h-[50px] w-full rounded-2xl px-4 text-[17px]';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition active:scale-[0.98] active:opacity-90 disabled:opacity-45 ${size} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

/** Round glass icon button for headers. */
export function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="glass inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2.5 text-[13px] font-semibold shadow-card active:scale-95"
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  autoFocus,
  maxLength = 64,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  maxLength?: number;
  type?: 'text' | 'date';
}) {
  return (
    <label className="block border-b border-hairline px-4 py-2.5 last:border-b-0">
      <span className="block text-[13px] text-hint">{label}</span>
      <input
        type={type}
        className="mt-0.5 min-h-[28px] w-full bg-transparent text-[17px] outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        maxLength={maxLength}
      />
    </label>
  );
}

/** iOS-style switch. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 disabled:opacity-50"
    >
      <span className="flex-1 text-[17px]">{label}</span>
      <Switch on={checked} />
    </button>
  );
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${
        on ? 'bg-brand' : 'bg-hairline'
      }`}
    >
      <span
        className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[23px]' : 'translate-x-[3px]'
        }`}
      />
    </span>
  );
}

export function CenterMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center text-hint">
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <Screen>
      <div className="flex items-center gap-3 pt-2">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-40 w-full" />
      <div className="flex gap-3">
        <Skeleton className="h-28 flex-1" />
        <Skeleton className="h-28 flex-1" />
      </div>
    </Screen>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <CenterMessage>
      <p>{t.common.errorGeneric}</p>
      {onRetry && (
        <div className="w-48">
          <Button onClick={onRetry}>{t.common.retry}</Button>
        </div>
      )}
    </CenterMessage>
  );
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-[15px] text-hint">{children}</p>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`glass animate-shimmer rounded-[var(--radius-card)] ${className}`} />;
}

/** Glass card. */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const base = `glass rounded-[var(--radius-card)] shadow-card ${className}`;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${base} block w-full text-left transition active:scale-[0.99]`}
    >
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
}

/** Solid brand-gradient card for the one most important thing on a screen. */
export function HeroCard({
  children,
  className = '',
  living,
  live,
  look,
}: {
  children: ReactNode;
  className?: string;
  /** A look of its own (a meeting's poster look) instead of the ministry's. */
  look?: PosterLook | null;
  /**
   * A living wallpaper: drifting colour, moving texture and twinkling light — fully
   * ("lively"), gently ("calm") or not at all. `true` = lively.
   */
  living?: boolean | 'off' | 'calm' | 'lively';
  /** Something is on right now: the living wallpaper turns warm and quickens. */
  live?: boolean;
}) {
  // Inside a ministry, its pattern decorates the hero blocks too.
  const { env } = useEnv();
  const src = look ?? env;
  const on = onBrandStyle(src?.textColor, !!src?.pattern || !!src?.backdropUrl);
  const brand = look?.brandColor ? resolveBrand(look.brandColor) : null;
  return (
    <div
      className={`brand-gradient flow sheen relative overflow-hidden rounded-[var(--radius-card)] p-5 shadow-cta ${on.className} ${className}`}
      style={
        brand
          ? ({
              ...on.style,
              '--brand': brand.light,
              '--brand-dark': brand.dark,
              '--brand-partner': brand.partner,
            } as React.CSSProperties)
          : on.style
      }
    >
      <PatternLayer pattern={src?.pattern} logoUrl={src?.logoUrl} />
      <BackdropLayer backdrop={src?.backdrop} url={src?.backdropUrl} />
      {living && living !== 'off' && (
        <span
          aria-hidden="true"
          className="living-bg"
          data-live={live ? 'true' : 'false'}
          data-level={living === 'calm' ? 'calm' : 'lively'}
        >
          <i className="living-blob b1" />
          <i className="living-blob b2" />
          <i className="living-blob b3" />
          <i className="living-rays" />
          <i className="living-dots" />
          <i className="living-dots far" />
        </span>
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/15 blur-2xl"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {icon && (
        <div className="brand-gradient mb-1 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-cta">
          {icon}
        </div>
      )}
      <div className="text-[17px] font-semibold">{title}</div>
      {children && <p className="max-w-xs text-[14px] leading-snug text-hint">{children}</p>}
      {action && <div className="mt-2 w-full max-w-[260px]">{action}</div>}
    </div>
  );
}

/** Pill-shaped switch between a few views. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="glass flex rounded-2xl p-1 shadow-card" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={`min-h-[36px] flex-1 rounded-xl px-3 text-[14px] font-semibold transition-colors ${
            o.key === value ? 'brand-gradient text-white shadow-cta' : 'text-hint'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Toggle-able choice pill (duration…). */
export function Pill({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-[42px] min-w-[48px] rounded-full px-4 text-[15px] font-semibold transition active:scale-95 ${
        selected ? 'brand-gradient text-white shadow-cta' : 'glass'
      }`}
    >
      {children}
    </button>
  );
}

/** Calendar-style date tile. */
export function DateBadge({
  day,
  month,
  weekday,
  muted,
  onBrand,
}: {
  day: string;
  month: string;
  weekday?: string;
  muted?: boolean;
  onBrand?: boolean;
}) {
  const tone = onBrand
    ? 'bg-white/20 text-white'
    : muted
      ? 'bg-hairline text-hint'
      : 'bg-brand/12 text-accent';
  return (
    <div
      className={`flex h-[56px] w-[52px] shrink-0 flex-col items-center justify-center rounded-2xl ${tone}`}
    >
      <span className="text-[10px] font-bold uppercase leading-none tracking-wide">
        {weekday ?? month}
      </span>
      <span className="text-[21px] font-bold leading-tight tabular-nums">{day}</span>
      {weekday && <span className="text-[10px] leading-none opacity-85">{month}</span>}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  tone = 'present',
}: {
  value: number;
  max: number;
  tone?: 'present' | 'accent';
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-hairline"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${tone === 'present' ? 'bg-present' : 'brand-gradient'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Circular percentage gauge. */
export function Ring({
  percent,
  size = 80,
  label,
}: {
  percent: number | null;
  size?: number;
  label?: string;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = percent ?? 0;
  const tone =
    p >= 75 ? 'var(--color-present)' : p >= 50 ? 'var(--color-late)' : 'var(--color-absent)';
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${p}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={stroke}
        />
        {percent !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p / 100)}
            style={{ transition: 'stroke-dashoffset 600ms ease' }}
          />
        )}
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-bold tabular-nums"
        style={{ fontSize: Math.round(size * 0.24) }}
      >
        {percent === null ? '—' : `${percent}%`}
      </div>
    </div>
  );
}

/** Number tile: small icon chip, label, big value, hint. */
export function StatTile({
  label,
  value,
  hint,
  badge,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} className="flex-1 p-4">
      <div className="flex items-center justify-between">
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-accent">
            {icon}
          </span>
        ) : (
          <span />
        )}
        {badge}
      </div>
      <div className="mt-3 text-[30px] font-bold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-text/80">{label}</div>
      {hint && <div className="text-[12px] text-hint">{hint}</div>}
    </Card>
  );
}

/** 24-hour time picker (native time inputs follow the phone's 12/24h setting). */
export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const [h = '19', m = '00'] = value.split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort();
  const sel =
    'min-h-[42px] rounded-xl bg-hairline px-3 text-[18px] font-semibold tabular-nums outline-none';
  return (
    <div className="border-b border-hairline px-4 py-2.5 last:border-b-0">
      <span className="block text-[13px] text-hint">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <select
          className={sel}
          value={h}
          aria-label={t.meetingForm.hours}
          onChange={(e) => onChange(`${e.target.value}:${m}`)}
        >
          {hours.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <span className="text-[18px] font-semibold">:</span>
        <select
          className={sel}
          value={m}
          aria-label={t.meetingForm.minutes}
          onChange={(e) => onChange(`${h}:${e.target.value}`)}
        >
          {minutes.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Multi-line text input inside a Section. */
export function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      className="block w-full resize-none bg-transparent px-4 py-3 text-[17px] leading-snug outline-none placeholder:text-hint"
    />
  );
}
