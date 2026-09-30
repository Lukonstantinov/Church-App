import { useState } from 'react';
import { displayName, ru, type ClaimCodeResponse } from '@church/shared';
import { AttendanceSummary } from '../components/AttendanceSummary';
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
  Title,
  Toggle,
} from '../components/ui';
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
  const tz = me.data?.church.timezone ?? 'Europe/Riga';
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
      <Title
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {user.username && <span>@{user.username}</span>}
            {user.isAdmin && <Badge>{ru.app.adminBadge}</Badge>}
            {user.offline && <Badge tone="hint">{ru.app.offline}</Badge>}
            {!user.offline && !user.isReachable && (
              <Badge tone="danger">{ru.app.unreachable}</Badge>
            )}
          </span>
        }
      >
        {displayName(user)}
      </Title>

      {attendance.map((a) => (
        <AttendanceSummary
          key={a.groupId}
          data={a}
          tz={tz}
          showStreak={permissions.canEditProfile}
        />
      ))}

      {permissions.canEditProfile && (
        <Section title={ru.app.profile}>
          {editing ? (
            <>
              <TextField
                label={ru.app.firstName}
                value={firstName}
                onChange={setFirstName}
                autoFocus
              />
              <TextField label={ru.app.lastName} value={lastName} onChange={setLastName} />
              <div className="flex gap-2 px-4 py-3">
                <Button
                  small
                  onClick={() => void saveEdit()}
                  disabled={!firstName.trim() || updateUser.isPending}
                >
                  {ru.app.save}
                </Button>
                <Button small variant="secondary" onClick={() => setEditing(false)}>
                  {ru.app.cancel}
                </Button>
              </div>
            </>
          ) : (
            <ActionRow onClick={startEdit}>{ru.app.edit}</ActionRow>
          )}
        </Section>
      )}

      {permissions.canEditProfile && (
        <Section footer={ru.app.guardianConsentHint}>
          <Toggle
            label={ru.app.guardianConsent}
            checked={user.guardianConsentAt !== null}
            disabled={updateUser.isPending}
            onChange={(v) => void updateUser.mutateAsync({ guardianConsent: v })}
          />
        </Section>
      )}

      <Section title={isSelf ? ru.app.myGroups : ru.app.groups}>
        {memberships.map((m) => (
          <div key={m.membershipId}>
            <Row
              title={m.groupName}
              subtitle={m.status === 'pending' ? ru.app.statusPending : undefined}
              after={m.role === 'leader' ? ru.app.roleLeader : ru.app.roleMember}
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
                {m.role === 'leader' ? ru.app.makeMember : ru.app.makeLeader}
              </ActionRow>
            )}
            {permissions.canEditProfile &&
              m.status === 'active' &&
              (actorIsAdmin || m.role !== 'leader') && (
                <ActionRow
                  destructive
                  disabled={updateMembership.isPending}
                  onClick={async () => {
                    if (await confirmDialog(ru.app.removeConfirm)) {
                      await updateMembership.mutateAsync({
                        membershipId: m.membershipId,
                        status: 'left',
                      });
                      if (memberships.length === 1) back();
                    }
                  }}
                >
                  {ru.app.removeFromGroup}
                </ActionRow>
              )}
          </div>
        ))}
      </Section>

      {permissions.canIssueClaimCode && (
        <Section title={ru.app.claimCode} footer={ru.app.claimCodeHint}>
          {claim ? (
            <LinkShare
              link={claim.link}
              shareText="Ссылка для привязки твоего профиля к Telegram"
            />
          ) : (
            <ActionRow
              disabled={issueClaim.isPending}
              onClick={async () => setClaim(await issueClaim.mutateAsync())}
            >
              {ru.app.issueClaimCode}
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
            {user.isAdmin ? ru.app.removeAdmin : ru.app.makeAdmin}
          </ActionRow>
        </Section>
      )}
    </Screen>
  );
}
