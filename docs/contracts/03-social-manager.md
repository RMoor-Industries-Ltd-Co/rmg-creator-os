# Contract — Social Manager (Publish Engine)

- **Service id:** `social-manager`
- **Status:** Planned — engine chosen (**self-hosted Postiz**)
- **Phase:** Distribution
- **Owner:** Rahm Moore

## Mission
The **execution engine** underneath My Poster: take a fully-specified post (creative +
per-platform metadata + schedule) and reliably **publish or schedule it across platforms**,
capture the live post URLs, and write results back. My Poster is the cockpit; ALLIE is the
brain; **Social Manager is the engine.**

## Egress mechanism — self-hosted Postiz
Rather than build a dozen platform OAuth integrations (each gated by Meta/TikTok app review,
YouTube quotas, etc.), Social Manager drives a **self-hosted [Postiz](https://postiz.com)
instance** on the Linode — one integration → many platforms, on our own infra (no per-post
SaaS fees, matches the in-house/PIAAR ethos).

- **First platforms (MVP):** TikTok · YouTube · Instagram · Facebook · LinkedIn · X.
- **Postiz coverage (later):** Pinterest · Tumblr · Threads · Bluesky · Telegram · Discord.
- **Out of aggregator scope:** Spotify (podcast host/RSS), Twitch (live), Patreon (own API),
  censor-less (Rumble/Odysee) — native or n8n, case by case.
- Per-platform **OAuth apps** are created by the operator in each platform's developer portal
  and connected once inside Postiz; Social Manager then posts via Postiz's API.

## Inputs
- A **post package** from My Poster: creative (final video / cover), per-platform caption,
  title, hashtags, first comment, switches/checks, schedule time, target accounts.
- (From gateway) a `publish.*` job.

## Outputs
- Scheduled/published posts on each selected platform.
- Captured **post URLs** + status per platform, written to Postgres and (planned) ClickUp.
- A schedule/calendar the dashboard reads.

## Responsibilities (in scope)
- Map a post package → Postiz API calls (per platform); schedule or publish now.
- Status polling + URL capture; retry/backoff on failure; idempotent scheduling.
- ClickUp write-back of the published record (URL, brand, time).

## Out of scope (for now)
- Metadata authoring + brand forms (My Poster) and research (ALLIE).
- Creative generation (Story Director / My Poster cover).
- Ads / paid placement and deep attribution analytics (later).

## Dependencies
- **Services:** My Poster (post packages), gateway (jobs), ClickUp (write-back).
- **Integrations / external:** **Postiz** (self-hosted) → platform APIs.
- **Data:** Postgres (`posts`, schedule, status, URLs); Redis/BullMQ (delayed jobs).

## Interface (high-level)
- **Exposes:** `POST /publish` (post package), `GET /schedule`, status endpoints.
- **Consumes:** `publish.*` jobs; "post-ready" from My Poster.

## Brands / stores touched
All social brands (BU$Y_MF, COM, VLOG, ORR, MSTR_RAHM, TRC, TGL) per their channel sets.
Not PIAAR.

## Success criteria
A post package submitted with a time goes live (or schedules) on every selected platform via
Postiz, with each post's URL captured and visible in the dashboard.

## Open questions
- Postiz deployment shape (Docker on control vs render Linode) + its own DB.
- Ads/paid surface (deferred).
- Per-platform rate/quotas surfaced back to My Poster.
