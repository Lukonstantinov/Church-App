import { useRef, useState, type ReactNode } from 'react';
import {
  MAX_SPEAKERS,
  SPEAKER_EDGES,
  SPEAKER_PLACES,
  SPEAKER_SHAPES,
  displayName,
  type Speaker,
  type SpeakerInput,
  type SpeakerLook,
} from '@church/shared';
import { preparePhoto } from '../lib/image';
import { useT } from '../lib/i18n';
import { useMembers, useUploadMedia } from '../lib/queries';
import { IconCamera, IconPlus, IconX } from './icons';
import { Pill } from './LookControls';
import { Knob } from './MotionTune';
import { PersonPicker } from './PersonPicker';
import { useToast } from './Toast';

/** A speaker while it is being edited (the photo is already uploaded; `photoUrl` previews it). */
export interface SpeakerDraft {
  name: string;
  role: string;
  mediaId: number | null;
  photoUrl: string | null;
  /** Picked from the people: their profile photo stands in for an own one. */
  userId?: number | null;
}

export const toDrafts = (list: Speaker[] | undefined): SpeakerDraft[] =>
  (list ?? []).map((s) => ({
    name: s.name,
    role: s.role ?? '',
    mediaId: s.mediaId,
    photoUrl: s.photoUrl,
    userId: s.userId ?? null,
  }));

/** What the API stores: named speakers only, at most four. */
export const toSpeakerInputs = (drafts: SpeakerDraft[]): SpeakerInput[] =>
  drafts
    .filter((d) => d.name.trim())
    .slice(0, MAX_SPEAKERS)
    .map((d) => ({
      name: d.name.trim(),
      role: d.role.trim() || null,
      mediaId: d.mediaId,
      userId: d.userId ?? null,
    }));

/** The speakers as shown on a poster or a screen (drafts count too, for live previews). */
export const toShown = (drafts: SpeakerDraft[]): Speaker[] =>
  toSpeakerInputs(drafts).map((s, i) => ({
    name: s.name,
    role: s.role ?? null,
    mediaId: s.mediaId ?? null,
    userId: s.userId ?? null,
    photoUrl: drafts.filter((d) => d.name.trim())[i]?.photoUrl ?? null,
  }));

/** Speakers that will show initials instead of a photo (a warning before sending). */
export const withoutPhoto = (list: Speaker[]): string[] =>
  list.filter((s) => s.name.trim() && !s.photoUrl).map((s) => s.name.trim());

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

const SIZES = {
  sm: { photo: 44, name: 'text-[11px]', role: 'text-[10px]', gap: 'gap-2.5' },
  md: { photo: 64, name: 'text-[13px]', role: 'text-[11px]', gap: 'gap-3' },
  lg: { photo: 96, name: 'text-[22px]', role: 'text-[17px]', gap: 'gap-5' },
} as const;

/** The edge around a speaker's photo, as a shadow (it follows any shape). */
function edgeShadow(edge: SpeakerLook['edge'], brand: string): string | undefined {
  switch (edge ?? 'white') {
    case 'none':
      return undefined;
    case 'brand':
      return `0 0 0 3px ${brand}`;
    case 'gold':
      return '0 0 0 3px #e9c46a, 0 0 0 5px rgba(120, 80, 0, 0.45)';
    case 'glow':
      return '0 0 0 2px #fff, 0 0 18px 5px rgba(255, 255, 255, 0.75)';
    case 'shadow':
      return '0 8px 22px rgba(0, 0, 0, 0.5)';
    default:
      return '0 0 0 2px rgba(255, 255, 255, 0.8), 0 4px 14px rgba(0, 0, 0, 0.25)';
  }
}

const RADIUS = { circle: '9999px', rounded: '24%', square: '8%' } as const;
const LOOK_SIZE = { s: 'sm', m: 'md', l: 'lg' } as const;

/**
 * Up to four speakers in a row (or a column): photo (or initials), name and what they
 * speak about. `onColor` = white text, for use on a coloured or photo background. `look`
 * (from the poster's design) sets how see-through the photos are, their edge, shape, size.
 */
export function SpeakerStrip({
  speakers,
  size = 'md',
  onColor,
  className = '',
  look,
  brand = '#ffffff',
  vertical,
}: {
  speakers: Speaker[];
  size?: keyof typeof SIZES;
  onColor?: boolean;
  className?: string;
  look?: SpeakerLook | null;
  /** The poster's colour, for the "colour" edge. */
  brand?: string;
  /** One under another (a column at the side of the poster). */
  vertical?: boolean;
}) {
  if (speakers.length === 0) return null;
  const wanted = look?.size ? LOOK_SIZE[look.size] : size;
  // A column at the side has less room: never larger than medium, small for three or more.
  const s =
    SIZES[
      vertical && speakers.length > 2
        ? 'sm'
        : vertical && wanted === 'lg' && speakers.length > 1
          ? 'md'
          : wanted
    ];
  const photo = {
    width: s.photo,
    height: s.photo,
    borderRadius: RADIUS[look?.shape ?? 'circle'],
    boxShadow: edgeShadow(look?.edge, brand),
    opacity: look?.opacity ?? 1,
  };
  return (
    <div
      className={`flex ${vertical ? 'flex-col items-center' : 'flex-wrap items-start justify-center'} ${s.gap} ${className}`}
    >
      {speakers.slice(0, MAX_SPEAKERS).map((sp, i) => (
        <div
          key={`${sp.name}${i}`}
          className="flex min-w-0 flex-col items-center text-center"
          style={{ width: s.photo + (s === SIZES.lg ? 52 : 28) }}
        >
          {sp.photoUrl ? (
            <img src={sp.photoUrl} alt="" className="object-cover" style={photo} />
          ) : (
            <span
              className="flex items-center justify-center bg-white/25 font-bold"
              style={{ ...photo, fontSize: s.photo / 2.8 }}
            >
              {initials(sp.name)}
            </span>
          )}
          <span
            className={`mt-1 w-full truncate font-bold leading-tight ${s.name} ${onColor ? '' : 'text-[var(--text)]'}`}
          >
            {sp.name}
          </span>
          {sp.role && (
            <span
              className={`w-full truncate leading-tight ${s.role} ${onColor ? 'opacity-85' : 'text-hint'}`}
            >
              {sp.role}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The poster settings for the speakers' photos: place, edge, shape, size, see-through. */
export function SpeakerLookControls({
  value,
  onChange,
}: {
  value: SpeakerLook | null | undefined;
  onChange: (v: SpeakerLook) => void;
}) {
  const t = useT();
  const v = value ?? {};
  const set = (p: Partial<SpeakerLook>) => onChange({ ...v, ...p });
  const row = (children: ReactNode, title: string) => (
    <div>
      <div className="mb-1.5 text-[13px] text-hint">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {row(
        SPEAKER_PLACES.map((p) => (
          <Pill
            key={p}
            on={(v.place ?? 'inline') === p}
            onClick={() => set({ place: p })}
            label={t.meetings.speakerPlaces[p]}
          />
        )),
        t.meetings.speakerPlace,
      )}
      {row(
        SPEAKER_EDGES.map((e) => (
          <Pill
            key={e}
            on={(v.edge ?? 'white') === e}
            onClick={() => set({ edge: e })}
            label={t.meetings.speakerEdges[e]}
          />
        )),
        t.meetings.speakerEdge,
      )}
      {row(
        SPEAKER_SHAPES.map((sh) => (
          <Pill
            key={sh}
            on={(v.shape ?? 'circle') === sh}
            onClick={() => set({ shape: sh })}
            label={t.meetings.speakerShapes[sh]}
          />
        )),
        t.meetings.speakerShape,
      )}
      {row(
        (['s', 'm', 'l'] as const).map((z) => (
          <Pill
            key={z}
            on={(v.size ?? 'm') === z}
            onClick={() => set({ size: z })}
            label={t.meetings.speakerSizes[z]}
          />
        )),
        t.meetings.speakerSize,
      )}
      <Knob
        label={t.meetings.speakerOpacity}
        value={v.opacity ?? 1}
        min={0.2}
        max={1}
        step={0.05}
        show={(x) => `${Math.round(x * 100)}%`}
        onChange={(opacity) => set({ opacity })}
      />
    </div>
  );
}

/** Edits up to four speakers: photo (optional), name and a line about them. */
export function SpeakersEditor({
  groupId,
  value,
  onChange,
}: {
  groupId: number;
  value: SpeakerDraft[];
  onChange: (v: SpeakerDraft[]) => void;
}) {
  const t = useT();
  const toast = useToast();
  const upload = useUploadMedia(groupId, 'event');
  const file = useRef<HTMLInputElement>(null);
  const target = useRef(0);
  const [picking, setPicking] = useState(false);
  const members = useMembers(groupId, picking);
  const people = (members.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({
      id: m.userId,
      firstName: m.firstName,
      lastName: m.lastName,
      username: m.username,
      photoUrl: m.photoUrl,
    }));
  const set = (i: number, patch: Partial<SpeakerDraft>) =>
    onChange(value.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  async function pick(f: File | undefined) {
    if (!f) return;
    const i = target.current;
    try {
      const m = await upload.mutateAsync(await preparePhoto(f, 600));
      set(i, { mediaId: m.id, photoUrl: m.url });
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  const field = 'w-full bg-transparent text-[16px] outline-none placeholder:text-hint';
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <p className="text-[13px] leading-snug text-hint">{t.meetings.speakersHint}</p>
      {value.map((sp, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl bg-hairline/60 p-2.5">
          <button
            type="button"
            aria-label={t.meetings.speakerPhoto}
            disabled={upload.isPending}
            onClick={() => {
              target.current = i;
              file.current?.click();
            }}
            className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/60 text-hint active:scale-95"
          >
            {sp.photoUrl ? (
              <img src={sp.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <IconCamera size={22} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <input
              className={`${field} font-semibold`}
              value={sp.name}
              maxLength={60}
              placeholder={t.meetings.speakerName}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <input
              className={`${field} mt-0.5 text-[14px]`}
              value={sp.role}
              maxLength={60}
              placeholder={t.meetings.speakerRole}
              onChange={(e) => set(i, { role: e.target.value })}
            />
            {sp.name.trim() && !sp.photoUrl && (
              <p className="mt-1 text-[12px] leading-snug text-[#d97706]">
                ⚠️ {sp.userId ? t.meetings.speakerNoProfilePhoto : t.meetings.speakerNoPhoto}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label={t.meetings.removeSpeaker}
            onClick={() => onChange(value.filter((_, k) => k !== i))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-hint active:bg-hairline"
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
      {value.length < MAX_SPEAKERS && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand/10 py-2 text-[15px] font-semibold text-link active:scale-[0.98]"
          >
            👤 {t.meetings.speakerFromPeople}
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([...value, { name: '', role: '', mediaId: null, photoUrl: null }])
            }
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[15px] font-semibold text-link active:bg-hairline"
          >
            <IconPlus size={16} /> {t.meetings.addSpeaker.replace(/^\+\s*/, '')}
          </button>
        </div>
      )}
      <PersonPicker
        open={picking}
        title={t.meetings.speakerFromPeople}
        people={people}
        value={null}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          const p = people.find((x) => x.id === id);
          if (!p) return;
          // Their profile photo is used (kept up to date by the server); the name can be edited.
          onChange([
            ...value,
            { name: displayName(p), role: '', mediaId: null, photoUrl: p.photoUrl, userId: p.id },
          ]);
        }}
      />
    </div>
  );
}
