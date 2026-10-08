import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BAKE_PARTS,
  bakeKey,
  freshLoop,
  type BakedLoop,
  ENTER_ANIMATIONS,
  MOTION_GROUPS,
  MODULE_EDGES,
  MODULE_SHINES,
  MODULE_SURFACES,
  isFontKey,
  resolveBrand,
  tuneFor,
  type EnterAnimation,
  type EventSummary,
  type AppBackground,
  type GroupSummary,
  type MeetingMotion,
  type ModuleLook,
  type ModulePhoto,
  type MotionIcon,
  type MotionTune,
  type ScreenLook,
  type ScreenModule,
} from '@church/shared';
import { useEnv } from '../lib/env';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import {
  useGroup,
  useGroups,
  useMe,
  usePinnedEvents,
  useSaveChurchStudio,
  useSaveMinistryStudio,
  useUploadMedia,
  uploadLoop,
} from '../lib/queries';
import { preparePhoto } from '../lib/image';
import { FullMotion } from '../lib/perf';
import { confirmDialog, haptic } from '../lib/telegram';
import { EnvCard, PinnedEventCard } from '../screens/Hub';
import { FontPicker } from './FontPicker';
import { AppBackdrop } from './AppBackdrop';
import { BackgroundEditor } from './BackgroundEditor';
import { BrandHeader } from './BrandHeader';
import { CalendarTile } from './GroupCalendar';
import { HomeActionRow, useHomeActions } from './HomeSections';
import { IconCalendar, IconHome, IconMenu, IconPalette, IconUsers, IconWallet } from './icons';
import { Group, Pill } from './LookControls';
import { LookTop } from './LookTop';
import {
  PartPhoto,
  ScreenLookPreview,
  SkinLayer,
  shineStyle,
  skinClass,
  skinMotions,
  skinStyle,
  useModuleLook,
} from './ModuleSkin';
import { MotionPicker } from './MotionPicker';
import { MotionTuneControls, PALETTE, ShineTuneControls, TunePanel } from './MotionTune';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, DateBadge, LivingLayer, Row, Section, Toggle } from './ui';

type Scope = 'church' | 'ministry';
type Spot = ScreenModule | 'background' | 'entrance';

/**
 * The screen studio: a live copy of the church's main page or the ministry's page. Tap any
 * part (header, buttons, calendar, meetings, posts, bottom bar) to set its surface —
 * glass, liquid glass, colour, an own gradient, flowing, dark, burning — and its
 * animations in layers; the background and the entrance animation sit above the copy.
 */
export function DesignStudio({ g }: { g: GroupSummary }) {
  const t = useT();
  const me = useMe();
  const group = useGroup(g.id);
  const isAdmin = me.data?.user.isAdmin ?? false;
  const [scope, setScope] = useState<Scope>('ministry');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [moving, setMoving] = useState(false);
  const church = me.data?.church;
  const look: ScreenLook = (scope === 'church' ? church?.screenLook : g.screenLook) ?? {};
  const meetingMotion = group.data?.meetingMotion ?? 'calm';
  const backdropLook =
    scope === 'church'
      ? { brandColor: church?.brandColor ?? null, pattern: null, logoUrl: church?.logoUrl ?? null }
      : g;
  const bg = scope === 'church' ? church?.appBackground : g.pageBackground;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex gap-2 px-1">
        <Pill
          on={scope === 'ministry'}
          onClick={() => setScope('ministry')}
          label={`${t.studio.ministry}: ${g.name}`}
        />
        {isAdmin && (
          <Pill
            on={scope === 'church'}
            onClick={() => setScope('church')}
            label={t.studio.church}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2 px-1">
        <Pill
          on={false}
          onClick={() => setSpot('background')}
          label={`🖼 ${t.studio.modules.background}`}
        />
        {scope === 'ministry' && (
          <Pill
            on={false}
            onClick={() => setSpot('entrance')}
            label={`✨ ${t.studio.modules.entrance}`}
          />
        )}
      </div>
      <ThemeRow scope={scope} g={g} />
      {/* The copy of the page stands still unless asked: the real page around it already
          moves, and both at once made the Design tab heavy on phones. */}
      <div className="flex justify-end px-1">
        <Pill
          on={moving}
          onClick={() => setMoving((v) => !v)}
          label={moving ? `⏸ ${t.studio.stopMotion}` : `▶ ${t.studio.playMotion}`}
        />
      </div>
      <div
        className={`relative isolate overflow-hidden rounded-[30px] border-4 border-[var(--color-section)] p-3 shadow-float ${moving ? '' : 'motion-still'}`}
        style={{ background: 'var(--color-bg-secondary)' }}
      >
        <AppBackdrop bg={bg} look={backdropLook} preview />
        <ScreenLookPreview value={look}>
          <div className="relative flex flex-col gap-4 pb-1">
            {(scope === 'church' ? CHURCH_SPOTS : MINISTRY_SPOTS).map((s) =>
              s === 'meetings' ? null : s === 'calendar' ? (
                // Side by side, as on the ministry's home.
                <div key={s} className="grid grid-cols-2 gap-3">
                  {(['calendar', 'meetings'] as const).map((x) => (
                    <Hot key={x} label={t.studio.modules[x]} onPick={() => setSpot(x)}>
                      <SpotPiece spot={x} scope={scope} g={g} meetingMotion={meetingMotion} />
                    </Hot>
                  ))}
                </div>
              ) : (
                <Hot key={s} label={t.studio.modules[s]} onPick={() => setSpot(s)}>
                  <SpotPiece spot={s} scope={scope} g={g} meetingMotion={meetingMotion} />
                </Hot>
              ),
            )}
          </div>
        </ScreenLookPreview>
      </div>
      {!isAdmin && <p className="px-3 text-[12px] text-hint">{t.studio.adminOnly}</p>}

      {spot === 'background' && (
        <BackgroundSheet scope={scope} g={g} onClose={() => setSpot(null)} />
      )}
      {spot === 'entrance' && <EntranceSheet g={g} onClose={() => setSpot(null)} />}
      {spot && spot !== 'background' && spot !== 'entrance' && (
        <ModuleSheet
          key={`${scope}${spot}`}
          spot={spot}
          scope={scope}
          g={g}
          look={look}
          meetingMotion={meetingMotion}
          onClose={() => setSpot(null)}
        />
      )}
    </section>
  );
}

const CHURCH_SPOTS = ['header', 'pinned', 'cards', 'list'] as const;
const MINISTRY_SPOTS = ['header', 'actions', 'calendar', 'meetings', 'posts', 'tabbar'] as const;

/** A tappable part of the copy: dashed outline and its name; the part itself doesn't react. */
function Hot({
  label,
  onPick,
  children,
}: {
  label: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none">{children}</div>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          haptic.tap();
          onPick();
        }}
        className="absolute -inset-1.5 rounded-[24px] border-2 border-dashed border-[var(--brand)]/50 transition active:bg-[var(--brand)]/10"
      >
        <span className="absolute -top-2.5 left-3 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[10px] font-bold text-white shadow-card">
          ✎ {label}
        </span>
      </button>
    </div>
  );
}

/** One part of the page, drawn as in the app (with the look from the studio's preview). */
function SpotPiece({
  spot,
  scope,
  g,
  meetingMotion,
}: {
  spot: ScreenModule;
  scope: Scope;
  g: GroupSummary;
  meetingMotion: MeetingMotion;
}) {
  const t = useT();
  if (spot === 'header')
    return scope === 'church' ? (
      <BrandHeader title={t.env.hubTitle} subtitle={t.env.hubSubtitle(1)} />
    ) : (
      <BrandHeader title={g.name} subtitle={t.common.members(g.activeCount)} />
    );
  if (spot === 'cards') return <CardsPiece g={g} />;
  if (spot === 'pinned') return <PinnedPiece g={g} />;
  if (spot === 'list') return <ListPiece />;
  if (spot === 'actions') return <ActionsPiece g={g} />;
  if (spot === 'calendar')
    return (
      <div className="h-full">
        <CalendarTile g={g} onToggle={() => undefined} />
      </div>
    );
  if (spot === 'meetings') return <MeetingPiece g={g} motion={meetingMotion} />;
  if (spot === 'posts') return <PostPiece />;
  return <TabBarPiece />;
}

function ActionsPiece({ g }: { g: GroupSummary }) {
  const me = useMe();
  const { can } = useEnv();
  const actions = useHomeActions(g, me.data?.church.brandColor ?? 'blue', can);
  return <HomeActionRow actions={actions} />;
}

function CardsPiece({ g }: { g: GroupSummary }) {
  const groups = useGroups();
  const me = useMe();
  const list = (groups.data ?? [g]).slice(0, 2);
  return (
    <div className="grid grid-cols-2 gap-3">
      {list.map((x, i) => (
        <EnvCard
          key={x.id}
          g={x}
          index={i}
          fallbackTheme={me.data?.church.brandColor ?? 'blue'}
          onClick={() => undefined}
        />
      ))}
    </div>
  );
}

/** The first pinned event as on the main page (or a sample one when none is pinned). */
function PinnedPiece({ g }: { g: GroupSummary }) {
  const t = useT();
  const me = useMe();
  const pinned = usePinnedEvents();
  const [sample] = useState((): EventSummary => ({
    id: 0,
    groupId: g.id,
    groupName: g.name,
    title: t.studio.samplePinned,
    startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    endsAt: null,
    location: null,
    coverUrl: null,
    coverLoop: null,
    features: { gallery: false, rsvp: false, duties: false, cost: false },
    priceCents: null,
    status: 'scheduled',
    goingCount: 0,
    pinned: true,
    brandColor: g.brandColor,
    design: null,
    templateId: null,
    motion: null,
    motionTune: null,
    motionLayers: [],
    coverSlides: null,
    posterTemplateId: null,
    poster: null,
    countdown: false,
    speakers: [],
    speakerLook: null,
    ownTemplateId: null,
    lookVersion: 0,
    createdAt: new Date().toISOString(),
    look: null,
    myRsvp: null,
    myRoles: [],
    myDuties: [],
  }));
  const e = pinned.data?.[0] ?? sample;
  return (
    <div className="flex">
      <PinnedEventCard
        e={e}
        fallbackTheme={me.data?.church.brandColor ?? 'blue'}
        onClick={() => undefined}
      />
    </div>
  );
}

function ListPiece() {
  const t = useT();
  const me = useMe();
  const look = useModuleLook('list');
  return (
    <Section
      cardClassName={skinClass(look)}
      cardStyle={skinStyle(look)}
      underlay={<SkinLayer look={look} />}
    >
      <Row title={me.data?.user.firstName ?? '—'} subtitle={t.home.privacyNote.slice(0, 32)} />
      <Row title={t.settings.title} subtitle={t.settings.entry} />
    </Section>
  );
}

/** A meeting tile as on the ministry's home: its colours and the meetings' animation. */
function MeetingPiece({ g, motion }: { g: GroupSummary; motion: MeetingMotion }) {
  const t = useT();
  const f = useFmt();
  const look = useModuleLook('meetings');
  const [when] = useState(() => new Date(Date.now() + 2 * 86_400_000).toISOString());
  return (
    <div className="h-full">
      <div
        className={`glass relative flex flex-col overflow-hidden rounded-2xl shadow-card ${skinClass(look)}`}
        style={skinStyle(look)}
      >
        {/* Layers cover the tile; the main animation sits in its coloured top. */}
        <SkinLayer look={{ ...look, motion: null }} />
        <LookTop
          look={g}
          className="tile-top isolate flex aspect-[16/10] flex-col p-2.5"
          under={
            <LivingLayer
              kind={look.own ? (look.motion ?? 'off') : motion}
              tune={tuneFor(look, look.own ? look.motion : motion)}
              icon={look.icon}
            />
          }
        >
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
            {t.meetings.details}
          </span>
          <span className="mt-auto">
            <DateBadge {...f.dateBadge(when)} onBrand />
          </span>
        </LookTop>
        <div className="flex flex-col gap-0.5 p-2.5">
          <span className="truncate text-[14px] font-semibold">{t.design.sampleTitle}</span>
          <span className="truncate text-[12px] text-hint">{f.relativeDay(when)} · 19:00</span>
        </div>
      </div>
    </div>
  );
}

function PostPiece() {
  const t = useT();
  const look = useModuleLook('posts');
  return (
    <div
      className={`glass relative flex flex-col gap-1 overflow-hidden rounded-2xl p-3 shadow-card ${skinClass(look)}`}
      style={skinStyle(look)}
    >
      <SkinLayer look={look} />
      <span className="text-[11px] font-bold text-accent">📌 {t.design.posts}</span>
      <span className="text-[15px] font-semibold">{t.design.sampleTopic}</span>
      <span className="text-[13px] text-hint">{t.design.sampleLocation} · 19:00</span>
    </div>
  );
}

/** The bottom bar as in the app (not fixed here, so it sits inside the copy). */
function TabBarPiece() {
  const t = useT();
  const look = useModuleLook('tabbar');
  const tabs = [
    { icon: <IconHome />, label: t.nav.overview },
    { icon: <IconCalendar />, label: t.nav.meetings },
    { icon: <IconWallet />, label: t.nav.treasury },
    { icon: <IconUsers />, label: t.nav.people },
    { icon: <IconPalette />, label: t.nav.design },
    { icon: <IconMenu />, label: t.nav.more },
  ];
  return (
    <div
      className={`glass-strong flex gap-1 rounded-[26px] p-1.5 shadow-float ${skinClass(look)}`}
      style={skinStyle(look)}
    >
      <SkinLayer look={look} />
      {tabs.map((x, i) => (
        <span
          key={x.label}
          className={`flex min-h-[50px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[10px] font-semibold ${
            i === 0 ? 'bg-brand/14 text-accent' : 'text-hint'
          }`}
        >
          {x.icon}
          <span className="max-w-full truncate px-0.5">{x.label}</span>
        </span>
      ))}
    </div>
  );
}

const ANGLES = [90, 135, 180, 225];

/**
 * Edit one part: its surface (with an own gradient of 2–5 colours), its animation and up to
 * two more animation layers. The part is previewed live at the top.
 */
function ModuleSheet({
  spot,
  scope,
  g,
  look,
  meetingMotion,
  onClose,
}: {
  spot: ScreenModule;
  scope: Scope;
  g: GroupSummary;
  look: ScreenLook;
  meetingMotion: MeetingMotion;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const saveChurch = useSaveChurchStudio();
  const saveMinistry = useSaveMinistryStudio(g.id);
  const [draft, setDraft] = useState<ModuleLook>(look[spot] ?? {});
  const [meetings, setMeetings] = useState<MeetingMotion>(meetingMotion);
  const [slot, setSlot] = useState(0);
  const set = (patch: Partial<ModuleLook>) => setDraft((d) => ({ ...d, ...patch }));
  const theme = resolveBrand(g.brandColor ?? 'blue');
  const colors = draft.colors?.length ? draft.colors : [theme.light, theme.partner];
  const layers = draft.layers ?? [];
  // Each animation keeps its own settings (an emptied one = as designed).
  const tuneOf = (m: MeetingMotion) => tuneFor(draft, m);
  const onTune = (m: MeetingMotion, tune: MotionTune | null) =>
    set({ tunes: { ...(draft.tunes ?? {}), [m]: tune ?? {} } });
  const pending = saveChurch.isPending || saveMinistry.isPending;

  async function save(next: ModuleLook | null) {
    const screenLook: ScreenLook = { ...look };
    if (next) screenLook[spot] = next;
    else delete screenLook[spot];
    try {
      if (scope === 'church') await saveChurch.mutateAsync({ screenLook });
      else
        await saveMinistry.mutateAsync({
          screenLook,
          ...(spot === 'meetings' ? { meetingMotion: meetings } : {}),
        });
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={`✎ ${t.studio.modules[spot]}`}>
      <div className="flex flex-col gap-5 px-4 pb-4">
        {/* The part itself, pinned while the settings scroll below it. */}
        <div
          className="sticky top-0 z-20 -mx-4 rounded-b-[22px] px-4 pb-3 pt-2 shadow-card"
          style={{ background: 'var(--color-bg-secondary)' }}
        >
          <ScreenLookPreview value={{ ...look, [spot]: draft }}>
            <SpotPiece spot={spot} scope={scope} g={g} meetingMotion={meetings} />
          </ScreenLookPreview>
        </div>

        {/* Pinned events are photos and designed covers: a surface wouldn't show on them. */}
        {spot !== 'pinned' && (
          <Group title={t.studio.surface}>
            <div className="grid grid-cols-4 gap-2">
              {MODULE_SURFACES.map((s) => {
                const on = (draft.surface ?? 'default') === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      // Tapping the chosen one again goes back to the app's own look.
                      set({ surface: s === 'default' || on ? null : s });
                    }}
                    className={`flex flex-col items-center gap-1 rounded-2xl p-1 ${on ? 'ring-2 ring-[var(--brand)]' : ''}`}
                  >
                    <span
                      className={`glass relative block h-11 w-full overflow-hidden rounded-xl ${s === 'default' ? '' : `skin skin-${s}`}`}
                      style={
                        s === 'gradient'
                          ? skinStyle({ surface: 'gradient', colors, angle: draft.angle })
                          : undefined
                      }
                    />
                    <span
                      className={`text-center text-[11px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
                    >
                      {t.studio.surfaces[s]}
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>
        )}

        <Group title={t.studio.edge}>
          <div className="grid grid-cols-4 gap-2">
            {MODULE_EDGES.map((e) => {
              const on = (draft.edge ?? 'none') === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    set({ edge: e === 'none' || on ? null : e });
                  }}
                  className={`flex flex-col items-center gap-1 rounded-2xl p-1.5 ${on ? 'ring-2 ring-[var(--brand)]' : ''}`}
                >
                  <span
                    className={`brand-gradient relative block h-10 w-full rounded-xl ${e === 'none' ? '' : `skin edge edge-${e}`}`}
                  />
                  <span
                    className={`text-center text-[11px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
                  >
                    {t.studio.edges[e]}
                  </span>
                </button>
              );
            })}
          </div>
        </Group>

        {spot === 'actions' && (
          <Group title={t.studio.chip}>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="flex justify-between text-[14px]">
                  <span>{t.studio.chipSize}</span>
                  <span className="font-semibold tabular-nums text-hint">
                    {Math.round((draft.chip?.size ?? 1) * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={1.4}
                  step={0.05}
                  value={draft.chip?.size ?? 1}
                  onChange={(e) => set({ chip: { ...draft.chip, size: Number(e.target.value) } })}
                  className="w-full accent-[var(--brand)]"
                />
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-hint">{t.studio.square}</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={draft.chip?.radius ?? 12}
                  onChange={(e) => set({ chip: { ...draft.chip, radius: Number(e.target.value) } })}
                  className="flex-1 accent-[var(--brand)]"
                />
                <span className="text-[12px] text-hint">{t.studio.round}</span>
              </div>
              <div>
                <div className="mb-2 text-[14px]">{t.studio.chipFill}</div>
                <div className="flex flex-wrap gap-2">
                  {(['brand', 'glass', 'dark', 'white', 'none'] as const).map((f) => (
                    <Pill
                      key={f}
                      on={(draft.chip?.fill ?? 'brand') === f}
                      onClick={() => set({ chip: { ...draft.chip, fill: f } })}
                      label={t.studio.chipFills[f]}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Group>
        )}

        <Group title={t.studio.shape}>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-hint">{t.studio.square}</span>
            <input
              type="range"
              min={0}
              max={40}
              step={2}
              value={draft.radius ?? 20}
              onChange={(e) => set({ radius: Number(e.target.value) })}
              className="flex-1 accent-[var(--brand)]"
            />
            <span className="text-[12px] text-hint">{t.studio.round}</span>
            <span
              className="brand-gradient h-9 w-9 shrink-0"
              style={{ borderRadius: Math.min(draft.radius ?? 20, 18) }}
            />
          </div>
        </Group>

        <Group title={t.studio.shine}>
          <div className="grid grid-cols-5 gap-2">
            {MODULE_SHINES.map((x) => {
              const on = (draft.shine ?? 'none') === x;
              return (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    set({ shine: x === 'none' || on ? null : x });
                  }}
                  className={`flex flex-col items-center gap-1 rounded-2xl p-1 ${on ? 'ring-2 ring-[var(--brand)]' : ''}`}
                >
                  <span className="brand-gradient relative block h-10 w-full overflow-hidden rounded-xl">
                    {x !== 'none' && (
                      <span
                        className={`shine shine-${x}`}
                        style={on ? shineStyle(draft.shineTune) : undefined}
                      />
                    )}
                  </span>
                  <span
                    className={`text-center text-[11px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
                  >
                    {t.studio.shines[x]}
                  </span>
                </button>
              );
            })}
          </div>
          {draft.shine && draft.shine !== 'none' && (
            <div className="mt-3">
              <TunePanel title={`${t.studio.knob.settings}: ${t.studio.shines[draft.shine]}`}>
                <ShineTuneControls
                  tune={draft.shineTune ?? {}}
                  onChange={(shineTune) => set({ shineTune })}
                />
              </TunePanel>
            </div>
          )}
        </Group>

        {scope === 'ministry' && (
          <PhotoControls
            photo={draft.photo ?? null}
            photo2={draft.photo2 ?? null}
            groupId={g.id}
            onChange={(photo, photo2) => set({ photo, photo2 })}
          />
        )}

        <Group title={t.studio.font}>
          <FontPicker
            label={t.studio.font}
            value={isFontKey(draft.font) ? draft.font : null}
            onChange={(font) => set({ font })}
          />
          <label className="mt-3 flex flex-col gap-1">
            <span className="flex justify-between text-[14px]">
              <span>{t.studio.textSize}</span>
              <span className="font-semibold tabular-nums text-hint">
                {Math.round((draft.textScale ?? 1) * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0.7}
              max={1.3}
              step={0.05}
              value={draft.textScale ?? 1}
              onChange={(e) => set({ textScale: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </label>
        </Group>

        {draft.surface === 'gradient' && (
          <Group title={t.studio.gradient}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {colors.map((c, i) => (
                  <label
                    key={i}
                    className={`relative h-10 w-10 cursor-pointer rounded-full shadow-card ${slot === i ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''}`}
                    style={{ background: c }}
                    onClick={() => setSlot(i)}
                  >
                    <input
                      type="color"
                      value={c}
                      onChange={(e) =>
                        set({ colors: colors.map((x, k) => (k === i ? e.target.value : x)) })
                      }
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                ))}
                {colors.length < 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      set({ colors: [...colors, PALETTE[(colors.length * 3) % PALETTE.length]!] });
                      setSlot(colors.length);
                    }}
                    className="h-10 rounded-full bg-hairline px-3 text-[13px] font-semibold"
                  >
                    + {t.studio.addColor}
                  </button>
                )}
                {colors.length > 2 && (
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => {
                      set({ colors: colors.filter((_, k) => k !== slot) });
                      setSlot(0);
                    }}
                    className="h-10 w-10 rounded-full bg-hairline text-[16px]"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => set({ colors: colors.map((x, k) => (k === slot ? c : x)) })}
                    className="h-7 w-7 rounded-full ring-1 ring-black/10 active:scale-90"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-[13px] text-hint">{t.studio.angle}</span>
                {ANGLES.map((a) => (
                  <Pill
                    key={a}
                    on={(draft.angle ?? 135) === a}
                    onClick={() => set({ angle: a })}
                    label={['→', '↘', '↓', '↙'][ANGLES.indexOf(a)]!}
                  />
                ))}
              </div>
              <Toggle
                label={t.studio.flow}
                checked={!!draft.flow}
                onChange={(v) => set({ flow: v })}
              />
            </div>
          </Group>
        )}

        {spot === 'meetings' && (
          <>
            <Group title={t.studio.meetingsMotion}>
              <MotionPicker
                value={meetings}
                onChange={(m) => setMeetings(m ?? 'calm')}
                icon={draft.icon}
                tuneOf={tuneOf}
                onTune={onTune}
              />
            </Group>
            <div>
              <Toggle
                label={t.studio.ownTile}
                checked={!!draft.own}
                onChange={(v) => set({ own: v })}
              />
              <p className="mt-1 px-1 text-[12px] text-hint">{t.studio.ownTileHint}</p>
            </div>
          </>
        )}

        {(spot !== 'meetings' || draft.own) && (
          <Group title={t.studio.animation}>
            <MotionPicker
              value={draft.motion ?? 'off'}
              onChange={(m) => set({ motion: !m || m === 'off' ? null : m })}
              icon={draft.icon}
              tuneOf={tuneOf}
              onTune={onTune}
            />
            <p className="mt-2 text-[12px] text-hint">{t.studio.tip}</p>
            {spot === 'pinned' && (
              <p className="mt-1 text-[12px] text-hint">{t.studio.pinnedHint}</p>
            )}
          </Group>
        )}

        <IconControls
          icon={draft.icon ?? null}
          groupId={scope === 'ministry' ? g.id : null}
          logoUrl={scope === 'ministry' ? g.logoUrl : null}
          onChange={(icon) => set({ icon })}
        />

        <Group title={t.studio.layers}>
          <p className="mb-2 text-[12px] text-hint">{t.studio.layersHint}</p>
          <div className="flex flex-col gap-2.5">
            {MOTION_GROUPS.map((group) => (
              <div key={group.key}>
                <div className="mb-1.5 text-[12px] font-semibold text-hint">
                  {t.meetings.motionGroups[group.key]}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((m) => {
                    const on = layers.includes(m);
                    return (
                      <Pill
                        key={m}
                        on={on}
                        onClick={() =>
                          set({
                            layers: on ? layers.filter((x) => x !== m) : [...layers, m].slice(-2),
                          })
                        }
                        label={t.meetings.motions[m]}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Each layer's own settings, open under the list. */}
            {layers.map((m) => (
              <TunePanel key={m} title={`${t.studio.knob.settings}: ${t.meetings.motions[m]}`}>
                <MotionTuneControls
                  kind={m}
                  tune={tuneOf(m) ?? {}}
                  onChange={(tune) => onTune(m, tune)}
                />
              </TunePanel>
            ))}
          </div>
        </Group>

        {(BAKE_PARTS as readonly string[]).includes(spot) && (
          <BakeSection
            draft={draft}
            groupId={scope === 'church' ? null : g.id}
            spot={spot}
            disabled={pending}
            onBaked={(baked) => void save({ ...draft, baked })}
            onRemove={() => void save({ ...draft, baked: null })}
          />
        )}

        <Button disabled={pending} onClick={() => void save(draft)}>
          {pending ? t.common.saving : t.common.save}
        </Button>
        <Button variant="glass" disabled={pending} onClick={() => void save(null)}>
          {t.studio.reset}
        </Button>
      </div>
    </Sheet>
  );
}

/** The size a part's loop is recorded at (a phone's block of that part, in css px). */
const BAKE_SIZE: Record<string, [number, number]> = {
  header: [370, 96],
  calendar: [180, 200],
  posts: [370, 240],
  tabbar: [370, 68],
  list: [370, 140],
};

/**
 * «🎬 Video animation»: the part's surface, picture, animations and shine recorded once as
 * a short loop (lib/recorder.ts) that phones play instead of drawing every effect live.
 * Saved with the look's fingerprint; any later change brings the live effects back until
 * it is recorded again.
 */
function BakeSection({
  draft,
  groupId,
  spot,
  disabled,
  onBaked,
  onRemove,
}: {
  draft: ModuleLook;
  groupId: number | null;
  spot: ScreenModule;
  disabled: boolean;
  onBaked: (baked: BakedLoop) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const sample = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [w, h] = BAKE_SIZE[spot] ?? [370, 120];
  const moving =
    skinMotions(draft).length > 0 ||
    (draft.shine && draft.shine !== 'none') ||
    draft.surface === 'fire';
  const fresh = freshLoop(draft);
  const stale = !!draft.baked && !fresh;

  async function record() {
    setProgress(0);
    try {
      // The sample is laid out with its effects fully on before recording starts.
      await new Promise((r) => setTimeout(r, 500));
      const { recordLoop } = await import('../lib/recorder');
      if (!sample.current) throw new Error('no_sample');
      const rec = await recordLoop(sample.current, {
        width: Math.min(740, w * 2),
        quality: 0.07,
        onProgress: setProgress,
      });
      if (!rec.mp4) {
        toast(t.studio.bakeNoVideo, 'error');
        return;
      }
      const up = await uploadLoop(groupId, rec.mp4);
      onBaked({ mediaId: up.id, key: bakeKey(draft), w, h });
    } catch (err) {
      console.warn('loop recording failed', err);
      haptic.error();
      toast(t.motionExport.failed, 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Group title={t.studio.bakeTitle}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-snug text-hint">{t.studio.bakeHint}</p>
        {fresh && <p className="text-[13px] font-semibold text-present">✓ {t.studio.bakeFresh}</p>}
        {stale && <p className="text-[13px] font-semibold text-late">⚠ {t.studio.bakeStale}</p>}
        {!moving && !draft.baked && <p className="text-[13px] text-hint">{t.studio.bakeNothing}</p>}
        {progress !== null ? (
          <div className="flex flex-col gap-1.5 py-1">
            <div className="h-2 overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="text-center text-[13px] text-hint">
              {t.motionExport.recording(Math.round(progress * 100))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled || !moving} onClick={() => void record()}>
              🎬 {fresh ? t.studio.bakeAgain : t.studio.bakeRecord}
            </Button>
            {draft.baked && (
              <Button variant="glass" disabled={disabled} onClick={onRemove}>
                {t.studio.bakeRemove}
              </Button>
            )}
          </div>
        )}
      </div>
      {/* The sample block, off screen and only while recording. */}
      {progress !== null && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0 }}>
          <FullMotion.Provider value>
            <div
              ref={sample}
              className={`relative overflow-hidden ${skinClass({ ...draft, edge: null, baked: null })}`}
              style={{ ...skinStyle(draft), width: w, height: h, borderRadius: 0 }}
            >
              <SkinLayer look={{ ...draft, baked: null }} />
            </div>
          </FullMotion.Provider>
        </div>
      )}
    </Group>
  );
}

/** The page background (church main page or ministry), with its own colours and movement. */
function BackgroundSheet({
  scope,
  g,
  onClose,
}: {
  scope: Scope;
  g: GroupSummary;
  onClose: () => void;
}) {
  const t = useT();
  const me = useMe();
  const saveChurch = useSaveChurchStudio();
  const saveMinistry = useSaveMinistryStudio(g.id);
  const church = me.data?.church;
  const isAdmin = me.data?.user.isAdmin ?? false;
  const [everywhere, setEverywhere] = useState(false);
  const qc = useQueryClient();
  return (
    <Sheet open onClose={onClose} title={`🖼 ${t.studio.modules.background}`}>
      <div className="px-4 pb-4">
        <BackgroundEditor
          value={scope === 'church' ? (church?.appBackground ?? null) : g.pageBackground}
          look={
            scope === 'church'
              ? {
                  brandColor: church?.brandColor ?? null,
                  pattern: null,
                  logoUrl: church?.logoUrl ?? null,
                }
              : g
          }
          church={scope === 'church'}
          saving={saveChurch.isPending || saveMinistry.isPending}
          onSave={async (bg) => {
            if (everywhere) await saveChurch.mutateAsync({ appBackground: bg, everywhere: true });
            else if (scope === 'church') await saveChurch.mutateAsync({ appBackground: bg });
            else await saveMinistry.mutateAsync({ pageBackground: bg });
            await qc.invalidateQueries({ queryKey: ['groups'] });
            onClose();
          }}
        />
        {isAdmin && (
          <div className="mt-3">
            <Toggle label={t.studio.everywhere} checked={everywhere} onChange={setEverywhere} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** How the ministry's page appears when opened, replayed on a copy of its card. */
function EntranceSheet({ g, onClose }: { g: GroupSummary; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const save = useSaveMinistryStudio(g.id);
  const [animation, setAnimation] = useState<EnterAnimation>(g.animation);
  const [replay, setReplay] = useState(0);
  return (
    <Sheet open onClose={onClose} title={`✨ ${t.studio.modules.entrance}`}>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-[13px] text-hint">{t.studio.entranceHint}</p>
        <div className="mx-auto w-1/2 min-w-[170px]">
          <div key={`${animation}${replay}`} className={`env-anim-${animation}`}>
            <EnvCard
              g={g}
              fallbackTheme={me.data?.church.brandColor ?? 'blue'}
              onClick={() => setReplay((r) => r + 1)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ENTER_ANIMATIONS.map((a) => (
            <Pill
              key={a}
              on={animation === a}
              onClick={() => {
                setAnimation(a);
                setReplay((r) => r + 1);
              }}
              label={t.env.animations[a]}
            />
          ))}
        </div>
        <Button
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ animation });
              haptic.success();
              toast(t.common.saved);
              onClose();
            } catch {
              toast(t.common.saveFailed, 'error');
            }
          }}
        >
          {t.common.save}
        </Button>
      </div>
    </Sheet>
  );
}

/** What the icon animations show: the logo, an emoji, or an uploaded picture (ministries). */
function IconControls({
  icon,
  groupId,
  logoUrl,
  onChange,
}: {
  icon: MotionIcon | null;
  groupId: number | null;
  logoUrl: string | null;
  onChange: (i: MotionIcon | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const upload = useUploadMedia(groupId ?? 0, 'event');
  const usesLogo = !icon?.emoji && !icon?.mediaId;
  return (
    <Group title={t.studio.icon}>
      <p className="mb-2 text-[12px] text-hint">{t.studio.iconHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`flex h-11 items-center gap-2 rounded-xl bg-hairline px-3 text-[14px] font-semibold ${
            usesLogo ? 'ring-2 ring-[var(--brand)]' : ''
          }`}
        >
          {logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 rounded-md object-contain" />}
          {t.studio.iconLogo}
        </button>
        {['✝️', '🔥', '🕊️', '⭐', '❤️', '🙏', '🎵', '✨'].map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onChange(icon?.emoji === e ? null : { emoji: e })}
            className={`h-11 w-11 rounded-xl bg-hairline text-[22px] ${
              icon?.emoji === e ? 'ring-2 ring-[var(--brand)]' : ''
            }`}
          >
            {e}
          </button>
        ))}
        <input
          value={
            icon?.emoji && !['✝️', '🔥', '🕊️', '⭐', '❤️', '🙏', '🎵', '✨'].includes(icon.emoji)
              ? icon.emoji
              : ''
          }
          onChange={(e) =>
            onChange(e.target.value.trim() ? { emoji: e.target.value.trim().slice(0, 8) } : null)
          }
          placeholder="😊"
          maxLength={8}
          className="h-11 w-16 rounded-xl bg-hairline text-center text-[20px] outline-none"
        />
        {groupId && (
          <label
            className={`flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-hairline px-3 text-[14px] font-semibold ${
              icon?.mediaId ? 'ring-2 ring-[var(--brand)]' : ''
            }`}
          >
            {icon?.url && <img src={icon.url} alt="" className="h-7 w-7 rounded-md object-cover" />}
            {upload.isPending ? '…' : `🖼 ${t.studio.iconUpload}`}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const media = await upload.mutateAsync(await preparePhoto(file));
                  onChange({ mediaId: media.id, url: media.url });
                } catch {
                  toast(t.common.saveFailed, 'error');
                }
              }}
            />
          </label>
        )}
      </div>
    </Group>
  );
}

/**
 * Pictures inside the part, under its content: upload, drag to choose the spot kept in
 * view, zoom, fill or show whole, see-through, and split into halves with a second picture.
 */
function PhotoControls({
  photo,
  photo2,
  groupId,
  onChange,
}: {
  photo: ModulePhoto | null;
  photo2: ModulePhoto | null;
  groupId: number;
  onChange: (p: ModulePhoto | null, p2: ModulePhoto | null) => void;
}) {
  const t = useT();
  const split = photo?.split ?? 'full';
  return (
    <Group title={t.studio.photo}>
      <p className="mb-2 text-[12px] text-hint">{t.studio.photoHint}</p>
      <div className="flex flex-col gap-4">
        <OnePhoto
          photo={photo}
          groupId={groupId}
          onChange={(p) => onChange(p, p ? photo2 : null)}
        />
        {photo && (
          <div>
            <div className="mb-2 text-[14px]">{t.studio.split}</div>
            <div className="flex flex-wrap gap-2">
              {(['full', 'left', 'right', 'top', 'bottom'] as const).map((x) => (
                <Pill
                  key={x}
                  on={split === x}
                  onClick={() => onChange({ ...photo, split: x }, x === 'full' ? null : photo2)}
                  label={t.studio.splits[x]}
                />
              ))}
            </div>
          </div>
        )}
        {photo && split !== 'full' && (
          <div>
            <div className="mb-2 text-[14px] font-semibold">{t.studio.photo2}</div>
            <OnePhoto photo={photo2} groupId={groupId} onChange={(p) => onChange(photo, p)} />
          </div>
        )}
      </div>
    </Group>
  );
}

/** One picture: upload or remove it, then place it (drag), zoom, fit and opacity. */
function OnePhoto({
  photo,
  groupId,
  onChange,
}: {
  photo: ModulePhoto | null;
  groupId: number;
  onChange: (p: ModulePhoto | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const upload = useUploadMedia(groupId, 'event');
  const set = (patch: Partial<ModulePhoto>) => photo && onChange({ ...photo, ...patch });
  // Dragging on the preview moves the picture: the spot kept in view follows the finger.
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 cursor-pointer items-center rounded-xl bg-hairline px-3 text-[14px] font-semibold">
          {upload.isPending ? '…' : `🖼 ${t.studio.photoAdd}`}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const media = await upload.mutateAsync(await preparePhoto(file));
                onChange({
                  ...(photo ?? { opacity: 0.35 }),
                  mediaId: media.id,
                  url: media.url,
                });
              } catch {
                toast(t.common.saveFailed, 'error');
              }
            }}
          />
        </label>
        {photo && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="h-11 rounded-xl bg-hairline px-3 text-[14px] font-semibold text-absent"
          >
            {t.studio.photoRemove}
          </button>
        )}
      </div>
      {photo?.url && (
        <>
          <div className="text-[12px] text-hint">{t.studio.place}</div>
          <div
            className="relative isolate aspect-[16/8] w-full touch-none overflow-hidden rounded-2xl bg-hairline"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                fx: photo.focusX ?? 50,
                fy: photo.focusY ?? 50,
              };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const box = e.currentTarget.getBoundingClientRect();
              const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
              set({
                focusX: clamp(d.fx - ((e.clientX - d.x) / box.width) * 100),
                focusY: clamp(d.fy - ((e.clientY - d.y) / box.height) * 100),
              });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <PartPhoto photo={{ ...photo, split: 'full', opacity: 1 }} />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[22px] text-white/70">
              ✥
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill
              on={(photo.fit ?? 'cover') === 'cover'}
              onClick={() => set({ fit: 'cover' })}
              label={t.studio.fitCover}
            />
            <Pill
              on={photo.fit === 'contain'}
              onClick={() => set({ fit: 'contain' })}
              label={t.studio.fitContain}
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[14px]">
              <span>{t.studio.zoom}</span>
              <span className="font-semibold tabular-nums text-hint">
                ×{(photo.zoom ?? 1).toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.05}
              value={photo.zoom ?? 1}
              onChange={(e) => set({ zoom: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[14px]">
              <span>{t.studio.opacity}</span>
              <span className="font-semibold tabular-nums text-hint">
                {Math.round(photo.opacity * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={photo.opacity}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </label>
        </>
      )}
    </div>
  );
}

type ThemeKey = 'autumn' | 'winter' | 'christmas' | 'easter' | 'night' | 'summer' | 'clean';

/**
 * Ready-made looks for the whole page: every part, the meetings' animation and the
 * background. Each part can be fine-tuned afterwards.
 */
const THEMES: Record<
  ThemeKey,
  {
    base: ModuleLook;
    parts?: Partial<Record<ScreenModule, ModuleLook>>;
    meetings: MeetingMotion;
    bg: AppBackground | null;
  }
> = {
  autumn: {
    base: { surface: 'dark', edge: 'gold', motion: 'leaves', tune: { size: 0.8, speed: 0.75 } },
    parts: {
      header: {
        surface: 'gradient',
        colors: ['#7c2d12', '#ea580c', '#facc15'],
        angle: 135,
        flow: true,
        motion: 'leaves',
      },
      calendar: { surface: 'glass', edge: 'gold' },
    },
    meetings: 'leaves',
    bg: {
      source: 'color',
      colors: ['#7c2d12', '#c2410c', '#facc15'],
      strength: 0.35,
      texture: 'grain',
      animation: 'drift',
    },
  },
  winter: {
    base: { surface: 'liquid', edge: 'glass', motion: 'snowfall', shine: 'soft' },
    parts: { calendar: { surface: 'glass', edge: 'glass' } },
    meetings: 'snowfall',
    bg: {
      source: 'color',
      colors: ['#0ea5e9', '#1e3a8a', '#e0f2fe'],
      strength: 0.4,
      texture: 'none',
      animation: 'aurora',
    },
  },
  christmas: {
    base: { surface: 'dark', edge: 'gold', motion: 'snowfall', shine: 'sparkle' },
    parts: {
      header: {
        surface: 'gradient',
        colors: ['#991b1b', '#166534'],
        angle: 120,
        edge: 'gold',
        motion: 'snowfall',
        shine: 'sparkle',
      },
    },
    meetings: 'snowfall',
    bg: {
      source: 'color',
      colors: ['#7f1d1d', '#14532d'],
      strength: 0.4,
      texture: 'dots',
      animation: 'breathe',
    },
  },
  easter: {
    base: {
      surface: 'glass',
      edge: 'glass',
      shine: 'glint',
      motion: 'petals',
      tune: { size: 0.8 },
    },
    parts: {
      header: {
        surface: 'gradient',
        colors: ['#fde68a', '#fb923c', '#f472b6'],
        angle: 135,
        motion: 'rays',
        layers: ['petals'],
        shine: 'glint',
      },
    },
    meetings: 'rays',
    bg: {
      source: 'color',
      colors: ['#fef3c7', '#fbcfe8'],
      strength: 0.45,
      texture: 'none',
      animation: 'breathe',
    },
  },
  night: {
    base: { surface: 'dark', edge: 'neon', motion: 'stars' },
    parts: { header: { surface: 'dark', edge: 'neon', motion: 'stars', layers: ['aurora'] } },
    meetings: 'stars',
    bg: {
      source: 'color',
      colors: ['#0f172a', '#312e81'],
      strength: 0.6,
      texture: 'none',
      animation: 'aurora',
    },
  },
  summer: {
    base: { surface: 'fluid', edge: 'liquid', motion: 'bokeh', shine: 'soft' },
    parts: { calendar: { surface: 'glass', edge: 'liquid' } },
    meetings: 'bokeh',
    bg: { source: 'theme', strength: 0.35, texture: 'none', animation: 'drift' },
  },
  clean: { base: {}, meetings: 'calm', bg: null },
};

/** One tap: a theme for the whole page (church main page or this ministry). */
function ThemeRow({ scope, g }: { scope: Scope; g: GroupSummary }) {
  const t = useT();
  const toast = useToast();
  const saveChurch = useSaveChurchStudio();
  const saveMinistry = useSaveMinistryStudio(g.id);
  const me = useMe();
  const group = useGroup(g.id);
  // What the page looked like before the last theme, to put back with one tap.
  const [undo, setUndo] = useState<(() => Promise<unknown>) | null>(null);
  async function apply(key: ThemeKey) {
    if (!(await confirmDialog(t.studio.themeConfirm))) return;
    const th = THEMES[key];
    if (scope === 'church') {
      const prev = {
        screenLook: me.data?.church.screenLook ?? {},
        appBackground: me.data?.church.appBackground ?? null,
      };
      setUndo(() => () => saveChurch.mutateAsync(prev));
    } else {
      const prev = {
        screenLook: g.screenLook ?? {},
        meetingMotion: group.data?.meetingMotion ?? null,
        pageBackground: g.pageBackground ?? null,
      };
      setUndo(() => () => saveMinistry.mutateAsync(prev));
    }
    const modules = scope === 'church' ? CHURCH_SPOTS : MINISTRY_SPOTS;
    const screenLook: ScreenLook = {};
    if (key !== 'clean') for (const m of modules) screenLook[m] = th.parts?.[m] ?? th.base;
    try {
      if (scope === 'church') await saveChurch.mutateAsync({ screenLook, appBackground: th.bg });
      else
        await saveMinistry.mutateAsync({
          screenLook,
          meetingMotion: th.meetings,
          pageBackground: th.bg,
        });
      haptic.success();
      toast(t.studio.themeApplied);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-3 text-[12px] font-semibold uppercase tracking-wide text-section-header">
        {t.studio.themes}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={saveChurch.isPending || saveMinistry.isPending}
            onClick={() => void apply(k)}
            className="glass shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold shadow-card active:scale-95"
          >
            {t.studio.themeNames[k]}
          </button>
        ))}
      </div>
      {undo && (
        <button
          type="button"
          disabled={saveChurch.isPending || saveMinistry.isPending}
          onClick={async () => {
            try {
              await undo();
              setUndo(null);
              haptic.success();
              toast(t.studio.themeUndone);
            } catch {
              toast(t.common.saveFailed, 'error');
            }
          }}
          className="mx-1 self-start rounded-full bg-hairline px-3.5 py-1.5 text-[13px] font-semibold active:scale-95"
        >
          ↺ {t.studio.themeUndo}
        </button>
      )}
      <p className="px-3 text-[12px] text-hint">{t.studio.themesHint}</p>
    </div>
  );
}
