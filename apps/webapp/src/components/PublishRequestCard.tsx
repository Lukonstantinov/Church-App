import type { PublishRequestRow } from '@church/shared';
import { ApiError } from '../lib/api';
import { useT } from '../lib/i18n';
import { useDecidePublish } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconSend } from './icons';
import { useToast } from './Toast';
import { Button, Card } from './ui';

/**
 * A designer's prepared announcement / reminder waiting for approval: the poster and the
 * text as they will go out. Those who may publish send it to everyone or decline it (the
 * same as the buttons under the bot's message); its designer sees that it is waiting.
 */
export function PublishRequestCard({
  request,
  canPublish,
}: {
  request: PublishRequestRow;
  canPublish: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const decide = useDecidePublish();

  async function answer(send: boolean) {
    try {
      const res = await decide.mutateAsync({ id: request.id, send });
      haptic.success();
      toast(send ? t.events.remindSent(res.sent) : t.publish.declined);
    } catch (err) {
      haptic.error();
      toast(
        err instanceof ApiError && err.status === 409 ? t.publish.handled : t.common.actionFailed,
        'error',
      );
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[var(--brand)]/12 px-2.5 py-1 text-[12px] font-bold text-accent">
          🎨 {t.publish.pendingTitle}
        </span>
        <span className="min-w-0 truncate text-[13px] text-hint">
          {request.mine ? t.publish.pendingMine : t.publish.pendingBy(request.requestedBy)}
        </span>
      </div>
      {request.posterUrl && (
        <img
          src={request.posterUrl}
          alt=""
          className="max-h-64 w-full rounded-xl bg-hairline object-contain"
        />
      )}
      {request.text && (
        <p className="line-clamp-6 whitespace-pre-line text-[14px] leading-snug">{request.text}</p>
      )}
      {canPublish && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => void answer(false)}
          >
            {t.publish.decline}
          </Button>
          <Button disabled={decide.isPending} onClick={() => void answer(true)}>
            <IconSend size={16} /> {t.publish.approve}
          </Button>
        </div>
      )}
    </Card>
  );
}
