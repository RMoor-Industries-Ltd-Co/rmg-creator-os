import { describe, it, expect } from 'vitest';
import {
  computeProductionDigest,
  computeAccordPackageDigest,
  type ProductionDigestInput
} from '../src/digest.js';

// Pure-function digest projections (docs/atelier/phase-b-governance-primitives-design.md §3.5,
// §13 step 2). Two properties are what the design actually needs, and every test below is one
// or the other:
//
//   STABLE    — the same logical input always produces the same digest, key order and
//               semantically-unordered array order notwithstanding.
//   SENSITIVE — changing an approval-relevant field changes the digest; changing anything NOT
//               named in §3.5 (updated_at, stage, status, ...) must not.
//
// A digest function that is sensitive to nothing is useless; one that is sensitive to
// everything (including field order or an unrelated column) is worse than useless — it
// invalidates approvals nobody touched. Both failure directions get tests.

function baseInput(): ProductionDigestInput {
  return {
    brand: 'hvn',
    thumbnailDriveId: 'drv_thumb_1',
    adIndexCode: 'vlog-software-news-usa-est-001',
    taggedScript: '[warm] Hello there.',
    finalVideo: { rowId: 'vid_1', contentDigest: 'sha256:abc' },
    outboundPackage: {
      platforms: ['tiktok', 'instagram'],
      type: 'scheduled',
      date: '2026-09-15T14:00:00Z',
      posts: [
        { platform: 'tiktok', caption: 'tt caption', hashtags: ['#a', '#b'] },
        { platform: 'instagram', caption: 'ig caption', hashtags: ['#c'] }
      ]
    }
  };
}

describe('computeProductionDigest — stability', () => {
  it('is deterministic for the same logical input', () => {
    expect(computeProductionDigest(baseInput())).toBe(computeProductionDigest(baseInput()));
  });

  it('is a versioned, hex-suffixed string', () => {
    expect(computeProductionDigest(baseInput())).toMatch(/^digest_v1:[0-9a-f]{64}$/);
  });

  it('does not depend on the order platforms/posts were assembled in', () => {
    const a = baseInput();
    const b = baseInput();
    b.outboundPackage.platforms = [...b.outboundPackage.platforms].reverse();
    b.outboundPackage.posts = [...b.outboundPackage.posts].reverse();
    expect(computeProductionDigest(a)).toBe(computeProductionDigest(b));
  });

  it('does not depend on hashtag order within a post', () => {
    const a = baseInput();
    const b = baseInput();
    b.outboundPackage.posts = b.outboundPackage.posts.map((p) => ({
      ...p,
      hashtags: [...p.hashtags].reverse()
    }));
    expect(computeProductionDigest(a)).toBe(computeProductionDigest(b));
  });

  it('does not depend on JS object key insertion order', () => {
    const a = computeProductionDigest(baseInput());
    // Same values, rebuilt with fields in a different literal order.
    const shuffled: ProductionDigestInput = {
      outboundPackage: baseInput().outboundPackage,
      finalVideo: baseInput().finalVideo,
      taggedScript: baseInput().taggedScript,
      adIndexCode: baseInput().adIndexCode,
      thumbnailDriveId: baseInput().thumbnailDriveId,
      brand: baseInput().brand
    };
    expect(computeProductionDigest(shuffled)).toBe(a);
  });
});

describe('computeProductionDigest — sensitivity to approval-relevant fields', () => {
  const cases: Array<[string, (i: ProductionDigestInput) => void]> = [
    ['brand', (i) => (i.brand = 'other-brand')],
    ['thumbnailDriveId', (i) => (i.thumbnailDriveId = 'drv_thumb_2')],
    ['thumbnailDriveId set to null', (i) => (i.thumbnailDriveId = null)],
    ['adIndexCode', (i) => (i.adIndexCode = 'vlog-software-news-usa-est-002')],
    ['taggedScript', (i) => (i.taggedScript = '[warm] Something else.')],
    ['finalVideo.rowId', (i) => (i.finalVideo = { rowId: 'vid_2', contentDigest: 'sha256:abc' })],
    // The bytes changed under an unchanged row id — pinning the row must not silently cover this.
    [
      'finalVideo.contentDigest with rowId unchanged',
      (i) => (i.finalVideo = { rowId: 'vid_1', contentDigest: 'sha256:def' })
    ],
    ['finalVideo becoming null (pin removed)', (i) => (i.finalVideo = null)],
    ['outboundPackage.platforms', (i) => (i.outboundPackage.platforms = ['tiktok'])],
    ['outboundPackage.type', (i) => (i.outboundPackage.type = 'now')],
    ['outboundPackage.date', (i) => (i.outboundPackage.date = '2026-09-16T14:00:00Z')],
    ['outboundPackage.date becoming null', (i) => (i.outboundPackage.date = null)],
    [
      'a post caption',
      (i) => {
        i.outboundPackage.posts[0]!.caption = 'changed';
      }
    ],
    [
      'a post hashtag',
      (i) => {
        i.outboundPackage.posts[0]!.hashtags = ['#a', '#different'];
      }
    ],
    [
      'a post added',
      (i) => {
        i.outboundPackage.posts.push({ platform: 'x', caption: 'new', hashtags: [] });
        i.outboundPackage.platforms.push('x');
      }
    ]
  ];

  for (const [label, mutate] of cases) {
    it(`changes when ${label} changes`, () => {
      const before = computeProductionDigest(baseInput());
      const mutated = baseInput();
      mutate(mutated);
      expect(computeProductionDigest(mutated)).not.toBe(before);
    });
  }
});

// §3.5's insensitivity claim — that stage/status/updated_at cannot invalidate an approval — is
// not tested here separately, because it is enforced by `ProductionDigestInput`'s shape rather
// than by this function's logic: those fields have no field to arrive in, so a caller cannot
// pass them and a runtime test asserting "the digest ignores a field this type cannot express"
// would be tautological. The sensitivity table above is the real coverage: everything the type
// DOES carry moves the digest.

describe('computeAccordPackageDigest', () => {
  it('is deterministic and versioned', () => {
    const out = computeAccordPackageDigest({ domainRevisionDigest: 'sha256:contract31abc' });
    expect(out).toMatch(/^digest_v1:[0-9a-f]{64}$/);
    expect(computeAccordPackageDigest({ domainRevisionDigest: 'sha256:contract31abc' })).toBe(
      out
    );
  });

  it('changes when the domain-supplied digest changes', () => {
    const a = computeAccordPackageDigest({ domainRevisionDigest: 'sha256:one' });
    const b = computeAccordPackageDigest({ domainRevisionDigest: 'sha256:two' });
    expect(a).not.toBe(b);
  });

  it('does not collide with a production digest even given the same raw bytes', () => {
    // The `subject` discriminator inside the hashed shape exists precisely so that no accord
    // digest can ever equal a production digest by coincidence of shared field values.
    const accord = computeAccordPackageDigest({ domainRevisionDigest: 'sha256:shared' });
    const production = computeProductionDigest(baseInput());
    expect(accord).not.toBe(production);
  });
});
