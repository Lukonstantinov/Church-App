import {
  TEXT_ALIGNS,
  TITLE_POSITIONS,
  TITLE_SIZES,
  type GroupSummary,
  type PostDesign,
  type PosterLook,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { useTemplates } from '../lib/queries';
import { FontPicker } from './FontPicker';
import { Group, LookControls, Pill, type LookValue } from './LookControls';
import { ThemePicker } from './ThemePicker';
import { Toggle } from './ui';

/** Where a cover's look comes from. */
export type CoverSource = { kind: 'ministry' } | { kind: 'own' } | { kind: 'template'; id: number };

/** Everything a cover designer edits (posts and events share it). */
export interface CoverState {
  design: PostDesign;
  source: CoverSource;
  own: LookValue;
}

export function initCover(
  d: PostDesign | null | undefined,
  templateId: number | null | undefined,
  look: PosterLook | null | undefined,
  defaultBanner: boolean,
): CoverState {
  return {
    source: templateId
      ? { kind: 'template', id: templateId }
      : d?.custom
        ? { kind: 'own' }
        : { kind: 'ministry' },
    design: {
      banner: d?.banner ?? defaultBanner,
      kind: d?.kind ?? null,
      brandColor: d?.brandColor ?? null,
      noBackdrop: d?.noBackdrop ?? false,
      titleFont: d?.titleFont ?? null,
      bodyFont: d?.bodyFont ?? null,
      titleSize: d?.titleSize ?? 'm',
      titlePos: d?.titlePos ?? 'bottom',
      align: d?.align ?? 'left',
      countdownSize: d?.countdownSize ?? 'm',
      countdownColor: d?.countdownColor ?? null,
      burnStyle: d?.burnStyle ?? 'flame',
      burnColor: d?.burnColor ?? null,
      burnDays: d?.burnDays ?? 3,
      posterLayout: d?.posterLayout ?? 'classic',
      speakerLook: d?.speakerLook ?? null,
    },
    own: {
      pattern: d?.custom?.pattern ?? null,
      textColor: d?.custom?.textColor ?? 'auto',
      backdrop: d?.custom?.backdrop ?? null,
      backdropUrl: d?.custom ? (look?.backdropUrl ?? null) : null,
    },
  };
}

/** The look a cover shows now (for the live preview), and the one before its colour. */
export function useCoverLook(
  state: CoverState,
  g: GroupSummary | undefined,
  /** Meetings: the ministry's default template, worn while "no own choice" is picked. */
  followTemplateId?: number | null,
) {
  const templates = useTemplates();
  const { source, own, design } = state;
  const followed =
    source.kind === 'ministry' && followTemplateId
      ? templates.data?.find((x) => x.id === followTemplateId)
      : undefined;
  const tpl =
    source.kind === 'template'
      ? templates.data?.find((x) => x.id === source.id)
      : (followed ?? undefined);
  const base: PosterLook | null = tpl
    ? {
        brandColor: tpl.brandColor,
        pattern: tpl.pattern,
        textColor: tpl.textColor,
        logoUrl: tpl.logoUrl,
        backdrop: tpl.backdrop,
        backdropUrl: tpl.backdropUrl,
      }
    : g
      ? source.kind === 'own'
        ? {
            brandColor: g.brandColor,
            pattern: own.pattern,
            textColor: own.textColor,
            logoUrl: g.logoUrl,
            backdrop: own.backdrop,
            backdropUrl: own.backdropUrl,
          }
        : {
            brandColor: g.brandColor,
            pattern: g.pattern,
            textColor: g.textColor,
            logoUrl: g.logoUrl,
            backdrop: g.backdrop,
            backdropUrl: g.backdropUrl,
          }
      : null;
  const look: PosterLook | null = base && {
    ...base,
    brandColor: design.brandColor ?? base.brandColor,
    ...(design.noBackdrop ? { backdrop: null, backdropUrl: null } : {}),
  };
  // Following the default is stored as no template of its own.
  return {
    look,
    base,
    templateId: followed ? null : (tpl?.id ?? null),
    followed: followed ?? null,
    templates: templates.data ?? [],
  };
}

/** What the API stores: the design (with an own look when chosen) and the template. */
export function coverPayload(state: CoverState, templateId: number | null) {
  return {
    templateId,
    design: {
      ...state.design,
      custom:
        state.source.kind === 'own'
          ? {
              pattern: state.own.pattern,
              backdrop: state.own.backdrop,
              textColor: state.own.textColor,
            }
          : null,
    },
  };
}

/**
 * The look of a cover: the ministry's (with its own colour, with or without the
 * ministry photo), an own look with the full designer, or a template.
 */
export function CoverLookControls({
  state,
  onChange,
  g,
  groupId,
  followTemplateId,
}: {
  state: CoverState;
  onChange: (s: CoverState) => void;
  g: GroupSummary | undefined;
  groupId: number;
  /** Meetings: the ministry's default template ("as for all meetings"). */
  followTemplateId?: number | null;
}) {
  const t = useT();
  const { base, templates } = useCoverLook(state, g, followTemplateId);
  const defaultTpl = followTemplateId ? templates.find((x) => x.id === followTemplateId) : null;
  const { source, design } = state;
  const setSource = (s: CoverSource) => onChange({ ...state, source: s });
  const set = (patch: Partial<PostDesign>) =>
    onChange({ ...state, design: { ...state.design, ...patch } });
  return (
    <div className="flex flex-col gap-5">
      <Group title={t.env.look}>
        <div className="flex flex-wrap gap-2">
          <Pill
            on={source.kind === 'ministry'}
            onClick={() => setSource({ kind: 'ministry' })}
            label={defaultTpl ? t.design.followDefault(defaultTpl.name) : t.feed.ministryLook}
          />
          <Pill
            on={source.kind === 'own'}
            onClick={() => setSource({ kind: 'own' })}
            label={t.feed.ownLook}
          />
          {templates
            .filter((x) => x.id !== defaultTpl?.id)
            .map((x) => (
              <Pill
                key={x.id}
                on={source.kind === 'template' && source.id === x.id}
                onClick={() => setSource({ kind: 'template', id: x.id })}
                label={x.name}
              />
            ))}
        </div>
      </Group>
      <Group title={t.feed.postColor}>
        <ThemePicker
          value={design.brandColor ?? null}
          onChange={(v) => set({ brandColor: v as PostDesign['brandColor'] })}
          inherit={
            g ? { label: g.name, theme: base?.brandColor ?? g.brandColor ?? 'blue' } : undefined
          }
        />
      </Group>
      {source.kind !== 'own' && base?.backdrop && (
        <Toggle
          label={t.feed.ministryPhoto}
          checked={!design.noBackdrop}
          onChange={(v) => set({ noBackdrop: !v })}
        />
      )}
      {source.kind === 'own' && g && (
        <LookControls
          value={state.own}
          onChange={(own) => onChange({ ...state, own })}
          groupId={groupId}
          logoUrl={g.logoUrl}
        />
      )}
    </div>
  );
}

/** Headline font, size, position and alignment on a cover. */
export function TitleStyleControls({
  design,
  set,
}: {
  design: PostDesign;
  set: (patch: Partial<PostDesign>) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <FontPicker
        label={t.feed.titleFont}
        value={design.titleFont}
        onChange={(v) => set({ titleFont: v })}
      />
      <Group title={t.feed.size}>
        <div className="flex flex-wrap gap-2">
          {TITLE_SIZES.map((s) => (
            <Pill
              key={s}
              on={design.titleSize === s}
              onClick={() => set({ titleSize: s })}
              label={s.toUpperCase()}
            />
          ))}
        </div>
      </Group>
      <Group title={t.feed.position}>
        <div className="flex flex-wrap gap-2">
          {TITLE_POSITIONS.map((p) => (
            <Pill
              key={p}
              on={design.titlePos === p}
              onClick={() => set({ titlePos: p })}
              label={t.feed.positions[p]}
            />
          ))}
        </div>
      </Group>
      <Group title={t.feed.align}>
        <div className="flex flex-wrap gap-2">
          {TEXT_ALIGNS.map((a) => (
            <Pill
              key={a}
              on={design.align === a}
              onClick={() => set({ align: a })}
              label={t.feed.aligns[a]}
            />
          ))}
        </div>
      </Group>
    </div>
  );
}
