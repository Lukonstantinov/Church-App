import { useState, type ReactNode } from 'react';
import { displayName, LOCALE_NAMES, type GroupSummary } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { BrandHeader, LanguageSheet } from '../components/BrandHeader';
import { TestAsSheet } from '../components/TestAs';
import {
  IconBell,
  IconTag,
  IconChart,
  IconGlobe,
  IconHome,
  IconSettings,
  IconUsers,
} from '../components/icons';
import { HomeScreenCard } from '../components/HomeScreenCard';
import { QualityPicker } from '../components/QualityPicker';
import { Pill } from '../components/LookControls';
import { Badge, Row, Screen, Section } from '../components/ui';
import { useEnv } from '../lib/env';
import { useI18n } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { MOTIONS, setMotion, useMotion } from '../lib/motion';
import { useMe } from '../lib/queries';

/** Profile, language, the ministry's settings (by rights) and church settings for admins. */
export function More({ groups }: { groups: GroupSummary[] }) {
  const { push, back, envId } = useNav();
  const { t, locale } = useI18n();
  const { can } = useEnv();
  const me = useMe();
  const [langOpen, setLangOpen] = useState(false);
  const [testAs, setTestAs] = useState(false);
  const motion = useMotion();
  const user = me.data?.user;
  const env = groups[0];
  if (!user) return null;

  const iconTile = (icon: ReactNode) => (
    <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
      {icon}
    </span>
  );

  return (
    <Screen tabs>
      <BrandHeader title={t.nav.more} subtitle={env?.name} />

      <Section title={t.member.profile}>
        <Row
          before={
            <Avatar id={user.id} firstName={user.firstName} lastName={user.lastName} size={46} />
          }
          title={displayName(user)}
          subtitle={
            <span className="flex items-center gap-1.5">
              {user.username && <span>@{user.username}</span>}
              {user.isAdmin && <Badge>{t.roles.admin}</Badge>}
              {env?.positionName && <Badge tone="hint">{env.positionName}</Badge>}
            </span>
          }
          onClick={() => push({ name: 'member', userId: user.id })}
        />
        <Row
          before={iconTile(<IconGlobe size={19} />)}
          title={t.language.title}
          after={LOCALE_NAMES[locale]}
          onClick={() => setLangOpen(true)}
        />
      </Section>

      <HomeScreenCard />

      <Section title={t.motion.title} footer={t.motion.hint}>
        <div className="flex flex-wrap gap-2 p-3">
          {MOTIONS.map((m) => (
            <Pill key={m} on={motion === m} onClick={() => setMotion(m)} label={t.motion[m]} />
          ))}
        </div>
      </Section>

      <QualityPicker />

      {env &&
        (can('settings') ||
          can('positions') ||
          can('reports') ||
          can('events.manage') ||
          can('people.manage')) && (
          <Section title={env.name}>
            {can('settings') && (
              <Row
                before={iconTile(<IconSettings size={19} />)}
                title={t.env.settings}
                subtitle={`${t.env.theme} · ${t.env.logo} · ${t.groups.chatTitle}`}
                onClick={() => push({ name: 'groupSettings', groupId: env.id })}
              />
            )}
            {can('people.manage') && (
              <Row
                before={iconTile(<IconTag size={19} />)}
                title={t.labels.title}
                subtitle={t.labels.entry}
                onClick={() => push({ name: 'labels', groupId: env.id })}
              />
            )}
            {can('events.manage') && (
              <Row
                before={iconTile(<IconBell size={19} />)}
                title={t.events.remindTitle}
                subtitle={t.events.remindEntry}
                onClick={() => push({ name: 'reminders', groupId: env.id })}
              />
            )}
            {can('positions') && (
              <Row
                before={iconTile(<IconUsers size={19} />)}
                title={t.positions.title}
                subtitle={t.positions.entry}
                onClick={() => push({ name: 'positions', groupId: env.id })}
              />
            )}
            {can('reports') && (
              <Row
                before={iconTile(<IconChart size={19} />)}
                title={t.reports.title}
                subtitle={t.reports.entry}
                onClick={() => push({ name: 'reports', groupId: env.id })}
              />
            )}
          </Section>
        )}

      {(envId !== null || user.isAdmin || user.isDeveloper) && (
        <Section>
          {envId !== null && (
            <Row before={iconTile(<IconHome size={19} />)} title={t.env.all} onClick={back} />
          )}
          {user.isDeveloper && (
            <Row
              before={iconTile(<span className="text-[17px]">📘</span>)}
              title={t.dev.guideTitle}
              subtitle={t.dev.guideEntry}
              onClick={() => push({ name: 'guide' })}
            />
          )}
          {user.isDeveloper && (
            <Row
              before={iconTile(<span className="text-[17px]">🧪</span>)}
              title={t.testAs.menu}
              subtitle={t.testAs.entry}
              onClick={() => setTestAs(true)}
            />
          )}
          {user.isAdmin && (
            <Row
              before={iconTile(<IconSettings size={19} />)}
              title={t.settings.title}
              subtitle={t.settings.entry}
              onClick={() => push({ name: 'settings' })}
            />
          )}
        </Section>
      )}

      <Section footer={t.common.reloadHint}>
        <Row
          before={iconTile(<span className="text-[17px]">↻</span>)}
          title={t.common.reload}
          onClick={() => window.location.reload()}
        />
      </Section>

      <p className="px-4 text-[13px] leading-snug text-hint">{t.home.privacyNote}</p>
      <LanguageSheet open={langOpen} onClose={() => setLangOpen(false)} />
      {user.isDeveloper && <TestAsSheet open={testAs} onClose={() => setTestAs(false)} />}
    </Screen>
  );
}
