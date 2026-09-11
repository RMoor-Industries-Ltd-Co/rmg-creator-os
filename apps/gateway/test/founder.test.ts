import { describe, it, expect } from 'vitest';
import { isFounder, parseFounderPrincipals, resolveFounderPrincipal } from '../src/founder.js';

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
