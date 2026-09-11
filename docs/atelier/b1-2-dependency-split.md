# B1.2 — what can proceed, and what waits on the A-Roll design

**Purpose.** B1.1 (`deae6a6`) landed the governance primitives. The A-Roll candidate/canonical
pipeline is now its own design track (`aroll-candidate-canonical-design.md`), not yet approved.
This document draws the line between B1.2 work that is independent of that track and work that
is not, so implementation can continue without quietly pre-deciding A-Roll architecture.

**Rule.** A B1.2 item is **blocked** if it must know what a *canonical render* is, when a
candidate exists, or which asset publish sends. Everything else proceeds.

---

## Proceeds now — no A-Roll dependency

| § | Item | Why independent |
|---|---|---|
| 13.2 | Digest projection functions + tests | The `production` and `accord_package` projections are defined. The `render` projection belongs to the A-Roll track and is simply not written yet |
| 13.3 | Step-up credential and its dashboard prompt | Authentication, not approval semantics. A-Roll's approve route will *consume* it (A-Roll §4.5), which is an argument for landing it first |
| 13.4 | `FOUNDER_PRINCIPALS` and the founder-set check at the write boundary | Same — identity and authority, independent of subject type |
| 13.5 | Backfill of legacy approvals as unbound history | Operates on `productions.deliveryApprovals`, which A-Roll does not touch. Must still run **before** any live write path exists |
| 13.6 | `approval_evidence` write path behind `PATCH /productions/:id/approvals` | The **production** subject only. Transactional with the legacy map, serialized per production row |
| 13.9 | `workflow_transitions` written with the state change it records | Generic |
| 13.10 | `work_items`, and the `enqueueJob` / `/queue` contract changes | Includes #56 item 11 (the parent-discriminated `EnqueueJobInput`). Accord-shaped, not A-Roll-shaped |
| 13.11 | The waiting-for-approval surface | Lists `awaiting_approval` jobs generically. It will *show* A-Roll candidates once they exist, but needs no knowledge of them |
| — | #56 items 2, 3, 5, 6 | Backfill inputs, rollback completeness, legacy rejections, the deploy-window quiesce runbook |

**Ordering note.** 13.5 before 13.6 is not a preference: backfilling after the write path exists
means a production re-approved in between already holds a live row, and the backfill then
collides with `approval_evidence_live`.

---

## Blocked on the A-Roll design

| § | Item | What it needs decided first |
|---|---|---|
| 13.7 | Populating `productions.final_video_row_id` | A-Roll §4.8 makes assembly the writer and defines it as the *assembled output*, distinct from `canonical_renders`. The column shipped in B1.1 deliberately unpopulated |
| 13.8 | Publish reading the pin | Depends on 13.7 |
| — | The `render` subject type and projection | A-Roll §3.4 |
| — | `gate_phase` and phase-aware enqueue/claim/retry/sweep | A-Roll §4.1–4.2. The `pre_dispatch` half is unused until something is gated that way |
| — | Moving the HeyGen call behind dispatch | A-Roll §4.2, step D — the riskiest change in the track |
| — | Durable provider polling and the persistence/digest step | A-Roll §4.3–4.4 |
| — | Replacing `POST /videos/:id/approve` | A-Roll §4.5 |
| — | Rejection retention | A-Roll §4.6 |
| — | Assembly-time verification | A-Roll §4.8 |
| — | #56 items 9, 10 | These *are* the A-Roll track |

---

## Two things that must not drift while the track is open

1. **`POST /videos/:id/approve` stays as it is.** It is a known bypass (A-Roll §1.5) and it is
   the only working approval path for renders. Half-fixing it — adding a check without the
   evidence transaction — would break the UI while closing nothing. It is replaced wholesale in
   A-Roll step E or not at all.
2. **`final_video_row_id` stays unpopulated.** Writing it from any path other than assembly
   would fix its meaning as a side effect and pre-empt A-Roll §4.8.

---

## Standing constraints, unchanged

`WORKER_TICK_ENABLED` remains unset. B2 is entirely out of scope: no `hvnglobalco-com` changes,
no signed domain assertions, no Accord MCP, no `rmg-piaar-mcps` write gates, no higher autonomy.
Issue #55 stays filed and unfixed.
