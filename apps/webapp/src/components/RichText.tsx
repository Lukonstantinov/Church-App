import { Fragment, type CSSProperties } from 'react';
import { openTelegramLink } from '../lib/telegram';

// http(s) links, bare www. addresses and t.me links; trailing punctuation stays text.
const LINK =
  /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"»]|www\.[^\s<]+[^\s<.,;:!?)\]'"»]|t\.me\/[A-Za-z0-9_+/-]+)/g;

function href(raw: string) {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Text with working links (they open in the browser, or in Telegram for t.me). */
export function RichText({
  text,
  className,
  style,
  linkClassName = 'font-medium text-link',
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  linkClassName?: string;
}) {
  const parts = text.split(LINK);
  return (
    <p className={`whitespace-pre-line break-words ${className ?? ''}`} style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={href(part)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openTelegramLink(href(part));
            }}
            className={`underline decoration-1 underline-offset-2 ${linkClassName}`}
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}
