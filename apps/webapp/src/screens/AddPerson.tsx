import { useEffect, useState } from 'react';
import { displayName, type PersonSearchRow } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { IconCheck, IconPlus, IconSearch, IconUserPlus } from '../components/icons';
import { LinkShare } from '../components/LinkShare';
import { useToast } from '../components/Toast';
import { ActionRow, Badge, EmptyText, Screen, Section, Skeleton, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useAddExisting, useGroup, usePeopleSearch } from '../lib/queries';
import { haptic } from '../lib/telegram';

/** Add someone to the ministry: from the church, without Telegram, or by invite link. */
export function AddPerson({ groupId }: { groupId: number }) {
  const t = useT();
  const toast = useToast();
  const { push } = useNav();
  const group = useGroup(groupId);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<number[]>([]);
  const add = useAddExisting(groupId);

  // Search as you type, a moment after the last key press.
  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(id);
  }, [input]);
  const results = usePeopleSearch(groupId, q);

  async function addPerson(p: PersonSearchRow) {
    try {
      await add.mutateAsync({ userId: p.userId });
      haptic.success();
      setAdded((a) => [...a, p.userId]);
      toast(t.env.added(displayName(p)));
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    }
  }

  const list = results.data ?? [];
  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.env.addPerson}</Title>

      <label className="glass flex min-h-[50px] items-center gap-2 rounded-2xl px-3.5 shadow-card">
        <IconSearch size={19} className="text-hint" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.env.searchPlaceholder}
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-hint"
        />
      </label>

      <Section title={t.env.fromChurch} footer={t.env.fromChurchHint}>
        {results.isPending ? (
          <div className="p-3">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.length === 0 ? (
          <EmptyText>{t.env.nobodyFound}</EmptyText>
        ) : (
          list.map((p) => {
            const here = p.inGroup || added.includes(p.userId);
            return (
              <div
                key={p.userId}
                className="flex min-h-[60px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
              >
                <Avatar id={p.userId} firstName={p.firstName} lastName={p.lastName} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-medium">{displayName(p)}</div>
                  <div className="truncate text-[13px] text-hint">
                    {p.username ? `@${p.username}` : p.offline ? t.common.offline : ''}
                  </div>
                </div>
                {here ? (
                  <Badge tone="success">
                    <IconCheck size={12} /> {t.env.inGroup}
                  </Badge>
                ) : (
                  <button
                    type="button"
                    aria-label={t.common.add}
                    disabled={add.isPending}
                    onClick={() => void addPerson(p)}
                    className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-white shadow-cta active:scale-95 disabled:opacity-50"
                  >
                    <IconPlus size={18} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </Section>

      <Section>
        <ActionRow
          icon={<IconUserPlus size={20} />}
          onClick={() => push({ name: 'addOffline', groupId })}
        >
          {t.env.addWithoutTelegram}
        </ActionRow>
      </Section>

      {group.data?.inviteLink && (
        <Section title={t.env.invite}>
          <LinkShare link={group.data.inviteLink} shareText={group.data.name} />
        </Section>
      )}
    </Screen>
  );
}
