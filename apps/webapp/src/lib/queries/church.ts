import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ChurchStudioInput,
  MinistryStudioInput,
  ChurchInfo,
  Locale,
  UpdateChurchInput,
  MeResponse,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, json, send, useInvalidateAll } from './core';

// ---------- language & church settings ----------

/** Switches the UI language immediately, then saves it for this user. */
export function useSetLocale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: Locale) =>
      apiFetch<MeResponse>('/me', { method: 'PATCH', ...json({ locale }) }),
    onMutate: (locale) => {
      const prev = qc.getQueryData<MeResponse>(keys.me);
      if (prev) qc.setQueryData<MeResponse>(keys.me, { ...prev, user: { ...prev.user, locale } });
      return { prev };
    },
    onError: (_e, _l, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.me, ctx.prev);
    },
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

function useSetChurch() {
  const qc = useQueryClient();
  return (church: ChurchInfo) => {
    const prev = qc.getQueryData<MeResponse>(keys.me);
    if (prev) qc.setQueryData<MeResponse>(keys.me, { ...prev, church });
  };
}

/** Design studio: save a ministry page's parts, entrance, meeting animation and background. */
export function useSaveMinistryStudio(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: MinistryStudioInput) =>
      apiFetch<{ ok: true }>(`/groups/${groupId}/studio`, send('PUT', input)),
    onSuccess: invalidate,
  });
}

/** Design studio: save the church main page's parts and background (admins). */
export function useSaveChurchStudio() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: (input: ChurchStudioInput) =>
      apiFetch<ChurchInfo>('/church/studio', send('PUT', input)),
    onSuccess: setChurch,
  });
}

export function useUpdateChurch() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: (input: UpdateChurchInput) =>
      apiFetch<ChurchInfo>('/church', { method: 'PATCH', ...json(input) }),
    onSuccess: setChurch,
  });
}

/** Sets the bot's profile photo (the phone shortcut's icon) from a square JPEG. */
export function useSetBotPhoto() {
  return useMutation({
    mutationFn: (file: Blob) =>
      apiFetch<{ ok: true }>('/church/bot-photo', {
        method: 'PUT',
        body: file,
        headers: { 'content-type': 'image/jpeg' },
      }),
  });
}

export function useUploadLogo() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: (file: Blob) =>
      apiFetch<ChurchInfo>('/church/logo', {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    onSuccess: setChurch,
  });
}

export function useRemoveLogo() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: () => apiFetch<ChurchInfo>('/church/logo', { method: 'DELETE' }),
    onSuccess: setChurch,
  });
}
