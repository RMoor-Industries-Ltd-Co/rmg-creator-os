import { describe, it, expect } from 'vitest';
import { checkWorkerSecret, isWorkerRoute, WORKER_AUTH_REQUIRED_CODE } from '../src/workerAuth.js';
import { isPublicRoute } from '../src/auth.js';

// Phase A.1 §2 — machine authentication for the worker execution lane.
//
// The defect these tests pin down: the previous check was
//   if (WORKER_SECRET && secret !== WORKER_SECRET) return 401
// and WORKER_SECRET was set nowhere in infra/ or .github/. An unset secret therefore made the
// check a no-op — fail-OPEN on the routes that claim work and trigger paid renders.

describe('checkWorkerSecret — fails closed', () => {
  it('refuses when no secret is configured (the fail-open defect)', () => {
    const r = checkWorkerSecret('anything', undefined);
    expect(r.authorized).toBe(false);
    expect(r.authorized === false && r.reason).toBe('not_configured');
  });

  it('refuses when the configured secret is empty', () => {
    expect(checkWorkerSecret('anything', '').authorized).toBe(false);
  });

  it('refuses when the configured secret is only whitespace', () => {
    const r = checkWorkerSecret('   ', '   ');
    expect(r.authorized).toBe(false);
    expect(r.authorized === false && r.reason).toBe('not_configured');
  });

  it('refuses a request with no header even when configured', () => {
    const r = checkWorkerSecret(undefined, 's3cret');
    expect(r.authorized).toBe(false);
    expect(r.authorized === false && r.reason).toBe('missing');
  });

  it('refuses an empty header', () => {
    expect(checkWorkerSecret('', 's3cret').authorized).toBe(false);
  });

  it('refuses a wrong secret', () => {
    const r = checkWorkerSecret('wrong', 's3cret');
    expect(r.authorized).toBe(false);
    expect(r.authorized === false && r.reason).toBe('mismatch');
  });

  it('refuses a secret of a different length without throwing', () => {
    // timingSafeEqual throws on unequal buffer lengths if called naively.
    expect(() => checkWorkerSecret('a', 'aaaaaaaaaaaaaaaaaaaa')).not.toThrow();
    expect(checkWorkerSecret('a', 'aaaaaaaaaaaaaaaaaaaa').authorized).toBe(false);
  });

  it('refuses a prefix of the real secret', () => {
    expect(checkWorkerSecret('s3cr', 's3cret').authorized).toBe(false);
  });

  it('accepts the exact secret', () => {
    expect(checkWorkerSecret('s3cret', 's3cret').authorized).toBe(true);
  });

  it('accepts around surrounding whitespace (header transport artifacts)', () => {
    expect(checkWorkerSecret('  s3cret  ', 's3cret\n').authorized).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(checkWorkerSecret('S3CRET', 's3cret').authorized).toBe(false);
  });

  it('exposes a distinct discriminator from the session 401', () => {
    expect(WORKER_AUTH_REQUIRED_CODE).toBe('worker_auth_required');
  });
});

describe('isWorkerRoute', () => {
  it('matches the two worker routes', () => {
    expect(isWorkerRoute('POST', '/worker/tick')).toBe(true);
    expect(isWorkerRoute('POST', '/worker/recover')).toBe(true);
  });

  it('ignores query strings and a trailing slash', () => {
    expect(isWorkerRoute('POST', '/worker/tick?x=1')).toBe(true);
    expect(isWorkerRoute('POST', '/worker/recover/')).toBe(true);
  });

  it('does not match anything else', () => {
    for (const p of ['/worker', '/worker/tick/extra', '/queue', '/productions', '/workers/tick', '/']) {
      expect(isWorkerRoute('POST', p)).toBe(false);
    }
  });

  it('does not match OPTIONS (preflight is handled by isPublicRoute)', () => {
    expect(isWorkerRoute('OPTIONS', '/worker/tick')).toBe(false);
  });
});

describe('worker routes are machine-authenticated, not public', () => {
  it('isPublicRoute still refuses the worker routes', () => {
    // Skipping the session guard must never be implemented by widening isPublicRoute —
    // that would leave the routes with no credential at all.
    expect(isPublicRoute('POST', '/worker/tick')).toBe(false);
    expect(isPublicRoute('POST', '/worker/recover')).toBe(false);
  });
});
