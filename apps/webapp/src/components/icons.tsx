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
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z" />
  </>,
);
export const IconMegaphone = make(
  <>
    <path d="M4 10.5v3a1.5 1.5 0 001.5 1.5H7l9 4.5v-15L7 9H5.5A1.5 1.5 0 004 10.5z" />
    <path d="M19 9.5a3.5 3.5 0 010 5M8 15l1.2 4.5h2.3L10.5 15" />
  </>,
);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
  </>,
);
export const IconUserPlus = make(
  <>
    <circle cx="10" cy="8.5" r="3.5" />
    <path d="M3.5 19.5c.5-3.3 3-5.2 6.5-5.2 1.3 0 2.5.3 3.5.8M18.5 13v6M15.5 16h6" />
  </>,
);
export const IconImage = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M20.5 16l-5-5-8 8.5" />
  </>,
);
export const IconSend = make(<path d="M4 12l16-8-6 16-2.5-6.5L4 12zM11.5 13.5L20 4" />);
export const IconWhatsApp = make(
  <>
    <path d="M4.5 19.5l1.2-3.6A8 8 0 1112 20a8 8 0 01-3.9-1l-3.6.5z" />
    <path d="M9.2 8.6c.3-.6.6-.6.9-.6h.5c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c.6 1.2 1.6 2.2 2.8 2.8l.6-.5c.2-.1.4-.2.6-.1l1.7.7c.3.1.4.3.4.5v.5c0 .3 0 .6-.6.9-.7.4-2.2.5-4.2-1s-3.1-3.3-3-4.4c0-.5.3-.9.7-1.1z" />
  </>,
);
export const IconTelegram = make(
  <path d="M20.5 4.5L3.5 11.2l5.4 2 2 6.3 3-3.7 4.6 3.6 2-14.9zM8.9 13.2l9-6.2-6.9 7.9" />,
);
export const IconWallet = make(
  <>
    <path d="M4 7.5A2.5 2.5 0 016.5 5H18v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <path d="M16 13.5h.1" />
  </>,
);
export const IconHeart = make(
  <path d="M12 19s-7-4.4-7-9.5A3.8 3.8 0 0112 7a3.8 3.8 0 017 2.5C19 14.6 12 19 12 19z" />,
);
export const IconArrowDown = make(<path d="M12 5v14M6 13l6 6 6-6" />);
export const IconArrowUp = make(<path d="M12 19V5M6 11l6-6 6 6" />);
export const IconReceipt = make(
  <>
    <path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5z" />
    <path d="M9 8h6M9 11.5h6M9 15h3.5" />
  </>,
);
export const IconCamera = make(
  <>
    <path d="M4 8.5A1.5 1.5 0 015.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </>,
);
export const IconChart = make(<path d="M5 19V11M10 19V5M15 19v-6M20 19V9" />);
export const IconCoins = make(
  <>
    <ellipse cx="9" cy="7" rx="5" ry="2.5" />
    <path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7" />
    <path d="M10 16.2c.9.2 1.9.3 3 .3 2.8 0 5-1.1 5-2.5v-4M14 11.8c2.3-.2 4-1.2 4-2.3" />
  </>,
);
