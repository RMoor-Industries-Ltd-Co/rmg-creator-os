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

/** Discriminator for a 401 meaning "your ordinary session is fine, but this write needs a fresh
 *  re-authentication" (docs/atelier/phase-b-governance-primitives-design.md §7.1) — distinct from
 *  `isSessionExpired`: the session itself has not expired, so the whole app must NOT be routed to
 *  the sign-in screen. */
export function isStepUpRequired(status: number, body: ApiErrorBody): boolean {
  if (status !== 401) return false;
  return body.code === 'step_up_required';
}

let stepUpHandler: (() => Promise<void>) | null = null;

/** App registers a callback that shows the re-authentication prompt and returns a promise
 *  resolving once a fresh `rmg_stepup` credential has been minted — or rejecting if the user
 *  cancels. `requestStepUp()` (called from `req()`'s retry path) awaits exactly this promise. */
export function setStepUpRequiredHandler(fn: (() => Promise<void>) | null): void {
  stepUpHandler = fn;
}

/** Rejects immediately (no infinite hang) when no prompt is registered — e.g. before `App` has
 *  mounted `StepUpPrompt`, or in a context (tests, a headless script) with no UI to show one. */
export function requestStepUp(): Promise<void> {
  if (!stepUpHandler) return Promise.reject(new Error('Step-up required, but no re-authentication prompt is available.'));
  return stepUpHandler();
}
