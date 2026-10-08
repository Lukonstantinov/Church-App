import { useQuery } from '@tanstack/react-query';
import type { Telemetry as TelemetryData } from '@church/shared';
import {
  Button,
  Card,
  ErrorState,
  Loading,
  ProgressBar,
  Row,
  Screen,
  Section,
  Title,
} from '../components/ui';
import { apiFetch } from '../lib/api';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';

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
