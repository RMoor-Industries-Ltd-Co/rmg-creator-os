// Delivery-approval gate for publication (Phase A).
//
// Pure and dependency-free so the boundary logic is fully unit-testable, matching the house
// pattern set by `auth.ts`. `server.ts` wires it into POST /productions/:id/publish.
//
// The rule it encodes: a completed render is NOT an approval. `productions.deliveryApprovals`
// is the per-brand My Poster gate (`{ [brand]: 'pending' | 'approved' | 'rejected' }`), set
// via PATCH /productions/:id/approvals. Publication requires that this production's own brand
// is explicitly `approved`. Anything else — absent map, missing brand, pending, rejected, or
// an unrecognized value — fails closed.

export const DELIVERY_NOT_APPROVED_CODE = 'delivery_not_approved';

export type ApprovalCheck = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether a production may publish.
 *
 * @param brand     the production's brand (`productions.brand`)
 * @param approvals the stored per-brand approval map, or null/undefined
 */
export function checkDeliveryApproval(
  brand: string | null | undefined,
  approvals: Record<string, string> | null | undefined
): ApprovalCheck {
  const b = (brand ?? '').trim();
  if (!b) {
    return { ok: false, reason: 'production has no brand, so delivery approval cannot be verified' };
  }

  const map = approvals ?? {};
  const state = map[b];

  if (state === 'approved') return { ok: true };

  if (state === undefined) {
    return {
      ok: false,
      reason: `delivery not approved for brand "${b}" — no approval recorded. Approve it with PATCH /productions/:id/approvals before publishing.`
    };
  }
  return {
    ok: false,
    reason: `delivery not approved for brand "${b}" — current state is "${state}". Approve it with PATCH /productions/:id/approvals before publishing.`
  };
}
