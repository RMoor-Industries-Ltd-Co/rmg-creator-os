import { describe, it, expect } from 'vitest';
import { checkDeliveryApproval } from '../src/approval.js';

// Phase A — the publish path previously accepted "some completed render exists" as sufficient
// to publish to live social channels, never reading deliveryApprovals at all. These tests pin
// the fail-closed rule: only an explicit `approved` for the production's OWN brand passes.

describe('delivery approval gate (Phase A)', () => {
  it('passes when this production\'s brand is explicitly approved', () => {
    expect(checkDeliveryApproval('vlog', { vlog: 'approved' })).toEqual({ ok: true });
  });

  it('still passes when other brands are pending or rejected alongside an approval', () => {
    expect(checkDeliveryApproval('vlog', { vlog: 'approved', orr: 'rejected', com: 'pending' }))
      .toEqual({ ok: true });
  });

  it.each([
    ['pending', { vlog: 'pending' }],
    ['rejected', { vlog: 'rejected' }],
    ['an unrecognized value', { vlog: 'maybe' }],
    ['approval recorded for a DIFFERENT brand only', { orr: 'approved' }],
    ['an empty approval map', {}]
  ])('fails closed on %s', (_label, approvals) => {
    const res = checkDeliveryApproval('vlog', approvals as Record<string, string>);
    expect(res.ok).toBe(false);
  });

  it('fails closed when the approval map is null or undefined', () => {
    expect(checkDeliveryApproval('vlog', null).ok).toBe(false);
    expect(checkDeliveryApproval('vlog', undefined).ok).toBe(false);
  });

  it('fails closed when the production has no brand — approval cannot be verified', () => {
    expect(checkDeliveryApproval(null, { vlog: 'approved' }).ok).toBe(false);
    expect(checkDeliveryApproval('', { '': 'approved' }).ok).toBe(false);
    expect(checkDeliveryApproval('   ', { vlog: 'approved' }).ok).toBe(false);
  });

  it('is case- and whitespace-exact on the brand key, and does not coerce', () => {
    // No normalization is applied: the approval map is keyed by the same brand string the
    // approvals route writes, so a near-miss must NOT silently pass.
    expect(checkDeliveryApproval('VLOG', { vlog: 'approved' }).ok).toBe(false);
    expect(checkDeliveryApproval(' vlog', { vlog: 'approved' })).toEqual({ ok: true }); // trimmed
  });

  it('explains what to do — the reason names the brand, the state, and the fix', () => {
    const missing = checkDeliveryApproval('vlog', {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toContain('vlog');
      expect(missing.reason).toContain('no approval recorded');
      expect(missing.reason).toContain('PATCH /productions/:id/approvals');
    }
    const rejected = checkDeliveryApproval('vlog', { vlog: 'rejected' });
    if (!rejected.ok) {
      expect(rejected.reason).toContain('"rejected"');
      expect(rejected.reason).toContain('PATCH /productions/:id/approvals');
    }
  });

  it('a prototype-polluting brand name cannot smuggle an approval through', () => {
    // `{}` inherits `toString`/`constructor`; a lookup must not treat those as an approval.
    expect(checkDeliveryApproval('constructor', {}).ok).toBe(false);
    expect(checkDeliveryApproval('toString', {}).ok).toBe(false);
  });
});
