// Auth allowlist + session helpers for the gateway's single-tenant Google sign-in.
// Pure and dependency-free so the boundary logic is fully unit-testable
// (see apps/gateway/test/auth.test.ts). server.ts wires these into the onRequest
// guard, /auth/google, and cookie registration.

/** The insecure development fallback for COOKIE_SECRET. Never valid in production. */
export const DEV_COOKIE_SECRET = 'rmg-dev-secret-change-me';

/** Machine-readable discriminator the frontend uses to tell an expired/absent session
 *  apart from other 401s and route the user to sign-in (instead of showing a raw error). */
export const SESSION_REQUIRED_CODE = 'session_required';

/** Discriminator for an authenticated Google identity that is not on the allowlist. */
export const NOT_ALLOWLISTED_CODE = 'not_allowlisted';

/**
 * Build the normalized (trimmed, lowercased) allowlist Set from the comma-separated
 * `AUTH_ALLOWED_EMAILS` plus the legacy single-value `AUTH_ALLOWED_EMAIL` fallback.
 * Empty entries are dropped; either source may be undefined.
 */
export function parseAllowedEmails(
  emails: string | undefined,
  fallback?: string | undefined
): Set<string> {
  const out = new Set<string>();
  const add = (raw: string | undefined): void => {
    for (const part of (raw ?? '').split(',')) {
      const e = part.trim().toLowerCase();
      if (e) out.add(e);
    }
  };
  add(emails);
  add(fallback);
  return out;
}

/** True when `email` is on the allowlist (case- and whitespace-insensitive). */
export function isEmailAllowed(email: string | undefined, allowed: Set<string>): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return e.length > 0 && allowed.has(e);
}

/**
 * Fail closed on an unsafe cookie secret. In production, with auth enabled, COOKIE_SECRET
 * must be set to a strong, non-default value — otherwise session cookies are trivially
 * forgeable and unstable across deploys (the cause of the briefing "unauthorized" incident).
 * No-op outside production or when auth is disabled (keeps local dev frictionless).
 */
export function assertCookieSecret(
  secret: string | undefined,
  opts: { authEnabled: boolean; nodeEnv: string | undefined }
): void {
  if (!opts.authEnabled) return;
  if (opts.nodeEnv !== 'production') return;
  if (!secret || secret === DEV_COOKIE_SECRET) {
    throw new Error(
      'COOKIE_SECRET must be set to a strong, non-default value in production when AUTH_ENABLED=true'
    );
  }
}

/**
 * Routes that must stay reachable without a session: health, the auth flow itself, and the
 * media proxies HeyGen/SuperCool fetch by unguessable UUID. Everything else is guarded.
 * (Moved out of server.ts unchanged so it can be unit-tested.)
 */
export function isPublicRoute(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'OPTIONS') return true;
  if (path === '/health' || path.startsWith('/auth/')) return true;
  if (/^\/(assets|videos)\/[^/]+\/raw$/.test(path)) return true;
  if (path.startsWith('/assets/drive-thumb/')) return true;
  return false;
}
