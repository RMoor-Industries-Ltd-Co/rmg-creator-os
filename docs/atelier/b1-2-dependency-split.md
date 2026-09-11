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
| 13.2 | Digest projection functions + tests | The `production` and `accord_package` projections are defined, and a projection is a pure function over an input — writing and testing it does not require any production to have a populated pin (that is 13.6's problem, below). The `render` projection belongs to the A-Roll track and is simply not written yet |
| 13.3 | Step-up credential and its dashboard prompt | Authentication, not approval semantics. A-Roll's approve route will *consume* it (A-Roll §4.5), which is an argument for landing it first |
| 13.4 | `FOUNDER_PRINCIPALS` and the founder-set check at the write boundary | Same — identity and authority, independent of subject type |
| 13.5 | Backfill of legacy approvals as unbound history | Operates on `productions.deliveryApprovals`, which A-Roll does not touch. Must still run **before** any live write path exists |
| 13.9 | `workflow_transitions` written with the state change it records | Generic |
| 13.10 | `work_items`, and the `enqueueJob` / `/queue` contract changes | Includes #56 item 11 (the parent-discriminated `EnqueueJobInput`). Accord-shaped, not A-Roll-shaped |
| 13.11 | The waiting-for-approval surface | Lists `awaiting_approval` jobs generically. It will *show* A-Roll candidates once they exist, but needs no knowledge of them |
| — | #56 items 2, 3, 5, 6 | Backfill inputs, rollback completeness, legacy rejections, the deploy-window quiesce runbook |

**Ordering note.** 13.5 must still land before any live write path exists — backfilling after
one exists means a production re-approved in between already holds a live row, and the backfill
then collides with `approval_evidence_live`. That write path is 13.6, which is blocked (below);
the ordering constraint survives the move and is the reason 13.5 is safe to do now and unsafe to
defer.

---

## Blocked on the A-Roll design

| § | Item | What it needs decided first |
|---|---|---|
| 13.6 | `approval_evidence` write path behind `PATCH /productions/:id/approvals` | **Corrected — this was previously listed as independent, and it is not.** The production subject's approved package is a *projection*, and Phase B §13.2/§10 put the pinned video row inside it: approval binds the exact asset publish will send, resolved through `productions.final_video_row_id`, and **a production with a null pin cannot be approved**. B1.1 shipped that column deliberately unpopulated, and populating it is 13.7 — which is blocked on A-Roll §4.8. So shipping 13.6 now would replace the one working production-approval path with one that cannot approve *any* current production. See the note below |
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

### Why 13.6 cannot simply be scoped around the pin

The tempting fix is to ship 13.6 with the pin omitted from the projection and added later. That
is worse than waiting. An approval's whole value is the digest it binds; a projection that
excludes the asset produces evidence that is *cryptographically well-formed and substantively
unbound* — it attests to copy and destination while the video underneath it is free to change.
Every such row then has to be superseded when the pin is added, and until it is, `/health` and
any audit read them as genuine bound approvals. Unbound history is acceptable for approvals that
predate the mechanism (13.5's `legacy:unbound`); manufacturing more of it after the mechanism
exists is not.

The unblocking order is therefore: A-Roll §4.8 decides the pin's writer → 13.7 populates it →
13.6 ships. Nothing in 13.6's own design is wrong; it is waiting on an input.

---

## Two things that must not drift while the track is open

1. **`POST /videos/:id/approve` stays as it is.** It is a known bypass (A-Roll §1.5) and it is
   the only working approval path for renders. Half-fixing it — adding a check without the
   evidence transaction — would break the UI while closing nothing. It is replaced wholesale in
   A-Roll step E or not at all.
2. **`final_video_row_id` stays unpopulated.** Writing it from any path other than assembly
   would fix its meaning as a side effect and pre-empt A-Roll §4.8.

---

## Founder decisions D-J1 – D-J3 (2026-09-11) and what they change here

Recorded in the A-Roll design's §10. Two touch this split:

- **D-J1 (segment identity)** adds a production-plan change — a segments array with stable
  stored ids — to the A-Roll track's step B. It is **not** a B1.2 item and does not unblock
  any row above; it is named here only so nobody lands a plan change from the B1.2 side.
- **D-J3 (retry semantics)** puts the **HeyGen v2 → v3 migration** in front of step D. That
  migration is mandatory anyway — v2 is retired 2026-11-01 — and it is **not** A-Roll work:
  it touches every HeyGen call in the repository. It does not depend on anything blocked
  below, so it can be scheduled independently of this split, and should be, given the date.
- **D-J2 (retention)** is entirely inside the A-Roll track. Nothing here moves.

---

## Standing constraints, unchanged

`WORKER_TICK_ENABLED` remains unset. B2 is entirely out of scope: no `hvnglobalco-com` changes,
no signed domain assertions, no Accord MCP, no `rmg-piaar-mcps` write gates, no higher autonomy.
Issue #55 stays filed and unfixed.
