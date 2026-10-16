import { useRef, useState, type CSSProperties } from 'react';
import {
  MAX_EFFECTS,
  MOTION_BLENDS,
  type EffectTemplate,
  type MeetingMotion,
  type MotionLayer,
  type MotionTune,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { dropDraft, isSuspectDraft, readDraft, useDraft, useOpeningMark } from '../lib/drafts';
import { FullMotion, useNearScreen } from '../lib/perf';
import {
  useDeleteEffectTemplate,
  useEffectTemplates,
  useMe,
  useSaveEffectTemplate,
} from '../lib/queries';
import { confirmDialog, haptic } from '../lib/telegram';
import { builtIn } from './EffectSets';
import { Group, Pill } from './LookControls';
import { MotionPicker } from './MotionPicker';
import { Knob, MotionTuneControls } from './MotionTune';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, LivingLayers } from './ui';

type Box = NonNullable<MotionTune['box']>;
const WHOLE: Box = { x: 0, y: 0, w: 100, h: 100 };
const PRESETS: Record<'all' | 'top' | 'bottom' | 'left' | 'right' | 'centre', Box> = {
  all: WHOLE,
  top: { x: 0, y: 0, w: 100, h: 50 },
  bottom: { x: 0, y: 50, w: 100, h: 50 },
  left: { x: 0, y: 0, w: 50, h: 100 },
  right: { x: 50, y: 0, w: 50, h: 100 },
  centre: { x: 25, y: 25, w: 50, h: 50 },
};
const SHAPES = {
  '4:5': 'aspect-[4/5]',
  '1:1': 'aspect-square',
  '16:10': 'aspect-[16/10]',
  '9:16': 'aspect-[9/16]',
};
type Shape = keyof typeof SHAPES;
type Backdrop = 'dark' | 'brand' | 'light';
const BACKDROP: Record<Backdrop, CSSProperties> = {
  dark: { background: '#05060f' },
  brand: {},
  light: { background: '#f4f4f6' },
};

/** A small live preview of an own effect, drawn only near the screen. */
function OwnPreview({ layers }: { layers: MotionLayer[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref);
  return (
    <span ref={ref} className="pointer-events-none absolute inset-0">
      {near && <LivingLayers layers={layers} preview />}
    </span>
  );
}

/**
 * Design → Effect studio: the church's own effects. Each is a stack of up to 8 layers of
 * any built-in effects, every layer with all its settings plus a blend mode and a place in
 * the frame. Saved, it is one item in every effect picker («⭐ My effects»), used by
 * reference: changing it here changes it everywhere it is used.
 */
export function EffectStudio() {
  const t = useT();
  const te = t.effectStudio;
  const list = useEffectTemplates();
  const [editing, setEditing] = useState<EffectTemplate | 'new' | null>(null);
  return (
    <section>
      <div className="grid grid-cols-3 gap-2.5">
        {(list.data ?? []).map((fx) => (
          <button
            key={fx.id}
            type="button"
            onClick={() => setEditing(fx)}
            className="flex flex-col gap-1 text-left active:scale-95"
          >
            <span
              className="relative block aspect-[4/5] w-full overflow-hidden rounded-2xl shadow-card"
              style={BACKDROP.dark}
            >
              <OwnPreview layers={fx.effects} />
            </span>
            <span className="truncate px-1 text-[12px] font-semibold">{fx.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="glass flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-hint/30 text-hint active:scale-95"
        >
          <span className="text-[24px]">✨</span>
          <span className="px-1 text-center text-[12px] font-semibold">{te.new}</span>
        </button>
      </div>
      {editing && (
        <EffectEditor
          key={editing === 'new' ? 'new' : editing.id}
          fx={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

interface Doc {
  name: string;
  layers: MotionLayer[];
}

function EffectEditor({ fx, onClose }: { fx: EffectTemplate | null; onClose: () => void }) {
  const t = useT();
  const te = t.effectStudio;
  const toast = useToast();
  const me = useMe();
  const save = useSaveEffectTemplate();
  const remove = useDeleteEffectTemplate();
  const mine = !fx || fx.mine || !!me.data?.user.isAdmin;
  // Unfinished work kept on the phone (set aside if it was open when the app closed itself).
  const draftKey = `effect.${fx?.id ?? 'new'}`;
  const [doc, setDoc] = useState<Doc>(() => {
    const kept = isSuspectDraft(draftKey) ? null : readDraft<Doc>(draftKey);
    return kept?.data ?? { name: fx?.name ?? te.defaultName, layers: fx?.effects ?? [] };
  });
  useDraft(draftKey, doc);
  useOpeningMark(draftKey, true);
  const [selected, setSelected] = useState<number | null>(doc.layers.length ? 0 : null);
  const [adding, setAdding] = useState(false);
  const [shape, setShape] = useState<Shape>('4:5');
  const [backdrop, setBackdrop] = useState<Backdrop>('dark');
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'size'; x: number; y: number; box: Box } | null>(null);

  const setLayer = (i: number, tune: MotionTune | null) =>
    setDoc((d) => ({ ...d, layers: d.layers.map((l, j) => (j === i ? { ...l, tune } : l)) }));
  const patchTune = (i: number, p: Partial<MotionTune>) =>
    setLayer(i, { ...(doc.layers[i]?.tune ?? {}), ...p });
  const move = (i: number, by: number) =>
    setDoc((d) => {
      const next = [...d.layers];
      const j = i + by;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j]!, next[i]!];
      setSelected(j);
      return { ...d, layers: next };
    });

  // Finger on the preview: drag the chosen layer's frame, or its corner to resize it.
  const onDown = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (selected === null) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      mode,
      x: e.clientX,
      y: e.clientY,
      box: doc.layers[selected]?.tune?.box ?? WHOLE,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = frame.current;
    if (!d || !el || selected === null) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / r.width) * 100;
    const dy = ((e.clientY - d.y) / r.height) * 100;
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
    patchTune(
      selected,
      d.mode === 'move'
        ? { box: { ...d.box, x: clamp(d.box.x + dx, -50, 150), y: clamp(d.box.y + dy, -50, 150) } }
        : { box: { ...d.box, w: clamp(d.box.w + dx, 5, 200), h: clamp(d.box.h + dy, 5, 200) } },
    );
  };
  const onUp = () => (drag.current = null);

  async function submit(asCopy: boolean) {
    const effects = builtIn(doc.layers);
    if (!effects.length) return;
    try {
      await save.mutateAsync({
        id: asCopy ? undefined : fx?.id,
        name: doc.name.trim() || te.defaultName,
        effects: effects.map((l) => ({ kind: l.kind, tune: l.tune ?? null })),
      });
      dropDraft(draftKey);
      haptic.success();
      toast(te.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  const sel = selected !== null ? doc.layers[selected] : null;
  const selBox = sel?.tune?.box ?? WHOLE;
  return (
    <Sheet wide open onClose={onClose} title={fx ? `✨ ${fx.name}` : `✨ ${te.new}`}>
      <div className="flex flex-col gap-4 px-4 pb-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
        {/* The effect live, pinned while the settings scroll (side by side on a wide screen). */}
        <div className="sticky top-0 z-20 -mx-4 rounded-b-[22px] bg-[var(--color-section)] px-4 pb-3 pt-1 shadow-card lg:mx-0 lg:rounded-[22px] lg:pt-3">
          <div className="mb-2 flex flex-wrap justify-center gap-1.5">
            {(Object.keys(SHAPES) as Shape[]).map((s) => (
              <Pill key={s} on={shape === s} onClick={() => setShape(s)} label={s} />
            ))}
            {(['dark', 'brand', 'light'] as const).map((b) => (
              <Pill
                key={b}
                on={backdrop === b}
                onClick={() => setBackdrop(b)}
                label={te.backdrops[b]}
              />
            ))}
          </div>
          <div className="flex justify-center">
            <div
              ref={frame}
              className={`relative isolate overflow-hidden rounded-2xl ${SHAPES[shape]} ${shape === '16:10' ? 'w-full' : 'h-[300px] lg:h-[68vh]'} ${backdrop === 'brand' ? 'brand-gradient' : ''}`}
              style={{
                ...BACKDROP[backdrop],
                touchAction: 'none',
              }}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <FullMotion.Provider value>
                <LivingLayers layers={doc.layers} />
              </FullMotion.Provider>
              {sel && (
                <span
                  className="absolute rounded-md border-2 border-dashed border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                  style={{
                    left: `${selBox.x}%`,
                    top: `${selBox.y}%`,
                    width: `${selBox.w}%`,
                    height: `${selBox.h}%`,
                    cursor: 'move',
                  }}
                  onPointerDown={(e) => onDown(e, 'move')}
                >
                  <span
                    className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-white bg-[var(--brand)]"
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(e) => onDown(e, 'size')}
                  />
                </span>
              )}
            </div>
          </div>
          {sel && <p className="mt-1.5 text-center text-[11px] text-hint">{te.placeHint}</p>}
        </div>

        <div className="flex flex-col gap-4">
          {!mine && <p className="rounded-xl bg-hairline px-3 py-2 text-[13px]">{te.notMine}</p>}
          <input
            value={doc.name}
            onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))}
            maxLength={40}
            placeholder={te.name}
            className="rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
          />

          <Group title={te.layers}>
            {doc.layers.length === 0 && <p className="text-[13px] text-hint">{te.empty}</p>}
            <div className="flex flex-col gap-2">
              {doc.layers.map((l, i) => (
                <div
                  key={i}
                  className={`rounded-2xl ${selected === i ? 'bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] ring-1 ring-[var(--brand)]/40' : 'bg-hairline'}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold"
                      onClick={() => setSelected(selected === i ? null : i)}
                    >
                      {i + 1}. {t.meetings.motions[l.kind]}
                      {l.tune?.blend && l.tune.blend !== 'normal' && (
                        <span className="ml-1.5 text-[11px] font-normal text-hint">
                          · {t.posters.blends[l.tune.blend]}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={te.up}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="h-8 w-8 rounded-full bg-[var(--color-section)] disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={te.down}
                      disabled={i === doc.layers.length - 1}
                      onClick={() => move(i, 1)}
                      className="h-8 w-8 rounded-full bg-[var(--color-section)] disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={te.remove}
                      onClick={() => {
                        setDoc((d) => ({ ...d, layers: d.layers.filter((_, j) => j !== i) }));
                        setSelected(null);
                      }}
                      className="h-8 w-8 rounded-full bg-[var(--color-section)] text-hint"
                    >
                      ✕
                    </button>
                  </div>
                  {selected === i && (
                    <div className="flex flex-col gap-4 border-t border-hairline px-3 pb-3 pt-3">
                      <div>
                        <div className="mb-1.5 text-[14px] font-semibold">{te.blend}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {MOTION_BLENDS.map((b) => (
                            <Pill
                              key={b}
                              on={(l.tune?.blend ?? 'normal') === b}
                              onClick={() => patchTune(i, { blend: b === 'normal' ? null : b })}
                              label={t.posters.blends[b]}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="text-[14px] font-semibold">{te.place}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
                            <Pill
                              key={p}
                              on={
                                JSON.stringify(l.tune?.box ?? WHOLE) === JSON.stringify(PRESETS[p])
                              }
                              onClick={() => patchTune(i, { box: p === 'all' ? null : PRESETS[p] })}
                              label={te.presets[p]}
                            />
                          ))}
                        </div>
                        {(['x', 'y', 'w', 'h'] as const).map((k) => (
                          <Knob
                            key={k}
                            label={te[k]}
                            value={(l.tune?.box ?? WHOLE)[k]}
                            min={k === 'w' || k === 'h' ? 5 : -50}
                            max={k === 'w' || k === 'h' ? 200 : 150}
                            step={1}
                            show={(v) => `${v}%`}
                            onChange={(v) =>
                              patchTune(i, { box: { ...(l.tune?.box ?? WHOLE), [k]: v } })
                            }
                          />
                        ))}
                      </div>
                      <MotionTuneControls
                        kind={l.kind}
                        tune={l.tune ?? {}}
                        onChange={(tune) =>
                          // Resetting the settings keeps the layer's place and blend.
                          setLayer(i, {
                            ...(tune ?? {}),
                            box: l.tune?.box ?? null,
                            blend: l.tune?.blend ?? null,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {doc.layers.length < MAX_EFFECTS ? (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {te.addLayer}
              </Button>
            ) : (
              <p className="text-[12px] text-hint">{te.maxLayers}</p>
            )}
          </Group>

          <Button
            disabled={save.isPending || doc.layers.length === 0}
            onClick={() => void submit(!mine)}
          >
            {save.isPending ? t.common.saving : mine ? te.save : te.saveCopy}
          </Button>
          {fx && mine && (
            <Button variant="secondary" disabled={save.isPending} onClick={() => void submit(true)}>
              {te.saveCopy}
            </Button>
          )}
          {fx && mine && (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                if (!(await confirmDialog(te.deleteConfirm))) return;
                await remove.mutateAsync(fx.id).catch(() => toast(t.common.actionFailed, 'error'));
                dropDraft(draftKey);
                onClose();
              }}
            >
              🗑 {t.common.delete}
            </Button>
          )}
        </div>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title={te.pickLayer}>
        <div className="px-4 pb-4">
          <MotionPicker
            value={null}
            onChange={(k: MeetingMotion | null) => {
              if (!k || k === 'off' || k === 'custom') return;
              setDoc((d) => ({ ...d, layers: [...d.layers, { kind: k, tune: null }] }));
              setSelected(doc.layers.length);
              setAdding(false);
            }}
          />
        </div>
      </Sheet>
    </Sheet>
  );
}
