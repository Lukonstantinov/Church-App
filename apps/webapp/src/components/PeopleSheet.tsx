import { useState } from 'react';
import { resolveBrand, type GroupSummary, type MemberRow } from '@church/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useT } from '../lib/i18n';
import {
  DEFAULT_PEOPLE_FIELDS,
  PEOPLE_FIELDS,
  peopleTable,
  peopleXlsx,
  sortPeople,
  type PeopleField,
} from '../lib/peopleSheet';
import { sendDocumentToChat } from '../lib/queries';
import { storage } from '../lib/storage';
import { haptic, isInsideTelegram } from '../lib/telegram';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Toggle } from './ui';

/** The columns ticked last time, kept on this phone. */
const KEY = 'church.peopleSheet.fields';
function keptFields(): PeopleField[] {
  try {
    const v = JSON.parse(storage.get(KEY) ?? 'null') as unknown;
    if (Array.isArray(v)) {
      const known = PEOPLE_FIELDS.filter((f) => v.includes(f));
      if (known.length) return known;
    }
  } catch {
    // Unreadable: the usual columns.
  }
  return DEFAULT_PEOPLE_FIELDS;
}

/**
 * «⬇️ Таблица людей»: the ministry's people as an Excel sheet — who goes in (those
 * waiting to join and those who left can be added) and which columns, ticked here. The
 * file comes to the chat with the bot, like the other reports (outside Telegram it is
 * saved on the device).
 */
export function PeopleSheet({
  g,
  rank,
  byName,
  onClose,
}: {
  g: GroupSummary;
  /** Where a person's position stands (the People screen's order). */
  rank: (m: MemberRow) => number;
  /** A–Z instead of by position, as the screen is sorted now. */
  byName: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const tp = t.peopleSheet;
  const toast = useToast();
  const [fields, setFields] = useState<PeopleField[]>(keptFields);
  const [pending, setPending] = useState(false);
  const [former, setFormer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ name: string; people: number } | null>(null);

  const choose = (next: PeopleField[]) => {
    setFields(next);
    setSent(null);
    storage.set(KEY, JSON.stringify(next));
  };

  async function download() {
    if (busy || fields.length === 0) return;
    setBusy(true);
    setSent(null);
    try {
      // Read afresh, so the table is as of now (with those who left when asked for).
      const all = await apiFetch<MemberRow[]>(
        `/groups/${g.id}/members${former ? '?status=all' : ''}`,
      );
      const people = all.filter(
        (m) =>
          m.status === 'active' ||
          (pending && m.status === 'pending') ||
          (former && m.status === 'left'),
      );
      const table = peopleTable(sortPeople(people, rank, byName), fields, t);
      const blob = await peopleXlsx(table, g.name, resolveBrand(g.brandColor).light, tp.noInfo);
      const name = `${tp
        .file(g.name)
        .replace(/[^\p{L}\p{N} ._()«»–—-]/gu, '')
        .slice(0, 75)}.xlsx`;
      if (isInsideTelegram()) await sendDocumentToChat(blob, name);
      else {
        // A computer's browser outside Telegram: saved here.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      haptic.success();
      setSent({ name, people: people.length });
    } catch (err) {
      haptic.error();
      toast(
        err instanceof ApiError && err.code === 'bot_blocked'
          ? t.reports.botBlocked
          : t.reports.failed,
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`⬇️ ${tp.title}`}>
      <div className="flex flex-col gap-4 px-3 pb-2">
        <p className="px-1 text-[13px] leading-snug text-hint">{tp.hint}</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-semibold text-hint">{tp.columns}</span>
            <span className="flex gap-3 text-[13px] font-semibold text-link">
              <button type="button" onClick={() => choose([...PEOPLE_FIELDS])}>
                {tp.all}
              </button>
              <button type="button" onClick={() => choose(DEFAULT_PEOPLE_FIELDS)}>
                {tp.usual}
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PEOPLE_FIELDS.map((f) => {
              const on = fields.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    haptic.tap();
                    choose(on ? fields.filter((x) => x !== f) : [...fields, f]);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                    on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {tp.fields[f]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="px-1 text-[13px] font-semibold text-hint">{tp.who}</div>
          <div className="overflow-hidden rounded-2xl bg-hairline/50">
            <Toggle label={tp.withPending} checked={pending} onChange={setPending} />
            <Toggle label={tp.withFormer} checked={former} onChange={setFormer} />
          </div>
        </div>
        {sent && (
          <p className="px-1 text-[13px] font-semibold text-present">
            ✓ {isInsideTelegram() ? t.reports.sent : t.motionExport.saved} · {tp.count(sent.people)}
          </p>
        )}
        <Button disabled={busy || fields.length === 0} onClick={() => void download()}>
          {busy ? t.reports.generating : `⬇️ ${tp.download}`}
        </Button>
        {fields.length === 0 && <p className="px-1 text-[12px] text-hint">{tp.pickOne}</p>}
      </div>
    </Sheet>
  );
}
