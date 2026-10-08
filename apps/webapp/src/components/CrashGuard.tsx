import { Component, type ErrorInfo, type ReactNode } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Sends an error the app hit to the server, so the developer sees it in Telemetry
 * (what broke, on which screen, on which phone). Never throws; at most one a second.
 */
let lastSent = 0;
export function reportError(error: unknown, place?: string, extra?: string): void {
  const now = Date.now();
  if (now - lastSent < 1000) return;
  lastSent = now;
  const e = error instanceof Error ? error : new Error(String(error));
  const stack = [e.stack, extra].filter(Boolean).join('\n---\n').slice(0, 3000);
  void apiFetch('/dev/client-error', {
    method: 'POST',
    body: JSON.stringify({
      message: (e.message || 'error').slice(0, 500),
      stack,
      place: place?.slice(0, 200) ?? null,
      userAgent: navigator.userAgent.slice(0, 300),
    }),
  }).catch(() => undefined);
}

/** Errors outside React (timers, promises) are reported too. */
export function watchErrors(): void {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, location.search));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, location.search));
}

/**
 * Catches a crash in a screen: instead of a white screen, a short note with "Back" and
 * "Reload" — and the error goes to the developer. Resets when `resetKey` (the screen) changes.
 */
export class CrashGuard extends Component<
  {
    resetKey: string;
    place: string;
    fallback: (error: Error, reset: () => void) => ReactNode;
    children: ReactNode;
  },
  { error: Error | null; key: string }
> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string },
  ) {
    // Another screen was opened: try again.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, this.props.place, info.componentStack ?? undefined);
  }

  override render() {
    if (this.state.error)
      return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return this.props.children;
  }
}
