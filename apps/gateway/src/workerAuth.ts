// apps/gateway/src/workerAuth.ts
// Machine authentication for the worker execution lane.
//
// The worker routes (`/worker/tick`, `/worker/recover`) are executed by a machine, not a
// person, so they cannot be gated behind the browser session cookie — a headless caller has
// no session and receives 401. They are also not public: they claim work and can trigger
// paid external renders. This module is the third option — a dedicated machine credential,
// evaluated per request, fail-closed.
//
// Pure and dependency-free apart from node:crypto, so every branch is unit-testable
// (apps/gateway/test/workerAuth.test.ts). Deliberately NOT the agent/MCP credential:
// worker execution authority and agent authority stay separate surfaces.

import { timingSafeEqual } from 'node:crypto';

/** Machine-readable discriminator so a worker 401 is distinguishable from a session 401. */
export const WORKER_AUTH_REQUIRED_CODE = 'worker_auth_required';

/** Reason a worker request was refused. `not_configured` means the deployment has no
 *  WORKER_SECRET at all — refused rather than allowed, which is the defect this fixes. */
export type WorkerAuthFailure = 'not_configured' | 'missing' | 'mismatch';

export type WorkerAuthResult =
  | { authorized: true }
  | { authorized: false; reason: WorkerAuthFailure; message: string };

/** Constant-time string comparison. Length is not secret here (the caller controls the
 *  header), but an early length return would leak it, so unequal lengths still run a
 *  comparison of equal-length buffers before returning false. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against itself so the work done is independent of `b`, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Authorize a worker request.
 *
 * Fails closed in all three ways it can fail:
 *  - `configured` empty/whitespace  -> refuse. The previous code read
 *    `if (WORKER_SECRET && secret !== WORKER_SECRET)`, so an unset WORKER_SECRET — which is
 *    what production actually had — turned the check into a no-op and left the routes open
 *    to anyone who could reach the gateway with a session. An unconfigured credential now
 *    means the lane is closed, not open.
 *  - `provided` empty -> refuse.
 *  - mismatch -> refuse, in constant time.
 */
export function checkWorkerSecret(
  provided: string | undefined,
  configured: string | undefined
): WorkerAuthResult {
  const expected = (configured ?? '').trim();
  if (expected.length === 0) {
    return {
      authorized: false,
      reason: 'not_configured',
      message: 'WORKER_SECRET is not configured; the worker execution lane is closed'
    };
  }
  const supplied = (provided ?? '').trim();
  if (supplied.length === 0) {
    return { authorized: false, reason: 'missing', message: 'missing x-worker-secret header' };
  }
  if (!constantTimeEquals(supplied, expected)) {
    return { authorized: false, reason: 'mismatch', message: 'invalid x-worker-secret' };
  }
  return { authorized: true };
}

/**
 * True for the worker execution routes. Used by server.ts so the session guard skips them —
 * they are authenticated by `checkWorkerSecret` instead, NOT made public. Keeping this
 * separate from `isPublicRoute` is the point: `isPublicRoute` means "no credential at all",
 * and the worker lane always requires one.
 */
export function isWorkerRoute(method: string, url: string): boolean {
  if (method === 'OPTIONS') return false;
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return path === '/worker/tick' || path === '/worker/recover';
}
