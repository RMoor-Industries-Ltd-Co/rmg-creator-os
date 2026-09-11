import { describe, it, expect } from 'vitest';
import { sign } from '@fastify/cookie';
import {
  assertStepUpCookieSecret,
  checkAuthTimeFreshness,
  DEV_STEP_UP_COOKIE_SECRET,
  extractAuthTime,
  parseStepUpMaxAgeSeconds,
  remainingStepUpWindowSeconds,
  signStepUpCookie,
  verifyStepUpCookie
} from '../src/stepup.js';

// Step-up authentication (docs/atelier/phase-b-governance-primitives-design.md §7.1, §12's named
// pure-test list). The property under test throughout: freshness is a fact about `auth_time`,
// never about the cookie merely being present, and a claim that cannot prove freshness is
// refused rather than defaulted into passing.

const SECRET = 'a-long-random-stepup-secret-for-tests';
const OTHER_SECRET = 'a-different-secret-entirely';
const NOW = 1_800_000_000; // arbitrary fixed epoch seconds

describe('extractAuthTime', () => {
  it('parses the auth_time claim as a number', () => {
    expect(extractAuthTime({ auth_time: '1700000000' })).toBe(1700000000);
  });

  it('is undefined when the claim is absent — never falls back to iat', () => {
    // §7.1, corrected second review round: a token with no auth_time must be refused outright,
    // not silently treated as fresh via some other timestamp.
    expect(extractAuthTime({})).toBeUndefined();
  });

  it('is undefined when the claim is unparseable', () => {
    expect(extractAuthTime({ auth_time: 'not-a-number' })).toBeUndefined();
  });
});

describe('checkAuthTimeFreshness', () => {
  it('is fresh exactly at the window boundary', () => {
    expect(checkAuthTimeFreshness(NOW - 900, NOW, 900).fresh).toBe(true);
  });

  it('rejects an auth_time older than the window', () => {
    expect(checkAuthTimeFreshness(NOW - 901, NOW, 900).fresh).toBe(false);
  });

  it('rejects an auth_time in the future', () => {
    const result = checkAuthTimeFreshness(NOW + 30, NOW, 900);
    expect(result.fresh).toBe(false);
    expect(result.ageSeconds).toBeLessThan(0);
  });

  it('reports the age for a fresh claim', () => {
    expect(checkAuthTimeFreshness(NOW - 120, NOW, 900).ageSeconds).toBe(120);
  });
});

describe('parseStepUpMaxAgeSeconds', () => {
  it('falls back to 900 when unset', () => {
    expect(parseStepUpMaxAgeSeconds(undefined)).toBe(900);
  });

  it('falls back to 900 when empty', () => {
    expect(parseStepUpMaxAgeSeconds('')).toBe(900);
  });

  it('falls back to 900 — never "unlimited" — on a non-numeric or non-positive value', () => {
    expect(parseStepUpMaxAgeSeconds('not-a-number')).toBe(900);
    expect(parseStepUpMaxAgeSeconds('0')).toBe(900);
    expect(parseStepUpMaxAgeSeconds('-30')).toBe(900);
  });

  it('honors a configured positive value', () => {
    expect(parseStepUpMaxAgeSeconds('300')).toBe(300);
  });
});

describe('remainingStepUpWindowSeconds', () => {
  it('returns the remaining window for a partly-aged claim', () => {
    expect(remainingStepUpWindowSeconds(600, 900)).toBe(300);
  });

  it('refuses (null) rather than minting a zero-or-negative Max-Age', () => {
    expect(remainingStepUpWindowSeconds(900, 900)).toBeNull();
    expect(remainingStepUpWindowSeconds(950, 900)).toBeNull();
  });
});

describe('assertStepUpCookieSecret (fail-closed in production)', () => {
  it('is a no-op when auth is disabled', () => {
    expect(() =>
      assertStepUpCookieSecret(undefined, { authEnabled: false, nodeEnv: 'production' })
    ).not.toThrow();
  });

  it('is a no-op outside production', () => {
    expect(() =>
      assertStepUpCookieSecret(DEV_STEP_UP_COOKIE_SECRET, { authEnabled: true, nodeEnv: 'development' })
    ).not.toThrow();
  });

  it('throws in production when auth is on and the secret is missing or the dev default', () => {
    expect(() =>
      assertStepUpCookieSecret(undefined, { authEnabled: true, nodeEnv: 'production' })
    ).toThrow();
    expect(() =>
      assertStepUpCookieSecret(DEV_STEP_UP_COOKIE_SECRET, { authEnabled: true, nodeEnv: 'production' })
    ).toThrow();
  });

  it('passes in production with a strong, non-default secret', () => {
    expect(() =>
      assertStepUpCookieSecret('a-long-random-production-stepup-secret', {
        authEnabled: true,
        nodeEnv: 'production'
      })
    ).not.toThrow();
  });
});

describe('verifyStepUpCookie', () => {
  const basePayload = { email: 'rahm@rmasters.group', stepUpId: 'step_1', authTime: NOW - 100 };

  function cookieFor(payload = basePayload, secret = SECRET) {
    return signStepUpCookie(payload, secret);
  }

  it('accepts a fresh, correctly-signed cookie matching the session email', () => {
    const result = verifyStepUpCookie(cookieFor(), {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.stepUpId).toBe('step_1');
      expect(result.ageSeconds).toBe(100);
    }
  });

  it('is case/whitespace-insensitive on the email match', () => {
    const result = verifyStepUpCookie(cookieFor(), {
      secret: SECRET,
      sessionEmail: '  RAHM@RMasters.group ',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing cookie', () => {
    const result = verifyStepUpCookie(undefined, {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects an expired cookie (auth_time beyond the window)', () => {
    const stale = { ...basePayload, authTime: NOW - 901 };
    const result = verifyStepUpCookie(cookieFor(stale), {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a cookie whose auth_time is in the future', () => {
    const future = { ...basePayload, authTime: NOW + 30 };
    const result = verifyStepUpCookie(cookieFor(future), {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a cookie belonging to a different session email', () => {
    const result = verifyStepUpCookie(cookieFor(), {
      secret: SECRET,
      sessionEmail: 'someone-else@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'email_mismatch' });
  });

  it('rejects a cookie signed with a different secret (e.g. the session COOKIE_SECRET)', () => {
    // The independent-proof property §7.1 relies on: a step-up "signed" with the wrong key must
    // fail identically to a forged one, never partially validate.
    const result = verifyStepUpCookie(cookieFor(basePayload, OTHER_SECRET), {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a tampered cookie value (signature no longer matches)', () => {
    const raw = cookieFor();
    const tampered = raw.replace(basePayload.stepUpId, 'step_2');
    const result = verifyStepUpCookie(tampered, {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a well-signed but structurally malformed payload', () => {
    const malformed = sign(JSON.stringify({ email: 'rahm@rmasters.group' }), SECRET);
    const result = verifyStepUpCookie(malformed, {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a well-signed but non-JSON value', () => {
    const notJson = sign('not-json-at-all', SECRET);
    const result = verifyStepUpCookie(notJson, {
      secret: SECRET,
      sessionEmail: 'rahm@rmasters.group',
      nowSeconds: NOW,
      maxAgeSeconds: 900
    });
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});
