import { useState, type ReactNode } from 'react';
import {
  ENTER_ANIMATIONS,
  MOTION_GROUPS,
  MODULE_SURFACES,
  resolveBrand,
  type EnterAnimation,
  type GroupSummary,
  type MeetingMotion,
  type ModuleLook,
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
  useSaveChurchStudio,
  useSaveMinistryStudio,
  useUploadMedia,
} from '../lib/queries';
import { preparePhoto } from '../lib/image';
import { haptic } from '../lib/telegram';
import { EnvCard } from '../screens/Hub';
import { AppBackdrop } from './AppBackdrop';
import { BackgroundEditor } from './BackgroundEditor';
import { BrandHeader } from './BrandHeader';
import { CalendarTile } from './GroupCalendar';
import { HomeActionRow, useHomeActions } from './HomeSections';
import { IconCalendar, IconHome, IconMenu, IconPalette, IconUsers, IconWallet } from './icons';
import { Group, Pill } from './LookControls';
import { LookTop } from './LookTop';
import { ScreenLookPreview, SkinLayer, skinClass, skinStyle, useModuleLook } from './ModuleSkin';
import { MotionPicker } from './MotionPicker';
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
      <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
        {t.studio.title}
      </h2>
      <p className="px-3 text-[13px] text-hint">{t.studio.hint}</p>
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
      <div
        className="relative isolate overflow-hidden rounded-[30px] border-4 border-[var(--color-section)] p-3 shadow-float"
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

const CHURCH_SPOTS = ['header', 'cards', 'list'] as const;
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
        <LookTop look={g} className="isolate flex aspect-[16/10] flex-col p-2.5">
          <LivingLayer
            kind={look.own ? (look.motion ?? 'off') : motion}
            behind
            tune={look.tune}
            icon={look.icon}
          />
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

const PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#111418',
  '#ffffff',
];
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
                    set({ surface: s === 'default' ? null : s });
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
            />
            <p className="mt-2 text-[12px] text-hint">{t.studio.tip}</p>
          </Group>
        )}

        <TuneControls tune={draft.tune ?? {}} onChange={(tune) => set({ tune })} />

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
          </div>
        </Group>

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
            if (scope === 'church') await saveChurch.mutateAsync({ appBackground: bg });
            else await saveMinistry.mutateAsync({ pageBackground: bg });
            onClose();
          }}
        />
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

const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Speed, size, direction and colour of a part's animations. */
function TuneControls({ tune, onChange }: { tune: MotionTune; onChange: (t: MotionTune) => void }) {
  const t = useT();
  const set = (patch: Partial<MotionTune>) => onChange({ ...tune, ...patch });
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    put: (v: number) => void,
  ) => (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[14px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-hint">×{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => put(Number(e.target.value))}
        className="w-full accent-[var(--brand)]"
      />
    </label>
  );
  return (
    <Group title={t.studio.tune}>
      <div className="flex flex-col gap-4">
        {slider(t.studio.speed, tune.speed ?? 1, 0.25, 3, 0.25, (speed) => set({ speed }))}
        {slider(t.studio.size, tune.size ?? 1, 0.5, 2, 0.1, (size) => set({ size }))}
        <div>
          <div className="mb-2 text-[14px]">{t.studio.direction}</div>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.map((a, i) => (
              <Pill
                key={a}
                on={(tune.angle ?? 0) === a}
                onClick={() => set({ angle: a })}
                label={ARROWS[i]!}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[14px]">{t.studio.color}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill
              on={!tune.color}
              onClick={() => set({ color: null })}
              label={t.studio.colorAuto}
            />
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set({ color: c })}
                className={`h-8 w-8 rounded-full ring-1 ring-black/10 active:scale-90 ${
                  tune.color === c ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                }`}
                style={{ background: c }}
              />
            ))}
            <label
              className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full"
              style={{
                background:
                  tune.color && !PALETTE.includes(tune.color)
                    ? tune.color
                    : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
              }}
            >
              <input
                type="color"
                value={tune.color ?? '#6366f1'}
                onChange={(e) => set({ color: e.target.value })}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      </div>
    </Group>
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
            onClick={() => onChange({ emoji: e })}
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
