import { useRef, useState, type ReactNode } from 'react';
import type {
  AnnouncementRow,
  BackdropConfig,
  DesignTemplate,
  EventSummary,
  GroupSummary,
  MeetingMotion,
  MeetingRow,
  PatternConfig,
  PostDesign,
  PosterLook,
} from '@church/shared';
import { initCover } from '../components/CoverDesigner';
import { DesignStudio } from '../components/DesignStudio';
import { GroupSwitcher } from '../components/GroupSwitcher';
import { Group, LookControls, Pill } from '../components/LookControls';
import { LookTop } from '../components/LookTop';
import { MeetingPoster, groupLook } from '../components/MeetingPoster';
import { MotionPicker } from '../components/MotionPicker';
import { Sheet } from '../components/Sheet';
import { ThemePicker } from '../components/ThemePicker';
import { useToast } from '../components/Toast';
import { IconPlus } from '../components/icons';
import {
  Button,
  DateBadge,
  HeroCard,
  LivingLayer,
  Row,
  Screen,
  Section,
  Toggle,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import {
  useCalendar,
  useDeleteTemplate,
  useFeed,
  useGroup,
  useMe,
  useSaveTemplate,
  useTemplates,
  useUpdateChurch,
  useUpdateEvent,
  useUpdateMeeting,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';

/** A template as a poster look (its colours, pattern, photo; the ministry's logo). */
export const templateLook = (tpl: DesignTemplate): PosterLook => ({
  brandColor: tpl.brandColor,
  pattern: tpl.pattern,
  textColor: tpl.textColor,
  logoUrl: tpl.logoUrl,
  backdrop: tpl.backdrop,
  backdropUrl: tpl.backdropUrl,
});

/**
 * The designer's tab: church-wide templates (look + animation) with live previews of how
 * a meeting wears them — in the app, as the small home tile and as the poster — and the
 * ministry's upcoming meetings, events and recent posts to restyle.
 */
export function Design({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const t = useT();
  const f = useFmt();
  const { push } = useNav();
  const me = useMe();
  const templates = useTemplates();
  const calendar = useCalendar(active.id);
  const feed = useFeed(active.id);
  const updateChurch = useUpdateChurch();
  const [editing, setEditing] = useState<DesignTemplate | 'new' | null>(null);
  const [applying, setApplying] = useState<
    { kind: 'meeting'; m: MeetingRow } | { kind: 'event'; e: EventSummary } | null
  >(null);
  // Fixed when the screen opens: the lists show what is still ahead.
  const [now] = useState(() => Date.now());
  const locked = me.data?.church.designLock ?? false;
  const isAdmin = me.data?.user.isAdmin ?? false;

  const meetings = (calendar.data?.meetings ?? [])
    .filter((m) => m.status !== 'cancelled' && Date.parse(m.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 8);
  const events = (calendar.data?.events ?? [])
    .filter((e) => e.status !== 'cancelled' && Date.parse(e.endsAt ?? e.startsAt) > now - 3_600_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 6);
  const posts: AnnouncementRow[] = (feed.data?.pages.flat() ?? []).slice(0, 6);
  const tplName = (id: number | null) =>
    id ? templates.data?.find((x) => x.id === id)?.name : undefined;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} subtitle={t.design.subtitle} />

      <Section footer={t.design.lockHint}>
        {isAdmin ? (
          <Toggle
            label={`🔒 ${t.design.lockToggle}`}
            checked={locked}
            disabled={updateChurch.isPending}
            onChange={(v) => updateChurch.mutate({ designLock: v })}
          />
        ) : (
          <Row title={locked ? `🔒 ${t.design.lockOn}` : `🔓 ${t.design.lockOff}`} />
        )}
      </Section>

      <DesignStudio g={active} />

      <section>
        <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.design.templates}
        </h2>
        <p className="mb-2.5 px-3 text-[13px] text-hint">{t.design.templatesHint}</p>
        <div className="grid grid-cols-2 gap-3">
          {(templates.data ?? []).map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setEditing(tpl)}
              className="glass overflow-hidden rounded-2xl text-left shadow-card active:scale-[0.98]"
            >
              <LookTop look={templateLook(tpl)} className="relative aspect-[16/10] p-2.5">
                <LivingLayer kind={tpl.motion ?? 'calm'} />
                <span className="relative mt-auto text-[12px] font-bold uppercase tracking-wider opacity-85">
                  {tpl.motion ? t.meetings.motions[tpl.motion] : t.design.motionInherit}
                </span>
              </LookTop>
              <span className="block truncate p-2.5 text-[14px] font-semibold">{tpl.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="glass flex min-h-[130px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-hint/30 text-hint active:scale-[0.98]"
          >
            <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-cta">
              <IconPlus size={22} />
            </span>
            <span className="text-[14px] font-semibold">{t.design.newTemplate}</span>
          </button>
        </div>
      </section>

      <Section title={t.design.meetings}>
        {meetings.length === 0 && <Row title={t.design.nothing} />}
        {meetings.map((m) => (
          <Row
            key={m.id}
            before={<Thumb look={m.look ?? groupLook(active)} motion={m.motion} />}
            title={m.title}
            subtitle={`${f.relativeDay(m.startsAt)} · ${f.time(m.startsAt)} · ${
              tplName(m.templateId) ?? (m.design?.custom ? t.design.ownLook : t.design.ministryLook)
            }`}
            onClick={() => setApplying({ kind: 'meeting', m })}
          />
        ))}
      </Section>

      <Section title={t.design.events}>
        {events.length === 0 && <Row title={t.design.nothing} />}
        {events.map((e) => (
          <Row
            key={e.id}
            before={<Thumb look={e.look ?? groupLook(active)} photo={e.coverUrl} />}
            title={e.title}
            subtitle={`${f.weekdayDayMonth(e.startsAt)} · ${
              tplName(e.templateId) ?? (e.design?.custom ? t.design.ownLook : t.design.ministryLook)
            }`}
            onClick={() => setApplying({ kind: 'event', e })}
          />
        ))}
      </Section>

      <Section title={t.design.posts}>
        {posts.length === 0 && <Row title={t.design.nothing} />}
        {posts.map((p) => (
          <Row
            key={p.id}
            before={<Thumb look={p.look ?? groupLook(active)} photo={p.photos[0]?.url} />}
            title={p.title || p.text.slice(0, 60) || '—'}
            subtitle={f.weekdayDayMonth(p.createdAt)}
            onClick={
              p.canDesign
                ? () => push({ name: 'editPost', groupId: active.id, postId: p.id })
                : undefined
            }
          />
        ))}
      </Section>

      {editing && (
        <TemplateSheet
          tpl={editing === 'new' ? null : editing}
          g={active}
          canDelete={editing !== 'new' && (editing.mine || isAdmin)}
          onClose={() => setEditing(null)}
        />
      )}
      {applying && <ApplySheet item={applying} g={active} onClose={() => setApplying(null)} />}
    </Screen>
  );
}

/** A small square of a look (or a photo) at the start of a row. */
function Thumb({
  look,
  motion,
  photo,
}: {
  look: PosterLook;
  motion?: MeetingMotion;
  photo?: string | null;
}) {
  if (photo)
    return <img src={photo} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />;
  return (
    <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-xl">
      <LookTop look={look} className="relative h-full w-full">
        {motion && <LivingLayer kind={motion} />}
        <span />
      </LookTop>
    </span>
  );
}

/**
 * A meeting in a look, three ways, as a carousel (swipe, or tap a name above): the
 * meeting screen's living hero, the small tile on the ministry's home page and the poster
 * sent by the bot. Pinned to the top of the sheet, so every change below shows at once.
 */
export function DesignPreviews({
  look,
  motion,
  g,
  title,
  design,
}: {
  look: PosterLook;
  motion: MeetingMotion;
  g: GroupSummary;
  title?: string;
  design?: PostDesign | null;
}) {
  const t = useT();
  const f = useFmt();
  const track = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  // A sample date three days ahead, 19:00–21:00, fixed while the sheet is open.
  const [when] = useState(() => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    d.setHours(19, 0, 0, 0);
    return { startsAt: d.toISOString(), endsAt: new Date(d.getTime() + 7_200_000).toISOString() };
  });
  const name = title || t.design.sampleTitle;
  const labels = [t.design.previewApp, t.design.previewTile, t.design.previewPoster];
  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="sticky top-0 z-20 -mx-4 rounded-b-[22px] bg-[var(--color-section)] pb-2.5 pt-1 shadow-card">
      <div className="flex justify-center gap-1.5 px-4 pb-2">
        {labels.map((l, i) => (
          <button
            key={l}
            type="button"
            onClick={() => go(i)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
              slide === i ? 'brand-gradient text-white shadow-cta' : 'bg-hairline text-hint'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
      >
        <Slide>
          <div className="w-full">
            <HeroCard look={look} living={motion}>
              <div className="mb-3 truncate text-[12px] font-bold uppercase tracking-wider opacity-80">
                {g.name}
              </div>
              <div className="flex items-center gap-3.5">
                <DateBadge {...f.dateBadge(when.startsAt)} onBrand />
                <div className="min-w-0">
                  <div className="truncate text-[20px] font-bold leading-tight">{name}</div>
                  <div className="text-[14px] opacity-85">
                    {f.relativeDay(when.startsAt)} · {f.timeRange(when.startsAt, when.endsAt)}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-[16px] font-semibold">«{t.design.sampleTopic}»</div>
            </HeroCard>
          </div>
        </Slide>
        <Slide>
          <div className="glass w-[58%] overflow-hidden rounded-2xl shadow-card">
            <LookTop look={look} className="flex aspect-[16/10] flex-col p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                {t.meetings.details}
              </span>
              <span className="mt-auto">
                <DateBadge {...f.dateBadge(when.startsAt)} onBrand />
              </span>
            </LookTop>
            <div className="flex flex-col gap-0.5 p-2.5">
              <span className="truncate text-[14px] font-semibold">{name}</span>
              <span className="truncate text-[12px] text-hint">
                {f.relativeDay(when.startsAt)} · {f.time(when.startsAt)}
              </span>
            </div>
          </div>
        </Slide>
        <Slide>
          {/* Drawn at print size (540×675); shown here at 30%. */}
          <div className="h-[203px] w-[162px] overflow-hidden rounded-xl shadow-card">
            <div className="origin-top-left scale-[0.3]">
              <MeetingPoster
                m={{
                  title: name,
                  startsAt: when.startsAt,
                  endsAt: when.endsAt,
                  topic: t.design.sampleTopic,
                  location: t.design.sampleLocation,
                  leader: null,
                  kind: null,
                  look,
                  design: design ?? null,
                  speakers: [],
                }}
                g={g}
              />
            </div>
          </div>
        </Slide>
      </div>
    </div>
  );
}

/** One page of the preview carousel: full width, the same height for all three. */
function Slide({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[210px] w-full shrink-0 snap-center items-center justify-center px-4">
      {children}
    </div>
  );
}

/** Make or change a template: name, colour, pattern/photo and the meeting animation. */
function TemplateSheet({
  tpl,
  g,
  canDelete,
  onClose,
}: {
  tpl: DesignTemplate | null;
  g: GroupSummary;
  canDelete: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const save = useSaveTemplate();
  const remove = useDeleteTemplate();
  const group = useGroup(g.id);
  const templates = useTemplates();
  // A new template starts with a name, so "Save" works even if the field was scrolled past.
  const [name, setName] = useState(
    () => tpl?.name ?? `${t.design.newTemplate} ${(templates.data?.length ?? 0) + 1}`,
  );
  const [brandColor, setBrandColor] = useState<string | null>(tpl?.brandColor ?? g.brandColor);
  const [look, setLook] = useState<{
    pattern: PatternConfig | null;
    textColor: string;
    backdrop: BackdropConfig | null;
    backdropUrl: string | null;
  }>({
    pattern: tpl ? tpl.pattern : g.pattern,
    textColor: tpl?.textColor ?? g.textColor,
    backdrop: tpl ? tpl.backdrop : null,
    backdropUrl: tpl ? tpl.backdropUrl : null,
  });
  const [motion, setMotion] = useState<MeetingMotion | null>(tpl?.motion ?? 'calm');
  const preview: PosterLook = {
    brandColor: brandColor ?? g.brandColor,
    pattern: look.pattern,
    textColor: look.textColor,
    logoUrl: tpl?.logoUrl ?? g.logoUrl,
    backdrop: look.backdrop,
    backdropUrl: look.backdropUrl,
  };

  async function submit() {
    try {
      await save.mutateAsync({
        id: tpl?.id,
        name: name.trim() || `${t.design.newTemplate}`,
        brandColor,
        pattern: look.pattern,
        textColor: look.textColor,
        logoMediaId: g.logoMediaId,
        backdrop: look.backdrop,
        motion,
      });
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={tpl ? t.design.editTemplate : t.design.newTemplate}>
      <div className="flex flex-col gap-5 px-4 pb-4">
        <DesignPreviews
          look={preview}
          motion={motion ?? group.data?.meetingMotion ?? 'calm'}
          g={g}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.design.templateName}
          maxLength={40}
          className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
        />
        <Group title={t.design.color}>
          <ThemePicker value={brandColor} onChange={setBrandColor} />
        </Group>
        <LookControls value={look} onChange={setLook} groupId={g.id} logoUrl={g.logoUrl} />
        <Group title={t.design.motion}>
          <MotionPicker value={motion} onChange={setMotion} allowInherit />
        </Group>
        <Button disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
        {tpl && canDelete && (
          <Button
            variant="secondary"
            disabled={remove.isPending}
            onClick={async () => {
              if (!(await confirmDialog(t.design.deleteConfirm))) return;
              await remove.mutateAsync(tpl.id).catch(() => toast(t.common.actionFailed, 'error'));
              onClose();
            }}
          >
            {t.design.deleteTemplate}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

type Choice = 'ministry' | 'own' | number;

/**
 * Restyle one meeting or event: the ministry's look, its own (kept as it is) or a
 * template, previewed live. The full designer is one tap away.
 */
function ApplySheet({
  item,
  g,
  onClose,
}: {
  item: { kind: 'meeting'; m: MeetingRow } | { kind: 'event'; e: EventSummary };
  g: GroupSummary;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { push } = useNav();
  const templates = useTemplates();
  const updateMeeting = useUpdateMeeting();
  const updateEvent = useUpdateEvent(item.kind === 'event' ? item.e.id : 0);
  const thing = item.kind === 'meeting' ? item.m : item.e;
  const start: Choice = thing.templateId ?? (thing.design?.custom ? 'own' : 'ministry');
  const [choice, setChoice] = useState<Choice>(start);
  const tpl = typeof choice === 'number' ? templates.data?.find((x) => x.id === choice) : null;
  const look: PosterLook =
    choice === 'own' ? (thing.look ?? groupLook(g)) : tpl ? templateLook(tpl) : groupLook(g);
  const motion: MeetingMotion =
    item.kind === 'meeting'
      ? (item.m.ownMotion ?? tpl?.motion ?? (choice === start ? item.m.motion : 'calm'))
      : (tpl?.motion ?? 'calm');
  const pending = updateMeeting.isPending || updateEvent.isPending;

  async function save() {
    if (choice === start) return onClose();
    // A template or the ministry's look replaces the own look and own colour.
    const design = {
      ...initCover(thing.design, null, null, true).design,
      brandColor: null,
      custom: null,
    };
    const templateId = typeof choice === 'number' ? choice : null;
    try {
      if (item.kind === 'meeting')
        await updateMeeting.mutateAsync({
          id: item.m.id,
          templateId,
          design,
          // The template's animation shows unless this meeting has its own.
          ...(templateId ? { motion: null } : {}),
        });
      else await updateEvent.mutateAsync({ templateId, design });
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.design.noRights, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={`🎨 ${thing.title}`}>
      <div className="flex flex-col gap-5 px-4 pb-4">
        <DesignPreviews
          look={look}
          motion={motion}
          g={g}
          title={thing.title}
          design={thing.design}
        />
        <Group title={t.design.apply}>
          <div className="flex flex-wrap gap-2">
            <Pill
              on={choice === 'ministry'}
              onClick={() => setChoice('ministry')}
              label={t.design.ministryLook}
            />
            {start === 'own' && (
              <Pill
                on={choice === 'own'}
                onClick={() => setChoice('own')}
                label={t.design.ownLook}
              />
            )}
            {(templates.data ?? []).map((x) => (
              <Pill
                key={x.id}
                on={choice === x.id}
                onClick={() => setChoice(x.id)}
                label={x.name}
              />
            ))}
          </div>
        </Group>
        <Button disabled={pending} onClick={() => void save()}>
          {pending ? t.common.saving : t.common.save}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onClose();
            push(
              item.kind === 'meeting'
                ? { name: 'meeting', meetingId: item.m.id }
                : { name: 'event', eventId: item.e.id },
            );
          }}
        >
          {t.design.openEditor}
        </Button>
      </div>
    </Sheet>
  );
}
