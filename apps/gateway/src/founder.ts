// Founder-set authorization (docs/atelier/phase-b-governance-primitives-design.md §7.2, ratified
// decision 2). Step-up (stepup.ts) proves recent control of an allowlisted identity — it does NOT
// prove the founder role. `AUTH_ALLOWED_EMAILS` is explicitly a multi-value list the auth model
// supports adding people to, so membership there must never imply founder authority. This module
// is the third, separate check the approval write boundary will run once it exists (§13 step 6,
// currently blocked — see docs/atelier/b1-2-dependency-split.md): is the authenticated principal
// in the founder set at all. It ships ahead of that one blocked caller, the same shape stepup.ts
// (step 3) and digest.ts (step 2) did.
//
// **It is a mapping, not a set** (§7.2, second review round). Creator OS authenticates a Google
// email, while the ratified principal is domain-scoped (e.g. `rahm@business`). A set of
// principals cannot be membership-tested against an email, and a set of emails would record
// evidence under an id the fabric will never recognise — so the correlation breaks precisely when
// authorization moves upstream. `FOUNDER_PRINCIPALS` is therefore `email -> canonical principal
// id`; membership is "does this authenticated email map?", and the write path that consumes this
// must record the MAPPED id in evidence, never the raw email.

/** Parsing `FOUNDER_PRINCIPALS` may find entries that cannot be parsed — surfaced rather than
 *  silently dropped, so a config mistake shows up as a diagnostic instead of a silent gap in who
 *  can approve. */
export interface ParsedFounderPrincipals {
  /** Lowercased, trimmed email -> canonical principal id (trimmed, case preserved). */
  map: Map<string, string>;
  /** Raw entries that had no `=`, an empty email, or an empty principal id. */
  malformed: string[];
}

/**
 * Parses `FOUNDER_PRINCIPALS`: comma-separated `email=principalId` pairs, e.g.
 * `rahm@rmasters.group=rahm@business`. Unset or empty yields an empty map — §7.2: "unset means
 * empty — no founder, refuse — never everyone." A later duplicate email overrides an earlier one
 * (same last-wins shape as a config file), which is deliberate: parsing must always converge on a
 * single owner per email rather than picking arbitrarily.
 */
export function parseFounderPrincipals(raw: string | undefined): ParsedFounderPrincipals {
  const map = new Map<string, string>();
  const malformed: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0 || eq === entry.length - 1) {
      malformed.push(entry);
      continue;
    }
    const email = entry.slice(0, eq).trim().toLowerCase();
    const principalId = entry.slice(eq + 1).trim();
    if (!email || !principalId) {
      malformed.push(entry);
      continue;
    }
    map.set(email, principalId);
  }
  return { map, malformed };
}

/**
 * Resolves an authenticated session email to its founder principal id — "may you assert founder
 * authority?" (§7.2 check 3) — or `undefined` when the email is not in the founder set.
 * Case/whitespace-insensitive on the email, matching `isEmailAllowed`'s convention (auth.ts); an
 * empty/undefined email always resolves to `undefined` rather than matching an accidental empty
 * map key.
 */
export function resolveFounderPrincipal(
  email: string | undefined,
  founderPrincipals: Map<string, string>
): string | undefined {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return undefined;
  return founderPrincipals.get(e);
}

/** Convenience predicate over `resolveFounderPrincipal`, for a boundary that only needs yes/no —
 *  the write path itself must still call `resolveFounderPrincipal` to get the mapped id to record
 *  in evidence, never re-derive it from the raw email. */
export function isFounder(email: string | undefined, founderPrincipals: Map<string, string>): boolean {
  return resolveFounderPrincipal(email, founderPrincipals) !== undefined;
}

/**
 * How many principals are in the founder set — for reporting only (configReport.ts's
 * `founder_approval` capability status), never for authorization itself.
 *
 * Exists to put one correct call site between the map and anything that counts it.
 * `Object.keys(aMap)` always returns `[]` regardless of a Map's actual contents — `Object.keys`
 * enumerates an object's own enumerable string-keyed properties, and a `Map`'s entries are not
 * those; they live in the engine's internal slot. `founderPrincipals.size` is correct.
 *
 * This is exactly the bug B1.3 shipped: `server.ts` computed
 * `Object.keys(FOUNDER_PRINCIPALS).length` for the startup/readiness report, which is `0` for
 * ANY non-empty Map — so `readiness.founder_approval` reported `disabled_no_principals` even
 * with a correctly-configured, correctly-parsing `FOUNDER_PRINCIPALS` in production. The
 * authorization path itself (`resolveFounderPrincipal` / `isFounder`, both `.get()`-based) was
 * never affected — this was a reporting-only defect, not an authorization gap in either
 * direction. See docs/atelier/audits/incident-2026-09-11-founder-principal-count-object-keys.md.
 */
export function founderPrincipalCount(founderPrincipals: Map<string, string>): number {
  return founderPrincipals.size;
}
