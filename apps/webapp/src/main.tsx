import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { initTelegram, isInsideTelegram } from './lib/telegram';
import { App } from './App';
import './index.css';
import './fonts.css';

initTelegram();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      enabled: isInsideTelegram(),
      staleTime: 30_000,
      // Don't retry auth/permission errors; they won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
