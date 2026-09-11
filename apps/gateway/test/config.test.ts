import { describe, it, expect } from 'vitest';
import { CONFIG_VARS, type ConfigVarSpec } from '../src/config.js';

// B1.3 §1/§8 — the classification table itself. This is the audit expressed as data (see
// config.ts's module comment) so a future edit that quietly reclassifies a variable — e.g.
// loosening COOKIE_SECRET's tier — fails a test instead of only drifting a document.

const MINIMUM_REQUIRED_NAMES = [
  'AUTH_ENABLED',
  'COOKIE_SECRET',
  'STEP_UP_COOKIE_SECRET',
  'STEP_UP_MAX_AGE_SECONDS',
  'FOUNDER_PRINCIPALS',
  'WORKER_SECRET',
  'WORKER_TICK_ENABLED',
  'POSTIZ_API_KEY',
  'HEYGEN_API_KEY',
  'GDRIVE_CLIENT_ID'
];

function findVar(name: string): ConfigVarSpec {
  const spec = CONFIG_VARS.find((v) => v.name === name);
  if (!spec) throw new Error(`CONFIG_VARS is missing an entry for ${name}`);
  return spec;
}

describe('CONFIG_VARS classification table', () => {
  it('covers every variable the B1.3 directive named as a minimum', () => {
    for (const name of MINIMUM_REQUIRED_NAMES) {
      expect(() => findVar(name)).not.toThrow();
    }
  });

  it('every entry has a non-empty note explaining its classification', () => {
    for (const spec of CONFIG_VARS) {
      expect(spec.note.length).toBeGreaterThan(0);
    }
  });

  it('no entry\'s name or note contains a value that looks like a real secret', () => {
    // This table documents variable NAMES and reasoning only — never a value. A long
    // high-entropy substring here would mean a real secret leaked into source.
    for (const spec of CONFIG_VARS) {
      expect(`${spec.name} ${spec.note}`).not.toMatch(/[A-Za-z0-9+/]{32,}/);
    }
  });

  it('COOKIE_SECRET stays required_to_start — session auth is load-bearing across the API', () => {
    // The one deliberate exception to "a missing credential must never crash the gateway": the
    // directive itself carves this out ("do not weaken authentication to achieve availability").
    // A regression here would silently reintroduce the option to run production auth on a
    // forgeable default secret in exchange for uptime.
    expect(findVar('COOKIE_SECRET').tier).toBe('required_to_start');
  });

  it('STEP_UP_COOKIE_SECRET is feature_required, not required_to_start — the #65-#71 fix', () => {
    // This is the exact classification the incident got wrong. Reverting it would reintroduce
    // the outage this table exists to prevent.
    expect(findVar('STEP_UP_COOKIE_SECRET').tier).toBe('feature_required');
  });

  it('DATABASE_URL is required_to_start — there is no gateway without a database', () => {
    expect(findVar('DATABASE_URL').tier).toBe('required_to_start');
  });

  it('every feature_required or optional entry names the capability it gates', () => {
    for (const spec of CONFIG_VARS) {
      if (spec.tier !== 'required_to_start') {
        expect(spec.capability).toBeTruthy();
      }
    }
  });

  it('has no duplicate variable names', () => {
    const names = CONFIG_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
