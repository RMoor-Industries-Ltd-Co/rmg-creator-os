import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSessionExpired,
  setUnauthorizedHandler,
  notifyUnauthorized,
  SESSION_EXPIRED_MESSAGE
} from '../src/authClient';

afterEach(() => setUnauthorizedHandler(null));

describe('isSessionExpired', () => {
  it('is true for a 401 tagged session_required', () => {
    expect(isSessionExpired(401, { error: 'unauthorized', code: 'session_required' })).toBe(true);
  });

  it('is true for a legacy 401 with only error: unauthorized', () => {
    expect(isSessionExpired(401, { error: 'unauthorized' })).toBe(true);
  });

  it('is false for other 401s, and for non-401 statuses', () => {
    expect(isSessionExpired(401, { error: 'something else' })).toBe(false);
    expect(isSessionExpired(403, { error: 'not authorized', code: 'not_allowlisted' })).toBe(false);
    expect(isSessionExpired(200, {})).toBe(false);
    expect(isSessionExpired(500, { error: 'boom' })).toBe(false);
  });
});

describe('unauthorized handler', () => {
  it('invokes the registered handler on notify', () => {
    const fn = vi.fn();
    setUnauthorizedHandler(fn);
    notifyUnauthorized();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('no-ops after the handler is cleared', () => {
    const fn = vi.fn();
    setUnauthorizedHandler(fn);
    setUnauthorizedHandler(null);
    notifyUnauthorized();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('SESSION_EXPIRED_MESSAGE', () => {
  it('is a human-friendly string, not a raw error code', () => {
    expect(SESSION_EXPIRED_MESSAGE).toMatch(/sign in/i);
    expect(SESSION_EXPIRED_MESSAGE).not.toMatch(/unauthorized/i);
  });
});
