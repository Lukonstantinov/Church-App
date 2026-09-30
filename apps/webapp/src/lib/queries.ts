import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@church/shared';
import { apiFetch } from './api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch<MeResponse>('/me') });
}
