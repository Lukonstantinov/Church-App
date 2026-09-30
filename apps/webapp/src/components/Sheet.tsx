import { useEffect, type ReactNode } from 'react';

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
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
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
    </div>
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
