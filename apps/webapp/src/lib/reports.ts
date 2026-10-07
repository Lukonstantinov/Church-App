import type * as ExcelJSModule from 'exceljs';
import type { Worksheet } from 'exceljs';
import type * as PdfMakeModule from 'pdfmake/build/pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  displayName,
  isOutgoing,
  type AttendanceExport,
  type AttendanceStatus,
  type DuesSheet,
  type GroupStatistics,
  type MeetingKind,
  type Messages,
  type TransactionRow,
  type TreasuryExport,
} from '@church/shared';
import { categoryLabel, mergeDues } from '../components/money';
import type { Formatters } from './format';

/**
 * Report files are built here, on the phone: the Worker's CPU budget is far too small
 * for Excel or PDF. The heavy libraries are loaded only when a report is requested.
 */

export interface ReportCtx {
  t: Messages;
  f: Formatters;
  currency: string;
  brandHex: string;
}

type Cell = string | number | null;

const cents = (c: number) => Math.round(c) / 100;

function entryText(ctx: ReportCtx, tx: TransactionRow) {
  const { t, f } = ctx;
  const who = tx.member
    ? displayName(tx.member)
    : tx.kind === 'donation'
      ? t.treasury.anonymous
      : '';
  const category =
    tx.kind === 'income' || tx.kind === 'expense'
      ? categoryLabel(t, tx.category)
      : tx.kind === 'dues' && tx.period
        ? f.periodLong(tx.period)
        : '';
  return { kind: t.treasury.kinds[tx.kind], category, who, note: tx.note ?? '' };
}

/** Same wording as the statistics screen: "Dues", "Donations", "Other income". */
function incomeLabel(t: Messages, kind: string): string {
  if (kind === 'income') return t.treasury.otherIncome;
  if (kind === 'dues' || kind === 'donation') return t.treasury.filters[kind];
  return t.treasury.kinds[kind as keyof typeof t.treasury.kinds] ?? kind;
}

function totals(data: TreasuryExport) {
  let income = 0;
  let expense = 0;
  const byKind = new Map<string, number>();
  const byCategory = new Map<string | null, number>();
  const donors = new Map<string, number>();
  for (const tx of data.transactions) {
    if (isOutgoing(tx.kind)) {
      expense += tx.amountCents;
      const key = tx.kind === 'event_expense' ? 'events' : tx.category;
      byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amountCents);
    } else {
      income += tx.amountCents;
      byKind.set(tx.kind, (byKind.get(tx.kind) ?? 0) + tx.amountCents);
    }
    if (tx.kind === 'donation') {
      const name = tx.member ? displayName(tx.member) : '';
      donors.set(name, (donors.get(name) ?? 0) + tx.amountCents);
    }
  }
  const sorted = <K>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    income,
    expense,
    byKind: sorted(byKind),
    byCategory: sorted(byCategory),
    donors: sorted(donors),
  };
}

// ---------- Excel ----------

export async function excel() {
  const mod = await import('exceljs');
  return (mod.default ?? mod) as typeof ExcelJSModule;
}

export const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const FILL = {
  present: 'FFD9F2E1',
  late: 'FFFCEBC9',
  excused: 'FFDDE7F7',
  absent: 'FFF8D7D5',
  none: 'FFF1F1F4',
};

export async function treasuryXlsx(
  ctx: ReportCtx,
  data: TreasuryExport,
  dues: DuesSheet | null,
): Promise<Blob> {
  const { t, f } = ctx;
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const money = `#,##0.00 [$${ctx.currency === 'EUR' ? '€' : ctx.currency}]`;
  const header = (ws: Worksheet, row: number) => {
    const r = ws.getRow(row);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ctx.brandHex) } };
    r.alignment = { vertical: 'middle' };
    r.height = 22;
  };
  const sum = totals(data);

  // Summary
  const s = wb.addWorksheet(t.reports.summary);
  s.columns = [{ width: 36 }, { width: 16 }];
  s.addRow([`${t.reports.fileTreasury(data.groupName, data.label ?? data.year)}`]).font = {
    bold: true,
    size: 14,
  };
  s.addRow([t.reports.generated(f.dayMonth(new Date().toISOString()))]).font = {
    color: { argb: 'FF888888' },
  };
  s.addRow([]);
  const lines: [string, number][] = [
    [t.reports.opening, data.openingCents],
    [t.reports.totalIncome, sum.income],
    [t.reports.totalExpense, -sum.expense],
    [t.reports.closing, data.closingCents],
  ];
  for (const [label, value] of lines) {
    const r = s.addRow([label, cents(value)]);
    r.getCell(2).numFmt = money;
    if (label === t.reports.closing) r.font = { bold: true };
  }
  const block = (title: string, rows: [string, number][]) => {
    if (!rows.length) return;
    s.addRow([]);
    s.addRow([title]).font = { bold: true };
    for (const [label, value] of rows) s.addRow([label, cents(value)]).getCell(2).numFmt = money;
  };
  block(
    t.treasury.incomeByKind(data.label ?? data.year),
    sum.byKind.map(([k, v]) => [incomeLabel(t, k), v]),
  );
  block(
    t.treasury.byCategory(data.label ?? data.year),
    sum.byCategory.map(([k, v]) => [categoryLabel(t, k), v]),
  );
  block(
    t.treasury.donors(data.label ?? data.year),
    sum.donors.map(([k, v]) => [k || t.treasury.anonymous, v]),
  );

  // Entries
  const e = wb.addWorksheet(t.reports.entries, { views: [{ state: 'frozen', ySplit: 1 }] });
  e.columns = [
    { header: t.reports.colDate, width: 12 },
    { header: t.reports.colKind, width: 18 },
    { header: t.reports.colCategory, width: 18 },
    { header: t.reports.colWho, width: 22 },
    { header: t.reports.colNote, width: 32 },
    { header: t.reports.colIn, width: 13 },
    { header: t.reports.colOut, width: 13 },
  ];
  header(e, 1);
  for (const tx of data.transactions) {
    const x = entryText(ctx, tx);
    const out = isOutgoing(tx.kind);
    const [y, m, d] = tx.occurredOn.split('-').map(Number) as [number, number, number];
    const row = e.addRow([
      new Date(Date.UTC(y, m - 1, d)),
      x.kind,
      x.category,
      x.who,
      x.note,
      out ? null : cents(tx.amountCents),
      out ? cents(tx.amountCents) : null,
    ] as Cell[]);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
    row.getCell(6).numFmt = money;
    row.getCell(7).numFmt = money;
  }
  if (data.transactions.length) {
    const last = data.transactions.length + 1;
    const r = e.addRow([
      t.reports.colTotal,
      '',
      '',
      '',
      '',
      { formula: `SUM(F2:F${last})` },
      { formula: `SUM(G2:G${last})` },
    ]);
    r.font = { bold: true };
    r.getCell(6).numFmt = money;
    r.getCell(7).numFmt = money;
  }
  e.autoFilter = { from: 'A1', to: 'G1' };

  // Dues
  if (dues && dues.rows.length) {
    const d = wb.addWorksheet(`${t.reports.dues} ${dues.year}`, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });
    d.columns = [
      { header: t.reports.colName, width: 24 },
      ...dues.periods.map((p) => ({ header: f.monthShort(p), width: 8 })),
      { header: t.reports.colTotal, width: 12 },
    ];
    header(d, 1);
    for (const r of dues.rows) {
      const row = d.addRow([
        displayName(r.member),
        ...r.cells.map((c) => (c.paidCents ? cents(c.paidCents) : null)),
        cents(r.paidCents),
      ]);
      r.cells.forEach((c, i) => {
        const cell = row.getCell(i + 2);
        cell.numFmt = '0.##';
        cell.alignment = { horizontal: 'center' };
        const fill =
          c.state === 'paid'
            ? FILL.present
            : c.state === 'partial'
              ? FILL.late
              : c.state === 'unpaid'
                ? FILL.absent
                : c.state === 'none'
                  ? FILL.none
                  : null;
        if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      });
      row.getCell(dues.periods.length + 2).numFmt = money;
      row.getCell(dues.periods.length + 2).font = { bold: true };
    }
    const tot = d.addRow([
      t.reports.colTotal,
      ...dues.totals.map(cents),
      cents(dues.totals.reduce((a, b) => a + b, 0)),
    ]);
    tot.font = { bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** The cash book as filtered on screen: one sheet with the entries and a total line. */
export async function ledgerXlsx(
  ctx: ReportCtx,
  title: string,
  filterLine: string,
  rows: TransactionRow[],
): Promise<Blob> {
  const { t } = ctx;
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const money = `#,##0.00 [$${ctx.currency === 'EUR' ? '€' : ctx.currency}]`;
  const e = wb.addWorksheet(t.reports.entries, { views: [{ state: 'frozen', ySplit: 4 }] });
  e.columns = [
    { width: 12 },
    { width: 18 },
    { width: 18 },
    { width: 22 },
    { width: 24 },
    { width: 32 },
    { width: 13 },
    { width: 13 },
  ];
  e.addRow([title]).font = { bold: true, size: 14 };
  e.addRow([filterLine]).font = { color: { argb: 'FF888888' } };
  e.addRow([]);
  const head = e.addRow([
    t.reports.colDate,
    t.reports.colKind,
    t.reports.colCategory,
    t.reports.colWho,
    t.treasury.meeting,
    t.reports.colNote,
    t.reports.colIn,
    t.reports.colOut,
  ]);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ctx.brandHex) } };
  for (const tx of rows) {
    const x = entryText(ctx, tx);
    const out = isOutgoing(tx.kind);
    const [y, m, d] = tx.occurredOn.split('-').map(Number) as [number, number, number];
    const row = e.addRow([
      new Date(Date.UTC(y, m - 1, d)),
      x.kind,
      x.category,
      x.who,
      tx.meeting ? `${tx.meeting.title} · ${ctx.f.dayMonth(tx.meeting.startsAt)}` : '',
      x.note,
      out ? null : cents(tx.amountCents),
      out ? cents(tx.amountCents) : null,
    ] as Cell[]);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
    row.getCell(7).numFmt = money;
    row.getCell(8).numFmt = money;
    row.getCell(7).font = { color: { argb: 'FF15803D' } };
    row.getCell(8).font = { color: { argb: 'FFB91C1C' } };
  }
  if (rows.length) {
    const first = 5;
    const last = rows.length + 4;
    const r = e.addRow([
      t.reports.colTotal,
      '',
      '',
      '',
      '',
      '',
      { formula: `SUM(G${first}:G${last})` },
      { formula: `SUM(H${first}:H${last})` },
    ]);
    r.font = { bold: true };
    r.getCell(7).numFmt = money;
    r.getCell(8).numFmt = money;
  }
  e.autoFilter = { from: 'A4', to: 'H4' };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const STATUSES: AttendanceStatus[] = ['present', 'late', 'excused', 'absent'];

function attendanceStats(statuses: (AttendanceStatus | null)[]) {
  const c = { present: 0, late: 0, excused: 0, absent: 0 };
  for (const s of statuses) if (s) c[s]++;
  const counted = c.present + c.late + c.absent;
  return { ...c, percent: counted ? Math.round(((c.present + c.late) / counted) * 100) : null };
}

export async function attendanceXlsx(ctx: ReportCtx, data: AttendanceExport): Promise<Blob> {
  const { t, f } = ctx;
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.reports.attendance, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });
  ws.columns = [
    { header: t.reports.colName, width: 24 },
    ...data.meetings.map((m) => ({ header: f.ddmm(m.startsAt), width: 6.5 })),
    ...STATUSES.map((s) => ({ header: t.status[s], width: 12 })),
    { header: '%', width: 7 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ctx.brandHex) } };
  head.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 0 };
  head.height = 22;

  for (const r of data.rows) {
    const st = attendanceStats(r.statuses);
    const row = ws.addRow([
      displayName(r.member),
      ...r.statuses.map((s) => (s ? t.reports.letters[s] : '')),
      st.present,
      st.late,
      st.excused,
      st.absent,
      st.percent === null ? '' : st.percent / 100,
    ]);
    r.statuses.forEach((s, i) => {
      const cell = row.getCell(i + 2);
      cell.alignment = { horizontal: 'center' };
      if (s) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[s] } };
    });
    row.getCell(data.meetings.length + 6).numFmt = '0%';
  }
  const guests = ws.addRow([t.reports.guests, ...data.meetings.map((m) => m.guestCount || '')]);
  guests.font = { italic: true, color: { argb: 'FF888888' } };
  ws.addRow([]);
  ws.addRow([STATUSES.map((s) => `${t.reports.letters[s]} = ${t.status[s]}`).join('   ')]).font = {
    color: { argb: 'FF888888' },
  };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ---------- PDF ----------

export async function pdf() {
  const mod = await import('pdfmake/build/pdfmake');
  const fonts = await import('pdfmake/build/vfs_fonts');
  const pdfMake = (mod.default ?? mod) as typeof PdfMakeModule;
  pdfMake.addVirtualFileSystem((fonts.default ?? fonts) as never);
  return pdfMake;
}

function pdfDoc(
  ctx: ReportCtx,
  title: string,
  content: Content[],
  landscape = false,
): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [36, 48, 36, 42],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.15 },
    info: { title },
    footer: (page, count) => ({
      columns: [
        { text: title, color: '#999999', fontSize: 8 },
        { text: `${page} / ${count}`, alignment: 'right', color: '#999999', fontSize: 8 },
      ],
      margin: [36, 12, 36, 0],
    }),
    styles: {
      h1: { fontSize: 18, bold: true, color: ctx.brandHex },
      h2: { fontSize: 12, bold: true, margin: [0, 14, 0, 6] },
      muted: { color: '#888888', fontSize: 9 },
      th: { bold: true, color: '#ffffff', fillColor: ctx.brandHex },
    },
    content,
  };
}

const layout = {
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => '#e5e5ea',
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

async function toBlob(doc: TDocumentDefinitions): Promise<Blob> {
  const pdfMake = await pdf();
  return pdfMake.createPdf(doc).getBlob();
}

const GOOD = '#16a34a';
const BAD = '#dc2626';
/** Usable page width (A4 portrait minus margins), in points. */
const PAGE_W = 523;

/** A colour mixed with white (pdf colours take plain #rrggbb only). */
function tint(hex: string, k: number): string {
  const v = parseInt(hex.slice(1, 7), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * k);
  const out = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(mix);
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A brand-coloured band with the report's title and period. */
function banner(ctx: ReportCtx, title: string, sub: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              { text: title, fontSize: 17, bold: true, color: '#ffffff' },
              { text: sub, fontSize: 9, color: '#f3f4f6', margin: [0, 3, 0, 0] },
            ],
            fillColor: ctx.brandHex,
            margin: [12, 10, 12, 10],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 12],
  };
}

/** Coloured summary tiles side by side: a label and a big number each. */
function tiles(items: { label: string; value: string; color: string }[]): Content {
  return {
    columns: items.map((x) => ({
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                { text: x.label.toUpperCase(), fontSize: 7, bold: true, color: x.color },
                { text: x.value, fontSize: 13, bold: true, color: '#111827', margin: [0, 3, 0, 0] },
              ],
              fillColor: tint(x.color, 0.1),
              margin: [8, 7, 8, 7],
            },
          ],
        ],
      },
      layout: 'noBorders',
    })),
    columnGap: 8,
    margin: [0, 0, 0, 4],
  };
}

/** Money in and out per month of the period, from the entries. */
function monthFlows(data: TreasuryExport) {
  const map = new Map<string, { inC: number; outC: number }>();
  for (const tx of data.transactions) {
    const p = tx.occurredOn.slice(0, 7);
    const v = map.get(p) ?? { inC: 0, outC: 0 };
    if (isOutgoing(tx.kind)) v.outC += tx.amountCents;
    else v.inC += tx.amountCents;
    map.set(p, v);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
}

/** The infographic palette: each bar or point takes the next colour. */
const PALETTE = ['#f2994a', '#eb6b4b', '#3fb0ac', '#3d8fd1', '#7b5ea7', '#d6527c', '#34495e'];
const colorAt = (i: number) => PALETTE[i % PALETTE.length]!;

/** Text safe inside SVG. */
const xml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An SVG chart as a pdf element, full page width. */
const svgChart = (height: number, body: string): Content => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${height}" viewBox="0 0 ${PAGE_W} ${height}" font-family="Roboto">${body}</svg>`,
  width: PAGE_W,
  margin: [0, 4, 0, 8],
});

const text = (x: number, y: number, v: string, color: string, size = 8, bold = true) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${color}" font-size="${size}" font-weight="${bold ? 'bold' : 'normal'}" text-anchor="middle">${xml(v)}</text>`;

const short = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);

/** Light vertical bands and horizontal lines behind a chart, like graph paper. */
function gridSvg(n: number, top: number, bottom: number): string {
  const slot = PAGE_W / n;
  let out = '';
  for (let i = 0; i < n; i += 2)
    out += `<rect x="${slot * i + 2}" y="${top}" width="${slot - 4}" height="${bottom - top}" fill="#f4f6fa"/>`;
  for (let k = 0; k < 4; k++) {
    const y = top + ((bottom - top) * k) / 4;
    out += `<line x1="0" y1="${y}" x2="${PAGE_W}" y2="${y}" stroke="#e8ecf2" stroke-width="0.5"/>`;
  }
  return out;
}

/** The axis drawn over the bars' round bottoms, so bars stand on it. */
const axisSvg = (bottom: number, cover: number) =>
  `<rect x="0" y="${bottom + 0.6}" width="${PAGE_W}" height="${cover}" fill="#ffffff"/>` +
  `<line x1="0" y1="${bottom}" x2="${PAGE_W}" y2="${bottom}" stroke="#374151" stroke-width="1.2"/>`;

/**
 * Capsule bars in the palette colours: each with a white dot near its top, its amount
 * in a coloured pill above and its name underneath in the same colour.
 */
function capsuleBars(items: [string, number][], m: (c: number) => string): Content {
  const rows = items.slice(0, 7);
  const top = 34;
  const bottom = 170;
  // A few bars sit in the middle, not crowded to the left.
  const slot = Math.min(PAGE_W / rows.length, 120);
  const off = (PAGE_W - slot * rows.length) / 2;
  const barW = Math.min(34, slot * 0.45);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  let body = gridSvg(Math.max(rows.length, Math.round(PAGE_W / slot)), 6, bottom);
  rows.forEach(([, v], i) => {
    const c = colorAt(i);
    const cx = off + slot * i + slot / 2;
    const h = Math.max(barW, (v / max) * (bottom - top));
    const y = bottom - h;
    body += `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${h + barW / 2}" rx="${barW / 2}" fill="${c}"/>`;
    body += `<circle cx="${cx}" cy="${y + barW / 2}" r="${barW * 0.27}" fill="#ffffff"/>`;
    const label = m(v);
    const pill = Math.min(slot - 8, Math.max(40, label.length * 5.2 + 12));
    body += `<rect x="${cx - pill / 2}" y="${y - 24}" width="${pill}" height="17" rx="8.5" fill="${c}"/>`;
    body += text(cx, y - 12.5, label, '#ffffff', 8);
  });
  body += axisSvg(bottom, barW / 2 + 1);
  body += rows
    .map(([name], i) => text(off + slot * i + slot / 2, bottom + 14, short(name), colorAt(i), 8))
    .join('');
  return svgChart(bottom + 22, body);
}

/**
 * A line through the months with a coloured ring at each point, the amount above it in
 * the same colour and the month underneath — like an infographic.
 */
function ringLine(points: [string, number][], m: (c: number) => string): Content {
  const n = points.length;
  const top = 30;
  const bottom = 170;
  const slot = PAGE_W / n;
  const vals = points.map(([, v]) => v);
  const min = Math.min(0, ...vals);
  const max = Math.max(1, ...vals);
  const yOf = (v: number) => bottom - 16 - ((v - min) / (max - min || 1)) * (bottom - top - 26);
  let body = gridSvg(n, 6, bottom) + axisSvg(bottom, 0);
  const pts = points.map(([, v], i) => `${(slot * i + slot / 2).toFixed(1)},${yOf(v).toFixed(1)}`);
  body += `<polyline points="${pts.join(' ')}" fill="none" stroke="#2d3748" stroke-width="1.8" stroke-linejoin="round"/>`;
  points.forEach(([label, v], i) => {
    const c = colorAt(i);
    const cx = slot * i + slot / 2;
    const cy = yOf(v);
    body += `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${c}"/>`;
    body += `<circle cx="${cx}" cy="${cy}" r="3.8" fill="#ffffff"/>`;
    // Amounts alternate above and below the line so neighbours don't collide.
    const above = i % 2 === 0 || cy > bottom - 34;
    body += text(cx, above ? cy - 13 : cy + 21, m(v), c, n > 8 ? 7 : 8.5);
    body += text(cx, bottom + 14, label, c, 8.5);
  });
  return svgChart(bottom + 22, body);
}

/** Green and red capsule bars per month (in and out), month names underneath. */
function monthChart(
  months: [string, { inC: number; outC: number }][],
  label: (p: string) => string,
): Content {
  const H = 120;
  const max = Math.max(1, ...months.flatMap(([, v]) => [v.inC, v.outC]));
  const slot = PAGE_W / months.length;
  const bar = Math.min(16, slot * 0.3);
  let body = gridSvg(months.length, 4, H);
  months.forEach(([, v], i) => {
    const cx = slot * i + slot / 2;
    const pair: [number, number, string][] = [
      [v.inC, cx - bar - 1.5, GOOD],
      [v.outC, cx + 1.5, BAD],
    ];
    for (const [val, x, color] of pair) {
      if (val <= 0) continue;
      const h = Math.max(bar, (val / max) * (H - 10));
      body += `<rect x="${x}" y="${H - h}" width="${bar}" height="${h + bar / 2}" rx="${bar / 2}" fill="${color}"/>`;
      body += `<circle cx="${x + bar / 2}" cy="${H - h + bar / 2}" r="${bar * 0.26}" fill="#ffffff"/>`;
    }
  });
  // Cover the round bar bottoms below the axis, then redraw the axis and labels on top.
  const labels = months
    .map(([p], i) => text(slot * i + slot / 2, H + 13, label(p), colorAt(i), 8))
    .join('');
  body += axisSvg(H, bar / 2 + 1) + labels;
  return svgChart(H + 20, body);
}

/** A heading kept on the same page as its chart. */
const pdfSection = (title: string, body: Content): Content => ({
  stack: [{ text: title, style: 'h2' }, body],
  unbreakable: true,
});

/** Every month of the period (at most the last 12), with its money in and out (0 if none). */
function monthsOfPeriod(
  data: TreasuryExport,
  flows: [string, { inC: number; outC: number }][],
): [string, { inC: number; outC: number }][] {
  const map = new Map(flows);
  const out: [string, { inC: number; outC: number }][] = [];
  let [y, mo] = data.from.slice(0, 7).split('-').map(Number) as [number, number];
  const end = data.to.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) {
    const p = `${y}-${String(mo).padStart(2, '0')}`;
    if (p > end) break;
    out.push([p, map.get(p) ?? { inC: 0, outC: 0 }]);
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out.slice(-12);
}

/** Capsule bars for a few items, plain rows with bars for a long list. */
function pickBars(rows: [string, number][], m: (c: number) => string, color: string): Content {
  return rows.length <= 7 ? capsuleBars(rows, m) : barRows(rows, m, color);
}

/** Rows of name, a coloured bar to scale and the amount. */
function barRows(rows: [string, number][], m: (c: number) => string, color: string): Content {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const W = 200;
  return {
    table: {
      widths: ['*', W, 'auto'],
      body: rows.map(([name, v]) => [
        { text: name },
        {
          canvas: [
            { type: 'rect', x: 0, y: 3, w: W, h: 7, color: '#f1f5f9', r: 3 },
            { type: 'rect', x: 0, y: 3, w: Math.max(3, (v / max) * W), h: 7, color, r: 3 },
          ] as never,
        },
        { text: m(v), alignment: 'right' as const, bold: true },
      ]),
    },
    layout,
  };
}

/** Lines with every other row tinted, easier to follow across a long list. */
const zebra = {
  ...layout,
  fillColor: (i: number) => (i > 0 && i % 2 === 0 ? '#f8fafc' : null),
};

export async function treasuryPdf(
  ctx: ReportCtx,
  data: TreasuryExport,
  dues: DuesSheet | null,
): Promise<Blob> {
  const { t, f } = ctx;
  const m = (c: number, sign = false) => f.money(c, ctx.currency, { sign });
  const sum = totals(data);
  const title = t.reports.fileTreasury(data.groupName, data.label ?? data.year);

  const content: Content[] = [
    banner(
      ctx,
      title,
      `${f.dayMonth(`${data.from}T12:00:00Z`)} – ${f.dayMonth(`${data.to}T12:00:00Z`)} ${data.to.slice(0, 4)} · ${t.reports.generated(f.dayMonth(new Date().toISOString()))}`,
    ),
    tiles([
      { label: t.reports.opening, value: m(data.openingCents), color: '#64748b' },
      { label: t.reports.totalIncome, value: m(sum.income, true), color: GOOD },
      { label: t.reports.totalExpense, value: m(-sum.expense, true), color: BAD },
      { label: t.reports.closing, value: m(data.closingCents), color: ctx.brandHex },
    ]),
  ];
  const months = monthFlows(data);
  const all = monthsOfPeriod(data, months);
  if (all.length > 1) {
    // End-of-month balances, from the opening balance forward.
    let running = data.openingCents;
    const balances = all.map(([p, v]): [string, number] => {
      running += v.inC - v.outC;
      return [f.monthShort(p), running];
    });
    content.push(
      pdfSection(
        t.treasury.balanceChart,
        ringLine(balances, (c) => m(c)),
      ),
    );
  }
  if (months.length > 1) {
    content.push(
      pdfSection(
        t.treasury.flowTitle,
        monthChart(months, (p) => f.monthShort(p)),
      ),
    );
    content.push({
      columns: [
        { text: [{ text: '■ ', color: GOOD }, t.treasury.income], width: 'auto', fontSize: 8.5 },
        { text: [{ text: '■ ', color: BAD }, t.treasury.expense], width: 'auto', fontSize: 8.5 },
      ],
      columnGap: 14,
      margin: [0, 4, 0, 0],
    });
  }
  if (sum.byKind.length) {
    content.push(
      pdfSection(
        t.treasury.incomeByKind(data.label ?? data.year),
        pickBars(
          sum.byKind.map(([k, v]) => [incomeLabel(t, k), v]),
          m,
          GOOD,
        ),
      ),
    );
  }
  if (sum.byCategory.length) {
    content.push(
      pdfSection(
        t.treasury.byCategory(data.label ?? data.year),
        pickBars(
          sum.byCategory.map(([k, v]) => [categoryLabel(t, k), v]),
          m,
          BAD,
        ),
      ),
    );
  }
  if (sum.donors.length) {
    content.push(
      pdfSection(
        t.treasury.donors(data.label ?? data.year),
        pickBars(
          sum.donors.map(([k, v]) => [k || t.treasury.anonymous, v]),
          m,
          ctx.brandHex,
        ),
      ),
    );
  }

  if (dues && dues.rows.length && dues.feeCents > 0) {
    // Plain text marks: the embedded font has no reliable symbol glyphs.
    const mark = (c: { state: string; paidCents: number }) =>
      c.paidCents > 0 ? String(cents(c.paidCents)) : c.state === 'unpaid' ? '—' : '';
    content.push({ text: `${t.reports.dues} ${dues.year}`, style: 'h2', pageBreak: 'before' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', ...dues.periods.map(() => 22), 'auto'],
        body: [
          [
            { text: t.reports.colName, style: 'th' },
            ...dues.periods.map((p) => ({
              text: f.monthShort(p).slice(0, 4),
              style: 'th',
              fontSize: 7.5,
              alignment: 'center' as const,
            })),
            { text: t.reports.colTotal, style: 'th', alignment: 'right' as const },
          ],
          ...dues.rows.map((r) => [
            displayName(r.member),
            ...r.cells.map((c) => ({
              text: mark(c),
              alignment: 'center' as const,
              color: c.state === 'paid' ? '#1f9d55' : c.state === 'partial' ? '#c77c02' : '#d64541',
            })),
            { text: m(r.paidCents), alignment: 'right' as const },
          ]),
        ],
      },
      layout,
    });
    content.push({
      text: `${t.treasury.feePerMonth}: ${m(dues.feeCents)} · — ${t.treasury.legend.unpaid}`,
      style: 'muted',
      margin: [0, 6, 0, 0],
    });
  }

  content.push({ text: t.reports.entries, style: 'h2', pageBreak: 'before' });
  if (data.transactions.length === 0) {
    content.push({ text: t.reports.noData, style: 'muted' });
  } else {
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto'],
        body: [
          [
            { text: t.reports.colDate, style: 'th' },
            { text: t.reports.colNote, style: 'th' },
            { text: t.reports.colTotal, style: 'th', alignment: 'right' },
          ],
          ...mergeDues(data.transactions).map((tx) => {
            const x = entryText(ctx, tx);
            if (tx.periods.length > 1) {
              const first = tx.periods[0]!;
              const last = tx.periods[tx.periods.length - 1]!;
              x.category = `${f.monthShort(first)}–${f.monthShort(last)} ${last.slice(0, 4)}`;
            }
            const out = isOutgoing(tx.kind);
            const detail = [x.category, x.who, x.note].filter(Boolean).join(' · ');
            return [
              f.ddmm(`${tx.occurredOn}T12:00:00Z`),
              { text: [{ text: x.kind, bold: true }, detail ? ` — ${detail}` : ''] },
              {
                text: m(out ? -tx.amountCents : tx.amountCents, true),
                alignment: 'right' as const,
                color: out ? '#d64541' : '#1f9d55',
              },
            ];
          }),
        ],
      },
      layout: zebra,
    });
  }
  return toBlob(pdfDoc(ctx, title, content));
}

export async function attendancePdf(ctx: ReportCtx, data: AttendanceExport): Promise<Blob> {
  const { t, f } = ctx;
  const title = t.reports.fileAttendance(data.groupName, data.label ?? data.year);
  const content: Content[] = [
    { text: title, style: 'h1' },
    {
      text: `${t.reports.generated(f.dayMonth(new Date().toISOString()))} · ${t.common.meetings(data.meetings.length)}`,
      style: 'muted',
      margin: [0, 2, 0, 10],
    },
  ];
  if (data.meetings.length === 0) {
    content.push({ text: t.reports.noData, style: 'muted' });
    return toBlob(pdfDoc(ctx, title, content));
  }
  const rows = data.rows
    .map((r) => ({ r, s: attendanceStats(r.statuses) }))
    .sort((a, b) => (b.s.percent ?? -1) - (a.s.percent ?? -1));
  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [
          { text: t.reports.colName, style: 'th' },
          ...STATUSES.map((s) => ({
            text: t.status[s],
            style: 'th',
            alignment: 'center' as const,
          })),
          { text: '%', style: 'th', alignment: 'right' as const },
        ],
        ...rows.map(({ r, s }) => [
          displayName(r.member),
          ...STATUSES.map((k) => ({ text: String(s[k] || ''), alignment: 'center' as const })),
          {
            text: s.percent === null ? '—' : `${s.percent}%`,
            alignment: 'right' as const,
            bold: true,
            color:
              s.percent === null
                ? '#999999'
                : s.percent >= 75
                  ? '#1f9d55'
                  : s.percent >= 50
                    ? '#c77c02'
                    : '#d64541',
          },
        ]),
      ],
    },
    layout,
  });

  content.push({ text: t.nav.meetings, style: 'h2' });
  content.push({
    table: {
      headerRows: 1,
      widths: ['auto', '*', 'auto', 'auto'],
      body: [
        [
          { text: t.reports.colDate, style: 'th' },
          { text: t.events.name, style: 'th' },
          { text: t.status.present, style: 'th', alignment: 'center' },
          { text: t.reports.guests, style: 'th', alignment: 'center' },
        ],
        ...data.meetings.map((mt, i) => {
          const came = data.rows.filter(
            (r) => r.statuses[i] === 'present' || r.statuses[i] === 'late',
          ).length;
          return [
            f.ddmm(mt.startsAt),
            mt.title,
            { text: String(came), alignment: 'center' as const },
            { text: mt.guestCount ? String(mt.guestCount) : '', alignment: 'center' as const },
          ];
        }),
      ],
    },
    layout,
  });
  return toBlob(pdfDoc(ctx, title, content));
}

// ---------- statistics ----------

const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);
const pctColor = (n: number | null) =>
  n === null ? '#999999' : n >= 75 ? '#1f9d55' : n >= 50 ? '#c77c02' : '#d64541';
const kindName = (t: Messages, kind: string | null) =>
  kind ? (t.meetings.kinds[kind as MeetingKind] ?? kind) : t.stats.noKind;

/** The summary as label/value pairs (shared by Excel and PDF). */
function statSummary(t: Messages, s: GroupStatistics): [string, string | number][] {
  const x = s.summary;
  return [
    [t.stats.members, x.activeMembers],
    [t.stats.newLeft(x.newMembers, x.leftMembers), ''],
    [t.stats.attendance, pctText(x.averageRate)],
    [t.stats.meetingsHeld, x.meetingsHeld],
    [t.stats.cancelled(x.meetingsCancelled), ''],
    [t.stats.perMeeting, x.averagePeople ?? '—'],
    [t.stats.guests, x.guests],
    [t.stats.excused, x.excused],
    [`${t.stats.faithful} (${t.stats.faithfulHint})`, x.faithful],
    [`${t.stats.atRisk} (${t.stats.atRiskHint})`, x.atRisk],
    [t.stats.events, x.events],
    [t.stats.duties, t.stats.dutiesHint(x.dutiesFilled, x.dutySlots)],
  ];
}

export async function statisticsXlsx(
  ctx: ReportCtx,
  s: GroupStatistics,
  label: string,
): Promise<Blob> {
  const { t, f } = ctx;
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const header = (ws: Worksheet) => {
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ctx.brandHex) } };
    head.alignment = { vertical: 'middle' };
    head.height = 22;
  };

  const sum = wb.addWorksheet(t.stats.tabOverview);
  sum.columns = [
    { header: t.stats.file(s.groupName, label), width: 44 },
    { header: '', width: 22 },
  ];
  header(sum);
  for (const [k, v] of statSummary(t, s)) sum.addRow([k, v]);
  sum.addRow([]);
  sum.addRow([t.stats.byKind]).font = { bold: true };
  for (const k of s.kinds)
    sum.addRow([
      `${kindName(t, k.kind)} — ${t.common.meetings(k.meetings)}`,
      pctText(k.averageRate),
    ]);

  const people = wb.addWorksheet(t.stats.tabPeople, { views: [{ state: 'frozen', ySplit: 1 }] });
  people.columns = [
    { header: t.reports.colName, width: 26 },
    { header: t.stats.colPosition, width: 18 },
    { header: '%', width: 7 },
    { header: t.status.present, width: 11 },
    { header: t.status.late, width: 11 },
    { header: t.status.excused, width: 13 },
    { header: t.status.absent, width: 11 },
    { header: t.stats.colStreak, width: 14 },
    { header: t.stats.colLastSeen, width: 14 },
    { header: t.stats.led, width: 9 },
    { header: t.stats.snacks, width: 9 },
    { header: t.stats.dutiesShort, width: 11 },
    { header: t.stats.joined, width: 13 },
  ];
  header(people);
  for (const p of s.people) {
    const row = people.addRow([
      displayName(p) + (p.active ? '' : ` (${t.stats.leftMinistry})`),
      p.positionName ?? '',
      p.percent === null ? '' : p.percent / 100,
      p.present,
      p.late,
      p.excused,
      p.absent,
      p.streak || '',
      p.lastSeen ? f.dayMonth(p.lastSeen) : '',
      p.led || '',
      p.snacks || '',
      p.duties || '',
      p.joinedAt ? f.dayMonth(p.joinedAt) : '',
    ]);
    row.getCell(3).numFmt = '0%';
    if (p.streak >= 3)
      row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.absent } };
  }

  const meets = wb.addWorksheet(t.stats.tabMeetings, { views: [{ state: 'frozen', ySplit: 1 }] });
  meets.columns = [
    { header: t.reports.colDate, width: 12 },
    { header: t.stats.tabMeetings, width: 28 },
    { header: t.stats.colTopic, width: 24 },
    { header: t.stats.colKind, width: 16 },
    { header: t.stats.leader, width: 20 },
    { header: t.status.present, width: 11 },
    { header: t.status.late, width: 11 },
    { header: t.status.excused, width: 13 },
    { header: t.status.absent, width: 11 },
    { header: t.reports.guests, width: 9 },
    { header: '%', width: 7 },
  ];
  header(meets);
  for (const m of s.meetings) {
    const row = meets.addRow([
      f.dayMonth(m.startsAt),
      m.title,
      m.topic ?? '',
      kindName(t, m.kind),
      m.leaderName ?? '',
      m.present,
      m.late,
      m.excused,
      m.absent,
      m.guests,
      m.rate === null ? '' : m.rate / 100,
    ]);
    row.getCell(11).numFmt = '0%';
  }

  const evs = wb.addWorksheet(t.stats.tabEvents, { views: [{ state: 'frozen', ySplit: 1 }] });
  evs.columns = [
    { header: t.reports.colDate, width: 12 },
    { header: t.stats.tabEvents, width: 30 },
    { header: t.stats.going, width: 10 },
    { header: t.stats.notGoing, width: 10 },
    { header: t.stats.colDuties, width: 24 },
  ];
  header(evs);
  for (const e of s.events)
    evs.addRow([
      f.dayMonth(e.startsAt),
      e.title,
      e.going,
      e.notGoing,
      e.slots ? `${e.filled} / ${e.slots}` : '',
    ]);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function statisticsPdf(
  ctx: ReportCtx,
  s: GroupStatistics,
  label: string,
): Promise<Blob> {
  const { t, f } = ctx;
  const title = t.stats.file(s.groupName, label);
  const th = (text: string, alignment: 'left' | 'center' | 'right' = 'left') => ({
    text,
    style: 'th',
    alignment,
  });
  const content: Content[] = [
    { text: title, style: 'h1' },
    {
      text: t.reports.generated(f.dayMonth(new Date().toISOString())),
      style: 'muted',
      margin: [0, 2, 0, 10],
    },
    {
      table: {
        widths: ['*', 'auto'],
        body: statSummary(t, s).map(([k, v]) => [k, { text: String(v), bold: true }]),
      },
      layout,
    },
  ];
  if (s.kinds.length) {
    content.push({ text: t.stats.byKind, style: 'h2' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto'],
        body: [
          [th(t.stats.colKind), th(t.stats.tabMeetings, 'center'), th('%', 'right')],
          ...s.kinds.map((k) => [
            kindName(t, k.kind),
            { text: String(k.meetings), alignment: 'center' as const },
            { text: pctText(k.averageRate), alignment: 'right' as const, bold: true },
          ]),
        ],
      },
      layout,
    });
  }
  content.push({ text: t.stats.tabPeople, style: 'h2' });
  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [
          th(t.reports.colName),
          th(t.status.present, 'center'),
          th(t.status.late, 'center'),
          th(t.status.absent, 'center'),
          th(t.stats.colStreak, 'center'),
          th(t.stats.dutiesShort, 'center'),
          th(t.stats.colLastSeen, 'center'),
          th('%', 'right'),
        ],
        ...s.people.map((p) => [
          {
            text: displayName(p) + (p.active ? '' : ` (${t.stats.leftMinistry})`),
            color: p.isAdmin ? '#e11d2e' : undefined,
          },
          { text: String(p.present || ''), alignment: 'center' as const },
          { text: String(p.late || ''), alignment: 'center' as const },
          { text: String(p.absent || ''), alignment: 'center' as const },
          {
            text: String(p.streak || ''),
            alignment: 'center' as const,
            color: p.streak >= 3 ? '#d64541' : undefined,
            bold: p.streak >= 3,
          },
          { text: String(p.duties + p.led + p.snacks || ''), alignment: 'center' as const },
          { text: p.lastSeen ? f.dayMonth(p.lastSeen) : '—', alignment: 'center' as const },
          {
            text: pctText(p.percent),
            alignment: 'right' as const,
            bold: true,
            color: pctColor(p.percent),
          },
        ]),
      ],
    },
    layout,
  });
  if (s.meetings.length) {
    content.push({ text: t.stats.tabMeetings, style: 'h2' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
        body: [
          [
            th(t.reports.colDate),
            th(t.stats.tabMeetings),
            th(t.status.present, 'center'),
            th(t.status.absent, 'center'),
            th(t.reports.guests, 'center'),
            th('%', 'right'),
          ],
          ...s.meetings.map((m) => [
            f.dayMonth(m.startsAt),
            `${m.title}${m.topic ? ` «${m.topic}»` : ''}${m.leaderName ? `\n${t.stats.leader}: ${m.leaderName}` : ''}`,
            { text: String(m.present + m.late), alignment: 'center' as const },
            { text: String(m.absent), alignment: 'center' as const },
            { text: String(m.guests || ''), alignment: 'center' as const },
            {
              text: pctText(m.rate),
              alignment: 'right' as const,
              bold: true,
              color: pctColor(m.rate),
            },
          ]),
        ],
      },
      layout,
    });
  }
  if (s.events.length) {
    content.push({ text: t.stats.tabEvents, style: 'h2' });
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto'],
        body: [
          [
            th(t.reports.colDate),
            th(t.stats.tabEvents),
            th(t.stats.going, 'center'),
            th(t.stats.colDuties, 'center'),
          ],
          ...s.events.map((e) => [
            f.dayMonth(e.startsAt),
            e.title,
            { text: String(e.going), alignment: 'center' as const },
            { text: e.slots ? `${e.filled} / ${e.slots}` : '—', alignment: 'center' as const },
          ]),
        ],
      },
      layout,
    });
  }
  return toBlob(pdfDoc(ctx, title, content));
}
