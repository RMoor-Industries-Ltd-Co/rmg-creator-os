import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSessionExpired,
  isStepUpRequired,
  setUnauthorizedHandler,
  notifyUnauthorized,
  requestStepUp,
  setStepUpRequiredHandler,
  SESSION_EXPIRED_MESSAGE
} from '../src/authClient';

afterEach(() => {
  setUnauthorizedHandler(null);
  setStepUpRequiredHandler(null);
});

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

describe('isStepUpRequired', () => {
  it('is true for a 401 tagged step_up_required', () => {
    expect(isStepUpRequired(401, { code: 'step_up_required' })).toBe(true);
  });

  it('is false for a plain session-expired 401 — the two must route differently', () => {
    // isSessionExpired routes the whole app to sign-in; isStepUpRequired must NOT also fire for
    // that case, or a session 401 would (incorrectly) also try to open the step-up modal.
    expect(isStepUpRequired(401, { error: 'unauthorized', code: 'session_required' })).toBe(false);
  });

  it('is false for other 401s, and for non-401 statuses', () => {
    expect(isStepUpRequired(401, { error: 'something else' })).toBe(false);
    expect(isStepUpRequired(403, { code: 'step_up_required' })).toBe(false);
    expect(isStepUpRequired(200, {})).toBe(false);
  });
});

describe('requestStepUp / setStepUpRequiredHandler', () => {
  it('rejects when no prompt is registered, rather than hanging forever', async () => {
    await expect(requestStepUp()).rejects.toThrow(/no re-authentication prompt/i);
  });

  it('resolves once the registered handler resolves', async () => {
    setStepUpRequiredHandler(() => Promise.resolve());
    await expect(requestStepUp()).resolves.toBeUndefined();
  });

  it('propagates rejection (e.g. the user cancelling the prompt)', async () => {
    setStepUpRequiredHandler(() => Promise.reject(new Error('cancelled')));
    await expect(requestStepUp()).rejects.toThrow('cancelled');
  });

  it('no-ops back to rejecting after the handler is cleared', async () => {
    setStepUpRequiredHandler(() => Promise.resolve());
    setStepUpRequiredHandler(null);
    await expect(requestStepUp()).rejects.toThrow(/no re-authentication prompt/i);
  });
});

describe('SESSION_EXPIRED_MESSAGE', () => {
  it('is a human-friendly string, not a raw error code', () => {
    expect(SESSION_EXPIRED_MESSAGE).toMatch(/sign in/i);
    expect(SESSION_EXPIRED_MESSAGE).not.toMatch(/unauthorized/i);
  });
});
