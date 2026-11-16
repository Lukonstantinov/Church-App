import { displayName, type MemberRow, type Messages } from '@church/shared';

/**
 * «Таблица людей»: the ministry's people as a spreadsheet with the columns the person
 * ticked. The table itself is built here as plain rows (so it can be checked without
 * Excel); `peopleXlsx` turns it into the file. Whatever isn't known about someone is
 * written as «нет данных», so an empty cell never looks like a mistake.
 */

export const PEOPLE_FIELDS = [
  'firstName',
  'lastName',
  'position',
  'labels',
  'birthday',
  'age',
  'username',
  'telegram',
  'role',
  'status',
  'joined',
  'attendance',
  'lastSeen',
  'consent',
] as const;
export type PeopleField = (typeof PEOPLE_FIELDS)[number];

/** What a new table starts with (the rest can be ticked). */
export const DEFAULT_PEOPLE_FIELDS: PeopleField[] = [
  'firstName',
  'lastName',
  'position',
  'labels',
  'birthday',
  'username',
];

/** Column widths in the sheet, in characters. */
const WIDTHS: Record<PeopleField, number> = {
  firstName: 18,
  lastName: 20,
  position: 20,
  labels: 26,
  birthday: 14,
  age: 9,
  username: 20,
  telegram: 14,
  role: 14,
  status: 16,
  joined: 14,
  attendance: 15,
  lastSeen: 16,
  consent: 18,
};

const pad = (n: number) => String(n).padStart(2, '0');
/** A stored moment as a date, day first. */
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

/** Full years on `today` for someone born on "MM-DD" of `year`. */
export function ageOn(birthday: string, year: number, today: Date): number {
  const [m = 1, d = 1] = birthday.split('-').map(Number);
  const had = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
  return today.getFullYear() - year - (had ? 0 : 1);
}

export interface PeopleTable {
  head: string[];
  widths: number[];
  rows: (string | number)[][];
}

/**
 * The table: one row a person, in the order given, with the chosen columns in the
 * sheet's own order (not the order they were ticked in).
 */
export function peopleTable(
  people: readonly MemberRow[],
  chosen: readonly PeopleField[],
  t: Messages,
  today = new Date(),
): PeopleTable {
  const tp = t.peopleSheet;
  const none = tp.noInfo;
  const fields = PEOPLE_FIELDS.filter((f) => chosen.includes(f));
  const cell = (m: MemberRow, f: PeopleField): string | number => {
    switch (f) {
      case 'firstName':
        return m.firstName || none;
      case 'lastName':
        return m.lastName || none;
      case 'position':
        return m.positionName || none;
      case 'labels':
        return m.labels.map((l) => l.name).join(', ') || none;
      case 'birthday': {
        if (!m.birthday) return none;
        const [mm, dd] = m.birthday.split('-');
        return `${dd}.${mm}${m.birthYear ? `.${m.birthYear}` : ''}`;
      }
      case 'age':
        return m.birthday && m.birthYear ? ageOn(m.birthday, m.birthYear, today) : none;
      case 'username':
        return m.username ? `@${m.username}` : none;
      case 'telegram':
        return m.offline ? tp.no : tp.yes;
      case 'role':
        return m.isAdmin ? t.roles.admin : t.roles[m.role];
      case 'status':
        return tp.statuses[m.status];
      case 'joined':
        return (m.joinedAt && day(m.joinedAt)) || none;
      case 'attendance':
        return m.recentPercent === null ? none : `${m.recentPercent}%`;
      case 'lastSeen':
        return (m.lastSeenAt && day(m.lastSeenAt)) || none;
      case 'consent':
        return m.guardianConsent ? tp.yes : tp.no;
    }
  };
  return {
    head: fields.map((f) => tp.fields[f]),
    widths: fields.map((f) => WIDTHS[f]),
    rows: people.map((m) => fields.map((f) => cell(m, f))),
  };
}

/** The people in the order of the People screen: by position (top first), then by name. */
export function sortPeople(
  people: readonly MemberRow[],
  rank: (m: MemberRow) => number,
  byName: boolean,
): MemberRow[] {
  return [...people].sort(
    (a, b) => (byName ? 0 : rank(a) - rank(b)) || displayName(a).localeCompare(displayName(b)),
  );
}

/** The table as an Excel file: a coloured, frozen heading row and a filter on every column. */
export async function peopleXlsx(
  table: PeopleTable,
  sheetName: string,
  brandHex: string,
  noInfo: string,
): Promise<Blob> {
  const { excel, argb } = await import('./reports');
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'People', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = table.head.map((header, i) => ({ header, width: table.widths[i] }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(brandHex) } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  for (const r of table.rows) {
    const row = ws.addRow(r);
    // What isn't known is written, but quietly.
    r.forEach((v, i) => {
      if (v === noInfo) row.getCell(i + 1).font = { italic: true, color: { argb: 'FF999999' } };
    });
  }
  if (table.head.length)
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.head.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
