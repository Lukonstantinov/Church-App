import { z } from 'zod';
import { backdropSchema, isBrandValue, isTextColor, patternSchema, type BrandColor } from './brand';

/**
 * Fonts for post headlines and text. All of them cover Cyrillic and the Lithuanian
 * letters; the files are served with the app and load only when a post uses them.
 */
export const FONTS = {
  // Sans
  montserrat: { family: 'Montserrat', group: 'sans' },
  rubik: { family: 'Rubik', group: 'sans' },
  nunito: { family: 'Nunito', group: 'sans' },
  'exo-2': { family: 'Exo 2', group: 'sans' },
  unbounded: { family: 'Unbounded', group: 'sans' },
  comfortaa: { family: 'Comfortaa', group: 'sans' },
  jost: { family: 'Jost', group: 'sans' },
  'golos-text': { family: 'Golos Text', group: 'sans' },
  onest: { family: 'Onest', group: 'sans' },
  manrope: { family: 'Manrope', group: 'sans' },
  raleway: { family: 'Raleway', group: 'sans' },
  oswald: { family: 'Oswald', group: 'sans' },
  'pt-sans': { family: 'PT Sans', group: 'sans' },
  // Serif
  'playfair-display': { family: 'Playfair Display', group: 'serif' },
  lora: { family: 'Lora', group: 'serif' },
  merriweather: { family: 'Merriweather', group: 'serif' },
  'pt-serif': { family: 'PT Serif', group: 'serif' },
  'cormorant-garamond': { family: 'Cormorant Garamond', group: 'serif' },
  'old-standard-tt': { family: 'Old Standard TT', group: 'serif' },
  spectral: { family: 'Spectral', group: 'serif' },
  'roboto-slab': { family: 'Roboto Slab', group: 'serif' },
  'yeseva-one': { family: 'Yeseva One', group: 'serif' },
  alice: { family: 'Alice', group: 'serif' },
  philosopher: { family: 'Philosopher', group: 'serif' },
  // Handwritten
  caveat: { family: 'Caveat', group: 'hand' },
  'marck-script': { family: 'Marck Script', group: 'hand' },
  pacifico: { family: 'Pacifico', group: 'hand' },
  lobster: { family: 'Lobster', group: 'hand' },
  'bad-script': { family: 'Bad Script', group: 'hand' },
  'great-vibes': { family: 'Great Vibes', group: 'hand' },
  'amatic-sc': { family: 'Amatic SC', group: 'hand' },
  pangolin: { family: 'Pangolin', group: 'hand' },
  kurale: { family: 'Kurale', group: 'hand' },
  // Display
  'russo-one': { family: 'Russo One', group: 'display' },
  'rubik-mono-one': { family: 'Rubik Mono One', group: 'display' },
  'ruslan-display': { family: 'Ruslan Display', group: 'display' },
  'seymour-one': { family: 'Seymour One', group: 'display' },
  tektur: { family: 'Tektur', group: 'display' },
  underdog: { family: 'Underdog', group: 'display' },
  'kelly-slab': { family: 'Kelly Slab', group: 'display' },
  'press-start-2p': { family: 'Press Start 2P', group: 'display' },
} as const satisfies Record<string, { family: string; group: FontGroup }>;
export type FontKey = keyof typeof FONTS;
export type FontGroup = 'sans' | 'serif' | 'hand' | 'display';
export const FONT_GROUPS: FontGroup[] = ['sans', 'serif', 'hand', 'display'];
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];
export const isFontKey = (v: unknown): v is FontKey => typeof v === 'string' && v in FONTS;

/** CSS font-family for a font key (the app's own font when none is chosen). */
export function fontFamily(key: string | null | undefined): string | undefined {
  return key && isFontKey(key) ? `'${FONTS[key].family}', var(--font-sans, system-ui)` : undefined;
}

/** Post types: a label with an emoji and a colour so members tell them apart at a glance. */
export const POST_KINDS = {
  announcement: { emoji: '📢', color: 'ocean' },
  important: { emoji: '❗', color: 'fire' },
  prayer: { emoji: '🙏', color: 'lavender' },
  event: { emoji: '📅', color: 'sunset' },
  news: { emoji: '📰', color: 'sky' },
  testimony: { emoji: '✨', color: 'gold' },
  help: { emoji: '🤝', color: 'forest' },
  celebration: { emoji: '🎉', color: 'berry' },
} as const satisfies Record<string, { emoji: string; color: BrandColor }>;
export type PostKind = keyof typeof POST_KINDS;
export const POST_KIND_KEYS = Object.keys(POST_KINDS) as PostKind[];

export const TITLE_SIZES = ['s', 'm', 'l', 'xl'] as const;
export const TITLE_POSITIONS = ['top', 'center', 'bottom'] as const;
export const TEXT_ALIGNS = ['left', 'center'] as const;

const brandValue = z.string().refine(isBrandValue, 'theme');
const fontKey = z.string().refine(isFontKey, 'font');

/**
 * How a post looks. By default it uses its ministry's look (colours, pattern, photo
 * split) under a cover banner; it can change the colour, drop the ministry photo, or
 * have a look of its own.
 */
export const postDesignSchema = z.object({
  /** Show the cover banner (default yes). */
  banner: z.boolean().default(true),
  kind: z.enum(POST_KIND_KEYS as [PostKind, ...PostKind[]]).nullish(),
  /** Colour instead of the ministry's. */
  brandColor: brandValue.nullish(),
  /** Leave out the ministry's photo (the split) on this post. */
  noBackdrop: z.boolean().optional(),
  /** A look of its own instead of the ministry's. */
  custom: z
    .object({
      pattern: patternSchema.nullable(),
      backdrop: backdropSchema.nullable(),
      textColor: z.string().refine(isTextColor, 'text colour'),
    })
    .nullish(),
  titleFont: fontKey.nullish(),
  bodyFont: fontKey.nullish(),
  titleSize: z.enum(TITLE_SIZES).optional(),
  titlePos: z.enum(TITLE_POSITIONS).optional(),
  align: z.enum(TEXT_ALIGNS).optional(),
  /** Events: size and colour of the countdown badge (colour null = flame gradient). */
  countdownSize: z.enum(['s', 'm', 'l']).optional(),
  countdownColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullish(),
  /** Events: how the outline burns when the event is near (flame by default), its colour and from how many days. */
  burnStyle: z
    .enum(['off', 'flame', 'glow', 'pulse', 'orbit', 'neon', 'sparks', 'electric', 'shimmer'])
    .optional(),
  /** A colour (#rrggbb), "rainbow", or a gradient of two colours ("grad:#rrggbb,#rrggbb"). */
  burnColor: z
    .string()
    .regex(/^(#[0-9a-f]{6}|rainbow|grad:#[0-9a-f]{6},#[0-9a-f]{6})$/i)
    .nullish(),
  burnDays: z.number().int().min(1).max(14).optional(),
  /** Poster layout: the usual one, or a collage of the speakers' photos. */
  posterLayout: z.enum(['classic', 'collage']).optional(),
});
export type PostDesign = z.infer<typeof postDesignSchema>;
export type PostDesignInput = z.input<typeof postDesignSchema>;

/** Parses a stored design defensively; null when absent or invalid. */
export function readPostDesign(raw: unknown): PostDesign | null {
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = postDesignSchema.safeParse(v);
  return r.success ? r.data : null;
}

// ---------- Speakers ----------

/** Most speakers one poster shows. */
export const MAX_SPEAKERS = 4;

/** A speaker on a poster: name, what they speak about or do, and an optional photo. */
export const speakerInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  /** An uploaded photo of the ministry. */
  mediaId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? null),
});
export const speakersSchema = z.array(speakerInputSchema).max(MAX_SPEAKERS);
export type SpeakerInput = z.input<typeof speakerInputSchema>;

/** A speaker as shown: `photoUrl` is the signed link of the photo (null = none). */
export interface Speaker {
  name: string;
  role: string | null;
  mediaId: number | null;
  photoUrl: string | null;
}

/** Parses stored speakers defensively (empty when absent or invalid). */
export function readSpeakers(raw: unknown): Omit<Speaker, 'photoUrl'>[] {
  if (!raw) return [];
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const r = speakersSchema.safeParse(v);
  return r.success ? r.data : [];
}

// ---------- Content blocks ----------

const blockId = z.string().regex(/^[a-z0-9]{4,16}$/);
const cell = z.string().max(300);

export const postBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: blockId, type: z.literal('text'), text: z.string().max(4000) }),
  z.object({
    id: blockId,
    type: z.literal('image'),
    mediaId: z.number().int().positive(),
    caption: z.string().max(300).nullish(),
  }),
  z.object({
    id: blockId,
    type: z.literal('table'),
    header: z.boolean(),
    rows: z.array(z.array(cell).min(1).max(6)).min(1).max(30),
  }),
  z.object({
    id: blockId,
    type: z.literal('file'),
    fileId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    id: blockId,
    type: z.literal('poll'),
    question: z.string().trim().min(1).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
    multiple: z.boolean().default(false),
  }),
  z.object({
    id: blockId,
    type: z.literal('quiz'),
    question: z.string().trim().min(1).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(6),
    correct: z.number().int().min(0).max(5),
    explanation: z.string().max(300).nullish(),
  }),
]);
export type PostBlockInput = z.input<typeof postBlockSchema>;
export type PostBlock = z.infer<typeof postBlockSchema>;

export const postBlocksSchema = z
  .array(postBlockSchema)
  .max(30)
  .default([])
  .refine((b) => new Set(b.map((x) => x.id)).size === b.length, 'duplicate block id')
  .refine((b) => b.every((x) => x.type !== 'quiz' || x.correct < x.options.length), 'quiz');

export function readPostBlocks(raw: unknown): PostBlock[] {
  if (!raw) return [];
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const r = postBlocksSchema.safeParse(v);
  return r.success ? r.data : [];
}

/** Results of a poll or quiz for one viewer. */
export interface VoteResults {
  counts: number[];
  /** People who answered. */
  voters: number;
  mine: number[];
  /** Who chose each option (same order as the options) — only for leaders. */
  who?: { id: number; firstName: string; lastName: string | null }[][];
}

/** Blocks as the app receives them: media resolved to URLs, polls with results. */
export type PostBlockView =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; mediaId: number; url: string; caption: string | null }
  | { id: string; type: 'table'; header: boolean; rows: string[][] }
  | {
      id: string;
      type: 'file';
      fileId: number;
      name: string;
      url: string;
      bytes: number;
      mime: string;
    }
  | {
      id: string;
      type: 'poll';
      question: string;
      options: string[];
      multiple: boolean;
      results: VoteResults;
    }
  | {
      id: string;
      type: 'quiz';
      question: string;
      options: string[];
      /** Revealed once the viewer has answered (or to people who may edit the post). */
      correct: number | null;
      explanation: string | null;
      results: VoteResults;
    };

export const voteSchema = z.object({
  blockId: blockId,
  options: z.array(z.number().int().min(0).max(9)).min(1).max(10),
});

/** Files attached to posts: documents people open or download. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
};
export const fileExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
