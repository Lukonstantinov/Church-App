import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const openSheets = new Set<symbol>();
function markSheets() {
  const html = document.documentElement;
  if (openSheets.size) html.dataset.sheet = String(openSheets.size);
  else delete html.dataset.sheet;
}

/** Bottom sheet: dims the page, slides up, closes on backdrop tap or Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The page behind stands still and drops its animation layers while a sheet is open
    // (index.css): moving things under the sheet's glass made it redo its blur every frame,
    // and with the sheet's own previews it was too much for iPhones. Kept as a set of open
    // sheets, so the page can never stay frozen after the last one closes.
    const me = Symbol('sheet');
    openSheets.add(me);
    markSheets();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      openSheets.delete(me);
      markSheets();
    };
  }, [open, onClose]);

  if (!open) return null;
  // Portal to <body>: ancestors with backdrop-filter/transform (glass cards, page animations)
  // create their own stacking context, which would trap the sheet under the tab bar.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="glass-strong relative max-h-[88dvh] w-full max-w-xl animate-sheet-in overflow-y-auto rounded-t-[28px] pb-[max(16px,env(safe-area-inset-bottom))] shadow-sheet">
        <div className="mx-auto mb-1 mt-2 h-1 w-9 rounded-full bg-hairline" />
        {title && <h2 className="px-5 pb-2 pt-2 text-[19px] font-semibold">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A tappable option inside a sheet. */
export function SheetOption({
  icon,
  label,
  hint,
  onClick,
  tone,
  selected,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
  tone?: 'destructive';
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center gap-3 px-5 py-2.5 text-left active:bg-hairline disabled:opacity-45 ${
        tone === 'destructive' ? 'text-destructive' : ''
      }`}
    >
      {icon && <span className="flex w-6 shrink-0 justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[17px]">{label}</span>
        {hint && <span className="block text-[13px] text-hint">{hint}</span>}
      </span>
      {selected && (
        <span className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold text-white">
          ✓
        </span>
      )}
    </button>
  );
}
