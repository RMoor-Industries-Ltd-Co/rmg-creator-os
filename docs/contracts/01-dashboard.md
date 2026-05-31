# Contract — Dashboard

- **Service id:** `dashboard`
- **Status:** Planned
- **Phase:** Foundation
- **Owner:** Rahm Moore

## Mission
The unified control-plane UI for RMG Creator OS at `rmg-creator-os.rmasters.group`.
A creative studio surface — not a form-based generator — for starting jobs, reviewing
output, and managing schedules across every brand and store.

## Inputs
- Operator actions (start a job, pick brand/target/recipe, review, approve, schedule).
- Live job/status data from the gateway.

## Outputs
- API calls to the gateway.
- A rendered, observable view of jobs, assets, schedules, and brand state.

## Responsibilities (in scope)
- Auth'd entry to the whole suite.
- Start/monitor jobs; review and approve creatives.
- Per-brand and per-store views (VLOG, COM, The Rahm Council, Royal Reservations,
  BU$Y_MF; HVN, R+R).
- An **"Extra / Personal"** area linking to the Life OS Fillout form.
- Schedule calendar (reads Social Manager).

## Out of scope (for now)
- Business logic (lives in gateway/services).
- In-browser heavy editing/rendering.

## Dependencies
- **Services:** gateway (primary), Social Manager (schedule view), Life OS (link only).
- **Integrations / external:** Caddy for TLS/routing.
- **Models / AI:** none directly (talks to ALLEN via gateway).
- **Data:** none directly.

## Interface (high-level)
- **Exposes:** the web app (served behind Caddy).
- **Consumes:** gateway REST/streaming endpoints.

## Brands / stores touched
All — primary operator surface.

## Success criteria
From one screen, start a job for any brand, watch it progress, approve the result, and
see it scheduled — with the personal Life OS reachable but tucked away.

## Open questions
- Framework continuity (React + Vite, as Story Director) vs. a meta-framework.
- Auth UX (SSO? passkeys?).
