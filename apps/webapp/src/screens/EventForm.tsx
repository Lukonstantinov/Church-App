import { useRef, useState, type ReactNode } from 'react';
import { parseAmount, type EventDetail, type EventFeatures, type PostDesign } from '@church/shared';
import {
  CoverLookControls,
  TitleStyleControls,
  coverPayload,
  initCover,
  useCoverLook,
  type CoverState,
} from '../components/CoverDesigner';
import { BURN_COLORS, BURN_STYLES, BurnColorPicker, BurnFx, burnPaint } from '../components/Burn';
import { COUNTDOWN_COLORS, COUNTDOWN_SIZES, CountdownBadge } from '../components/Countdown';
import { Pill } from '../components/LookControls';
import {
  CoverEffectLayers,
  CoverEffects,
  effectsPayload,
  initEffects,
  type EffectsState,
} from '../components/CoverEffects';
import { CoverPicture } from '../components/CoverSlideshow';
import { LayeredPoster, usePosterTexts } from '../components/LayeredPoster';
import { PosterPicker } from '../components/PosterStudio';
import { PosterMedia } from '../components/Poster';
import {
  SpeakerLookControls,
  SpeakersEditor,
  toDrafts,
  toShown,
  toSpeakerInputs,
  type SpeakerDraft,
} from '../components/Speakers';
import { capturePoster } from '../lib/poster';
import { ApiError } from '../lib/api';
import { Sheet } from '../components/Sheet';
import {
  IconCalendar,
  IconCamera,
  IconCheck,
  IconCoins,
  IconImage,
  IconMinus,
  IconPlus,
  IconTelegram,
  IconUsers,
  IconX,
} from '../components/icons';
import { useMoney } from '../components/money';
import { useToast } from '../components/Toast';
import {
  Button,
  ErrorState,
  Loading,
  Screen,
  Section,
  TextArea,
  TextField,
  TimeField,
  Title,
  Toggle,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useMayDesign } from '../lib/env';
import { useNav } from '../lib/nav';
import {
  useCreateEvent,
  useEvent,
  useGroup,
  usePosterTemplates,
  useSendAnnouncement,
  useSetRoles,
  useUpdateEvent,
  useUploadMedia,
} from '../lib/queries';
import { haptic } from '../lib/telegram';

const CHAT_RE = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/;

interface RoleDraft {
  key: string;
  id?: number;
  name: string;
  description: string;
  leaderId: number | null;
  slots: number;
  userIds: number[];
}

/** Create an event (eventId absent) or edit one. */
export function EventForm({
  groupId,
  eventId,
  date: initialDate,
}: {
  groupId: number;
  eventId?: number;
  date?: string;
}) {
  const existing = useEvent(eventId ?? 0, eventId !== undefined);
  if (eventId === undefined) return <EventFormBody groupId={groupId} initialDate={initialDate} />;
  if (existing.isPending) return <Loading />;
  if (existing.isError) return <ErrorState onRetry={() => void existing.refetch()} />;
  return <EventFormBody groupId={groupId} event={existing.data} />;
}

function EventFormBody({
  groupId,
  event,
  initialDate,
}: {
  groupId: number;
  event?: EventDetail;
  initialDate?: string;
}) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const { replace, back } = useNav();
  const group = useGroup(groupId);
  const create = useCreateEvent(groupId);
  const update = useUpdateEvent(event?.id ?? 0);
  const setRoles = useSetRoles(event?.id ?? 0);
  const announce = useSendAnnouncement(groupId);
  const upload = useUploadMedia(groupId, 'event');
  const fileInput = useRef<HTMLInputElement>(null);
  // With looks locked to designers, others keep the cover as it is.
  const mayDesignHere = useMayDesign();
  const mayDesign = event ? event.canDesign : mayDesignHere;
  // A designer who can't manage the event changes only its look (the rest stays hidden).
  const designOnly = !!event && !event.canManage;

  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [date, setDate] = useState(() =>
    event
      ? f.todayInput(new Date(event.startsAt))
      : (initialDate ?? f.todayInput(new Date(Date.now() + 7 * 864e5))),
  );
  const [startTime, setStartTime] = useState(event ? f.time(event.startsAt) : '18:00');
  const [hasEnd, setHasEnd] = useState(!!event?.endsAt);
  const [endDate, setEndDate] = useState(() =>
    event?.endsAt ? f.todayInput(new Date(event.endsAt)) : date,
  );
  const [endTime, setEndTime] = useState(event?.endsAt ? f.time(event.endsAt) : '21:00');
  const [features, setFeatures] = useState<EventFeatures>(
    event?.features ?? { gallery: false, rsvp: true, duties: false, cost: false },
  );
  const [price, setPrice] = useState(
    event?.priceCents ? String(event.priceCents / 100).replace('.', ',') : '',
  );
  const [chatUrl, setChatUrl] = useState(event?.chatUrl ?? '');
  const [cover, setCover] = useState<{ id: number; url: string } | null>(
    event?.coverMediaId && event.coverUrl ? { id: event.coverMediaId, url: event.coverUrl } : null,
  );
  const [roles, setRoleDrafts] = useState<RoleDraft[]>(
    event?.roles.map((r) => ({
      key: String(r.id),
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      leaderId: r.leader?.id ?? null,
      slots: r.slots,
      userIds: r.assignees.map((a) => a.id),
    })) ?? [],
  );
  const [notify, setNotify] = useState(true);
  const [countdown, setCountdown] = useState(event?.countdown ?? false);
  // The cover's effects (several can combine), folded away until wanted.
  const [effects, setEffects] = useState<EffectsState>(() => initEffects(event));
  const [effectsOpen, setEffectsOpen] = useState(false);
  // The cover slideshow: more photos shown in turn after the cover.
  const [slides, setSlides] = useState<{ id: number; url: string }[]>(() =>
    (event?.coverSlides?.mediaIds ?? []).map((id, i) => ({
      id,
      url: event?.coverSlides?.urls[i] ?? '',
    })),
  );
  const [slideSeconds, setSlideSeconds] = useState(event?.coverSlides?.seconds ?? 5);
  const slideInput = useRef<HTMLInputElement>(null);
  // A poster template (Design → Posters): the event's words fill in its texts.
  const [posterTpl, setPosterTpl] = useState<number | null>(event?.posterTemplateId ?? null);
  const posters = usePosterTemplates(mayDesign);
  const chosenPoster = posters.data?.find((x) => x.id === posterTpl) ?? null;
  const posterTexts = usePosterTexts();
  const posterWords = posterTexts({
    title: title.trim() || t.events.name,
    // (An unfinished date shows today rather than breaking the form.)
    startsAt: Number.isNaN(Date.parse(`${date}T${startTime || '18:00'}`))
      ? new Date().toISOString()
      : new Date(`${date}T${startTime || '18:00'}`).toISOString(),
    location: location || null,
  });
  const coverLayer = <CoverEffectLayers e={effectsPayload(effects)} image={cover?.url} />;
  const [speakers, setSpeakers] = useState<SpeakerDraft[]>(() => toDrafts(event?.speakers));
  // Without a cover photo the event shows a designed cover, like posts.
  const [look, setLook] = useState<CoverState>(() =>
    // Its own choice only: following the ministry's default shows as "as for all events".
    initCover(event?.design, event?.ownTemplateId ?? null, event?.look, true),
  );
  const coverLook = useCoverLook(look, group.data, group.data?.eventTemplateId);
  const setDesign = (patch: Partial<PostDesign>) =>
    setLook((c) => ({ ...c, design: { ...c.design, ...patch } }));
  const previewPaint = burnPaint(
    look.design.burnColor ?? BURN_COLORS[0]!,
    look.design.burnStyle ?? 'flame',
  );
  const BURN_LABEL = {
    flame: t.events.burnFlame,
    glow: t.events.burnGlow,
    pulse: t.events.burnPulse,
    orbit: t.events.burnOrbit,
    neon: t.events.burnNeon,
    sparks: t.events.burnSparks,
    electric: t.events.burnElectric,
    shimmer: t.events.burnShimmer,
    off: t.events.burnOff,
  };
  const [rolePicker, setRolePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const posterNode = useRef<HTMLDivElement>(null);

  /** The cover (photo with the title, the design, or the ministry's look) as a JPEG for the bot. */
  async function makePoster(): Promise<number | null> {
    if (!posterNode.current) return null;
    const blob = await capturePoster(posterNode.current);
    if (!blob) return null;
    return upload
      .mutateAsync(blob)
      .then((m) => m.id)
      .catch(() => null);
  }

  const priceCents = price.trim() ? parseAmount(price) : null;
  const chatOk = !chatUrl.trim() || CHAT_RE.test(chatUrl.trim());
  const valid =
    title.trim().length > 0 && chatOk && (!features.cost || !price.trim() || priceCents !== null);

  const toggle = (k: keyof EventFeatures) => {
    haptic.tap();
    setFeatures((x) => ({ ...x, [k]: !x[k] }));
  };

  async function addSlides(files: FileList | null) {
    if (!files?.length) return;
    try {
      const room = 9 - slides.length;
      for (const file of Array.from(files).slice(0, room)) {
        const up = await upload.mutateAsync(await preparePhoto(file));
        setSlides((all) => [...all, up]);
      }
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (slideInput.current) slideInput.current.value = '';
    }
  }

  async function pickCover(file: File | undefined) {
    if (!file) return;
    try {
      setCover(await upload.mutateAsync(await preparePhoto(file)));
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const addRole = (name = '') =>
    setRoleDrafts((r) => [
      ...r,
      {
        key: `n${Date.now()}${r.length}`,
        name,
        description: '',
        leaderId: null,
        slots: 1,
        userIds: [],
      },
    ]);
  const editRole = (key: string, patch: Partial<RoleDraft>) =>
    setRoleDrafts((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function submit() {
    if (!valid) return;
    setSaving(true);
    const cleanRoles = features.duties
      ? roles
          .filter((r) => r.name.trim())
          .map((r) => ({
            id: r.id,
            name: r.name.trim(),
            description: r.description.trim() || null,
            leaderId: r.leaderId,
            slots: r.slots,
            userIds: r.userIds,
          }))
      : [];
    const posterMediaId = await makePoster();
    const common = {
      posterMediaId,
      title: title.trim(),
      description,
      location,
      date,
      startTime,
      endDate: hasEnd ? endDate : null,
      endTime: hasEnd ? endTime : null,
      coverMediaId: cover?.id ?? null,
      posterTemplateId: posterTpl,
      coverSlides:
        cover && slides.length
          ? { mediaIds: slides.map((x) => x.id), seconds: slideSeconds }
          : null,
      ...coverPayload(look, coverLook.templateId),
      features,
      countdown,
      ...effectsPayload(effects),
      speakers: toSpeakerInputs(speakers),
      priceCents: features.cost ? priceCents : null,
      chatUrl: chatUrl.trim() || null,
    };
    try {
      if (event && designOnly) {
        // Only the look and the speakers (they are on the poster) — nothing else is theirs.
        await update.mutateAsync({
          posterMediaId,
          coverMediaId: common.coverMediaId,
          posterTemplateId: common.posterTemplateId,
          coverSlides: common.coverSlides,
          ...coverPayload(look, coverLook.templateId),
          ...effectsPayload(effects),
          speakers: common.speakers,
          lookVersion: event.lookVersion,
        });
        haptic.success();
        toast(t.common.saved);
        back();
      } else if (event) {
        await update.mutateAsync({ ...common, lookVersion: event.lookVersion });
        if (features.duties) await setRoles.mutateAsync({ roles: cleanRoles });
        haptic.success();
        toast(t.common.saved);
        back();
      } else {
        const created = await create.mutateAsync({ ...common, roles: cleanRoles });
        if (notify) {
          const when = `${f.weekdayDayMonth(created.startsAt)} · ${f.time(created.startsAt)}`;
          const head = t.events.announce(created.title, when, created.location);
          const body = created.description ? `${head}\n\n${created.description}` : head;
          await announce
            .mutateAsync({ text: body.slice(0, 2000), eventId: created.id })
            .catch(() => undefined);
        }
        haptic.success();
        toast(t.events.created);
        replace({ name: 'event', eventId: created.id });
      }
    } catch (e) {
      haptic.error();
      // Someone changed its look while this form was open: say so instead of overwriting.
      toast(
        e instanceof ApiError && e.status === 409 ? t.design.lookChanged : t.common.saveFailed,
        'error',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title subtitle={group.data?.name}>{event ? t.events.edit : t.events.new}</Title>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pickCover(e.target.files?.[0])}
      />
      {cover ? (
        // While the effects are open the cover stays in view, so every change shows at once.
        <div
          className={
            effectsOpen
              ? 'glass-strong sticky top-0 z-10 -mx-4 rounded-b-[26px] px-4 pb-3 pt-3'
              : undefined
          }
        >
          <div className="relative overflow-hidden rounded-[var(--radius-card)] shadow-card">
            <div className="relative aspect-[16/9] w-full">
              <CoverPicture
                e={{ coverUrl: cover.url, ...effectsPayload(effects) }}
                photos={[cover.url, ...slides.map((x) => x.url)]}
                seconds={slideSeconds}
              />
            </div>
            <div className={`absolute bottom-2 right-2 flex gap-2 ${mayDesign ? '' : 'hidden'}`}>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-10 items-center gap-1.5 rounded-full bg-black/55 px-3.5 text-[14px] font-semibold text-white backdrop-blur"
              >
                <IconCamera size={17} /> {t.events.changeCover}
              </button>
              <button
                type="button"
                aria-label="remove"
                onClick={() => setCover(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
              >
                <IconX size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : look.design.banner ? (
        <div className="glass-strong sticky top-0 z-10 -mx-4 rounded-b-[26px] px-4 pb-3 pt-3">
          <div className="relative overflow-hidden rounded-[var(--radius-card)] shadow-card">
            <PosterMedia
              title={title.trim() || t.events.name}
              photos={[]}
              tint={null}
              look={coverLook.look}
              design={look.design}
              speakers={toShown(speakers)}
            />
            {coverLayer}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
              hidden={!mayDesign}
              className="absolute right-2 top-2 flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[13px] font-semibold text-white backdrop-blur"
            >
              <IconCamera size={16} /> {upload.isPending ? t.treasury.uploading : t.events.addCover}
            </button>
          </div>
        </div>
      ) : !mayDesign ? null : (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="glass flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-hint/30 text-hint shadow-card active:scale-[0.99]"
        >
          <span className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-cta">
            <IconImage size={24} />
          </span>
          <span className="text-[15px] font-semibold">
            {upload.isPending ? t.treasury.uploading : t.events.addCover}
          </span>
        </button>
      )}

      {/* The designed cover at full size, off screen: the picture the bot sends is taken from it. */}
      <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 720 }}>
        <div ref={posterNode}>
          {chosenPoster ? (
            <LayeredPoster
              tpl={chosenPoster}
              texts={posterWords}
              coverUrl={cover?.url}
              className="h-[900px] w-[720px]"
            />
          ) : (
            <PosterMedia
              title={title.trim() || t.events.name}
              photos={cover ? [cover] : []}
              tint={null}
              look={coverLook.look}
              design={{ ...look.design, banner: true }}
              speakers={toShown(speakers)}
            />
          )}
        </div>
      </div>

      {!cover && mayDesign && (
        <Section title={t.events.coverLook} footer={t.events.coverLookHint}>
          <Toggle
            label={t.feed.showCover}
            checked={look.design.banner}
            onChange={(v) => setDesign({ banner: v })}
          />
          {look.design.banner && (
            <div className="flex flex-col gap-5 border-t border-hairline p-4">
              <CoverLookControls
                state={look}
                onChange={setLook}
                g={group.data}
                groupId={groupId}
                followTemplateId={group.data?.eventTemplateId}
                followLabel={t.design.followDefaultEvents}
              />
              <div>
                <div className="mb-2 text-[13px] text-hint">{t.meetings.posterLayout}</div>
                <div className="flex flex-wrap gap-2">
                  {(['classic', 'collage'] as const).map((l) => (
                    <Pill
                      key={l}
                      on={(look.design.posterLayout ?? 'classic') === l}
                      onClick={() => setDesign({ posterLayout: l })}
                      label={l === 'classic' ? t.meetings.layoutClassic : t.meetings.layoutCollage}
                    />
                  ))}
                </div>
              </div>
              <TitleStyleControls design={look.design} set={setDesign} />
            </div>
          )}
        </Section>
      )}

      {mayDesign && (
        <Section title={t.posters.pick} footer={t.posters.pickHint}>
          <div className="flex flex-col gap-3 p-3">
            {chosenPoster && (
              <LayeredPoster
                tpl={chosenPoster}
                texts={posterWords}
                coverUrl={cover?.url}
                className="mx-auto aspect-[4/5] w-[62%] rounded-2xl shadow-card"
              />
            )}
            <PosterPicker
              value={posterTpl}
              onChange={setPosterTpl}
              texts={posterWords}
              coverUrl={cover?.url}
            />
          </div>
        </Section>
      )}

      {cover && mayDesign && (
        <Section title={t.events.slideshow} footer={t.events.slideshowHint}>
          <input
            ref={slideInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void addSlides(e.target.files)}
          />
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap gap-2">
              <img
                src={cover.url}
                alt=""
                className="h-16 w-16 rounded-xl object-cover ring-2 ring-[var(--brand)]"
              />
              {slides.map((x, i) => (
                <span key={x.id} className="relative h-16 w-16">
                  <img src={x.url} alt="" className="h-full w-full rounded-xl object-cover" />
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => setSlides((all) => all.filter((_, k) => k !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <IconX size={13} />
                  </button>
                </span>
              ))}
              {slides.length < 9 && (
                <button
                  type="button"
                  disabled={upload.isPending}
                  onClick={() => slideInput.current?.click()}
                  className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-hint/40 text-hint active:scale-95"
                >
                  {upload.isPending ? '…' : <IconPlus size={22} />}
                </button>
              )}
            </div>
            {slides.length > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px]">{t.events.slideSeconds(slideSeconds)}</span>
                <Stepper
                  value={slideSeconds}
                  onChange={(v) => setSlideSeconds(Math.min(20, Math.max(2, v)))}
                />
              </div>
            )}
          </div>
        </Section>
      )}

      {(cover || look.design.banner) && mayDesign && (
        <CoverEffects
          state={effects}
          onChange={setEffects}
          open={effectsOpen}
          onOpen={setEffectsOpen}
        />
      )}

      <Section title={t.meetings.speakers}>
        <SpeakersEditor groupId={groupId} value={speakers} onChange={setSpeakers} />
      </Section>
      {speakers.some((sp) => sp.name.trim()) && mayDesign && (
        <Section title={t.meetings.speakerLook}>
          <div className="p-4">
            <SpeakerLookControls
              value={look.design.speakerLook}
              onChange={(speakerLook) => setDesign({ speakerLook })}
            />
          </div>
        </Section>
      )}

      {designOnly && (
        <p className="px-1 text-[13px] leading-snug text-hint">{t.publish.designOnly}</p>
      )}
      {!designOnly && (
        <>
          <Section>
            <TextField
              label={t.events.name}
              value={title}
              onChange={setTitle}
              maxLength={80}
              autoFocus={!event}
            />
            <TextField
              label={t.events.location}
              value={location}
              onChange={setLocation}
              maxLength={120}
            />
          </Section>
          <Section title={t.events.description}>
            <TextArea
              value={description}
              onChange={setDescription}
              placeholder={t.events.descriptionPlaceholder}
              maxLength={2000}
              rows={4}
            />
          </Section>

          <Section title={t.events.when}>
            <TextField label={t.events.date} type="date" value={date} onChange={setDate} />
            <TimeField label={t.events.start} value={startTime} onChange={setStartTime} />
            <Toggle label={t.events.hasEnd} checked={hasEnd} onChange={setHasEnd} />
            {hasEnd && (
              <>
                <TextField
                  label={t.events.endDate}
                  type="date"
                  value={endDate}
                  onChange={setEndDate}
                />
                <TimeField label={t.events.end} value={endTime} onChange={setEndTime} />
              </>
            )}
            <Toggle
              label={
                <span className="flex flex-col">
                  <span>{t.meetings.countdown}</span>
                  <span className="text-[12px] font-normal text-hint">
                    {t.meetings.countdownHint}
                  </span>
                </span>
              }
              checked={countdown}
              onChange={setCountdown}
            />
            {countdown && (
              <fieldset
                disabled={!mayDesign}
                className="flex flex-col gap-3.5 px-4 pb-4 pt-1 disabled:opacity-60"
              >
                <div className="flex min-h-[44px] items-center">
                  <CountdownBadge
                    startsAt={new Date(`${date}T${startTime || '00:00'}`).toISOString()}
                    design={look.design}
                  />
                </div>
                <div>
                  <div className="mb-2 text-[13px] text-hint">{t.meetings.countdownSize}</div>
                  <div className="flex gap-2">
                    {COUNTDOWN_SIZES.map((sz) => (
                      <Pill
                        key={sz}
                        on={(look.design.countdownSize ?? 'm') === sz}
                        onClick={() =>
                          setLook({ ...look, design: { ...look.design, countdownSize: sz } })
                        }
                        label={sz.toUpperCase()}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[13px] text-hint">{t.meetings.countdownColor}</div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {[null, ...COUNTDOWN_COLORS].map((c) => {
                      const on = (look.design.countdownColor ?? null) === c;
                      return (
                        <button
                          key={c ?? 'auto'}
                          type="button"
                          aria-label={c ?? t.meetings.countdownAuto}
                          onClick={() =>
                            setLook({ ...look, design: { ...look.design, countdownColor: c } })
                          }
                          className={`h-8 w-8 rounded-full ring-1 ring-black/10 transition active:scale-90 ${
                            on ? 'ring-2 ring-[var(--text)] ring-offset-2' : ''
                          }`}
                          style={{
                            background: c ?? 'linear-gradient(135deg, #f59e0b, #ef4444)',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </fieldset>
            )}
          </Section>
        </>
      )}

      <Section
        title={t.events.burnTitle}
        footer={mayDesign ? t.events.burnHint : `🔒 ${t.design.lockedHint}`}
      >
        <fieldset disabled={!mayDesign} className="flex flex-col gap-3.5 p-3 disabled:opacity-60">
          <div className="flex flex-wrap gap-2">
            {BURN_STYLES.map((b) => (
              <Pill
                key={b}
                on={(look.design.burnStyle ?? 'flame') === b}
                onClick={() => setLook({ ...look, design: { ...look.design, burnStyle: b } })}
                label={BURN_LABEL[b]}
              />
            ))}
          </div>
          {(look.design.burnStyle ?? 'flame') !== 'off' && (
            <>
              <div>
                <div className="mb-2 text-[13px] text-hint">{t.events.burnColor}</div>
                <BurnColorPicker
                  value={look.design.burnColor ?? BURN_COLORS[0]!}
                  onChange={(burnColor) =>
                    setLook({ ...look, design: { ...look.design, burnColor } })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px]">
                  {t.events.burnWhen}: {look.design.burnDays ?? 3} {t.events.burnDaysUnit}
                </span>
                <Stepper
                  value={look.design.burnDays ?? 3}
                  onChange={(burnDays) =>
                    setLook({
                      ...look,
                      design: { ...look.design, burnDays: Math.min(14, Math.max(1, burnDays)) },
                    })
                  }
                />
              </div>
              <div className="flex min-h-[60px] items-center justify-center rounded-2xl bg-hairline/50 p-3">
                <div
                  className={`burn burn-${look.design.burnStyle ?? 'flame'} ${previewPaint.className} h-11 w-40 rounded-2xl`}
                  style={previewPaint.style}
                >
                  {/* The card's face sits over the glow, as on a real event card. */}
                  <div className="h-full w-full rounded-2xl bg-[var(--color-section)]" />
                  <BurnFx style={look.design.burnStyle ?? 'flame'} />
                </div>
              </div>
            </>
          )}
        </fieldset>
      </Section>

      {!designOnly && (
        <>
          <section>
            <h2 className="px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
              {t.events.sections}
            </h2>
            <p className="mb-2.5 px-3 text-[13px] text-hint">{t.events.sectionsHint}</p>
            <div className="grid grid-cols-2 gap-2.5">
              <FeatureTile
                on={features.rsvp}
                onClick={() => toggle('rsvp')}
                icon={<IconCheck size={20} />}
                title={t.events.features.rsvp}
                hint={t.events.featureHints.rsvp}
              />
              <FeatureTile
                on={features.duties}
                onClick={() => toggle('duties')}
                icon={<IconUsers size={20} />}
                title={t.events.features.duties}
                hint={t.events.featureHints.duties}
              />
              <FeatureTile
                on={features.gallery}
                onClick={() => toggle('gallery')}
                icon={<IconImage size={20} />}
                title={t.events.features.gallery}
                hint={t.events.featureHints.gallery}
              />
              <FeatureTile
                on={features.cost}
                onClick={() => toggle('cost')}
                icon={<IconCoins size={20} />}
                title={t.events.features.cost}
                hint={t.events.featureHints.cost}
              />
            </div>
          </section>

          {features.cost && (
            <Section title={t.events.features.cost}>
              <label className="flex items-center gap-2 px-4 py-3">
                <span className="flex-1 text-[17px]">{t.events.price}</span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-24 bg-transparent text-right text-[20px] font-semibold tabular-nums outline-none"
                />
                <span className="text-[17px] text-hint">{money.symbol}</span>
              </label>
            </Section>
          )}

          {features.duties && (
            <Section title={t.events.roles}>
              {roles.map((r) => (
                <div key={r.key} className="flex flex-col border-b border-hairline px-4 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={r.name}
                      placeholder={t.events.roleName}
                      maxLength={40}
                      onChange={(e) => editRole(r.key, { name: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent py-2 text-[17px] outline-none placeholder:text-hint"
                    />
                    <Stepper value={r.slots} onChange={(slots) => editRole(r.key, { slots })} />
                    <button
                      type="button"
                      aria-label="remove"
                      onClick={() => setRoleDrafts((x) => x.filter((y) => y.key !== r.key))}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-hint active:bg-hairline"
                    >
                      <IconX size={18} />
                    </button>
                  </div>
                  <textarea
                    value={r.description}
                    placeholder={t.events.roleDescription}
                    maxLength={600}
                    rows={2}
                    onChange={(e) => editRole(r.key, { description: e.target.value })}
                    className="mb-1 w-full resize-y rounded-xl bg-hairline px-3 py-2 text-[14px] leading-snug outline-none placeholder:text-hint"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRolePicker(true)}
                className="flex min-h-[52px] w-full items-center gap-2 px-4 text-[17px] text-accent active:bg-hairline"
              >
                <IconPlus size={20} /> {t.events.addRole}
              </button>
            </Section>
          )}

          <Section title={t.events.chat} footer={chatOk ? undefined : t.events.chatInvalid}>
            <label className="flex items-center gap-3 px-4 py-3">
              <IconTelegram size={20} className="shrink-0 text-accent" />
              <input
                value={chatUrl}
                onChange={(e) => setChatUrl(e.target.value)}
                placeholder={t.events.chatPlaceholder}
                inputMode="url"
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-hint"
              />
            </label>
          </Section>
        </>
      )}

      {!event && (
        <Section footer={t.events.notifyHint}>
          <Toggle label={t.events.notify} checked={notify} onChange={setNotify} />
        </Section>
      )}

      <Button onClick={() => void submit()} disabled={!valid || saving}>
        <IconCalendar size={18} />
        {saving ? t.events.creating : event ? t.events.save : t.events.create}
      </Button>

      <Sheet open={rolePicker} onClose={() => setRolePicker(false)} title={t.events.addRole}>
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {t.events.roleSuggestions
            .filter((s) => !roles.some((r) => r.name === s))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  addRole(s);
                  setRolePicker(false);
                }}
                className="glass min-h-[42px] rounded-full px-4 text-[15px] font-semibold active:scale-95"
              >
                {s}
              </button>
            ))}
        </div>
        <div className="px-5 pb-2">
          <Button
            variant="secondary"
            onClick={() => {
              addRole('');
              setRolePicker(false);
            }}
          >
            <IconPlus size={18} /> {t.events.roleName}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

function FeatureTile({
  on,
  onClick,
  icon,
  title,
  hint,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative flex min-h-[112px] flex-col items-start gap-2 rounded-[var(--radius-card)] p-3.5 text-left transition active:scale-[0.98] ${
        on ? 'brand-gradient text-white shadow-cta' : 'glass shadow-card'
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${on ? 'bg-white/20' : 'bg-brand/12 text-accent'}`}
      >
        {icon}
      </span>
      <span className="text-[15px] font-semibold leading-tight">{title}</span>
      <span className={`text-[12px] leading-snug ${on ? 'text-white/80' : 'text-hint'}`}>
        {hint}
      </span>
      <span
        className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full ${
          on ? 'bg-white text-[var(--brand)]' : 'border-2 border-hint/40'
        }`}
      >
        {on && <IconCheck size={15} />}
      </span>
    </button>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-hairline p-0.5">
      <button
        type="button"
        aria-label="-"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-35"
      >
        <IconMinus size={15} />
      </button>
      <span className="w-5 text-center text-[15px] font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="+"
        disabled={value >= 50}
        onClick={() => onChange(value + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-full"
      >
        <IconPlus size={15} />
      </button>
    </div>
  );
}
