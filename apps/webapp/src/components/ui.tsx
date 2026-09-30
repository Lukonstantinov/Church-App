import type { ReactNode } from 'react';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-5">{children}</main>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && (
        <h2 className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-section-header">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-xl bg-section">{children}</div>
    </section>
  );
}

export function Row({
  title,
  subtitle,
  after,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-bg-secondary px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px]">{title}</div>
        {subtitle && <div className="truncate text-[14px] text-hint">{subtitle}</div>}
      </div>
      {after && <div className="shrink-0 text-[15px] text-hint">{after}</div>}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-button/15 px-2 py-0.5 text-[12px] font-medium text-accent">
      {children}
    </span>
  );
}

export function Button({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl bg-button px-4 py-3 text-[17px] font-medium text-button-text active:opacity-80"
    >
      {children}
    </button>
  );
}

export function CenterMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center text-hint">
      {children}
    </div>
  );
}
