import { useState, type ReactNode } from 'react';
import { LOCALE_NAMES, LOCALES, type Locale } from '@church/shared';
import { useI18n } from '../lib/i18n';
import { useMe, useSetLocale } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconChevronDown, IconGlobe } from './icons';
import { Sheet, SheetOption } from './Sheet';
import { IconButton } from './ui';

function initialsOf(name: string): string {
  const words = name
    .replace(/[«»"'“”„]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)
  ).toUpperCase();
}

/** Church logo, or a monogram in the brand gradient when none is uploaded. */
export function ChurchLogo({ size = 48 }: { size?: number }) {
  const me = useMe();
  const church = me.data?.church;
  const radius = Math.round(size * 0.3);
  if (church?.logoUrl) {
    return (
      <img
        src={church.logoUrl}
        alt={church.name}
        width={size}
        height={size}
        className="shrink-0 bg-white object-contain shadow-card"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="brand-gradient inline-flex shrink-0 items-center justify-center font-bold text-white shadow-cta"
      style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.36 }}
    >
      {initialsOf(church?.name ?? '✝')}
    </span>
  );
}

/**
 * Header for root screens: logo, church name, a big title (tappable when it's a
 * group picker) and the language button — so the language is always one tap away.
 */
export function BrandHeader({
  title,
  subtitle,
  onTitleClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onTitleClick?: () => void;
}) {
  const me = useMe();
  return (
    <header className="flex items-center gap-3 pt-1">
      <ChurchLogo />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold uppercase tracking-wider text-accent">
          {me.data?.church.name}
        </div>
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            aria-haspopup="dialog"
            className="-ml-0.5 flex max-w-full items-center gap-1 rounded-lg text-left active:opacity-70"
          >
            <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
            <IconChevronDown size={20} className="mt-0.5 shrink-0 text-hint" />
          </button>
        ) : (
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
        )}
        {subtitle && <div className="truncate text-[14px] text-hint">{subtitle}</div>}
      </div>
      <LanguageButton />
    </header>
  );
}

export function LanguageButton() {
  const [open, setOpen] = useState(false);
  const { t, locale } = useI18n();
  return (
    <>
      <IconButton label={t.language.title} onClick={() => setOpen(true)}>
        <IconGlobe size={18} />
        <span className="uppercase">{locale}</span>
      </IconButton>
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const setLocale = useSetLocale();
  const pick = (l: Locale) => {
    haptic.tap();
    if (l !== locale) setLocale.mutate(l);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t.language.title}>
      {LOCALES.map((l) => (
        <SheetOption
          key={l}
          icon={<span className="text-[13px] font-bold uppercase text-hint">{l}</span>}
          label={LOCALE_NAMES[l]}
          selected={l === locale}
          onClick={() => pick(l)}
        />
      ))}
      <p className="px-5 pb-2 pt-1 text-[13px] leading-snug text-hint">{t.language.hint}</p>
    </Sheet>
  );
}
