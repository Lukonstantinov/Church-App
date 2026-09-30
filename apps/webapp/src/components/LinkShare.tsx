import { useMemo, useState } from 'react';
import { renderSVG } from 'uqr';
import { copyText, haptic, shareLink } from '../lib/telegram';
import { useT } from '../lib/i18n';
import { Button } from './ui';

/** Shows a deep link with Share / Copy / QR actions. */
export function LinkShare({ link, shareText }: { link: string; shareText: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const svg = useMemo(() => (showQr ? renderSVG(link, { border: 2 }) : ''), [link, showQr]);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="select-all break-all rounded-xl bg-hairline px-3 py-2 font-mono text-[13px]">
        {link}
      </div>
      <div className="flex gap-2">
        <Button small onClick={() => shareLink(link, shareText)}>
          {t.people.share}
        </Button>
        <Button
          small
          variant="secondary"
          onClick={async () => {
            if (await copyText(link)) {
              haptic.success();
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? t.people.copied : t.people.copy}
        </Button>
        <Button small variant="secondary" onClick={() => setShowQr((v) => !v)}>
          QR
        </Button>
      </div>
      {showQr && (
        <div
          className="mx-auto w-56 rounded-lg bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
          // uqr returns a self-contained SVG string for a URL we generated ourselves.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
