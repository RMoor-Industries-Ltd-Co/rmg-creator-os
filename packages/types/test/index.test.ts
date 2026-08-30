import { describe, it, expect } from 'vitest';
import {
  BRANDS,
  BRAND_KEYS,
  CONTENT_BRANDS,
  STORE_KEYS,
  BUSY_MF_PROMOTES,
  SERVICE_IDS
} from '../src/index.js';

// Invariant/regression guards for the derived brand & service constants.
// These are pure, exported constants — no runtime behavior is exercised, only that
// the derivations stay internally consistent as BRANDS is edited.

describe('brand model derivations', () => {
  it('BRAND_KEYS mirrors BRANDS one-to-one and is unique', () => {
    expect(BRAND_KEYS).toHaveLength(BRANDS.length);
    expect(new Set(BRAND_KEYS).size).toBe(BRAND_KEYS.length);
    expect(BRAND_KEYS).toEqual(BRANDS.map((b) => b.key));
  });

  it('every brand code and name is non-empty and codes are unique', () => {
    for (const b of BRANDS) {
      expect(b.code.length).toBeGreaterThan(0);
      expect(b.name.length).toBeGreaterThan(0);
    }
    const codes = BRANDS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('CONTENT_BRANDS is exactly the brands with a content folder', () => {
    const expected = BRANDS.filter((b) => b.contentFolder).map((b) => b.key);
    expect(CONTENT_BRANDS).toEqual(expected);
    // rmg is the master brand (newsletter/books only) — never a content brand.
    expect(CONTENT_BRANDS).not.toContain('rmg');
    for (const key of CONTENT_BRANDS) {
      expect(BRANDS.find((b) => b.key === key)?.contentFolder).toBe(true);
    }
  });

  it("STORE_KEYS includes 'hvn', which is a store but NOT a content BrandKey", () => {
    expect(STORE_KEYS).toContain('hvn');
    expect(BRAND_KEYS as string[]).not.toContain('hvn');
  });

  it('BUSY_MF_PROMOTES is a subset of STORE_KEYS', () => {
    for (const s of BUSY_MF_PROMOTES) {
      expect(STORE_KEYS).toContain(s);
    }
  });
});

describe('service ids', () => {
  it('SERVICE_IDS is unique', () => {
    expect(new Set(SERVICE_IDS).size).toBe(SERVICE_IDS.length);
  });
});
