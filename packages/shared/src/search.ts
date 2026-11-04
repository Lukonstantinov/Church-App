/**
 * Name search that doesn't care about the alphabet: «Anna» finds «Анна», «Zhenya» finds
 * «Женя». Both the name and what was typed are boiled down to the same rough Latin
 * sound-alike spelling, so any common way of writing a Russian name in English matches.
 */

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'i',
  є: 'e',
  ґ: 'g',
};

/** Ways of writing the same sound in English, folded to one spelling (longest first). */
const SOUNDS: [RegExp, string][] = [
  [/shch|sch/g, 's'],
  [/sh/g, 's'],
  [/zh/g, 'z'],
  [/ch/g, 'c'],
  [/ts/g, 'c'],
  [/kh/g, 'h'],
  [/ph/g, 'f'],
  [/[yj]u/g, 'u'],
  [/[yj]a/g, 'a'],
  [/[yj]o/g, 'o'],
  [/[yj]e/g, 'e'],
  [/[yj]/g, 'i'],
  [/w/g, 'v'],
  [/q/g, 'k'],
  [/x/g, 'ks'],
  [/c(?![h])/g, 'c'],
  [/(.)\1+/g, '$1'],
];

/** A name or search text as its rough sound-alike spelling, for comparing across alphabets. */
export function nameKey(text: string): string {
  let s = text.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = [...s].map((ch) => CYRILLIC[ch] ?? ch).join('');
  s = s.replace(/[^a-z0-9 ]+/g, '');
  for (const [from, to] of SOUNDS) s = s.replace(from, to);
  return s;
}

/** Whether `name` contains what was typed — as written, or as it sounds in another alphabet. */
export function nameMatches(name: string, typed: string): boolean {
  const q = typed.trim().toLocaleLowerCase();
  if (!q) return true;
  if (name.toLocaleLowerCase().includes(q)) return true;
  const key = nameKey(q);
  return key !== '' && nameKey(name).includes(key);
}
