/** Full display name: "Имя Фамилия" or just "Имя". */
export function displayName(u: { firstName: string; lastName?: string | null }): string {
  return u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName;
}

/** Russian plural form picker: plural(5, ['встреча', 'встречи', 'встреч']) → 'встреч'. */
const pluralRules = new Intl.PluralRules('ru-RU');
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  switch (pluralRules.select(n)) {
    case 'one':
      return forms[0];
    case 'few':
      return forms[1];
    default:
      return forms[2];
  }
}

export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

/** Picks the grammatical form for `n` using the locale's plural rules (ru/lt need 3 forms). */
export function pluralize(intlLocale: string, n: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(intlLocale).select(n) as keyof PluralForms;
  return forms[category] ?? forms.other;
}
