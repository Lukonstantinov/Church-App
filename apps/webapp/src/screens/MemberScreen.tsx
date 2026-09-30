import { useState } from 'react';
import { displayName, type ClaimCodeResponse } from '@church/shared';
import { AttendanceSummary } from '../components/AttendanceSummary';
import { Avatar } from '../components/Avatar';
import { GroupDot } from '../components/GroupSwitcher';
import { LinkShare } from '../components/LinkShare';
import {
  ActionRow,
  Badge,
  Button,
  ErrorState,
  Loading,
  Row,
  Screen,
  Section,
  TextField,
  Toggle,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useIssueClaimCode,
  useMe,
  useMemberDetail,
  useSetAdmin,
  useUpdateMembership,
  useUpdateUser,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

export function MemberScreen({ userId }: { userId: number }) {
  const { back } = useNav();
  const t = useT();
  const me = useMe();
  const detail = useMemberDetail(userId);
  const updateUser = useUpdateUser(userId);
  const updateMembership = useUpdateMembership();
  const issueClaim = useIssueClaimCode(userId);
  const setAdmin = useSetAdmin(userId);
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [claim, setClaim] = useState<ClaimCodeResponse | null>(null);

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;
  const { user, memberships, permissions, attendance } = detail.data;
  const actorIsAdmin = me.data?.user.isAdmin === true;
  const isSelf = me.data?.user.id === user.id;

  function startEdit() {
    setFirstName(user.firstName);
    setLastName(user.lastName ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    await updateUser.mutateAsync({ firstName, lastName });
    haptic.success();
    setEditing(false);
  }

  return (
    <Screen>
      <header className="flex flex-col items-center gap-2 pt-4 text-center">
        <Avatar id={user.id} firstName={user.firstName} lastName={user.lastName} size={84} />
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{displayName(user)}</h1>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[15px] text-hint">
          {user.username && <span>@{user.username}</span>}
          {user.isAdmin && <Badge>{t.roles.admin}</Badge>}
          {user.offline && <Badge tone="hint">{t.common.offline}</Badge>}
          {!user.offline && !user.isReachable && (
            <Badge tone="danger">{t.common.unreachable}</Badge>
          )}
        </div>
      </header>

      {attendance.map((a) => (
        <AttendanceSummary key={a.groupId} data={a} showStreak={permissions.canEditProfile} />
      ))}

      {permissions.canEditProfile && (
        <Section title={t.member.profile}>
          {editing ? (
            <>
              <TextField
                label={t.member.firstName}
                value={firstName}
                onChange={setFirstName}
                autoFocus
              />
              <TextField label={t.member.lastName} value={lastName} onChange={setLastName} />
              <div className="flex gap-2 px-4 py-3">
                <Button
                  small
                  onClick={() => void saveEdit()}
                  disabled={!firstName.trim() || updateUser.isPending}
                >
                  {t.common.save}
                </Button>
                <Button small variant="secondary" onClick={() => setEditing(false)}>
                  {t.common.cancel}
                </Button>
              </div>
            </>
          ) : (
            <ActionRow onClick={startEdit}>{t.common.edit}</ActionRow>
          )}
        </Section>
      )}

      {permissions.canEditProfile && (
        <Section footer={t.member.guardianConsentHint}>
          <Toggle
            label={t.member.guardianConsent}
            checked={user.guardianConsentAt !== null}
            disabled={updateUser.isPending}
            onChange={(v) => void updateUser.mutateAsync({ guardianConsent: v })}
          />
        </Section>
      )}

      {memberships.length > 0 && (
        <Section title={isSelf ? t.member.myGroups : t.member.groups}>
          {memberships.map((m) => (
            <div key={m.membershipId}>
              <Row
                before={<GroupDot id={m.groupId} />}
                title={m.groupName}
                subtitle={m.status === 'pending' ? t.member.statusPending : undefined}
                after={m.role === 'leader' ? <Badge>{t.roles.leader}</Badge> : t.roles.member}
              />
              {actorIsAdmin && m.status === 'active' && (
                <ActionRow
                  disabled={updateMembership.isPending}
                  onClick={() =>
                    void updateMembership.mutateAsync({
                      membershipId: m.membershipId,
                      role: m.role === 'leader' ? 'member' : 'leader',
                    })
                  }
                >
                  {m.role === 'leader' ? t.member.makeMember : t.member.makeLeader}
                </ActionRow>
              )}
              {permissions.canEditProfile &&
                m.status === 'active' &&
                (actorIsAdmin || m.role !== 'leader') && (
                  <ActionRow
                    destructive
                    disabled={updateMembership.isPending}
                    onClick={async () => {
                      if (await confirmDialog(t.member.removeConfirm)) {
                        await updateMembership.mutateAsync({
                          membershipId: m.membershipId,
                          status: 'left',
                        });
                        if (memberships.length === 1) back();
                      }
                    }}
                  >
                    {t.member.removeFromGroup}
                  </ActionRow>
                )}
            </div>
          ))}
        </Section>
      )}

      {permissions.canIssueClaimCode && (
        <Section title={t.member.claimCode} footer={t.member.claimCodeHint}>
          {claim ? (
            <LinkShare link={claim.link} shareText={t.member.claimShare} />
          ) : (
            <ActionRow
              disabled={issueClaim.isPending}
              onClick={async () => setClaim(await issueClaim.mutateAsync())}
            >
              {t.member.issueClaimCode}
            </ActionRow>
          )}
        </Section>
      )}

      {permissions.canSetAdmin && !isSelf && (
        <Section>
          <ActionRow
            destructive={user.isAdmin}
            disabled={setAdmin.isPending}
            onClick={() => void setAdmin.mutateAsync(!user.isAdmin)}
          >
            {user.isAdmin ? t.member.removeAdmin : t.member.makeAdmin}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}
