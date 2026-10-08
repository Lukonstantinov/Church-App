import type { ReactNode } from 'react';
import { resolveBrand, type PosterLook } from '@church/shared';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';

/** The ministry's look (colour, pattern, photo, text colour) as the coloured top of a card. */
export function LookTop({
  look,
  fallbackColor,
  className = '',
  under,
  children,
}: {
  look:
    | (Pick<PosterLook, 'pattern' | 'logoUrl' | 'backdrop' | 'backdropUrl' | 'textColor'> & {
        brandColor?: string | null;
      })
    | null;
  /** Colour to use when the look has none of its own (the surrounding theme is another one). */
  fallbackColor?: string | null;
  className?: string;
  /** Drawn over the whole card under the text, past its padding (a cover photo, effects). */
  under?: ReactNode;
  children: ReactNode;
}) {
  const on = onBrandStyle(look?.textColor, !!(look?.pattern || look?.backdropUrl));
  // The card wears its own ministry's colour even where another theme is active.
  const own = look?.brandColor ?? fallbackColor;
  const brand = own ? resolveBrand(own) : null;
  const style = brand
    ? ({
        ...on.style,
        '--brand': brand.light,
        '--brand-dark': brand.dark,
        '--brand-partner': brand.partner,
      } as React.CSSProperties)
    : on.style;
  return (
    <div
      className={`brand-gradient flow relative overflow-hidden ${on.className} ${className}`}
      style={style}
    >
      <span aria-hidden="true" className="card-clip">
        <PatternLayer pattern={look?.pattern} logoUrl={look?.logoUrl} />
        <BackdropLayer backdrop={look?.backdrop} url={look?.backdropUrl} />
        {under}
      </span>
      <div className="relative flex min-h-full flex-1 flex-col justify-between">{children}</div>
    </div>
  );
}
