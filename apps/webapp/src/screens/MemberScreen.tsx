import { useRef, useState } from 'react';
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
import { LabelPicker } from '../components/LabelChip';
import { LabelChip, PersonName } from '../components/LabelLook';
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
  useProfilePhoto,
  useSetAdmin,
  useUploadMedia,
  useUpdateMembership,
  useUpdateUser,
} from '../lib/queries';
import { preparePhoto } from '../lib/image';
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
  // Every label the person has (across ministries, once each), right by the name.
  const headerLabels = [
    ...new Map(
      memberships
        .filter((m) => m.status === 'active')
        .flatMap((m) => m.labels)
        .map((l) => [l.id, l] as const),
    ).values(),
  ];

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
        <ProfilePhoto
          user={user}
          groupId={memberships.find((m) => m.status === 'active')?.groupId ?? null}
          editable={permissions.canEditPhoto}
        />
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">
          <PersonName
            name={displayName(user)}
            labels={headerLabels}
            positionLook={
              memberships.find((m) => m.status === 'active' && m.positionLook?.nameStyle)
                ?.positionLook
            }
            isAdmin={user.isAdmin}
          />
        </h1>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[15px] text-hint">
          {user.username && <span>@{user.username}</span>}
          {user.isAdmin && <Badge>{t.roles.admin}</Badge>}
          {headerLabels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {user.offline && <Badge tone="hint">{t.common.offline}</Badge>}
          {!user.offline && !user.isReachable && (
            <Badge tone="danger">{t.common.unreachable}</Badge>
          )}
        </div>
        {permissions.canEditPhoto && !user.photoUrl && (
          <p className="max-w-[300px] text-[13px] leading-snug text-hint">{t.member.photoAdd}</p>
        )}
      </header>

      {attendance.map(
        (a) =>
          a.visible && (
            <AttendanceSummary key={a.groupId} data={a} showStreak={permissions.canEditProfile} />
          ),
      )}

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
                after={
                  m.positionName ? (
                    m.positionLook ? (
                      <LabelChip label={{ ...m.positionLook, name: m.positionName }} />
                    ) : (
                      <Badge>{m.positionName}</Badge>
                    )
                  ) : undefined
                }
              />
              {m.status === 'active' && canIn(m.groupId, 'people.manage') && (
                <div className="px-4 pb-3">
                  <LabelPicker groupId={m.groupId} userId={user.id} current={m.labels} />
                </div>
              )}
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

/**
 * The person's photo, big, with a camera button to add or change it (themselves, or whoever
 * manages them). It shows on meeting cards and is the speaker's photo on generated posters.
 */
function ProfilePhoto({
  user,
  groupId,
  editable,
}: {
  user: MemberDetail['user'];
  /** A ministry the person is in: the picture is stored as its upload. */
  groupId: number | null;
  editable: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia(groupId ?? 0, 'event');
  const save = useProfilePhoto(user.id);
  const [menu, setMenu] = useState(false);
  const busy = upload.isPending || save.isPending;

  async function pick(file: File | undefined) {
    if (!file || !groupId) return;
    try {
      const media = await upload.mutateAsync(await preparePhoto(file, 800));
      await save.mutateAsync(media.id);
      haptic.success();
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const avatar = (
    <Avatar
      id={user.id}
      firstName={user.firstName}
      lastName={user.lastName}
      size={96}
      photoUrl={user.photoUrl}
    />
  );
  if (!editable || !groupId) return avatar;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        aria-label={t.member.photoChange}
        disabled={busy}
        onClick={() => (user.photoUrl ? setMenu(true) : input.current?.click())}
        className={`relative rounded-full active:scale-95 ${busy ? 'animate-pulse' : ''}`}
      >
        {avatar}
        <span className="brand-gradient absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[15px] text-white shadow-cta ring-2 ring-[var(--color-bg)]">
          📷
        </span>
      </button>
      <Sheet open={menu} onClose={() => setMenu(false)} title={t.member.photo}>
        <SheetOption
          label={t.member.photoChange}
          onClick={() => {
            setMenu(false);
            input.current?.click();
          }}
        />
        <SheetOption
          label={t.member.photoRemove}
          tone="destructive"
          onClick={() => {
            setMenu(false);
            void save.mutateAsync(null).catch(() => toast(t.common.actionFailed, 'error'));
          }}
        />
      </Sheet>
    </>
  );
}
