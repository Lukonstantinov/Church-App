import { useState } from 'react';
import {
  PERMISSIONS,
  displayName,
  type ClaimCodeResponse,
  type MemberDetail,
  type Permission,
} from '@church/shared';
import { Sheet, SheetOption } from '../components/Sheet';
import { useToast } from '../components/Toast';
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
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useGroups,
  useIssueClaimCode,
  useMe,
  usePositions,
  useMemberDetail,
  useSetAdmin,
  useUpdateMembership,
  useUpdateUser,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

export function MemberScreen({ userId }: { userId: number }) {
  const { back } = useNav();
  const t = useT();
  const toast = useToast();
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
  const [positionFor, setPositionFor] = useState<MemberDetail['memberships'][number] | null>(null);
  const groups = useGroups();
  const canIn = (groupId: number, p: Permission) =>
    groups.data?.find((g) => g.id === groupId)?.myPermissions.includes(p) ?? false;

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

      {memberships.length > 0 && (
        <Section title={isSelf ? t.member.myGroups : t.member.groups}>
          {memberships.map((m) => (
            <div key={m.membershipId}>
              <Row
                before={<GroupDot id={m.groupId} theme={m.brandColor} />}
                title={m.groupName}
                subtitle={m.status === 'pending' ? t.member.statusPending : undefined}
                after={m.positionName ? <Badge>{m.positionName}</Badge> : undefined}
              />
              {m.status === 'active' && canIn(m.groupId, 'positions') && !isSelf && (
                <ActionRow onClick={() => setPositionFor(m)}>{t.positions.choose}</ActionRow>
              )}
              {permissions.canEditProfile &&
                m.status === 'active' &&
                (actorIsAdmin || m.permissions.length === 0) && (
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
      <PositionSheet
        membership={positionFor}
        onClose={() => setPositionFor(null)}
        onPick={async (positionId) => {
          if (!positionFor) return;
          try {
            await updateMembership.mutateAsync({
              membershipId: positionFor.membershipId,
              positionId,
            });
            haptic.success();
          } catch {
            haptic.error();
            toast(t.positions.escalation, 'error');
          }
          setPositionFor(null);
        }}
      />
    </Screen>
  );
}

/** Choose a member's position in one ministry. */
function PositionSheet({
  membership,
  onClose,
  onPick,
}: {
  membership: MemberDetail['memberships'][number] | null;
  onClose: () => void;
  onPick: (positionId: number) => void;
}) {
  const t = useT();
  const positions = usePositions(membership?.groupId ?? 0, membership !== null);
  return (
    <Sheet open={membership !== null} onClose={onClose} title={t.positions.choose}>
      {(positions.data ?? []).map((p) => (
        <SheetOption
          key={p.id}
          label={p.name}
          hint={
            p.permissions.length
              ? t.positions.rightsCount(p.permissions.length, PERMISSIONS.length)
              : t.positions.noRights
          }
          selected={p.name === membership?.positionName}
          onClick={() => onPick(p.id)}
        />
      ))}
    </Sheet>
  );
}
