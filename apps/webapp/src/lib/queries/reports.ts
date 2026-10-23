import { useQuery } from '@tanstack/react-query';
import type { PosterAudience } from '@church/shared';
import type { GroupStatistics } from '@church/shared';
import type { AttendanceExport, TreasuryExport, DuesSheet } from '@church/shared';
import { apiFetch } from '../api';

// ---------- reports ----------

/** A report period: a whole year, a month ("YYYY-MM") or from..to (local dates). */
export type ReportPeriod = { from: string; to: string };
const periodQuery = (p: ReportPeriod) => `from=${p.from}&to=${p.to}`;
export const fetchTreasuryExport = (groupId: number, p: ReportPeriod) =>
  apiFetch<TreasuryExport>(`/groups/${groupId}/treasury/export?${periodQuery(p)}`);
export const fetchDues = (groupId: number, year: number) =>
  apiFetch<DuesSheet>(`/groups/${groupId}/dues?year=${year}`);
/** The statistics screen: totals, people, meetings and events of a period. */
export function useStatistics(groupId: number, p: ReportPeriod, enabled = true) {
  return useQuery({
    queryKey: ['groups', groupId, 'statistics', p.from, p.to],
    queryFn: () => apiFetch<GroupStatistics>(`/groups/${groupId}/statistics?${periodQuery(p)}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export const fetchAttendanceExport = (groupId: number, p: ReportPeriod) =>
  apiFetch<AttendanceExport>(`/groups/${groupId}/attendance/export?${periodQuery(p)}`);

/** The bot sends a picture (PNG/JPEG) to the user's own chat, as a photo or as a file. */
export const sendPictureToChat = (image: Blob, name: string, asFile = false) =>
  apiFetch<{ ok: true }>(`/me/photo?name=${encodeURIComponent(name)}${asFile ? '&as=file' : ''}`, {
    method: 'POST',
    body: image,
    headers: { 'content-type': image.type || 'image/png' },
  });

/** The bot sends a recorded moving poster (MP4 or GIF, playing in the chat) to the user. */
export const sendAnimationToChat = (
  file: Blob,
  name: string,
  caption?: string,
  /** Also to others (the bot sends it to the person first, then to them). */
  share?: { to: PosterAudience; kind: 'event' | 'meeting'; id: number; users?: number[] },
  /** As a file to save (the exact file, full size) instead of a playing animation. */
  asFile = false,
) =>
  apiFetch<{ ok: true; sent: number }>(
    `/me/animation?name=${encodeURIComponent(name)}${asFile ? '&as=file' : ''}${
      caption ? `&caption=${encodeURIComponent(caption.slice(0, 1024))}` : ''
    }${
      share && share.to !== 'me'
        ? `&to=${share.to}&kind=${share.kind}&id=${share.id}${
            share.users?.length ? `&users=${share.users.join(',')}` : ''
          }`
        : ''
    }`,
    {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'video/mp4' },
    },
  );

/** The bot sends the file to the user's own chat. */
export const sendDocumentToChat = (file: Blob, name: string) =>
  apiFetch<{ ok: true }>(`/me/document?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': 'application/octet-stream' },
  });
