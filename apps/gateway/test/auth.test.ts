import { describe, it, expect } from 'vitest';
import {
  parseAllowedEmails,
  isEmailAllowed,
  assertCookieSecret,
  isPublicRoute,
  DEV_COOKIE_SECRET
} from '../src/auth.js';

describe('parseAllowedEmails', () => {
  it('parses a comma-separated list, trimming and lowercasing', () => {
    const set = parseAllowedEmails('rahm@rmasters.group, RMOORindustries@gmail.com ');
    expect([...set].sort()).toEqual(['rahm@rmasters.group', 'rmoorindustries@gmail.com']);
  });

  it('merges the single-value fallback and de-duplicates', () => {
    const set = parseAllowedEmails('a@x.com,b@x.com', 'A@X.com');
    expect([...set].sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  it('accepts only the fallback when the list is undefined', () => {
    const set = parseAllowedEmails(undefined, 'solo@x.com');
    expect([...set]).toEqual(['solo@x.com']);
  });

  it('drops empty entries and returns an empty set when nothing is configured', () => {
    expect(parseAllowedEmails(' , ,')).toEqual(new Set());
    expect(parseAllowedEmails(undefined, undefined)).toEqual(new Set());
  });
});

describe('isEmailAllowed', () => {
  const allowed = parseAllowedEmails('rahm@rmasters.group,rmoorindustries@gmail.com');

  it('accepts allowlisted emails regardless of case/whitespace', () => {
    expect(isEmailAllowed('rahm@rmasters.group', allowed)).toBe(true);
    expect(isEmailAllowed('  RMOORindustries@GMAIL.com ', allowed)).toBe(true);
  });

  it('rejects non-allowlisted, empty, and undefined (missing/invalid session)', () => {
    expect(isEmailAllowed('someone@else.com', allowed)).toBe(false);
    expect(isEmailAllowed('', allowed)).toBe(false);
    expect(isEmailAllowed(undefined, allowed)).toBe(false);
  });

  it('rejects everything against an empty allowlist', () => {
    expect(isEmailAllowed('rahm@rmasters.group', new Set())).toBe(false);
  });
});

describe('assertCookieSecret (fail-closed in production)', () => {
  it('is a no-op when auth is disabled', () => {
    expect(() => assertCookieSecret(undefined, { authEnabled: false, nodeEnv: 'production' })).not.toThrow();
  });

  it('is a no-op outside production', () => {
    expect(() => assertCookieSecret(DEV_COOKIE_SECRET, { authEnabled: true, nodeEnv: 'development' })).not.toThrow();
    expect(() => assertCookieSecret(undefined, { authEnabled: true, nodeEnv: undefined })).not.toThrow();
  });

  it('throws in production when auth is on and the secret is missing or the dev default', () => {
    expect(() => assertCookieSecret(undefined, { authEnabled: true, nodeEnv: 'production' })).toThrow();
    expect(() => assertCookieSecret('', { authEnabled: true, nodeEnv: 'production' })).toThrow();
    expect(() => assertCookieSecret(DEV_COOKIE_SECRET, { authEnabled: true, nodeEnv: 'production' })).toThrow();
  });

  it('passes in production with a strong, non-default secret', () => {
    expect(() =>
      assertCookieSecret('a-long-random-production-secret', { authEnabled: true, nodeEnv: 'production' })
    ).not.toThrow();
  });
});

describe('isPublicRoute', () => {
  it('keeps health, the auth flow, and UUID media proxies public', () => {
    expect(isPublicRoute('GET', '/health')).toBe(true);
    expect(isPublicRoute('POST', '/auth/google')).toBe(true);
    expect(isPublicRoute('GET', '/auth/me')).toBe(true);
    expect(isPublicRoute('OPTIONS', '/anything')).toBe(true);
    expect(isPublicRoute('GET', '/assets/abc-123/raw')).toBe(true);
    expect(isPublicRoute('GET', '/videos/abc-123/raw?x=1')).toBe(true);
    expect(isPublicRoute('GET', '/assets/drive-thumb/xyz')).toBe(true);
  });

  it('guards everything else (protected routes stay protected)', () => {
    expect(isPublicRoute('GET', '/allen/brief')).toBe(false);
    expect(isPublicRoute('GET', '/productions')).toBe(false);
    expect(isPublicRoute('POST', '/productions/1/generate')).toBe(false);
    // not the exact public shapes:
    expect(isPublicRoute('GET', '/assets/abc/raw/extra')).toBe(false);
    expect(isPublicRoute('GET', '/healthz')).toBe(false);
  });
});
