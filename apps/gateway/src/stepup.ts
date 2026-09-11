// Step-up authentication (docs/atelier/phase-b-governance-primitives-design.md §7.1, ratified
// decision 2). A second, independently-keyed credential proving the founder authenticated *just
// now* — distinct from the 30-day `rmg_sess` session, which carries only an email and nothing to
// age. Pure and dependency-free (except the HMAC sign/unsign primitives already shipped by
// @fastify/cookie) so the freshness/signature logic is fully unit-testable — see
// apps/gateway/test/stepup.test.ts. server.ts wires these into `POST /auth/google/step-up` and
// its dashboard prompt now; the write-boundary check (`verifyStepUpCookie` on every approval
// write) is what §13 step 6 will call once it is unblocked (docs/atelier/b1-2-dependency-split.md)
// — this module ships the primitive ahead of its one blocked caller, same as §7.1 names.

import { sign, unsign } from '@fastify/cookie';

export const STEP_UP_COOKIE = 'rmg_stepup';

/** The insecure development fallback for STEP_UP_COOKIE_SECRET. Never valid in production.
 *  Deliberately distinct from DEV_COOKIE_SECRET (auth.ts) — the two secrets must never collide,
 *  even as dev defaults, or a dev-mode test would pass for the wrong reason. */
export const DEV_STEP_UP_COOKIE_SECRET = 'rmg-dev-stepup-secret-change-me';

/** Discriminator the dashboard uses to distinguish "you need a fresh re-authentication" from an
 *  ordinary 401 — routes to the step-up prompt rather than the sign-in screen. */
export const STEP_UP_REQUIRED_CODE = 'step_up_required';

const DEFAULT_STEP_UP_MAX_AGE_SECONDS = 900;

/**
 * `STEP_UP_MAX_AGE_SECONDS` unset, empty, non-numeric, or non-positive falls back to the default
 * 900s — never to "no limit". §7.1 calls this out explicitly: unlimited is the fail-open shape
 * `WORKER_SECRET` already had to be corrected out of once.
 */
export function parseStepUpMaxAgeSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_STEP_UP_MAX_AGE_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_STEP_UP_MAX_AGE_SECONDS;
}

/**
 * Fail closed on an unsafe step-up cookie secret — same shape as `assertCookieSecret` (auth.ts),
 * but for a distinct, independently-rotatable key. §7.1: signing step-up with the session's own
 * `COOKIE_SECRET` would mean the one scenario where forgery matters — that secret compromised —
 * lets an attacker mint *both* a session and a matching fresh step-up, closing nothing that
 * stolen-session replay didn't already close.
 */
export function assertStepUpCookieSecret(
  secret: string | undefined,
  opts: { authEnabled: boolean; nodeEnv: string | undefined }
): void {
  if (!opts.authEnabled) return;
  if (opts.nodeEnv !== 'production') return;
  if (!secret || secret === DEV_STEP_UP_COOKIE_SECRET) {
    throw new Error(
      'STEP_UP_COOKIE_SECRET must be set to a strong, non-default value in production when AUTH_ENABLED=true'
    );
  }
}

/**
 * The decoded `auth_time` claim from Google's tokeninfo response — the instant the user actually
 * authenticated, as opposed to `iat` (when the token happened to be issued, which Google will
 * mint fresh from a weeks-old browser session with no prompt at all). Returns `undefined` when
 * the claim is absent or unparseable; callers MUST refuse in that case rather than falling back
 * to `iat` — that fallback is the exact hole §7.1's second review round closed.
 */
export function extractAuthTime(tokenInfo: { auth_time?: string }): number | undefined {
  if (tokenInfo.auth_time === undefined) return undefined;
  const n = Number(tokenInfo.auth_time);
  return Number.isFinite(n) ? n : undefined;
}

export interface StepUpFreshness {
  fresh: boolean;
  /** May be negative (an `auth_time` claiming to be in the future) — callers treat any negative
   *  age as not fresh, but the raw value is kept so a caller can log/inspect it. */
  ageSeconds: number;
}

/**
 * Whether an authentication instant is within the step-up window right now. Rejects both a stale
 * `auth_time` (age beyond `maxAgeSeconds`) and one that claims to be in the future (negative
 * age) — either means the claim cannot be trusted as "the user is at the keyboard right now".
 */
export function checkAuthTimeFreshness(
  authTimeSeconds: number,
  nowSeconds: number,
  maxAgeSeconds: number
): StepUpFreshness {
  const ageSeconds = nowSeconds - authTimeSeconds;
  return { fresh: ageSeconds >= 0 && ageSeconds <= maxAgeSeconds, ageSeconds };
}

/**
 * Cookie `Max-Age` to set at mint time: the *remaining* window, never the full window again — an
 * `auth_time` already 890s old must not mint a cookie good for another 900s, or an approval could
 * land ~30 minutes after the actual login while every individual check passed (§7.1). Returns
 * `null` when the remaining window is already `<= 0`; the caller must refuse minting rather than
 * set a zero-or-negative Max-Age.
 */
export function remainingStepUpWindowSeconds(ageSeconds: number, maxAgeSeconds: number): number | null {
  const remaining = maxAgeSeconds - ageSeconds;
  return remaining > 0 ? remaining : null;
}

export interface StepUpCookiePayload {
  /** The verified email from the fresh ID token, lowercased. Compared against the caller's
   *  session email at verification time — a step-up minted for one account must never authorize
   *  an approval made under a different session (§7.1: "belonging to a different session ...
   *  refuse"). Carried in the signed value itself because B1 adds no server-side step-up store —
   *  there is nothing else to compare it against. */
  email: string;
  /** Opaque id for this step-up instance, recorded as `authorization_ref` in approval evidence
   *  once §13 step 6 lands — how fresh the authority was is itself part of the evidence. */
  stepUpId: string;
  /** The verified `auth_time`, in seconds since epoch — never `iat`. */
  authTime: number;
}

/** Sign a step-up payload with `STEP_UP_COOKIE_SECRET` — deliberately NOT the app's registered
 *  `COOKIE_SECRET` (see `assertStepUpCookieSecret`). Uses @fastify/cookie's standalone `sign`
 *  rather than the app instance's `reply.signCookie`, which is permanently bound to the one
 *  secret registered with the plugin. */
export function signStepUpCookie(payload: StepUpCookiePayload, secret: string): string {
  return sign(JSON.stringify(payload), secret);
}

export type StepUpVerification =
  | { ok: true; payload: StepUpCookiePayload; ageSeconds: number }
  | { ok: false; reason: 'missing' | 'invalid_signature' | 'malformed' | 'expired' | 'email_mismatch' };

/**
 * Verify a raw `rmg_stepup` cookie value against `STEP_UP_COOKIE_SECRET` and the caller's current
 * session email. This is the check the approval write path (§13 step 6, currently blocked — see
 * docs/atelier/b1-2-dependency-split.md) will call on every write, recomputing freshness from the
 * signed `authTime` each time rather than inferring it from the cookie merely being present:
 * `Max-Age` is a client-side hint, not a server-verifiable expiry, so trusting presence alone
 * would let a cookie outlive the window it was minted for.
 *
 * A signature verified with the **session's** `COOKIE_SECRET` instead of `STEP_UP_COOKIE_SECRET`
 * fails here exactly as a forged or tampered cookie does — `unsign` with the wrong secret never
 * validates, by construction, which is what makes the two credentials independent proofs.
 */
export function verifyStepUpCookie(
  raw: string | undefined,
  opts: { secret: string; sessionEmail: string; nowSeconds: number; maxAgeSeconds: number }
): StepUpVerification {
  if (!raw) return { ok: false, reason: 'missing' };
  const unsigned = unsign(raw, opts.secret);
  if (!unsigned.valid || unsigned.value === null) return { ok: false, reason: 'invalid_signature' };
  let payload: StepUpCookiePayload;
  try {
    const parsed = JSON.parse(unsigned.value) as Partial<StepUpCookiePayload>;
    if (
      typeof parsed.email !== 'string' ||
      typeof parsed.stepUpId !== 'string' ||
      typeof parsed.authTime !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    payload = { email: parsed.email, stepUpId: parsed.stepUpId, authTime: parsed.authTime };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.email.toLowerCase() !== opts.sessionEmail.trim().toLowerCase()) {
    return { ok: false, reason: 'email_mismatch' };
  }
  const { fresh, ageSeconds } = checkAuthTimeFreshness(payload.authTime, opts.nowSeconds, opts.maxAgeSeconds);
  if (!fresh) return { ok: false, reason: 'expired' };
  return { ok: true, payload, ageSeconds };
}
