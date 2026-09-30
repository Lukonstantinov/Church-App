import { useState } from 'react';
import { displayName, LOCALE_NAMES, type GroupSummary } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { BrandHeader, LanguageSheet } from '../components/BrandHeader';
import { GroupDot } from '../components/GroupSwitcher';
import { IconGlobe, IconPlus, IconSettings } from '../components/icons';
import { ActionRow, Badge, Row, Screen, Section } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useMe } from '../lib/queries';

/** Profile, language, and for admins: church settings and all groups. */
export function More({ groups }: { groups: GroupSummary[] }) {
  const { push, setTab, setActiveGroupId } = useNav();
  const { t, locale } = useI18n();
  const me = useMe();
  const [langOpen, setLangOpen] = useState(false);
  const user = me.data?.user;
  if (!user) return null;

  const iconTile = (icon: React.ReactNode) => (
    <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
      {icon}
    </span>
  );

  return (
    <Screen tabs>
      <BrandHeader title={t.nav.more} />

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

      {user.isAdmin && (
        <Section>
          <Row
            before={iconTile(<IconSettings size={19} />)}
            title={t.settings.title}
            subtitle={t.settings.entry}
            onClick={() => push({ name: 'settings' })}
          />
        </Section>
      )}

      {groups.length > 0 && (
        <Section title={t.groups.groupSettings}>
          {groups.map((g) => (
            <Row
              key={g.id}
              before={<GroupDot id={g.id} size={12} />}
              title={g.name}
              onClick={() => push({ name: 'groupSettings', groupId: g.id })}
            />
          ))}
        </Section>
      )}

      {user.isAdmin && (
        <Section title={t.groups.churchGroups}>
          {groups.map((g) => (
            <Row
              key={g.id}
              before={<GroupDot id={g.id} size={12} />}
              title={g.name}
              subtitle={`${t.common.members(g.activeCount)}${g.leaderNames.length ? ` · ${g.leaderNames.join(', ')}` : ''}`}
              after={g.pendingCount > 0 ? <Badge tone="danger">{g.pendingCount}</Badge> : undefined}
              onClick={() => {
                setActiveGroupId(g.id);
                setTab('overview');
              }}
            />
          ))}
          <ActionRow icon={<IconPlus size={20} />} onClick={() => push({ name: 'createGroup' })}>
            {t.groups.create}
          </ActionRow>
        </Section>
      )}

      <p className="px-4 text-[13px] leading-snug text-hint">{t.home.privacyNote}</p>
      <LanguageSheet open={langOpen} onClose={() => setLangOpen(false)} />
    </Screen>
  );
}
