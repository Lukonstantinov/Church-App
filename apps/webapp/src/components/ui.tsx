import type { ReactNode } from 'react';
import { ru } from '@church/shared';

export function Screen({ children, tabs }: { children: ReactNode; tabs?: boolean }) {
  return (
    <main
      className={`mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 pt-5 ${tabs ? 'pb-28' : 'pb-8'}`}
    >
      {children}
    </main>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="px-1 pt-1">
      <h1 className="text-[26px] font-bold leading-tight">{children}</h1>
      {subtitle && <div className="mt-1 text-[15px] text-hint">{subtitle}</div>}
    </header>
  );
}

export function Section({
  title,
  footer,
  children,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {title && (
        <h2 className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-section-header">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-xl bg-section">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] text-hint">{footer}</p>}
    </section>
  );
}

interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
  onClick?: () => void;
}

export function Row({ title, subtitle, after, onClick }: RowProps) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px]">{title}</div>
        {subtitle && <div className="truncate text-[14px] text-hint">{subtitle}</div>}
      </div>
      {after && <div className="shrink-0 text-[15px] text-hint">{after}</div>}
      {onClick && <span className="shrink-0 text-[18px] text-hint">›</span>}
    </>
  );
  const cls =
    'flex w-full items-center gap-3 border-b border-bg-secondary px-4 py-3 text-left last:border-b-0';
  return onClick ? (
    <button type="button" className={`${cls} active:bg-bg-secondary`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** A full-width tappable row styled as an action (blue or red text). */
export function ActionRow({
  children,
  onClick,
  destructive,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full border-b border-bg-secondary px-4 py-3 text-left text-[17px] last:border-b-0 active:bg-bg-secondary disabled:opacity-50 ${
        destructive ? 'text-destructive' : 'text-link'
      }`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'accent',
}: {
  children: ReactNode;
  tone?: 'accent' | 'hint' | 'danger';
}) {
  const tones = {
    accent: 'bg-button/15 text-accent',
    hint: 'bg-hint/15 text-hint',
    danger: 'bg-destructive/15 text-destructive',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${tones[tone]}`}
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
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  type?: 'button' | 'submit';
  small?: boolean;
}) {
  const variants = {
    primary: 'bg-button text-button-text',
    secondary: 'bg-button/15 text-accent',
    destructive: 'bg-destructive/15 text-destructive',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${small ? 'rounded-lg px-3 py-1.5 text-[14px]' : 'w-full rounded-xl px-4 py-3 text-[17px]'} font-medium active:opacity-80 disabled:opacity-50 ${variants[variant]}`}
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
    <label className="block border-b border-bg-secondary px-4 py-2.5 last:border-b-0">
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
    <label className="flex items-center gap-3 border-b border-bg-secondary px-4 py-3 last:border-b-0">
      <span className="flex-1 text-[17px]">{label}</span>
      <input
        type="checkbox"
        className="h-5 w-5 accent-[var(--color-button)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
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
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </Screen>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <CenterMessage>
      <p>{ru.app.errorGeneric}</p>
      {onRetry && (
        <div className="w-48">
          <Button onClick={onRetry}>{ru.app.retry}</Button>
        </div>
      )}
    </CenterMessage>
  );
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-[15px] text-hint">{children}</p>;
}

// ---------- richer building blocks ----------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-xl bg-hairline ${className}`} />;
}

/** White rounded surface with an optional heading row. */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const base = `rounded-2xl bg-section shadow-card ${className}`;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${base} block w-full text-left active:opacity-80`}
    >
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
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
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-button/10 text-accent">
          {icon}
        </div>
      )}
      <div className="text-[17px] font-semibold">{title}</div>
      {children && <p className="max-w-xs text-[14px] leading-snug text-hint">{children}</p>}
      {action && <div className="mt-2 w-full max-w-[240px]">{action}</div>}
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
    <div className="flex rounded-xl bg-hairline p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={`min-h-[34px] flex-1 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${
            o.key === value ? 'bg-section text-text shadow-card' : 'text-hint'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Toggle-able filter pill (weekday picker, duration…). */
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
      className={`min-h-[40px] min-w-[44px] rounded-full px-3.5 text-[15px] font-medium active:opacity-80 ${
        selected ? 'bg-button text-button-text' : 'bg-hairline text-text'
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
}: {
  day: string;
  month: string;
  weekday?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex h-[52px] w-[48px] shrink-0 flex-col items-center justify-center rounded-xl ${
        muted ? 'bg-hairline text-hint' : 'bg-button/12 text-accent'
      }`}
    >
      <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">
        {weekday ?? month}
      </span>
      <span className="text-[20px] font-bold leading-tight tabular-nums">{day}</span>
      {weekday && <span className="text-[10px] leading-none opacity-80">{month}</span>}
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
        className={`h-full rounded-full transition-[width] duration-300 ${tone === 'present' ? 'bg-present' : 'bg-button'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Circular percentage gauge. */
export function Ring({
  percent,
  size = 76,
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
      aria-label={label ?? `${percent ?? 0}%`}
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
            style={{ transition: 'stroke-dashoffset 500ms ease' }}
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

/** Number tile for the overview: label, value, optional hint underneath. */
export function StatTile({
  label,
  value,
  hint,
  badge,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} className="flex-1 p-4">
      <div className="flex items-center justify-between text-[13px] text-hint">
        {label}
        {badge}
      </div>
      <div className="mt-1 text-[30px] font-bold leading-none tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-[13px] text-hint">{hint}</div>}
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
  const [h = '19', m = '00'] = value.split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort();
  const sel = 'min-h-[40px] rounded-lg bg-hairline px-3 text-[18px] tabular-nums outline-none';
  return (
    <div className="border-b border-bg-secondary px-4 py-2.5 last:border-b-0">
      <span className="block text-[13px] text-hint">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <select
          className={sel}
          value={h}
          aria-label="Часы"
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
          aria-label="Минуты"
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
