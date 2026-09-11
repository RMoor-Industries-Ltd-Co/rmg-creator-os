import { describe, it, expect } from 'vitest';
import { founderPrincipalCount, isFounder, parseFounderPrincipals, resolveFounderPrincipal } from '../src/founder.js';

// Founder-set authorization (docs/atelier/phase-b-governance-primitives-design.md §7.2, ratified
// decision 2) — the third, separate check from session + step-up: being allowlisted and fresh is
// not the same as being the founder. The property under test throughout: FOUNDER_PRINCIPALS is a
// MAPPING from an authenticated email to a canonical principal id, unset means EMPTY (refuse),
// and it is never confused with AUTH_ALLOWED_EMAILS.

describe('parseFounderPrincipals', () => {
  it('parses a single email=principalId pair', () => {
    const { map, malformed } = parseFounderPrincipals('rahm@rmasters.group=rahm@business');
    expect([...map.entries()]).toEqual([['rahm@rmasters.group', 'rahm@business']]);
    expect(malformed).toEqual([]);
  });

  it('parses multiple comma-separated pairs', () => {
    const { map } = parseFounderPrincipals('a@x.com=a@business,b@y.com=b@business');
    expect(map.get('a@x.com')).toBe('a@business');
    expect(map.get('b@y.com')).toBe('b@business');
    expect(map.size).toBe(2);
  });

  it('is unset or empty means an empty map — never "everyone"', () => {
    // §7.2: "unset means empty — no founder, refuse — never everyone."
    expect(parseFounderPrincipals(undefined).map.size).toBe(0);
    expect(parseFounderPrincipals('').map.size).toBe(0);
    expect(parseFounderPrincipals('   ').map.size).toBe(0);
    expect(parseFounderPrincipals(' , ,').map.size).toBe(0);
  });

  it('lowercases and trims the email key, but preserves the principal id as given', () => {
    const { map } = parseFounderPrincipals('  RAHM@RMasters.group  =  rahm@business  ');
    expect([...map.keys()]).toEqual(['rahm@rmasters.group']);
    expect(map.get('rahm@rmasters.group')).toBe('rahm@business');
  });

  it('flags entries with no "=" as malformed, and drops them from the map', () => {
    const { map, malformed } = parseFounderPrincipals('rahm@rmasters.group');
    expect(map.size).toBe(0);
    expect(malformed).toEqual(['rahm@rmasters.group']);
  });

  it('flags entries with an empty email or empty principal id as malformed', () => {
    const { map, malformed } = parseFounderPrincipals('=rahm@business,rahm@rmasters.group=');
    expect(map.size).toBe(0);
    expect(malformed).toEqual(['=rahm@business', 'rahm@rmasters.group=']);
  });

  it('a later duplicate email overrides an earlier one (converges on one owner per email)', () => {
    const { map } = parseFounderPrincipals('rahm@rmasters.group=old@business,rahm@rmasters.group=new@business');
    expect(map.get('rahm@rmasters.group')).toBe('new@business');
    expect(map.size).toBe(1);
  });

  it('a principal id may itself legitimately contain "=" only after the first one is consumed as the separator', () => {
    // Defensive: indexOf('=') takes the FIRST '=' as the separator, so a principal id value is
    // never truncated even if it happened to contain one.
    const { map } = parseFounderPrincipals('rahm@rmasters.group=rahm@business=extra');
    expect(map.get('rahm@rmasters.group')).toBe('rahm@business=extra');
  });

  // B1.3 follow-up verification: the exact value the founder configured in production Doppler
  // is a plain comma-separated list of email addresses — NOT `email=principalId` pairs. Against
  // the parser's documented contract (`email=principalId`, comma-separated), this produces an
  // EMPTY founder map and flags all three entries malformed — the opposite of what was intended.
  // This is not a defect in the parser (it is doing exactly what §7.2 and its own doc comment
  // say), it is a live configuration/contract mismatch surfaced by test rather than left to be
  // discovered at the write boundary later. See docs/atelier/b1-3-operational-activation.md §1.
  it('the currently-configured production value ("email,email,email", no "=") parses to ZERO founder principals', () => {
    const configuredValue =
      'rahm@rmasters.group,rmoorindustries@gmail.com,rahmind.consulting@rmoorind.com';
    const { map, malformed } = parseFounderPrincipals(configuredValue);
    expect(map.size).toBe(0);
    expect(malformed).toEqual([
      'rahm@rmasters.group',
      'rmoorindustries@gmail.com',
      'rahmind.consulting@rmoorind.com'
    ]);
  });

  it('the same three identities DO parse correctly once given as email=principalId pairs', () => {
    // Documents the fix shape without prescribing what the principal ids should actually be —
    // that is Rahm's call, not this test's. `email` is used as a placeholder principal id only
    // to prove the mechanics; a real value should follow Contract 36's principal-id convention.
    const fixed =
      'rahm@rmasters.group=rahm@business,rmoorindustries@gmail.com=rmoorindustries@business,rahmind.consulting@rmoorind.com=rahmind@business';
    const { map, malformed } = parseFounderPrincipals(fixed);
    expect(malformed).toEqual([]);
    expect(map.size).toBe(3);
    expect(map.get('rahm@rmasters.group')).toBe('rahm@business');
    expect(map.get('rmoorindustries@gmail.com')).toBe('rmoorindustries@business');
    expect(map.get('rahmind.consulting@rmoorind.com')).toBe('rahmind@business');
  });
});

describe('resolveFounderPrincipal', () => {
  const map = parseFounderPrincipals('rahm@rmasters.group=rahm@business').map;

  it('resolves a mapped email to its canonical principal id', () => {
    expect(resolveFounderPrincipal('rahm@rmasters.group', map)).toBe('rahm@business');
  });

  it('is case/whitespace-insensitive, matching isEmailAllowed', () => {
    expect(resolveFounderPrincipal('  RAHM@RMasters.group ', map)).toBe('rahm@business');
  });

  it('returns undefined for an email not in the founder set — allowlisted is not founder', () => {
    // The exact scenario §7.2 exists to prevent: an allowlisted, non-founder email must not
    // resolve to a principal just because AUTH_ALLOWED_EMAILS accepted it.
    expect(resolveFounderPrincipal('someone-else@rmasters.group', map)).toBeUndefined();
  });

  it('returns undefined for empty or undefined input', () => {
    expect(resolveFounderPrincipal('', map)).toBeUndefined();
    expect(resolveFounderPrincipal(undefined, map)).toBeUndefined();
  });

  it('returns undefined against an empty founder set for any input', () => {
    const empty = parseFounderPrincipals(undefined).map;
    expect(resolveFounderPrincipal('rahm@rmasters.group', empty)).toBeUndefined();
  });
});

describe('isFounder', () => {
  const map = parseFounderPrincipals('rahm@rmasters.group=rahm@business').map;

  it('is true for a mapped email, false otherwise', () => {
    expect(isFounder('rahm@rmasters.group', map)).toBe(true);
    expect(isFounder('someone-else@rmasters.group', map)).toBe(false);
  });

  it('is false against an empty founder set', () => {
    expect(isFounder('rahm@rmasters.group', parseFounderPrincipals(undefined).map)).toBe(false);
  });
});

describe('founderPrincipalCount', () => {
  // Regression test for the exact defect that shipped in B1.3: server.ts computed
  // `Object.keys(FOUNDER_PRINCIPALS).length` for the startup/readiness report — `Object.keys()`
  // on a Map ALWAYS returns [] regardless of how many entries it has, so `readiness.founder_approval`
  // reported `disabled_no_principals` in production even with a correctly-configured, correctly
  // -parsing FOUNDER_PRINCIPALS (verified live: readiness showed the bug while the map itself,
  // per this same parser, was non-empty). This test would have failed against the old
  // `Object.keys(map).length` expression and passes against `map.size`.

  it('counts a Map correctly, unlike Object.keys(map).length (which is always 0)', () => {
    const { map } = parseFounderPrincipals(
      'rahm@rmasters.group=rahm@business,rmoorindustries@gmail.com=rahm@business,rahmind.consulting@rmoorind.com=rahm@business'
    );
    // The defect, demonstrated directly: this is what server.ts used to compute.
    expect(Object.keys(map).length).toBe(0);
    // The fix: Map.prototype.size reports the actual entry count.
    expect(founderPrincipalCount(map)).toBe(3);
  });

  it('is 0 for an empty founder set', () => {
    expect(founderPrincipalCount(parseFounderPrincipals(undefined).map)).toBe(0);
  });

  it('counts one entry for a single mapping', () => {
    expect(founderPrincipalCount(parseFounderPrincipals('rahm@rmasters.group=rahm@business').map)).toBe(1);
  });
});
