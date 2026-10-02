import { useEffect, useRef, useState } from 'react';
import { resolveBrand, type EventDetail } from '@church/shared';
import { useEnv } from '../lib/env';
import { eventRosterXlsx, posterPdf } from '../lib/eventFiles';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { sendDocumentToChat, sendPictureToChat, useGroup, useMe } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { useEventWhen } from './EventCard';
import { EventSheet, SHEET_WIDTH, availableParts, type SheetPart } from './EventSheet';
import { Pill } from './LookControls';
import { IconCheck, IconSend } from './icons';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button } from './ui';

type Job = 'picture' | 'file' | 'pdf' | 'excel';

/**
 * The event's poster and lists to take away: the poster as a picture (to forward to
 * people) or as a PDF, and an Excel sheet of who is responsible for what. Built on the
 * phone and delivered by the bot to the person's own chat.
 */
export function EventExport({ e, onClose }: { e: EventDetail; onClose: () => void }) {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const me = useMe();
  const { env } = useEnv();
  const group = useGroup(e.groupId);
  const when = useEventWhen();
  const node = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Job | null>(null);
  // What the picture shows under the poster: everything except the money, to start with.
  const available = availableParts(e);
  const [parts, setParts] = useState<SheetPart[]>(available.filter((p) => p !== 'finance'));
  const togglePart = (p: SheetPart) =>
    setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const [done, setDone] = useState<Job | null>(null);
  // The poster's full height, so the small preview can scroll through all of it.
  const [height, setHeight] = useState(900);
  const church = me.data?.church;
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, [church, parts]);
  if (!church) return null;

  /** The poster as an image: PNG, or a JPEG when the PNG would be too big to send. */
  async function render(): Promise<{ blob: Blob; dataUrl: string; w: number; h: number }> {
    const { toJpeg, toPng } = await import('html-to-image');
    const el = node.current!;
    const opts = { pixelRatio: 2, skipFonts: true } as const;
    let dataUrl = await toPng(el, opts);
    let blob = await (await fetch(dataUrl)).blob();
    if (blob.size > 8_500_000) {
      dataUrl = await toJpeg(el, { ...opts, quality: 0.9 });
      blob = await (await fetch(dataUrl)).blob();
    }
    return { blob, dataUrl, w: el.offsetWidth, h: el.offsetHeight };
  }

  async function run(job: Job) {
    if (busy) return;
    setBusy(job);
    setDone(null);
    const name = e.title.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 50) || 'event';
    try {
      if (job === 'picture' || job === 'file') {
        const img = await render();
        await sendPictureToChat(img.blob, name, job === 'file');
      } else if (job === 'pdf') {
        const img = await render();
        // A PDF holds a JPEG (smaller than the PNG, same picture).
        const { toJpeg } = await import('html-to-image');
        const jpeg = await toJpeg(node.current!, { pixelRatio: 2, skipFonts: true, quality: 0.92 });
        const pdf = await posterPdf(jpeg, img.w, img.h, e.title);
        await sendDocumentToChat(pdf, `${name}.pdf`);
      } else {
        const ctx = {
          t,
          f,
          currency: church!.currency,
          brandHex: resolveBrand(env?.brandColor ?? church!.brandColor).light,
        };
        await sendDocumentToChat(await eventRosterXlsx(ctx, e, when(e)), `${name}.xlsx`);
      }
      haptic.success();
      setDone(job);
      toast(t.events.exportDone);
    } catch {
      haptic.error();
      toast(t.reports.failed, 'error');
    } finally {
      setBusy(null);
    }
  }

  const btn = (job: Job, label: string, variant: 'primary' | 'glass' = 'glass') => (
    <Button variant={variant} disabled={busy !== null} onClick={() => void run(job)}>
      {done === job ? <IconCheck size={17} /> : <IconSend size={16} />}{' '}
      {busy === job ? t.events.exportBusy : label}
    </Button>
  );

  return (
    <Sheet open onClose={onClose} title={t.events.exportTitle}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex justify-center rounded-2xl bg-hairline/50 py-3">
          {/* Shown small and scrollable; the picture is taken from the full-size poster. */}
          <div
            style={{
              width: SHEET_WIDTH * 0.42,
              height: Math.min(340, height * 0.42),
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                transform: 'scale(0.42)',
                transformOrigin: 'top left',
                width: SHEET_WIDTH,
                height: height * 0.42,
              }}
            >
              <EventSheet ref={node} e={e} g={group.data} church={church} parts={parts} />
            </div>
          </div>
        </div>
        {available.length > 0 && (
          <div>
            <div className="mb-2 text-[13px] text-hint">{t.events.sheetShow}</div>
            <div className="flex flex-wrap gap-2">
              {available.map((p) => (
                <Pill
                  key={p}
                  on={parts.includes(p)}
                  onClick={() => togglePart(p)}
                  label={
                    {
                      description: t.events.partDescription,
                      program: t.events.partProgram,
                      roles: t.events.partRoles,
                      going: t.events.partGoing,
                      finance: t.events.partFinance,
                    }[p]
                  }
                />
              ))}
            </div>
          </div>
        )}
        {btn('picture', t.events.exportPicture, 'primary')}
        {btn('file', t.events.exportPictureFile)}
        {btn('pdf', t.events.exportPdf)}
        {btn('excel', t.events.exportExcel)}
        <p className="text-[12px] leading-snug text-hint">{t.events.exportHint}</p>
      </div>
    </Sheet>
  );
}
