import { z } from 'zod';

/**
 * Made-up people for trying birthdays and statistics (developer only): pasted as text, one
 * person per line — a name, a birthday and, if wanted, a position:
 *   Anna Petrova — 14.05.2001 — Лидер
 *   Ivan Ivanov, 03.11
 *   Maria; 1999-12-24
 * Dates as DD.MM.YYYY, DD.MM, DD/MM/YYYY or YYYY-MM-DD; the year may be left out.
 */
export const mockPersonSchema = z.object({
  firstName: z.string().trim().min(1).max(64),
  lastName: z.string().trim().max(64).nullable(),
  /** "MM-DD". */
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .nullable(),
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  /** A position of the ministry with this name (if there is one). */
  role: z.string().trim().max(64).nullable(),
});
export type MockPerson = z.output<typeof mockPersonSchema>;

export const mockPeopleSchema = z.object({
  groupId: z.number().int().positive(),
  people: z.array(mockPersonSchema).min(1).max(300),
});
export type MockPeopleInput = z.input<typeof mockPeopleSchema>;

export interface MockPeopleInfo {
  count: number;
  mockOnly: boolean;
  groups: { id: number; name: string }[];
}

const two = (n: number) => String(n).padStart(2, '0');

/** Reads one date: "MM-DD" and the year (or null), or null when it isn't a real date. */
export function readDate(text: string): { birthday: string; birthYear: number | null } | null {
  let d: number;
  let m: number;
  let y: number | null = null;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (hit) {
    y = Number(hit[1]);
    m = Number(hit[2]);
    d = Number(hit[3]);
  } else {
    hit = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(text);
    if (!hit) return null;
    d = Number(hit[1]);
    m = Number(hit[2]);
    if (hit[3])
      y =
        hit[3].length === 2
          ? 2000 + Number(hit[3]) - (Number(hit[3]) > 30 ? 100 : 0)
          : Number(hit[3]);
  }
  if (m < 1 || m > 12 || d < 1) return null;
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  if (d > max) return null;
  if (y !== null && (y < 1900 || y > 2100)) return null;
  return { birthday: `${two(m)}-${two(d)}`, birthYear: y };
}

/** The pasted lines as people; lines that can't be read come back in `bad` (1-based numbers). */
export function parseMockPeople(text: string): { people: MockPerson[]; bad: number[] } {
  const people: MockPerson[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const date = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/.exec(line);
    const cut = (s: string) => s.replace(/^[\s,;—–\-|\t]+|[\s,;—–\-|\t]+$/g, '');
    const name = cut(date ? line.slice(0, date.index) : line);
    const role = date ? cut(line.slice(date.index + date[0].length)) : '';
    const when = date ? readDate(date[1]!) : null;
    if (!name || (date && !when)) {
      bad.push(i + 1);
      return;
    }
    const [first, ...rest] = name.split(/\s+/);
    people.push({
      firstName: first!.slice(0, 64),
      lastName: rest.length ? rest.join(' ').slice(0, 64) : null,
      birthday: when?.birthday ?? null,
      birthYear: when?.birthYear ?? null,
      role: role ? role.slice(0, 64) : null,
    });
  });
  return { people, bad };
}
