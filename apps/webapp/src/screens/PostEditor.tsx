import { useRef, useState } from 'react';
import { capturePoster } from '../lib/poster';
import { recordPosterVideo } from '../lib/movingPoster';
import { FullMotion } from '../lib/perf';
import { CoverEffects, effectsPayload, initEffects } from '../components/CoverEffects';
import { MotionExport } from '../components/MotionExport';
import { PosterTextLayer } from '../components/PosterText';
import {
  POST_KINDS,
  POST_KIND_KEYS,
  fontFamily,
  type AnnouncementRow,
  type PostDesign,
  type PostKind,
} from '@church/shared';
import {
  BLOCK_ICONS,
  BLOCK_TYPES,
  BlockEditor,
  newBlock,
  toDraft,
  toInput,
  useBlockUploads,
  type DraftBlock,
} from '../components/BlockEditor';
import {
  CoverLookControls,
  TitleStyleControls,
  coverPayload,
  initCover,
  useCoverLook,
  type CoverState,
} from '../components/CoverDesigner';
import { FontPicker } from '../components/FontPicker';
import { IconImage, IconSend, IconX } from '../components/icons';
import { Pill } from '../components/LookControls';
import { PosterMedia } from '../components/Poster';
import { useToast } from '../components/Toast';
import {
  Button,
  Loading,
  Screen,
  Section,
  TextArea,
  TextField,
  Title,
  Toggle,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useMayDesign } from '../lib/env';
import { useNav } from '../lib/nav';
import {
  useEditPost,
  useFeed,
  useGroup,
  useSendAnnouncement,
  useUploadMedia,
} from '../lib/queries';
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

/** Compose a post or a poster; with `postId`, edit that post. */
export function PostEditor({ groupId, postId }: { groupId: number; postId?: number }) {
  const feed = useFeed(groupId);
  if (postId === undefined) return <PostForm groupId={groupId} />;
  const post = feed.data?.pages.flat().find((p) => p.id === postId);
  return post ? <PostForm groupId={groupId} post={post} /> : <Loading />;
}

/**
 * Type, cover (ministry look with its own colour, an own look with the full designer,
 * or a template), headline fonts and placement, text, photos, and content blocks.
 */
function PostForm({ groupId, post }: { groupId: number; post?: AnnouncementRow }) {
  const t = useT();
  const toast = useToast();
  const { replace } = useNav();
  const group = useGroup(groupId);
  const upload = useUploadMedia(groupId, 'event');
  const publish = useSendAnnouncement(groupId);
  const save = useEditPost(groupId);
  const fileInput = useRef<HTMLInputElement>(null);
  // With looks locked to designers, others keep the type, cover and tint as they are.
  const mayDesignHere = useMayDesign();
  const mayDesign = post ? post.canDesign : mayDesignHere;
  const [title, setTitle] = useState(post?.title ?? '');
  const [text, setText] = useState(post?.text ?? '');
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>(post?.photos ?? []);
  const [tintColor, setTintColor] = useState<string | null>(
    post ? (post.tint?.color ?? null) : '#000000',
  );
  const [tintStrength, setTintStrength] = useState(post?.tint?.strength ?? 0.35);
  const [cover, setCover] = useState<CoverState>(() =>
    initCover(post?.design, post?.templateId, post?.look, true),
  );
  const design = cover.design;
  const [blocks, setBlocks] = useState<DraftBlock[]>(post?.blocks.map(toDraft) ?? []);
  const [notify, setNotify] = useState(true);
  const [uploading, setUploading] = useState<[number, number] | null>(null);
  const [making, setMaking] = useState(false);
  // Moving effects over the cover (stored in the design), and the picture sent with it.
  const [fxOpen, setFxOpen] = useState(false);
  const fx = initEffects({
    motion: design.effects?.motion ?? null,
    motionTune: design.effects?.motionTune ?? null,
    motionLayers: design.effects?.motionLayers ?? [],
  });
  const moves = fx.effects.length > 0;
  const [moving, setMoving] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const posterNode = useRef<HTMLDivElement>(null);
  const addBlock = (b: DraftBlock) => setBlocks((list) => [...list, b]);
  const uploads = useBlockUploads(groupId, addBlock);
  const pending = publish.isPending || save.isPending || making;
  const set = (patch: Partial<PostDesign>) =>
    setCover((c) => ({ ...c, design: { ...c.design, ...patch } }));

  const g = group.data;
  const { look, templateId } = useCoverLook(cover, g);
  const coverShown = photos.length > 0 || design.banner;

  function pickKind(kind: PostKind | null) {
    haptic.tap();
    // A type brings its colour unless a colour was already picked by hand.
    const kindColor = (k: PostKind | null | undefined) => (k ? POST_KINDS[k].color : null);
    const auto = !design.brandColor || design.brandColor === kindColor(design.kind);
    set({ kind, ...(auto ? { brandColor: kindColor(kind) } : {}) });
  }

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

  const blockInput = toInput(blocks);
  const canSubmit = !!(text.trim() || title.trim() || blockInput.length);

  /** The cover as a picture (for the bot message): drawn at full size off screen, then uploaded. */
  async function makePoster(): Promise<number | null> {
    if (!coverShown || !posterNode.current) return null;
    // The moving cover: recorded now (plays like a GIF in Telegram); else the still one.
    if (moving && moves && notify) {
      setRecording(0);
      try {
        await new Promise((r) => setTimeout(r, 400));
        const id = await recordPosterVideo(posterNode.current, groupId, setRecording);
        if (id) return id;
      } catch (err) {
        console.warn('moving post poster failed', err);
      } finally {
        setRecording(null);
      }
    }
    const blob = await capturePoster(posterNode.current);
    if (!blob) return null;
    return upload
      .mutateAsync(blob)
      .then((m) => m.id)
      .catch(() => null);
  }

  async function submit() {
    setMaking(true);
    const posterMediaId = await makePoster();
    setMaking(false);
    const input = {
      posterMediaId,
      title: title.trim() || null,
      text: text.trim(),
      mediaIds: photos.map((p) => p.id),
      ...(post && !mayDesign
        ? // Not theirs to change: the look goes back exactly as it was.
          {
            tintColor: post.tint?.color ?? null,
            tintStrength: post.tint?.strength ?? null,
            templateId: post.templateId,
            design: post.design,
          }
        : {
            tintColor: photos.length && tintColor ? tintColor : null,
            tintStrength: photos.length && tintColor ? tintStrength : null,
            ...coverPayload(cover, templateId),
          }),
      blocks: blockInput,
    };
    try {
      if (post) {
        await save.mutateAsync({ postId: post.id, input });
        haptic.success();
        toast(t.common.saved);
        replace({ name: 'post', groupId, postId: post.id });
        return;
      }
      await publish.mutateAsync({ ...input, notify });
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
      <Title subtitle={g?.name}>{post ? t.feed.editingPost : t.feed.newPost}</Title>

      {/* The cover stays in view while scrolling through the settings. */}
      {coverShown && (
        <div className="glass-strong sticky top-0 z-10 -mx-4 rounded-b-[26px] px-4 pb-3 pt-3">
          <div className="overflow-hidden rounded-[var(--radius-card)] shadow-card">
            <PosterMedia
              title={title.trim() || null}
              photos={photos}
              tint={
                photos.length && tintColor ? { color: tintColor, strength: tintStrength } : null
              }
              look={look}
              design={design}
            />
          </div>
        </div>
      )}

      {/* The same cover at full size, off screen: the picture sent with the post is taken from it. */}
      {coverShown && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 720 }}>
          <div ref={posterNode}>
            <FullMotion.Provider value={recording !== null}>
              <PosterMedia
                title={title.trim() || null}
                photos={photos}
                tint={
                  photos.length && tintColor ? { color: tintColor, strength: tintStrength } : null
                }
                look={look}
                design={design}
              />
            </FullMotion.Provider>
          </div>
        </div>
      )}

      {!mayDesign && <p className="px-4 text-[13px] text-hint">🔒 {t.design.lockedHint}</p>}
      <Section title={t.feed.kind}>
        <fieldset disabled={!mayDesign} className="flex flex-wrap gap-2 p-3 disabled:opacity-60">
          <Pill on={!design.kind} onClick={() => pickKind(null)} label={t.feed.kindNone} />
          {POST_KIND_KEYS.map((k) => (
            <Pill
              key={k}
              on={design.kind === k}
              onClick={() => pickKind(k)}
              label={`${POST_KINDS[k].emoji} ${t.feed.kinds[k]}`}
            />
          ))}
        </fieldset>
      </Section>

      {mayDesign && (
        <Section title={t.feed.cover} footer={t.feed.coverHint}>
          <Toggle
            label={t.feed.showCover}
            checked={design.banner}
            onChange={(v) => set({ banner: v })}
          />
          {coverShown && (
            <div className="border-t border-hairline p-4">
              <CoverLookControls state={cover} onChange={setCover} g={g} groupId={groupId} />
            </div>
          )}
        </Section>
      )}

      {mayDesign && coverShown && (
        <CoverEffects
          state={fx}
          onChange={(st) => set({ effects: effectsPayload(st) })}
          open={fxOpen}
          onOpen={setFxOpen}
        />
      )}

      <Section title={t.feed.headline}>
        <TextField label={t.feed.headline} value={title} onChange={setTitle} maxLength={120} />
        {title.trim() && (
          <div className="border-t border-hairline p-4">
            <TitleStyleControls design={design} set={set} />
          </div>
        )}
      </Section>

      <Section title={t.feed.text}>
        <div style={{ fontFamily: fontFamily(design.bodyFont) }}>
          <TextArea
            value={text}
            onChange={setText}
            placeholder={t.feed.textPlaceholder}
            maxLength={4000}
            rows={5}
          />
        </div>
        <div className="border-t border-hairline p-3">
          <FontPicker
            label={t.feed.bodyFont}
            value={design.bodyFont}
            onChange={(v) => set({ bodyFont: v })}
          />
        </div>
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

      {photos.length > 0 && mayDesign && (
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
      )}

      <Section title={t.feed.extras}>
        <div className="flex flex-col gap-3 p-3">
          {blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              first={i === 0}
              last={i === blocks.length - 1}
              onChange={(nb) => setBlocks((list) => list.map((x) => (x.id === b.id ? nb : x)))}
              onRemove={() => setBlocks((list) => list.filter((x) => x.id !== b.id))}
              onMove={(dir) =>
                setBlocks((list) => {
                  const next = [...list];
                  const j = i + dir;
                  [next[i], next[j]] = [next[j]!, next[i]!];
                  return next;
                })
              }
            />
          ))}
          {uploads.inputs}
          <div className="grid grid-cols-3 gap-2">
            {BLOCK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                disabled={uploads.busy || blocks.length >= 30}
                onClick={() => {
                  haptic.tap();
                  if (type === 'image') return uploads.pickImages();
                  if (type === 'file') return uploads.pickFile();
                  const b = newBlock(type);
                  if (b) addBlock(b);
                }}
                className="flex flex-col items-center gap-1 rounded-2xl bg-hairline px-2 py-3 text-[13px] font-semibold active:scale-95 disabled:opacity-45"
              >
                <span className="text-[22px]">{BLOCK_ICONS[type]}</span>
                {t.feed.blockTypes[type]}
              </button>
            ))}
          </div>
          {uploads.busy && <p className="text-center text-[13px] text-hint">{t.common.saving}</p>}
          <p className="text-[13px] text-hint">{t.feed.fileHint}</p>
        </div>
      </Section>

      {/* The moving poster to oneself (to forward), with own words on it or none. */}
      {coverShown && moves && (
        <MotionExport
          name={title.trim() || t.freePoster.fileName}
          caption={[title.trim(), text.trim()].filter(Boolean).join('\n\n').slice(0, 1000)}
          preview={{
            preset: title.trim(),
            modes: ['design', 'custom', 'none'],
            render: (words) => (
              <>
                <PosterMedia
                  title={words.mode === 'design' ? title.trim() || null : null}
                  photos={photos}
                  tint={
                    photos.length && tintColor ? { color: tintColor, strength: tintStrength } : null
                  }
                  look={look}
                  design={design}
                />
                <PosterTextLayer value={words} />
              </>
            ),
          }}
        />
      )}

      {!post && (
        <Section>
          <Toggle label={t.feed.notify} checked={notify} onChange={setNotify} />
          {notify && coverShown && moves && (
            <div className="flex flex-col gap-2 border-t border-hairline p-4">
              <div className="text-[13px] font-semibold">{t.meetings.pictureTitle}</div>
              <div className="flex flex-wrap gap-1.5">
                {([false, true] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      setMoving(v);
                    }}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                      moving === v ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                    }`}
                  >
                    {v ? t.events.picture.moving : t.events.picture.still}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
      {recording !== null && (
        <p className="text-center text-[13px] text-hint">
          {t.motionExport.recording(Math.round(recording * 100))}
        </p>
      )}

      <Button onClick={() => void submit()} disabled={!canSubmit || pending || uploading !== null}>
        {post ? (
          pending ? (
            t.common.saving
          ) : (
            t.feed.saveChanges
          )
        ) : (
          <>
            <IconSend size={18} /> {pending ? t.feed.publishing : t.feed.publish}
          </>
        )}
      </Button>
    </Screen>
  );
}
