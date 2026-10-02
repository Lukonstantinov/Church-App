import type { Worksheet } from 'exceljs';
import { displayName, type EventDetail } from '@church/shared';
import { argb, excel, pdf, type ReportCtx } from './reports';

/**
 * Files about one event, built on the phone like the other reports: an Excel workbook
 * of who is responsible for what (duties with their leaders, the programme, who is going),
 * and a PDF made from the event's poster image so it looks exactly like the picture.
 */
export async function eventRosterXlsx(ctx: ReportCtx, e: EventDetail, when: string): Promise<Blob> {
  const { t } = ctx;
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const head = (ws: Worksheet, row: number) => {
    const r = ws.getRow(row);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(ctx.brandHex) } };
    r.alignment = { vertical: 'middle' };
    r.height = 22;
  };
  const title = (ws: Worksheet, cols: number) => {
    ws.addRow([e.title]).font = { bold: true, size: 14 };
    ws.addRow([[when, e.location].filter(Boolean).join(' · ')]).font = {
      color: { argb: 'FF888888' },
    };
    ws.addRow([]);
    ws.mergeCells(1, 1, 1, cols);
    ws.mergeCells(2, 1, 2, cols);
  };

  const duties = wb.addWorksheet(t.events.sheetDuties);
  duties.columns = [{ width: 24 }, { width: 38 }, { width: 24 }, { width: 44 }, { width: 8 }];
  title(duties, 5);
  duties.addRow([
    t.events.colDuty,
    t.events.colInvolves,
    t.events.colLeader,
    t.events.colPeople,
    t.events.colSlots,
  ]);
  head(duties, 4);
  for (const r of e.roles) {
    const row = duties.addRow([
      r.name,
      r.description ?? '',
      r.leader ? displayName(r.leader) : '',
      r.assignees.map((a) => displayName(a)).join(', '),
      r.slots,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(3).font = { bold: true };
  }

  if (e.program.length > 0) {
    const ws = wb.addWorksheet(t.events.sheetProgram);
    ws.columns = [{ width: 8 }, { width: 9 }, { width: 40 }, { width: 24 }, { width: 40 }];
    title(ws, 5);
    ws.addRow([
      t.events.colDay,
      t.events.colTime,
      t.events.colItem,
      t.events.colWho,
      t.events.colNote,
    ]);
    head(ws, 4);
    for (const i of e.program)
      ws.addRow([
        i.day + 1,
        i.time,
        i.title,
        i.person ? displayName(i.person) : '',
        i.note ?? '',
      ]).alignment = {
        vertical: 'top',
        wrapText: true,
      };
  }

  if (e.features.rsvp && e.rsvps.going.length > 0) {
    const ws = wb.addWorksheet(t.events.colGoing);
    ws.columns = [{ width: 36 }];
    title(ws, 1);
    ws.addRow([`${t.events.colGoing} · ${e.rsvps.going.length}`]);
    head(ws, 4);
    for (const p of e.rsvps.going) ws.addRow([displayName(p)]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** A one-page PDF (page as tall as the picture needs) holding the poster image. */
export async function posterPdf(
  dataUrl: string,
  width: number,
  height: number,
  title: string,
): Promise<Blob> {
  const pdfMake = await pdf();
  const pageW = 595;
  const pageH = Math.round((height / width) * pageW);
  return pdfMake
    .createPdf({
      pageSize: { width: pageW, height: pageH },
      pageMargins: 0,
      info: { title },
      content: [{ image: dataUrl, width: pageW }],
    })
    .getBlob();
}
