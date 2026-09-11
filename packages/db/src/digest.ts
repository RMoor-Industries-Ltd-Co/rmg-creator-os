// Digest projections — Phase B governance (docs/atelier/phase-b-governance-primitives-design.md
// §3.5, §13 step 2). Pure functions only: no DB access, no I/O. The write path that will
// consume these (§13 step 6, `PATCH /productions/:id/approvals`) is blocked on the A-Roll
// design's pin (docs/atelier/b1-2-dependency-split.md, §13.6) and is not implemented here.
//
// A digest is computed over the **approval-relevant projection** of a subject, never the whole
// row — otherwise an unrelated column (`updated_at`, a UI-only field) would invalidate a live
// approval. What counts as approval-relevant is exactly what §3.5 specifies per subject type,
// and it is versioned (`digest_v1:`) so a later change to that set is visible rather than
// silently re-validating evidence computed under a different definition.
//
// Two properties every projection here must hold, both covered by test:
//   1. STABLE — the same logical input always produces the same digest, regardless of key
//      insertion order or the order of a semantically unordered collection (e.g. per-platform
//      captions). `canonicalize()` sorts object keys; callers sort any array whose order carries
//      no meaning before it reaches these functions.
//   2. SENSITIVE — changing any field this projection declares approval-relevant changes the
//      digest. A field that is NOT listed here (anything not named in §3.5) must be free to
//      change without invalidating an approval — that is the entire point of projecting rather
//      than hashing the row.

import { createHash } from 'node:crypto';

/** Version prefix on every digest this module produces. Bump the function version (never this
 *  string in place) when the approval-relevant field set changes, so an old evidence row's
 *  digest visibly stops matching a newly computed one instead of coincidentally re-validating. */
const DIGEST_VERSION = 'digest_v1';

/**
 * Deterministic JSON serialization: object keys sorted recursively; arrays serialized in the
 * order given (array order is caller-controlled and meaningful once it reaches here — see the
 * per-projection sorting below). `undefined` is normalized to `null` rather than dropped, so a
 * field that is explicitly absent cannot silently collapse into "key not present" — the two are
 * indistinguishable to `JSON.stringify` (it omits `undefined`-valued keys entirely), which would
 * otherwise make an object with an unset field and one missing the field hash identically by
 * accident rather than by the caller's explicit choice. Every field in the input types below is
 * therefore required, not optional, and non-applicable fields are passed as `null`.
 */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [k, canonicalize(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

function digest(shape: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(shape));
  const hex = createHash('sha256').update(canonicalJson).digest('hex');
  return `${DIGEST_VERSION}:${hex}`;
}

/** One platform's outbound post, as it will be sent — not as it currently reads in `posts`.
 *  §3.5: "the digest covers a canonical snapshot of the whole outbound package, and publish
 *  sends the snapshot rather than re-reading mutable rows and trusting the request." This type
 *  IS that snapshot's shape; capturing it into `approval_evidence.approved_package` is §13
 *  step 6's job, not this module's. */
export interface OutboundPost {
  platform: string;
  caption: string | null;
  hashtags: string[];
}

/** The complete outbound package as of the moment of approval. `platforms`/`type`/`date` do not
 *  exist as production-scoped data today (§3.5: "not properties of the production at all") —
 *  they arrive with the approval action once §13 step 6 lands. Order in `posts` and `platforms`
 *  does not matter to the caller and must not matter to the digest, so this module sorts both
 *  before hashing; changing a caption, a hashtag, the platform set, the publish type, or the
 *  date changes the digest, and reordering either array alone does not. */
export interface OutboundPackage {
  platforms: string[];
  type: string;
  /** ISO 8601, or `null` for "publish now" (no scheduled date is itself approval-relevant: an
   *  approval for "now" is not an approval for some later, reconsidered date). */
  date: string | null;
  posts: OutboundPost[];
}

/** The pinned render, resolved through `productions.final_video_row_id` (§3.6(b)) — never
 *  `finalVideoId`, and never re-derived by `updatedAt` (§3.5's confirmed defect). `null` until a
 *  pin exists; nothing currently populates one (`final_video_row_id` ships unpopulated, and
 *  populating it is A-Roll §4.8 / dependency-split §13.7, both blocked). Kept nullable here
 *  rather than required so this projection can represent that real, current state instead of
 *  being unusable until the A-Roll pin ships — the write path that will call it is what is
 *  blocked, not this function's ability to express "no pin yet". */
export interface PinnedVideo {
  /** `videos.id` — the row, not the Drive file. */
  rowId: string;
  /** A content checksum for the pinned asset's bytes at pin time (§3.5: "the approval projection
   *  therefore carries a content checksum or immutable object version for the pinned asset"),
   *  distinct from `rowId` because pinning the row does not pin the bytes — the same row's
   *  underlying Drive file can be replaced. Changing this without changing `rowId` must change
   *  the digest just as surely as changing `rowId` does. */
  contentDigest: string;
}

export interface ProductionDigestInput {
  brand: string;
  thumbnailDriveId: string | null;
  adIndexCode: string | null;
  taggedScript: string | null;
  finalVideo: PinnedVideo | null;
  outboundPackage: OutboundPackage;
}

/** §3.5's `production` projection. Every field named there and nothing else — in particular NOT
 *  `updated_at`, `stage`, `status`, or any field not listed in §3.5, all of which must remain
 *  free to change post-approval without invalidating the approval. */
export function computeProductionDigest(input: ProductionDigestInput): string {
  const posts = [...input.outboundPackage.posts]
    .map((p) => ({ platform: p.platform, caption: p.caption, hashtags: [...p.hashtags].sort() }))
    .sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0));
  const platforms = [...input.outboundPackage.platforms].sort();

  return digest({
    subject: 'production',
    brand: input.brand,
    thumbnailDriveId: input.thumbnailDriveId,
    adIndexCode: input.adIndexCode,
    taggedScript: input.taggedScript,
    finalVideo: input.finalVideo
      ? { rowId: input.finalVideo.rowId, contentDigest: input.finalVideo.contentDigest }
      : null,
    outboundPackage: {
      platforms,
      type: input.outboundPackage.type,
      date: input.outboundPackage.date,
      posts
    }
  });
}

export interface AccordPackageDigestInput {
  /** Contract 31's content-addressed package-manifest digest, as supplied by the Accord domain.
   *  §3.5: "Creator OS should *carry* that digest, not compute a second one" — this projection
   *  is deliberately thin, wrapping the domain's own digest into this module's versioned
   *  envelope rather than re-hashing content Creator OS does not own. */
  domainRevisionDigest: string;
}

/** §3.5's `accord_package` projection. */
export function computeAccordPackageDigest(input: AccordPackageDigestInput): string {
  return digest({ subject: 'accord_package', domainRevisionDigest: input.domainRevisionDigest });
}
