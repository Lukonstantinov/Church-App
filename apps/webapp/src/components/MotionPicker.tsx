import {
  MOTION_GROUPS,
  type EffectTemplate,
  type MeetingMotion,
  type MotionIcon,
  type MotionTune,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Group, Pill } from './LookControls';
import { MotionTuneControls, TunePanel } from './MotionTune';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNearScreen } from '../lib/perf';
import { LivingLayer } from './ui';
import { useEffectTemplates } from '../lib/queries';

/** A preview's animation, drawn only while its tile is on or near the screen. */
function LivePreview(props: {
  kind: MeetingMotion;
  icon?: MotionIcon | null;
  tune?: MotionTune | null;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref);
  return (
    <span ref={ref} className="absolute inset-0">
      {near && <LivingLayer kind={props.kind} icon={props.icon} tune={props.tune} preview />}
    </span>
  );
}

type GroupKey = (typeof MOTION_GROUPS)[number]['key'];
/** Which part of the list is open: everything, a kept list, or one type. */
type Tab = 'all' | 'fav' | 'recent' | 'chosen' | 'own' | GroupKey;

const GROUP_ICON: Record<GroupKey, string> = {
  light: '🌈',
  sacred: '✝️',
  nature: '🌌',
  cosmic: '🪐',
  christmas: '🎄',
  abstract: '🌀',
  sunlight: '☀️',
  particles: '✨',
  liquid: '💧',
  texture: '▦',
  photo: '📷',
  adjust: '🎚',
  retro: '📺',
  stage: '🎉',
  icons: '⛪',
  seasons: '🍂',
  colour: '🎨',
  gpu: '🔮',
};

const FAV_KEY = 'church.fx.fav';
const RECENT_KEY = 'church.fx.recent';
const TAB_KEY = 'church.fx.tab';
const ALL_KINDS = new Set<string>(MOTION_GROUPS.flatMap((g) => g.items));

/** A list of animations kept on this phone (favourites, the last ones used). */
function readKept(key: string): MeetingMotion[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v)
      ? (v.filter((x) => typeof x === 'string' && ALL_KINDS.has(x)) as MeetingMotion[])
      : [];
  } catch {
    return [];
  }
}
function writeKept(key: string, list: MeetingMotion[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode: just not remembered */
  }
}

/**
 * Every animation as a small live preview to pick from. Over a hundred of them is a long
 * scroll, so only one part shows at a time, chosen in a row of chips: one type (light,
 * particles, liquid…), ⭐ favourites and 🕘 the last ones used (both kept on this phone),
 * the church's own effects, or everything in folding groups. A search by name looks
 * through all of them. "Off" comes first; with `allowInherit` also "like the ministry"
 * (value null). With `tuneOf`/`onTune`, the picked animations' own settings open under the
 * previews, and the previews show them.
 */
export function MotionPicker({
  value,
  onChange,
  allowInherit,
  inheritLabel,
  icon,
  tuneOf,
  onTune,
  many,
}: {
  value: MeetingMotion | null;
  onChange: (v: MeetingMotion | null) => void;
  allowInherit?: boolean;
  /** The name of the "inherit" choice (default: like the ministry). */
  inheritLabel?: string;
  /** What the icon animations show in their previews. */
  icon?: MotionIcon | null;
  /** The settings each animation has here (null = as designed). */
  tuneOf?: (m: MeetingMotion) => MotionTune | null;
  onTune?: (m: MeetingMotion, tune: MotionTune | null) => void;
  /**
   * Several at once, drawn over each other: tapping one adds or removes it ("off" clears
   * all), and every picked one opens its settings under the previews.
   */
  many?: { values: MeetingMotion[]; toggle: (m: MeetingMotion) => void };
}) {
  const t = useT();
  const tp = t.meetings.motionPick;
  const [favs, setFavs] = useState(() => readKept(FAV_KEY));
  const [recent, setRecent] = useState(() => readKept(RECENT_KEY));
  const [query, setQuery] = useState('');
  const picked: MeetingMotion[] = many ? many.values : value && value !== 'off' ? [value] : [];
  const [tab, setTabState] = useState<Tab>(() => {
    // Opens where the chosen animation is; else where the person last was.
    const at = MOTION_GROUPS.find((g) => picked[0] && g.items.includes(picked[0]));
    if (at) return at.key;
    let last: string | null = null;
    try {
      last = localStorage.getItem(TAB_KEY);
    } catch {
      /* private mode */
    }
    if (last === 'all' || last === 'recent' || MOTION_GROUPS.some((g) => g.key === last))
      return last as Tab;
    if (last === 'fav' && readKept(FAV_KEY).length) return 'fav';
    return MOTION_GROUPS[0]!.key;
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    setQuery('');
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* private mode */
    }
  };
  const used = (m: MeetingMotion) => {
    const next = [m, ...recent.filter((x) => x !== m)].slice(0, 12);
    setRecent(next);
    writeKept(RECENT_KEY, next);
  };
  const toggleFav = (m: MeetingMotion) => {
    haptic.tap();
    const next = favs.includes(m) ? favs.filter((x) => x !== m) : [m, ...favs];
    setFavs(next);
    writeKept(FAV_KEY, next);
  };

  const first: (MeetingMotion | null)[] = [...(allowInherit ? [null] : []), 'off'];
  const tile = (m: MeetingMotion | null) => {
    const on = many
      ? m === 'off'
        ? many.values.length === 0
        : !!m && many.values.includes(m)
      : value === m;
    const real = !!m && m !== 'off';
    const fav = real && favs.includes(m);
    return (
      <div key={m ?? 'inherit'} className="relative">
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            if (real && !on) used(m);
            if (many) {
              if (m) many.toggle(m);
              return;
            }
            // Tapping the chosen one again takes it off.
            onChange(on && real ? (allowInherit ? null : 'off') : m);
          }}
          className={`flex w-full flex-col items-center gap-1 rounded-2xl p-1 transition active:scale-95 ${
            on ? 'ring-2 ring-[var(--brand)]' : ''
          }`}
        >
          <span className="brand-gradient relative block aspect-[4/3] w-full overflow-hidden rounded-xl">
            {m && <LivePreview kind={m} icon={icon} tune={tuneOf?.(m)} />}
            {!m && (
              <span className="absolute inset-0 flex items-center justify-center text-[20px] text-white">
                ⛪
              </span>
            )}
          </span>
          <span
            className={`text-center text-[12px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
          >
            {m ? t.meetings.motions[m] : (inheritLabel ?? t.meetings.motionMinistry)}
          </span>
        </button>
        {real && (
          <button
            type="button"
            aria-label={fav ? tp.removeFav : tp.addFav}
            aria-pressed={fav}
            onClick={() => toggleFav(m)}
            className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-[14px] leading-none active:scale-90 ${
              fav ? 'text-[#ffd34d]' : 'text-white/80'
            }`}
          >
            {fav ? '★' : '☆'}
          </button>
        )}
      </div>
    );
  };
  // The church's own effects (Effect studio): one item each, used by reference.
  const owned = useEffectTemplates(!!onTune);
  const hasOwn = !!onTune && (owned.data?.length ?? 0) > 0;
  const ownOn = many ? many.values.includes('custom') : value === 'custom';
  const ownRef = tuneOf?.('custom')?.ref ?? null;
  const ownTile = (fx: EffectTemplate) => {
    const on = ownOn && ownRef === fx.id;
    return (
      <button
        key={`own${fx.id}`}
        type="button"
        onClick={() => {
          haptic.tap();
          if (on) {
            if (many) many.toggle('custom');
            else onChange(allowInherit ? null : 'off');
            return;
          }
          onTune?.('custom', { ...(tuneOf?.('custom') ?? {}), ref: fx.id });
          if (many) {
            if (!ownOn) many.toggle('custom');
          } else onChange('custom');
        }}
        className={`flex flex-col items-center gap-1 rounded-2xl p-1 transition active:scale-95 ${
          on ? 'ring-2 ring-[var(--brand)]' : ''
        }`}
      >
        <span className="brand-gradient relative block aspect-[4/3] w-full overflow-hidden rounded-xl">
          <LivePreview kind="custom" icon={icon} tune={{ ref: fx.id }} />
        </span>
        <span
          className={`text-center text-[12px] leading-tight ${on ? 'font-bold text-accent' : 'text-hint'}`}
        >
          {fx.name}
        </span>
      </button>
    );
  };
  const ownBlock = hasOwn && (
    <>
      <div className="grid grid-cols-3 gap-2">{owned.data!.map(ownTile)}</div>
      {ownOn && ownRef && (
        <div className="mt-3">
          <TunePanel
            title={`${t.studio.knob.settings}: ${owned.data!.find((x) => x.id === ownRef)?.name ?? ''}`}
          >
            <MotionTuneControls
              kind="custom"
              tune={tuneOf?.('custom') ?? {}}
              onChange={(tune) => onTune!('custom', { ...tune, ref: ownRef })}
            />
          </TunePanel>
        </div>
      )}
    </>
  );
  // The settings of the picked animations among `items`, opened right under them.
  const tunes = (items: readonly MeetingMotion[]) =>
    onTune &&
    picked
      .filter((m) => m !== 'custom' && items.includes(m))
      .map((m) => (
        <div key={m} className="mt-3">
          <TunePanel title={`${t.studio.knob.settings}: ${t.meetings.motions[m]}`}>
            <MotionTuneControls
              kind={m}
              tune={tuneOf?.(m) ?? {}}
              onChange={(tune) => onTune(m, tune)}
            />
          </TunePanel>
        </div>
      ));
  const grid = (items: readonly MeetingMotion[], empty?: string) =>
    items.length === 0 ? (
      <p className="rounded-xl bg-hairline px-3 py-3 text-center text-[13px] text-hint">{empty}</p>
    ) : (
      <div>
        <div className="grid grid-cols-3 gap-2">{items.map(tile)}</div>
        {tunes(items)}
      </div>
    );

  const q = query.trim().toLowerCase();
  const found = useMemo(
    () =>
      q
        ? MOTION_GROUPS.flatMap((g) => g.items).filter(
            (m, i, all) => all.indexOf(m) === i && t.meetings.motions[m].toLowerCase().includes(q),
          )
        : [],
    [q, t],
  );
  const chips: { key: Tab; label: string }[] = [
    ...(favs.length ? [{ key: 'fav' as const, label: `⭐ ${tp.favourites}` }] : []),
    ...(recent.length ? [{ key: 'recent' as const, label: `🕘 ${tp.recent}` }] : []),
    ...(many && picked.length
      ? [{ key: 'chosen' as const, label: `✓ ${tp.chosen} · ${picked.length}` }]
      : []),
    ...(hasOwn ? [{ key: 'own' as const, label: t.meetings.motionGroups.own }] : []),
    ...MOTION_GROUPS.map((g) => ({
      key: g.key,
      label: `${GROUP_ICON[g.key]} ${t.meetings.motionGroups[g.key]}`,
    })),
    { key: 'all', label: tp.all },
  ];
  // A kept list that has emptied (or own effects gone) falls back to everything.
  const open: Tab = chips.some((c) => c.key === tab) ? tab : 'all';
  const group = MOTION_GROUPS.find((g) => g.key === open);
  // The open type's chip is brought into view in its row (it may be far along) — only when
  // the open type changes, and only sideways: the page itself never jumps.
  const chipRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipRow.current;
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${open}"]`);
    if (!row || !chip) return;
    row.scrollLeft = chip.offsetLeft - row.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
  }, [open, q]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">{first.map(tile)}</div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`🔍 ${tp.search}`}
        className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
      />
      {q ? (
        grid(found, tp.nothing)
      ) : (
        <>
          {/* One row to swipe sideways: a type at a time instead of one long list. */}
          <div
            ref={chipRow}
            className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none]"
          >
            {chips.map((c) => (
              <span key={c.key} className="shrink-0" data-chip={c.key}>
                <Pill on={open === c.key} onClick={() => setTab(c.key)} label={c.label} />
              </span>
            ))}
          </div>
          {open === 'fav' && grid(favs)}
          {open === 'recent' && grid(recent)}
          {open === 'chosen' && grid(picked.filter((m) => m !== 'custom'))}
          {open === 'own' && ownBlock}
          {group && grid(group.items)}
          {open === 'all' && (
            <>
              {hasOwn && <Group title={t.meetings.motionGroups.own}>{ownBlock}</Group>}
              {MOTION_GROUPS.map((g) => (
                <Group key={g.key} title={`${GROUP_ICON[g.key]} ${t.meetings.motionGroups[g.key]}`}>
                  {grid(g.items)}
                </Group>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
