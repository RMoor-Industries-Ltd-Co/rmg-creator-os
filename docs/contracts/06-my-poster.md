# Contract — My Poster (Publishing Cockpit & Poster Studio)

- **Service id:** `my-poster`
- **Status:** Planned — role expanded to **the scheduler cockpit**
- **Phase:** Distribution (creative + scheduling)
- **Owner:** Rahm Moore

## Mission
**My Poster is the scheduler you interact with.** It is the brand-facing cockpit where a
finished video becomes a fully-specified, multi-platform post: the **cover/poster**, the
**per-platform metadata**, the **checks & switches**, and the **schedule**. It is **powered by
ALLIE** (research → suggested metadata) and **executes through Social Manager** (Postiz). It
literally makes the *poster* and *posts* it.

## Inputs
- A practically-ready creative (final video w/ captions + optional music) from the wizard.
- Brand context + the brand's saved **post form** (defaults).
- **ALLIE suggestions:** hashtags, descriptions, first comments, target audiences, next-topic.

## Outputs
- A **cover/thumbnail** (poster) per post (image generation; can use SuperCool `image_generate`).
- A **post package** per platform (caption, title, hashtags, first comment, switches, schedule,
  target accounts) handed to Social Manager.
- (Secondary) Shopify product creative + copy for the stores (HVN, R+R, BU$Y_MF).

## Responsibilities (in scope)
- **Per-brand form** at the post stage: default platforms, voice/hashtag style, cadence,
  target audience, link/first-comment templates.
- **Per-platform metadata editor** (overrides the brand defaults): caption (length-aware),
  title (YouTube), hashtags, first comment, cover, and the platform **checks/switches**
  (e.g. TikTok privacy/duet/stitch/comment/music; YouTube visibility/category/made-for-kids/
  playlist; IG Reel-vs-feed/share-to-FB/collaborator; LinkedIn visibility; Pinterest board/link).
- **Cover/poster generation** + brand styling.
- Schedule selection; preview; submit the post package to Social Manager.

## Out of scope (for now)
- The actual publish/queue + URL capture (Social Manager / Postiz).
- The research itself (ALLIE) — My Poster *consumes* ALLIE's suggestions.
- Final video editing (CapCut, operator-side).

## Dependencies
- **Services:** ALLIE (metadata brain), Social Manager (publish engine), gateway, ALLEN
  (optional caption voice).
- **Integrations / external:** image model (SuperCool `image_generate`) for covers; Shopify
  Admin API (stores).
- **Data:** Postgres (`posts`, `brand_post_defaults`); Drive (covers + assets).

## Interface (high-level)
- **Exposes:** the Post wizard step UI; `GET/PUT /brands/:brand/post-defaults`,
  `POST /productions/:id/post-package`.
- **Consumes:** ALLIE suggestion payloads; final-cut assets.

## Brands / stores touched
All social brands (per-brand forms) + stores HVN · R+R · BU$Y_MF for product creative.

## Success criteria
From a ready video, the operator fills/confirms a per-brand form, sees ALLIE-suggested
metadata, picks platforms + schedule, and submits — producing a cover + a per-platform post
package that Social Manager publishes on time.

## Open questions
- Cover generation engine default (SuperCool vs Higgsfield vs uploaded).
- How much the operator confirms vs. trusts ALLIE auto-fill (approval gate per brand).
