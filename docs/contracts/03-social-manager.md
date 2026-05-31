# Contract — Social Manager

- **Service id:** `social-manager`
- **Status:** Planned
- **Phase:** Distribution
- **Owner:** Rahm Moore

## Mission
Take finished creatives and put them live as content, ads, or posts across social
platforms and Shopify stores — on a schedule, per brand.

## Inputs
- Finished creatives (video from Story Director, graphics from My Poster).
- Target spec: platform/store, format (content | ad | post), brand, schedule time.
- (From gateway) a job requesting distribution.

## Outputs
- Scheduled and published posts/ads.
- Publish status + post-back metrics into the gateway/DB.
- A schedule calendar the dashboard reads.

## Responsibilities (in scope)
- Schedule queue + calendar; per-brand cadence rules.
- Platform/store API integrations (publish, ads, status).
- Retry/backoff on publish failures; idempotent scheduling.

## Out of scope (for now)
- Creative generation (Story Director / My Poster).
- Deep analytics/attribution dashboards (later).

## Dependencies
- **Services:** gateway (jobs), Story Director + My Poster (creatives).
- **Integrations / external:** social platform APIs; Shopify (HVN, R+R, BU$Y_MF).
- **Models / AI:** optional (best-time-to-post heuristics, later).
- **Data:** Postgres (schedule, posts, metrics); Redis (queue + delayed jobs).

## Interface (high-level)
- **Exposes:** `GET /schedule`, `POST /schedule`, publish status endpoints.
- **Consumes:** `publish.*` jobs; creative-ready events.

## Brands / stores touched
All brands + HVN, R+R, BU$Y_MF stores.

## Success criteria
A creative submitted with a target + time reliably goes live at that time on the right
account, with status visible in the dashboard.

## Open questions
- Which platforms first, and which support ads vs. organic via API?
- Shopify ad surface (native vs. Meta/Google catalog sync).
