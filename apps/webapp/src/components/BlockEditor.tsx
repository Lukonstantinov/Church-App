import { useRef, useState, type ReactNode } from 'react';
import {
  FILE_MAX_BYTES,
  FILE_TYPES,
  fileExtension,
  type PostBlockInput,
  type PostBlockView,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { preparePhoto } from '../lib/image';
import { useUploadFile, useUploadMedia } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconX } from './icons';
import { SmallButton } from './LookControls';
import { useToast } from './Toast';

/** A block while editing: the saved shape plus what the editor shows (previews). */
export type DraftBlock = PostBlockInput & { url?: string; bytes?: number };
export type BlockType = PostBlockInput['type'];
export const BLOCK_TYPES: BlockType[] = ['text', 'image', 'table', 'file', 'poll', 'quiz'];
export const BLOCK_ICONS: Record<BlockType, string> = {
  text: '📝',
  image: '🖼️',
  table: '📊',
  file: '📎',
  poll: '🗳️',
  quiz: '❓',
};

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

export function newBlock(type: BlockType): DraftBlock | null {
  const id = newId();
  switch (type) {
    case 'text':
      return { id, type, text: '' };
    case 'table':
      return {
        id,
        type,
        header: true,
        rows: [
          ['', ''],
          ['', ''],
        ],
      };
    case 'poll':
      return { id, type, question: '', options: ['', ''], multiple: false };
    case 'quiz':
      return { id, type, question: '', options: ['', ''], correct: 0, explanation: '' };
    default:
      return null; // pictures and files are added once uploaded
  }
}

/** Saved blocks back into editable drafts. */
export function toDraft(b: PostBlockView): DraftBlock {
  switch (b.type) {
    case 'image':
      return { id: b.id, type: 'image', mediaId: b.mediaId, caption: b.caption, url: b.url };
    case 'file':
      return { id: b.id, type: 'file', fileId: b.fileId, name: b.name, bytes: b.bytes };
    case 'poll':
      return {
        id: b.id,
        type: 'poll',
        question: b.question,
        options: b.options,
        multiple: b.multiple,
      };
    case 'quiz':
      return {
        id: b.id,
        type: 'quiz',
        question: b.question,
        options: b.options,
        correct: b.correct ?? 0,
        explanation: b.explanation,
      };
    default:
      return b;
  }
}

/** Drafts into what the API takes: previews dropped, empty bits trimmed. */
export function toInput(blocks: DraftBlock[]): PostBlockInput[] {
  return blocks.flatMap((b): PostBlockInput[] => {
    switch (b.type) {
      case 'text':
        return b.text.trim() ? [{ id: b.id, type: 'text', text: b.text.trim() }] : [];
      case 'image':
        return [
          { id: b.id, type: 'image', mediaId: b.mediaId, caption: b.caption?.trim() || null },
        ];
      case 'file':
        return [{ id: b.id, type: 'file', fileId: b.fileId, name: b.name }];
      case 'table': {
        const rows = b.rows.filter((r) => r.some((c) => c.trim()));
        return rows.length ? [{ ...b, rows }] : [];
      }
      case 'poll': {
        const options = b.options.map((o) => o.trim()).filter(Boolean);
        return b.question.trim() && options.length >= 2
          ? [{ ...b, question: b.question.trim(), options }]
          : [];
      }
      case 'quiz': {
        const options = b.options.map((o) => o.trim());
        if (!b.question.trim() || options.filter(Boolean).length < 2 || !options[b.correct])
          return [];
        // Keep the right answer pointing at the same option once blanks are dropped.
        const kept = options.filter(Boolean);
        return [
          {
            ...b,
            question: b.question.trim(),
            options: kept,
            correct: kept.indexOf(options[b.correct]!),
            explanation: b.explanation?.trim() || null,
          },
        ];
      }
    }
  });
}

const input =
  'w-full min-w-0 rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint';

/** Upload buttons that add a picture or a file block. */
export function useBlockUploads(groupId: number, add: (b: DraftBlock) => void) {
  const t = useT();
  const toast = useToast();
  const media = useUploadMedia(groupId, 'event');
  const files = useUploadFile(groupId);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const addImages = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of [...list].slice(0, 10)) {
        // Screenshots keep more detail so small text stays readable.
        const m = await media.mutateAsync(await preparePhoto(f, 2200));
        add({ id: newId(), type: 'image', mediaId: m.id, caption: '', url: m.url });
      }
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      setBusy(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  };
  const addFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!f) return;
    if (!FILE_TYPES[fileExtension(f.name)]) return toast(t.feed.fileType, 'error');
    if (f.size > FILE_MAX_BYTES) return toast(t.feed.fileTooBig, 'error');
    setBusy(true);
    try {
      const r = await files.mutateAsync(f);
      add({ id: newId(), type: 'file', fileId: r.id, name: r.name, bytes: r.bytes });
    } catch {
      toast(t.treasury.uploadFailed, 'error');
    } finally {
      setBusy(false);
    }
  };
  const inputs = (
    <>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void addImages(e.target.files)}
      />
      <input
        ref={fileInput}
        type="file"
        accept={Object.keys(FILE_TYPES)
          .map((x) => `.${x}`)
          .join(',')}
        className="hidden"
        onChange={(e) => void addFile(e.target.files)}
      />
    </>
  );
  return {
    busy,
    inputs,
    pickImages: () => imageInput.current?.click(),
    pickFile: () => fileInput.current?.click(),
  };
}

/** One block in the editor, with move and remove controls. */
export function BlockEditor({
  block,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  block: DraftBlock;
  onChange: (b: DraftBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-hairline/50 p-3 ring-1 ring-hairline">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {BLOCK_ICONS[block.type]} {t.feed.blockTypes[block.type]}
        </span>
        <IconButton label={t.feed.moveUp} disabled={first} onClick={() => onMove(-1)}>
          ↑
        </IconButton>
        <IconButton label={t.feed.moveDown} disabled={last} onClick={() => onMove(1)}>
          ↓
        </IconButton>
        <IconButton label={t.feed.removeBlock} onClick={onRemove}>
          <IconX size={16} />
        </IconButton>
      </div>
      <BlockFields block={block} onChange={onChange} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-hairline text-[15px] font-bold active:scale-90 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: DraftBlock;
  onChange: (b: DraftBlock) => void;
}) {
  const t = useT();
  switch (block.type) {
    case 'text':
      return (
        <textarea
          value={block.text}
          maxLength={4000}
          rows={4}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          className={`${input} resize-y`}
        />
      );
    case 'image':
      return (
        <>
          {block.url && (
            <img src={block.url} alt="" className="max-h-64 w-full rounded-xl object-contain" />
          )}
          <input
            value={block.caption ?? ''}
            maxLength={300}
            placeholder={t.feed.caption}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
            className={input}
          />
        </>
      );
    case 'file':
      return (
        <div className="flex items-center gap-3 rounded-xl bg-hairline px-3 py-2.5">
          <span className="text-[22px]">📎</span>
          <input
            value={block.name}
            maxLength={120}
            onChange={(e) => onChange({ ...block, name: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
          />
          {block.bytes !== undefined && (
            <span className="shrink-0 text-[13px] text-hint">
              {(block.bytes / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
        </div>
      );
    case 'table': {
      const cols = Math.max(...block.rows.map((r) => r.length));
      const setCell = (i: number, j: number, v: string) =>
        onChange({
          ...block,
          rows: block.rows.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? v : c)) : r)),
        });
      return (
        <>
          <div className="overflow-x-auto">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(96px, 1fr))` }}
            >
              {block.rows.map((r, i) =>
                r.map((c, j) => (
                  <input
                    key={`${i}-${j}`}
                    value={c}
                    maxLength={300}
                    onChange={(e) => setCell(i, j, e.target.value)}
                    className={`${input} px-2 py-2 text-[14px] ${block.header && i === 0 ? 'font-semibold' : ''}`}
                  />
                )),
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <SmallButton
              onClick={() =>
                block.rows.length < 30 &&
                onChange({ ...block, rows: [...block.rows, Array<string>(cols).fill('')] })
              }
            >
              {t.feed.addRow}
            </SmallButton>
            <SmallButton
              onClick={() =>
                cols < 6 && onChange({ ...block, rows: block.rows.map((r) => [...r, '']) })
              }
            >
              {t.feed.addColumn}
            </SmallButton>
            <SmallButton
              onClick={() =>
                block.rows.length > 1 && onChange({ ...block, rows: block.rows.slice(0, -1) })
              }
            >
              {t.feed.removeRow}
            </SmallButton>
            <SmallButton
              onClick={() =>
                cols > 1 && onChange({ ...block, rows: block.rows.map((r) => r.slice(0, -1)) })
              }
            >
              {t.feed.removeColumn}
            </SmallButton>
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={block.header}
              onChange={(e) => onChange({ ...block, header: e.target.checked })}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            {t.feed.tableHeader}
          </label>
        </>
      );
    }
    case 'poll':
    case 'quiz': {
      const quiz = block.type === 'quiz';
      const max = quiz ? 6 : 10;
      const setOption = (i: number, v: string) =>
        onChange({ ...block, options: block.options.map((o, k) => (k === i ? v : o)) });
      const removeOption = (i: number) => {
        if (block.options.length <= 2) return;
        const options = block.options.filter((_, k) => k !== i);
        if (block.type === 'quiz') {
          const correct =
            block.correct === i ? 0 : block.correct > i ? block.correct - 1 : block.correct;
          onChange({ ...block, options, correct });
        } else onChange({ ...block, options });
      };
      return (
        <>
          <input
            value={block.question}
            maxLength={200}
            placeholder={t.feed.question}
            onChange={(e) => onChange({ ...block, question: e.target.value })}
            className={`${input} font-semibold`}
          />
          {block.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              {block.type === 'quiz' && (
                <button
                  type="button"
                  aria-label="correct"
                  aria-pressed={block.correct === i}
                  onClick={() => onChange({ ...block, correct: i })}
                  className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                    block.correct === i ? 'border-[#22c55e] bg-[#22c55e]' : 'border-hint/50'
                  }`}
                />
              )}
              <input
                value={o}
                maxLength={100}
                placeholder={t.feed.option(i + 1)}
                onChange={(e) => setOption(i, e.target.value)}
                className={input}
              />
              {block.options.length > 2 && (
                <IconButton label={t.feed.removeBlock} onClick={() => removeOption(i)}>
                  <IconX size={14} />
                </IconButton>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {block.options.length < max && (
              <SmallButton onClick={() => onChange({ ...block, options: [...block.options, ''] })}>
                {t.feed.addOption}
              </SmallButton>
            )}
            {block.type === 'poll' && (
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={block.multiple ?? false}
                  onChange={(e) => onChange({ ...block, multiple: e.target.checked })}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                {t.feed.multiple}
              </label>
            )}
          </div>
          {block.type === 'quiz' && (
            <>
              <p className="text-[13px] text-hint">{t.feed.correctHint}</p>
              <input
                value={block.explanation ?? ''}
                maxLength={300}
                placeholder={t.feed.explanation}
                onChange={(e) => onChange({ ...block, explanation: e.target.value })}
                className={input}
              />
            </>
          )}
        </>
      );
    }
  }
}
