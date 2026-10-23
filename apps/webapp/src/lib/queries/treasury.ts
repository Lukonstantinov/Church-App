import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTransactionInput,
  DuesSheet,
  MyFinanceGroup,
  PayDuesInput,
  TransactionPage,
  TransactionRow,
  TreasurySettingsInput,
  TreasurySummary,
  UpdateTransactionInput,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, json, useInvalidateAll } from './core';

// ---------- treasury ----------

export function useTreasury(groupId: number) {
  return useQuery({
    queryKey: keys.treasury(groupId),
    queryFn: () => apiFetch<TreasurySummary>(`/groups/${groupId}/treasury`),
  });
}

/** Sets the balance to the real amount now (a correction entry makes up the difference). */
export function useSetBalance(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: { balanceCents: number; note?: string | null }) =>
      apiFetch<TreasurySummary>(`/groups/${groupId}/treasury/balance`, {
        method: 'POST',
        ...json(input),
      }),
    onSuccess: invalidate,
  });
}

/** Church admins: deletes all of a ministry's money records (its name typed back). */
export function useWipeTreasury(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (confirmName: string) =>
      apiFetch<TreasurySummary>(`/groups/${groupId}/treasury`, {
        method: 'DELETE',
        ...json({ confirmName }),
      }),
    onSuccess: invalidate,
  });
}

/** Cash-book entries, newest first; `filter` is a comma list of kinds ("" = all). */
export interface LedgerFilter {
  member?: number;
  meeting?: number;
  from?: string;
  to?: string;
  q?: string;
}

const ledgerQuery = (f: LedgerFilter) =>
  Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join('');

/** Every entry matching a filter (for the downloadable sheet). */
export const fetchAllTransactions = (groupId: number, kinds: string, f: LedgerFilter) =>
  apiFetch<TransactionPage>(`/groups/${groupId}/transactions?kind=${kinds}${ledgerQuery(f)}&all=1`);

export function useTransactions(
  groupId: number,
  filter: string,
  opts: LedgerFilter & { enabled?: boolean } = {},
) {
  const { enabled, ...rest } = opts;
  const extra = ledgerQuery(rest);
  return useInfiniteQuery({
    queryKey: keys.transactions(groupId, `${filter}${extra}`),
    enabled: enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<TransactionPage>(
        `/groups/${groupId}/transactions?kind=${filter}${extra}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useDues(groupId: number, year: number) {
  return useQuery({
    queryKey: keys.dues(groupId, year),
    queryFn: () => apiFetch<DuesSheet>(`/groups/${groupId}/dues?year=${year}`),
  });
}

/** Everything under the group's treasury key (summary, lists, dues) is refreshed. */
function useInvalidateTreasury(groupId: number) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.treasury(groupId) });
}

export function useCreateTransaction(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      apiFetch<TransactionRow>(`/groups/${groupId}/transactions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTransactionInput & { id: number }) =>
      apiFetch<TransactionRow>(`/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function usePayDues(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: PayDuesInput) =>
      apiFetch<{ created: number[]; skipped: string[] }>(`/groups/${groupId}/dues`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useSetDuesExempt(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: { userId: number; exempt: boolean }) =>
      apiFetch(`/groups/${groupId}/dues/exempt`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useTreasurySettings(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TreasurySettingsInput) =>
      apiFetch<TreasurySummary>(`/groups/${groupId}/treasury`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(keys.treasury(groupId), data);
      void qc.invalidateQueries({ queryKey: keys.treasury(groupId) });
    },
  });
}

/** Uploads an already-resized image; returns its id for attaching. */
/** Stores a part's recorded loop (Design studio): a ministry's, or the church's with null. */
export const uploadLoop = (groupId: number | null, video: Blob, forSend = false) =>
  apiFetch<{ id: number; url: string }>(
    groupId ? `/groups/${groupId}/loops${forSend ? '?for=send' : ''}` : '/church/loops',
    {
      method: 'POST',
      body: video,
      headers: { 'content-type': 'video/mp4' },
    },
  );

export function useUploadMedia(groupId: number, kind: 'receipt' | 'event' = 'receipt') {
  return useMutation({
    mutationFn: (file: Blob) =>
      apiFetch<{ id: number; url: string }>(`/groups/${groupId}/media?kind=${kind}`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
  });
}

export function useMyFinance(enabled = true) {
  return useQuery({
    queryKey: keys.myFinance,
    queryFn: () => apiFetch<MyFinanceGroup[]>('/me/finance'),
    enabled,
  });
}
