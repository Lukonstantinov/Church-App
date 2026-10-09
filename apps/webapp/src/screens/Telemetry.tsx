import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  parseMockPeople,
  type MockPeopleInfo,
  type MockPeopleInput,
  type Telemetry as TelemetryData,
} from '@church/shared';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  ErrorState,
  Loading,
  ProgressBar,
  Row,
  Screen,
  Section,
  TextArea,
  Title,
  Toggle,
} from '../components/ui';
import { apiFetch } from '../lib/api';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { confirmDialog, haptic } from '../lib/telegram';

const mb = (b: number) =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Developer-only numbers: storage use against the free limits, activity, bot health. */
export function Telemetry() {
  const t = useT();
  const f = useFmt();
  const q = useQuery({
    queryKey: ['dev', 'telemetry'],
    queryFn: () => apiFetch<TelemetryData>('/dev/telemetry'),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const size = d.database.sizeBytes;
  const filesBytes = d.media.reduce((s, m) => s + m.bytes, 0);
  const when = (iso: string) => `${f.shortDate(iso)} ${f.time(iso)}`;

  return (
    <Screen>
      <Title subtitle={`${d.environment} · ${when(d.generatedAt)}`}>{t.dev.title}</Title>

      <Card className="flex flex-col gap-2 p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.dev.storage}
        </div>
        <div className="text-[26px] font-bold tabular-nums">
          {size === null ? t.dev.unknown : t.dev.used(mb(size), mb(d.database.limitBytes))}
        </div>
        {size !== null && <ProgressBar value={size} max={d.database.limitBytes} tone="accent" />}
        <div className="text-[13px] text-hint">
          {t.dev.files}: {mb(filesBytes)} ·{' '}
          {d.media.map((m) => `${m.kind} ${m.count}`).join(', ') || '0'}
        </div>
      </Card>

      <MockPeople />

      <Section title={t.dev.people}>
        <Row title={t.dev.total} after={String(d.users.total)} />
        <Row title={t.dev.withTelegram} after={String(d.users.withTelegram)} />
        <Row title={t.dev.active1d} after={String(d.users.active1d)} />
        <Row title={t.dev.active7d} after={String(d.users.active7d)} />
        <Row title={t.dev.active30d} after={String(d.users.active30d)} />
        <Row title={t.dev.blocked} after={String(d.users.blockedBot)} />
        <Row
          title={t.dev.ministries}
          after={`${d.ministries.total - d.ministries.archived} (+${d.ministries.archived} ${t.dev.archived})`}
        />
      </Section>

      <Section title={t.dev.bot}>
        <Row title={t.dev.pending} after={String(d.bot.pending)} />
        <Row title={t.dev.sent24h} after={String(d.bot.sent24h)} />
        <Row title={t.dev.dead} after={String(d.bot.dead)} />
      </Section>
      {d.bot.recentErrors.length > 0 && (
        <Section title={t.dev.errors}>
          {d.bot.recentErrors.map((e, i) => (
            <Row key={i} title={e.method} subtitle={`${when(e.at)} · ${e.error ?? ''}`} />
          ))}
        </Section>
      )}

      <Section title={t.dev.appErrors} footer={t.dev.appErrorsHint}>
        {(d.clientErrors ?? []).length === 0 && <Row title={t.dev.noAppErrors} />}
        {(d.clientErrors ?? []).map((e, i) => (
          <Row
            key={i}
            title={e.message}
            subtitle={`${when(e.at)} · ${e.place ?? ''} · ${(e.device ?? '').slice(0, 60)}`}
          />
        ))}
      </Section>

      <Section title={t.dev.jobs}>
        {d.jobs.map((j) => (
          <Row key={j.job} title={j.job} after={when(j.lastRun)} />
        ))}
      </Section>

      <Section title={t.dev.tables}>
        {d.tables.map((x) => (
          <Row key={x.name} title={x.name} after={x.rows.toLocaleString()} />
        ))}
      </Section>

      <Section title={t.dev.limits}>
        {d.limits.map((l) => (
          <Row key={l.key} title={l.key} subtitle={l.value} />
        ))}
      </Section>

      <Button variant="glass" onClick={() => void q.refetch()}>
        {t.dev.refresh}
      </Button>
    </Screen>
  );
}

/**
 * Made-up people for trying birthdays and statistics: paste one person a line (name,
 * birthday, position), pick a ministry and add them. "Only test people" makes birthdays
 * (calendar, bot lists) use just them and leave the real members out; turning it off — or
 * removing the test people — brings the real ones back.
 */
function MockPeople() {
  const t = useT();
  const tm = t.dev.mock;
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dev', 'mock-people'],
    queryFn: () => apiFetch<MockPeopleInfo>('/dev/mock-people'),
  });
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  // Everything that shows people (calendar, members, statistics) changes with them.
  const done = () => void qc.invalidateQueries();
  const add = useMutation({
    mutationFn: (input: MockPeopleInput) =>
      apiFetch<{ added: number }>('/dev/mock-people', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: done,
  });
  const setOnly = useMutation({
    mutationFn: (mockOnly: boolean) =>
      apiFetch('/dev/mock-people', { method: 'PATCH', body: JSON.stringify({ mockOnly }) }),
    onSuccess: done,
  });
  const removeAll = useMutation({
    mutationFn: () => apiFetch<{ removed: number }>('/dev/mock-people', { method: 'DELETE' }),
    onSuccess: done,
  });
  if (!q.data) return null;
  const info = q.data;
  const group = groupId ?? info.groups[0]?.id ?? null;
  const parsed = parseMockPeople(text);

  async function submit() {
    if (!group || !parsed.people.length) return;
    try {
      const r = await add.mutateAsync({ groupId: group, people: parsed.people });
      haptic.success();
      toast(tm.added(r.added));
      setText('');
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  async function wipe() {
    if (!(await confirmDialog(tm.removeConfirm(info.count)))) return;
    const r = await removeAll.mutateAsync();
    toast(tm.removed(r.removed));
  }

  return (
    <Section title={`🧪 ${tm.title}`} footer={tm.hint}>
      <Row title={tm.count} after={String(info.count)} />
      <Toggle
        label={tm.only}
        checked={info.mockOnly}
        disabled={setOnly.isPending}
        onChange={(v) => void setOnly.mutateAsync(v).then(() => haptic.success())}
      />
      <div className="flex flex-col gap-2 p-3">
        <select
          aria-label={tm.ministry}
          className="min-h-[44px] w-full rounded-xl bg-hairline px-3 text-[16px] font-medium outline-none"
          value={group ?? ''}
          onChange={(e) => setGroupId(Number(e.target.value))}
        >
          {info.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="overflow-hidden rounded-xl bg-hairline">
          <TextArea
            value={text}
            onChange={setText}
            rows={6}
            maxLength={30000}
            placeholder={tm.placeholder}
          />
        </div>
        {text.trim() && (
          <p className="text-[13px] text-hint">
            {tm.parsed(parsed.people.length)}
            {parsed.bad.length > 0 && (
              <span className="text-destructive"> · {tm.badLines(parsed.bad.join(', '))}</span>
            )}
          </p>
        )}
        <Button
          disabled={!group || !parsed.people.length || parsed.people.length > 300 || add.isPending}
          onClick={() => void submit()}
        >
          {add.isPending ? t.common.saving : tm.add}
        </Button>
        {info.count > 0 && (
          <Button variant="destructive" disabled={removeAll.isPending} onClick={() => void wipe()}>
            {tm.removeAll}
          </Button>
        )}
      </div>
    </Section>
  );
}
