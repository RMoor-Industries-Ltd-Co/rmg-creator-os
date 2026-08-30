// Client-side session handling for the gateway auth boundary.
// Dependency-free (no React, no DOM) so the 401 detection is unit-testable in node
// (see apps/dashboard/test/authClient.test.ts). api.ts calls notifyUnauthorized() on a
// session 401; App.tsx registers a handler that routes the user to the sign-in screen.

export interface ApiErrorBody {
  error?: string;
  code?: string;
}

export const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';

/** A 401 that means "you need a (fresh) session" — the gateway tags these
 *  `code: 'session_required'` (falling back to the legacy `error: 'unauthorized'`). */
export function isSessionExpired(status: number, body: ApiErrorBody): boolean {
  if (status !== 401) return false;
  return body.code === 'session_required' || body.error === 'unauthorized';
}

let handler: (() => void) | null = null;

/** App registers a callback (e.g. flip to the login view) invoked on a session 401. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function notifyUnauthorized(): void {
  handler?.();
}
