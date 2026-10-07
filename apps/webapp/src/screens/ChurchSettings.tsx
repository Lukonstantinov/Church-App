import { BackgroundEditor } from '../components/BackgroundEditor';
import { useRef, useState } from 'react';
import { LOCALE_NAMES, LOCALES, type Locale } from '@church/shared';
import { ChurchLogo } from '../components/BrandHeader';
import { IconImage, IconTrash } from '../components/icons';
import { useToast } from '../components/Toast';
import { ActionRow, Button, Row, Screen, Section, TextField, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { prepareLogo, squareJpeg } from '../lib/image';
import { ThemePicker } from '../components/ThemePicker';
import { GroupDot } from '../components/GroupSwitcher';
import {
  useArchivedGroups,
  useMe,
  useRemoveLogo,
  useRestoreGroup,
  useSetBotPhoto,
  useUpdateChurch,
  useUploadLogo,
} from '../lib/queries';
import { applyBrand } from '../lib/theme';
import { confirmDialog, haptic } from '../lib/telegram';

const TIMEZONES = [
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/Prague',
  'Europe/Dublin',
  'Europe/London',
  'Europe/Kyiv',
  'Europe/Chisinau',
  'Europe/Madrid',
  'Europe/Oslo',
  'Europe/Stockholm',
];

export function ChurchSettings() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const church = me.data!.church;
  const update = useUpdateChurch();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(church.name);
  const [sheetLabel, setSheetLabel] = useState(church.sheetLabel ?? '');

  const zones = TIMEZONES.includes(church.timezone) ? TIMEZONES : [church.timezone, ...TIMEZONES];

  async function patch(input: Parameters<typeof update.mutateAsync>[0]) {
    try {
      await update.mutateAsync(input);
      haptic.success();
      toast(t.common.saved);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  async function pickColor(key: string) {
    applyBrand(key); // preview instantly
    haptic.tap();
    await patch({ brandColor: key });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await upload.mutateAsync(await prepareLogo(file));
      haptic.success();
      toast(t.settings.logoUpdated);
    } catch {
      haptic.error();
      toast(t.settings.logoFailed, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const select =
    'min-h-[44px] w-full rounded-xl bg-hairline px-3 text-[16px] font-medium outline-none';

  return (
    <Screen>
      <Title>{t.settings.title}</Title>

      {/* Live preview of what everyone sees at the top of the app. */}
      <div className="brand-gradient relative overflow-hidden rounded-[var(--radius-card)] p-5 text-white shadow-cta">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl"
        />
        <div className="relative flex items-center gap-3">
          <ChurchLogo size={56} />
          <div className="min-w-0">
            <div className="truncate text-[20px] font-bold">{name.trim() || church.name}</div>
            <div className="text-[14px] text-white/80">
              {LOCALE_NAMES[church.defaultLocale]} · {church.timezone}
            </div>
          </div>
        </div>
      </div>

      <Section title={t.appBg.title}>
        <BackgroundEditor
          church
          value={church.appBackground}
          look={{ brandColor: church.brandColor, pattern: null, logoUrl: church.logoUrl }}
          saving={update.isPending}
          onSave={async (appBackground) => {
            await update.mutateAsync({ appBackground });
          }}
        />
      </Section>

      <Section title={t.settings.name}>
        <TextField label={t.settings.name} value={name} onChange={setName} maxLength={80} />
        <div className="p-3">
          <Button
            small
            onClick={() => void patch({ name })}
            disabled={!name.trim() || name.trim() === church.name || update.isPending}
          >
            {t.common.save}
          </Button>
        </div>
      </Section>

      <Section title={t.settings.sheetLabel} footer={t.settings.sheetLabelHint}>
        <TextField
          label={t.settings.sheetLabel}
          value={sheetLabel}
          onChange={setSheetLabel}
          maxLength={40}
        />
        <div className="p-3">
          <Button
            small
            onClick={() => void patch({ sheetLabel: sheetLabel.trim() || null })}
            disabled={sheetLabel.trim() === (church.sheetLabel ?? '') || update.isPending}
          >
            {t.common.save}
          </Button>
        </div>
      </Section>

      <Section title={t.settings.logo} footer={t.settings.logoHint}>
        <div className="flex items-center gap-4 p-4">
          <ChurchLogo size={72} />
          <div className="flex flex-1 flex-col gap-2">
            <Button small onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              <IconImage size={17} />{' '}
              {church.logoUrl ? t.settings.changeLogo : t.settings.uploadLogo}
            </Button>
          </div>
        </div>
        {church.logoUrl && (
          <ActionRow
            destructive
            icon={<IconTrash size={18} />}
            disabled={removeLogo.isPending}
            onClick={async () => {
              if (await confirmDialog(`${t.settings.removeLogo}?`)) await removeLogo.mutateAsync();
            }}
          >
            {t.settings.removeLogo}
          </ActionRow>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </Section>

      <BotPhotoSection />

      <Section title={t.settings.color} footer={t.settings.colorHint}>
        <ThemePicker value={church.brandColor} onChange={(v) => v && void pickColor(v)} />
      </Section>

      <Section title={t.settings.defaultLanguage} footer={t.settings.defaultLanguageHint}>
        <div className="p-3">
          <select
            className={select}
            value={church.defaultLocale}
            onChange={(e) => void patch({ defaultLocale: e.target.value as Locale })}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title={t.settings.timezone} footer={t.settings.timezoneHint}>
        <div className="p-3">
          <select
            className={select}
            value={church.timezone}
            onChange={(e) => void patch({ timezone: e.target.value })}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </Section>
      <ArchivedMinistries />
    </Screen>
  );
}

/** Deleted ministries, with a way back. */
function ArchivedMinistries() {
  const t = useT();
  const toast = useToast();
  const list = useArchivedGroups(true);
  const restore = useRestoreGroup();
  if (!list.data?.length) return null;
  return (
    <Section title={t.env.archived}>
      {list.data.map((g) => (
        <Row
          key={g.id}
          before={<GroupDot id={g.id} theme={g.brandColor} size={12} />}
          title={g.name}
          subtitle={t.common.members(g.activeCount)}
          after={
            <Button
              small
              variant="secondary"
              disabled={restore.isPending}
              onClick={async () => {
                await restore.mutateAsync(g.id);
                toast(t.env.restored);
              }}
            >
              {t.env.restore}
            </Button>
          }
        />
      ))}
    </Section>
  );
}

/** The bot's profile photo, which is also the icon of the app on phones' home screens. */
function BotPhotoSection() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const church = me.data!.church;
  const set = useSetBotPhoto();
  const file = useRef<HTMLInputElement>(null);
  async function send(src: File | string) {
    try {
      await set.mutateAsync(await squareJpeg(src));
      haptic.success();
      toast(t.settings.botPhotoDone);
    } catch {
      haptic.error();
      toast(t.settings.botPhotoFailed, 'error');
    }
  }
  return (
    <Section title={t.settings.botPhoto} footer={t.settings.botPhotoHint}>
      <div className="flex flex-wrap gap-2 p-3">
        {church.logoUrl && (
          <Button small disabled={set.isPending} onClick={() => void send(church.logoUrl!)}>
            {t.settings.botPhotoFromLogo}
          </Button>
        )}
        <Button
          small
          variant="glass"
          disabled={set.isPending}
          onClick={() => file.current?.click()}
        >
          <IconImage size={17} /> {t.settings.botPhotoPick}
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void send(f);
        }}
      />
    </Section>
  );
}
