import { useState } from 'react';
import type { AnnouncementResult } from '@church/shared';
import { AnnouncementCard, ShareButton } from '../components/AnnouncementCard';
import { IconMegaphone, IconSend, IconTelegram, IconWhatsApp } from '../components/icons';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  Screen,
  Section,
  Skeleton,
  TextArea,
  Title,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useAnnouncements, useGroup, useSendAnnouncement } from '../lib/queries';
import { confirmDialog, haptic, shareToTelegram, shareToWhatsApp } from '../lib/telegram';

const MAX = 2000;

export function Announcements({ groupId }: { groupId: number }) {
  const t = useT();
  const toast = useToast();
  const group = useGroup(groupId);
  const history = useAnnouncements(groupId);
  const send = useSendAnnouncement(groupId);
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnnouncementResult | null>(null);

  const activeOthers = Math.max(0, (group.data?.activeCount ?? 1) - 1);

  async function submit() {
    const body = text.trim();
    if (!body) return;
    if (!(await confirmDialog(t.announcements.confirmSend(activeOthers)))) return;
    try {
      const r = await send.mutateAsync(body);
      haptic.success();
      setResult(r);
      setText('');
    } catch {
      haptic.error();
      toast(t.announcements.failed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.announcements.title}</Title>

      {result ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-[16px] font-semibold text-present">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-present/15">
              <IconSend size={17} />
            </span>
            {t.announcements.sentTo(result.announcement.recipients)}
          </div>
          {result.noTelegram + result.unreachable > 0 && (
            <p className="text-[14px] text-hint">
              {t.announcements.notReached(result.noTelegram + result.unreachable)}
            </p>
          )}
          <div>
            <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {t.announcements.alsoShare}
            </div>
            <div className="flex gap-2">
              <ShareButton
                icon={<IconWhatsApp size={17} />}
                label={t.announcements.shareWhatsApp}
                onClick={() => shareToWhatsApp(result.announcement.text)}
              />
              <ShareButton
                icon={<IconTelegram size={17} />}
                label={t.announcements.shareTelegram}
                onClick={() => shareToTelegram(result.announcement.text)}
              />
            </div>
          </div>
          <Button variant="secondary" onClick={() => setResult(null)}>
            {t.announcements.compose}
          </Button>
        </Card>
      ) : (
        <Section
          title={t.announcements.compose}
          footer={t.announcements.charsLeft(MAX - text.length)}
        >
          <TextArea
            value={text}
            onChange={setText}
            placeholder={t.announcements.placeholder}
            maxLength={MAX}
          />
          <div className="border-t border-hairline p-3">
            <Button onClick={() => void submit()} disabled={!text.trim() || send.isPending}>
              <IconSend size={18} />{' '}
              {send.isPending ? t.announcements.sending : t.announcements.send}
            </Button>
          </div>
        </Section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.announcements.history}
        </h2>
        {history.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (history.data ?? []).length === 0 ? (
          <Card>
            <EmptyState icon={<IconMegaphone size={26} />} title={t.announcements.empty}>
              {t.announcements.emptyText}
            </EmptyState>
          </Card>
        ) : (
          history.data!.map((a) => <AnnouncementCard key={a.id} a={a} shareable />)
        )}
      </section>
    </Screen>
  );
}
