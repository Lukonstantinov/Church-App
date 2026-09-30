import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 22, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 7.6v.1" />
  </>,
);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconChevronRight = make(<path d="M9.5 6l6 6-6 6" />);
export const IconChevronDown = make(<path d="M6 9.5l6 6 6-6" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconMinus = make(<path d="M5 12h14" />);
export const IconMore = make(
  <>
    <circle cx="6" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="18" cy="12" r="1" fill="currentColor" />
  </>,
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </>,
);
export const IconHome = make(
  <>
    <path d="M4 11l8-6.5 8 6.5" />
    <path d="M6 10v9h12v-9" />
  </>,
);
export const IconCalendar = make(
  <>
    <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </>,
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="9" r="3.2" />
    <path d="M3.5 19c.4-3 2.6-4.8 5.5-4.8s5.1 1.8 5.5 4.8" />
    <path d="M16 6.3a3 3 0 010 5.6M17.5 14.6c1.7.6 2.8 2 3 4.4" />
  </>,
);
export const IconMenu = make(<path d="M5 7h14M5 12h14M5 17h14" />);
export const IconRepeat = make(
  <>
    <path d="M4 11V9.5A3.5 3.5 0 017.5 6H19l-2.5-2.5M20 13v1.5a3.5 3.5 0 01-3.5 3.5H5l2.5 2.5" />
  </>,
);
export const IconBell = make(
  <>
    <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15l1.5-2z" />
    <path d="M10 20.5a2 2 0 004 0" />
  </>,
);
export const IconTrash = make(
  <>
    <path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7" />
  </>,
);
export const IconEdit = make(<path d="M5 19l1-4L16.5 4.5a2 2 0 013 3L9 18l-4 1z" />);
export const IconSwap = make(
  <path d="M7 4L3.5 7.5 7 11M3.5 7.5H16M17 13l3.5 3.5L17 20M20.5 16.5H8" />,
);
