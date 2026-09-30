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
