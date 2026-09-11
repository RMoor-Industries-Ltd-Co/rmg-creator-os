import { describe, it, expect } from 'vitest';
import { buildConfigReport, type ConfigReportInput } from '../src/configReport.js';

// B1.3 §2/§8 — the startup configuration report. Every assertion here is checking a status
// WORD, never a value, and the fixture below never contains anything that looks like a secret —
// that is itself part of what this module guarantees.

const BASE: ConfigReportInput = {
  authEnabled: true,
  stepUpConfigured: true,
  founderPrincipalCount: 1,
  workerSecretConfigured: true,
  workerTickEnabled: true,
  postizConfigured: true,
  heygenConfigured: true,
  driveConfigured: true,
  higgsfieldConfigured: true,
  redisConfigured: true
};

describe('buildConfigReport', () => {
  it('reports every capability enabled/configured when every input is present', () => {
    const report = buildConfigReport(BASE);
    expect(report).toEqual({
      session_auth: 'enabled',
      step_up: 'enabled',
      founder_approval: 'enabled',
      worker_auth: 'enabled',
      worker_dispatch: 'enabled',
      postiz: 'configured',
      heygen: 'configured',
      drive: 'configured',
      higgsfield: 'configured',
      redis: 'configured'
    });
  });

  it('step_up is disabled_missing_secret when the secret is absent but auth is on — the #65-#71 case', () => {
    const report = buildConfigReport({ ...BASE, stepUpConfigured: false });
    expect(report.step_up).toBe('disabled_missing_secret');
  });

  it('step_up is disabled_by_flag (not disabled_missing_secret) when auth itself is off', () => {
    // Step-up presupposes session auth to step up FROM — with auth off, a missing secret is
    // moot, not a misconfiguration to flag as such.
    const report = buildConfigReport({ ...BASE, authEnabled: false, stepUpConfigured: false });
    expect(report.step_up).toBe('disabled_by_flag');
    expect(report.session_auth).toBe('disabled_by_flag');
  });

  it('founder_approval is disabled_no_principals when FOUNDER_PRINCIPALS parses to zero entries', () => {
    const report = buildConfigReport({ ...BASE, founderPrincipalCount: 0 });
    expect(report.founder_approval).toBe('disabled_no_principals');
  });

  it('worker_auth is disabled_missing_secret when WORKER_SECRET is unset', () => {
    const report = buildConfigReport({ ...BASE, workerSecretConfigured: false });
    expect(report.worker_auth).toBe('disabled_missing_secret');
  });

  it('worker_dispatch is disabled_by_flag when WORKER_TICK_ENABLED is not exactly "true"', () => {
    const report = buildConfigReport({ ...BASE, workerTickEnabled: false });
    expect(report.worker_dispatch).toBe('disabled_by_flag');
  });

  it('optional integrations report unconfigured, never a failure word, when unset', () => {
    const report = buildConfigReport({
      ...BASE,
      postizConfigured: false,
      heygenConfigured: false,
      driveConfigured: false,
      higgsfieldConfigured: false,
      redisConfigured: false
    });
    expect(report.postiz).toBe('unconfigured');
    expect(report.heygen).toBe('unconfigured');
    expect(report.drive).toBe('unconfigured');
    expect(report.higgsfield).toBe('unconfigured');
    expect(report.redis).toBe('unconfigured');
  });

  it('never returns a status value outside the documented CapabilityStatus vocabulary', () => {
    const allowed = new Set([
      'enabled',
      'configured',
      'unconfigured',
      'disabled_by_flag',
      'disabled_missing_secret',
      'disabled_no_principals'
    ]);
    const report = buildConfigReport(BASE);
    for (const value of Object.values(report)) {
      expect(allowed.has(value)).toBe(true);
    }
  });

  it('the report object never contains anything that looks like a secret value', () => {
    // A mutation-style guard: every value must come from the fixed vocabulary above, not be
    // echoed from an arbitrary input string — buildConfigReport has no string-passthrough path.
    const report = buildConfigReport(BASE);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{20,}/); // no secret-shaped token substrings
  });
});
