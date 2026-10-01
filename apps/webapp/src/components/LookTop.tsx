import type { ReactNode } from 'react';
import type { PosterLook } from '@church/shared';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';

/** The ministry's look (colour, pattern, photo, text colour) as the coloured top of a card. */
export function LookTop({
  look,
  className = '',
  children,
}: {
  look: Pick<PosterLook, 'pattern' | 'logoUrl' | 'backdrop' | 'backdropUrl' | 'textColor'> | null;
  className?: string;
  children: ReactNode;
}) {
  const on = onBrandStyle(look?.textColor, !!(look?.pattern || look?.backdropUrl));
  return (
    <div
      className={`brand-gradient relative overflow-hidden ${on.className} ${className}`}
      style={on.style}
    >
      <PatternLayer pattern={look?.pattern} logoUrl={look?.logoUrl} />
      <BackdropLayer backdrop={look?.backdrop} url={look?.backdropUrl} />
      <div className="relative flex min-h-full flex-1 flex-col justify-between">{children}</div>
    </div>
  );
}
