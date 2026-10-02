import type { CSSProperties, ReactNode } from 'react';
import type { EventSummary, PostDesign } from '@church/shared';

export const BURN_STYLES = ['flame', 'glow', 'pulse', 'orbit', 'off'] as const;
export const BURN_COLORS = ['#ff7a18', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

/** How the event's outline burns now, or null: it isn't near, is over, cancelled or switched off. */
export function burnOf(
  e: Pick<EventSummary, 'startsAt' | 'status' | 'design'>,
  now = Date.now(),
): { style: 'flame' | 'glow' | 'pulse' | 'orbit'; color: string } | null {
  const d: Partial<PostDesign> = e.design ?? {};
  const style = d.burnStyle ?? 'flame';
  if (style === 'off' || e.status === 'cancelled') return null;
  const left = Date.parse(e.startsAt) - now;
  if (left <= 0 || left >= (d.burnDays ?? 3) * 864e5) return null;
  return { style, color: d.burnColor ?? '#ff7a18' };
}

/** Wraps an event's card: its outline burns when the event is near. */
export function BurnFrame({
  e,
  radius = 16,
  className = '',
  children,
}: {
  e: Pick<EventSummary, 'startsAt' | 'status' | 'design'>;
  /** Corner radius of what it wraps, so the fire follows the shape. */
  radius?: number | string;
  className?: string;
  children: ReactNode;
}) {
  const b = burnOf(e);
  if (!b) return <div className={className}>{children}</div>;
  return (
    <div
      className={`burn burn-${b.style} ${className}`}
      style={{ '--burn': b.color, borderRadius: radius } as CSSProperties}
    >
      {children}
    </div>
  );
}
