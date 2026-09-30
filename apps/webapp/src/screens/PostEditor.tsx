import { useRef, useState } from 'react';
import type { PosterLook } from '@church/shared';
import { IconImage, IconSend, IconX } from '../components/icons';
import { PosterMedia } from '../components/Poster';
import { useToast } from '../components/Toast';
import { Button, Screen, Section, TextArea, TextField, Title, Toggle } from '../components/ui';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useNav } from '../lib/nav';
import { useGroup, useSendAnnouncement, useTemplates, useUploadMedia } from '../lib/queries';
import { haptic } from '../lib/telegram';

const TINTS = [
  '#000000',
  '#1e293b',
  '#312e81',
  '#7c2d12',
  '#14532d',
  '#831843',
  '#0c4a6e',
  '#ffffff',
];

/** Compose a post or a poster: headline, text, photos (collage), tint and background. */
export function PostEditor({ groupId }: { groupId: number }) {
  const t = useT();
  const toast = useToast();
  const { replace } = useNav();
  const group = useGroup(groupId);
  const templates = useTemplates();
  const upload = useUploadMedia(groupId, 'event');
  const publish = useSendAnnouncement(groupId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  const [tintColor, setTintColor] = useState<string | null>('#000000');
  const [tintStrength, setTintStrength] = useState(0.35);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [notify, setNotify] = useState(true);
  const [uploading, setUploading] = useState<[number, number] | null>(null);

  const g = group.data;
  const tpl = templates.data?.find((x) => x.id === templateId);
  const look: PosterLook | null = tpl
    ? {
        brandColor: tpl.brandColor,
        pattern: tpl.pattern,
        textColor: tpl.textColor,
        logoUrl: tpl.logoUrl,
        backdrop: tpl.backdrop,
        backdropUrl: tpl.backdropUrl,
      }
    : g
      ? {
          brandColor: g.brandColor,
          pattern: g.pattern,
          textColor: g.textColor,
          logoUrl: g.logoUrl,
          backdrop: g.backdrop,
          backdropUrl: g.backdropUrl,
        }
      : null;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 10 - photos.length);
    try {
      for (const [i, file] of list.entries()) {
        setUploading([i + 1, list.length]);
        const m = await upload.mutateAsync(await preparePhoto(file));
        setPhotos((p) => [...p, m]);
      }
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submit() {
    try {
      await publish.mutateAsync({
        title: title.trim() || null,
        text: text.trim(),
        mediaIds: photos.map((p) => p.id),
        tintColor: photos.length && tintColor ? tintColor : null,
        tintStrength: photos.length && tintColor ? tintStrength : null,
        templateId,
        notify,
      });
      haptic.success();
      toast(t.feed.published);
      replace({ name: 'announcements', groupId });
    } catch {
      haptic.error();
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={g?.name}>{t.feed.newPost}</Title>

      {(photos.length > 0 || title.trim()) && (
        <section>
          <h2 className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
            {t.feed.preview}
          </h2>
          <div className="overflow-hidden rounded-[var(--radius-card)] shadow-card">
            <PosterMedia
              title={title.trim() || null}
              photos={photos}
              tint={
                photos.length && tintColor ? { color: tintColor, strength: tintStrength } : null
              }
              look={look}
            />
          </div>
        </section>
      )}

      <Section>
        <TextField label={t.feed.headline} value={title} onChange={setTitle} maxLength={120} />
      </Section>
      <Section title={t.feed.text}>
        <TextArea
          value={text}
          onChange={setText}
          placeholder={t.feed.textPlaceholder}
          maxLength={4000}
          rows={5}
        />
      </Section>

      <Section title={t.feed.photos}>
        <div className="flex flex-col gap-3 p-3">
          {photos.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-square overflow-hidden rounded-xl bg-hairline"
                >
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => setPhotos((list) => list.filter((x) => x.id !== p.id))}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <IconX size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void addPhotos(e.target.files)}
          />
          <Button
            variant="secondary"
            disabled={uploading !== null || photos.length >= 10}
            onClick={() => fileInput.current?.click()}
          >
            <IconImage size={18} />
            {uploading ? t.events.uploadingN(uploading[0], uploading[1]) : t.feed.addPhotos}
          </Button>
        </div>
      </Section>

      {photos.length > 0 ? (
        <Section title={t.feed.tint} footer={t.feed.tintHint}>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTintColor(null)}
                className={`flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-[13px] text-hint ${tintColor === null ? 'ring-2 ring-[var(--brand)]' : ''}`}
              >
                ∅
              </button>
              {TINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setTintColor(c)}
                  className={`h-9 w-9 rounded-full border border-hint/30 ${tintColor === c ? 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--color-section)]' : ''}`}
                  style={{ background: c }}
                />
              ))}
              <label
                className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full"
                style={{
                  background:
                    'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
                }}
              >
                <input
                  type="color"
                  value={tintColor ?? '#000000'}
                  onChange={(e) => setTintColor(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
            {tintColor && (
              <label className="block">
                <span className="mb-1 flex justify-between text-[14px]">
                  <span className="font-medium">{t.feed.tintStrength}</span>
                  <span className="text-hint">{Math.round(tintStrength * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={Math.round(tintStrength * 100)}
                  onChange={(e) => setTintStrength(Number(e.target.value) / 100)}
                  className="h-2 w-full accent-[var(--brand)]"
                />
              </label>
            )}
          </div>
        </Section>
      ) : (
        <Section title={t.feed.background}>
          <div className="flex flex-wrap gap-2 p-3">
            <button
              type="button"
              onClick={() => setTemplateId(null)}
              className={`min-h-[36px] rounded-full px-3.5 text-[14px] font-semibold ${templateId === null ? 'brand-gradient text-white' : 'bg-hairline'}`}
            >
              {t.feed.ministryLook}
            </button>
            {(templates.data ?? []).map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTemplateId(x.id)}
                className={`min-h-[36px] rounded-full px-3.5 text-[14px] font-semibold ${templateId === x.id ? 'brand-gradient text-white' : 'bg-hairline'}`}
              >
                {x.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <Toggle label={t.feed.notify} checked={notify} onChange={setNotify} />
      </Section>

      <Button
        onClick={() => void submit()}
        disabled={!text.trim() || publish.isPending || uploading !== null}
      >
        <IconSend size={18} /> {publish.isPending ? t.feed.publishing : t.feed.publish}
      </Button>
    </Screen>
  );
}
