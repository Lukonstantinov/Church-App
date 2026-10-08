import { useState } from 'react';
import { displayName } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { IconSearch, IconTelegram } from '../components/icons';
import { LabelChip, PersonName } from '../components/LabelLook';
import { useToast } from '../components/Toast';
import { Badge, Screen, Skeleton, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { useContacts, useGroup } from '../lib/queries';
import { FilterChip, SortSwitch } from './People';
import { haptic, openTelegramLink } from '../lib/telegram';

/** Everyone in the ministry with their position; tapping someone opens a Telegram chat. */
export function Contacts({ groupId }: { groupId: number }) {
  const t = useT();
  const toast = useToast();
  const group = useGroup(groupId);
  const contacts = useContacts(groupId);
  const [q, setQ] = useState('');
  const [byName, setByName] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const needle = q.trim().toLocaleLowerCase();
  const all = contacts.data ?? [];
  // Leaders first (the ministry's position order, set in Позиции), or simply A–Z.
  const sorted = [...all].sort(
    (a, b) =>
      (byName ? 0 : a.positionRank - b.positionRank) ||
      displayName(a).localeCompare(displayName(b)),
  );
  // One chip per position, in that order, to show only its people.
  const positionsInUse = [
    ...new Map(
      [...all]
        .sort((a, b) => a.positionRank - b.positionRank)
        .filter((c) => c.positionName)
        .map((c) => [c.positionName!, all.filter((x) => x.positionName === c.positionName).length]),
    ),
  ];
  const list = sorted.filter(
    (c) =>
      (only === null || c.positionName === only) &&
      (!needle ||
        `${displayName(c)} ${c.username ?? ''} ${c.positionName ?? ''}`
          .toLocaleLowerCase()
          .includes(needle)),
  );

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.people.contactsTitle}</Title>
      <label className="glass flex items-center gap-2 rounded-2xl px-3.5 py-2.5 shadow-card">
        <IconSearch size={18} className="shrink-0 text-hint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.people.search}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-hint"
        />
      </label>
      <p className="-mt-2 px-2 text-[13px] text-hint">{t.people.contactsHint}</p>
      {all.length > 1 && <SortSwitch byName={byName} onChange={setByName} />}
      {positionsInUse.length > 1 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <FilterChip on={only === null} onClick={() => setOnly(null)}>
            {t.people.all} · {all.length}
          </FilterChip>
          {positionsInUse.map(([name, n]) => (
            <FilterChip key={name} on={only === name} onClick={() => setOnly(name)}>
              {name} · {n}
            </FilterChip>
          ))}
        </div>
      )}
      {contacts.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                haptic.tap();
                if (c.username) openTelegramLink(`https://t.me/${c.username}`);
                else toast(c.offline ? t.people.offline : t.people.noUsername, 'error');
              }}
              className="flex min-h-[60px] w-full items-center gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 active:bg-hairline"
            >
              <Avatar id={c.id} firstName={c.firstName} lastName={c.lastName} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <PersonName
                    name={displayName(c)}
                    labels={c.labels}
                    positionLook={c.positionLook}
                    isAdmin={c.isAdmin}
                    className="min-w-0 truncate text-[16px] font-medium"
                  />
                  {c.labels.map((l) => (
                    <LabelChip key={l.id} label={l} small />
                  ))}
                </span>
                <span className="block truncate text-[13px] text-hint">
                  {c.username ? `@${c.username}` : c.offline ? t.people.offline : '—'}
                </span>
              </span>
              {c.positionName &&
                (c.positionLook ? (
                  <LabelChip label={{ ...c.positionLook, name: c.positionName }} />
                ) : (
                  <Badge>{c.positionName}</Badge>
                ))}
              {c.username && <IconTelegram size={20} className="shrink-0 text-link" />}
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}
