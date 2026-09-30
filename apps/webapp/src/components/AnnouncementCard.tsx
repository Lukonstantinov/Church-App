import { useState } from 'react';
import { displayName, type AnnouncementRow } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { shareToTelegram, shareToWhatsApp } from '../lib/telegram';
import { GroupDot } from './GroupSwitcher';
import { IconMegaphone, IconTelegram, IconWhatsApp } from './icons';
import { Card } from './ui';

/** One announcement; long texts collapse, leaders get share buttons. */
export function AnnouncementCard({
  a,
  showGroup,
  shareable,
}: {
  a: AnnouncementRow;
  showGroup?: boolean;
  shareable?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  const [expanded, setExpanded] = useState(false);
  const long = a.text.length > 220;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] text-hint">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/12 text-accent">
          <IconMegaphone size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {showGroup && (
            <span className="mr-1 inline-flex items-center gap-1 font-semibold text-text">
              <GroupDot id={a.groupId} size={8} /> {a.groupName} ·
            </span>
          )}
          {f.weekdayDayMonth(a.createdAt)} · {f.time(a.createdAt)}
        </span>
      </div>
      <p
        className={`whitespace-pre-wrap text-[16px] leading-snug ${long && !expanded ? 'line-clamp-5' : ''}`}
      >
        {a.text}
      </p>
      {long && (
        <button
          type="button"
          className="mt-1 text-[14px] font-semibold text-link"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '−' : '…'}
        </button>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-hint">
        <span className="truncate">{a.author ? `— ${displayName(a.author)}` : ''}</span>
        {shareable && <span className="shrink-0">{t.announcements.recipients(a.recipients)}</span>}
      </div>
      {shareable && (
        <div className="mt-3 flex gap-2">
          <ShareButton
            icon={<IconWhatsApp size={17} />}
            label={t.announcements.shareWhatsApp}
            onClick={() => shareToWhatsApp(a.text)}
          />
          <ShareButton
            icon={<IconTelegram size={17} />}
            label={t.announcements.shareTelegram}
            onClick={() => shareToTelegram(a.text)}
          />
        </div>
      )}
    </Card>
  );
}

export function ShareButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-hairline px-3 text-[14px] font-semibold active:opacity-70"
    >
      {icon}
      {label}
    </button>
  );
}
