import type { ReactNode } from 'react';
import { ru } from '@church/shared';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 py-5">{children}</main>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block border-b border-bg-secondary px-4 py-2.5 last:border-b-0">
      <span className="block text-[13px] text-hint">{label}</span>
      <input
        className="mt-0.5 w-full bg-transparent text-[17px] outline-none"
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
  return <CenterMessage>{ru.app.loading}</CenterMessage>;
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
