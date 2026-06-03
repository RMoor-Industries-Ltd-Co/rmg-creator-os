# Contract — Higgsfield Integration (Avatar Creation)

- **Integration id:** `higgsfield`
- **Status:** Planned — **access confirmed** (CLI authenticated, ultra plan)
- **Phase:** Creative (avatars & voice)
- **Owner:** Rahm Moore
- **Home:** Higgsfield **CLI** (`@higgsfield/cli`, recommended by Higgsfield for Claude
  Code/Codex over their MCP). Auth via `higgsfield auth login` (device flow). Invoked
  server-side from the gateway/worker. Add `--json` for machine-readable output.

## Mission
Create a character's **visual likeness/avatar** from the operator's own **still photos
or a short video**, producing an asset that can be registered with HeyGen for talking-head
generation. Also generate **video thumbnails** for the asset-lifecycle thumbnail loop
(→ `THUMBNAIL_DESIGN`, see contract 11).

## Inputs
- Still images and/or a short reference video of the character.
- Optional style/look parameters.

## Outputs
- A generated avatar likeness (image and/or video asset) + Higgsfield asset id(s).
- The likeness image that gets registered with HeyGen (→ `heygenAvatarId`).

## Responsibilities (in scope)
- Upload source media to Higgsfield and trigger avatar/likeness generation.
- Poll generation status; return the finished asset reference(s).
- Hand the likeness image to the Character Pipeline for HeyGen registration.
- Generate **thumbnails** for finished videos (thumbnail feedback loop).

## Out of scope (for now)
- Final talking-head video generation (HeyGen).
- Voice (ElevenLabs).
- Storing/serving the asset long-term (Drive).

## Dependencies
- **External:** Higgsfield CLI (`@higgsfield/cli`) + authenticated account (ultra plan).
- **Consumers:** Character Pipeline (gateway).
- **Data:** Drive (source uploads), Postgres (`characters.avatarSource`, `heygenAvatarId`,
  `soulId`).

## Interface (actual CLI surface)
A character "Soul" is Higgsfield's identity reference, trained from ~5 images.

    higgsfield upload create ./photo.jpg            # → upload_id  (repeat ×5)
    higgsfield soul-id create --name <char> --soul-2 \
        --image <id1> ... --image <id5>            # → soul_id (training)
    higgsfield soul-id wait <soul_id>              # poll until ready
    higgsfield generate create <model> \
        --prompt "<clean portrait>" [--image ...]  # → likeness image → register w/ HeyGen
    higgsfield generate wait <job_id>              # poll; get asset url
    higgsfield account status                      # credits / plan

- All commands accept `--json` for parsing. Models from `higgsfield model list`.
- Thumbnails reuse `generate create` with a thumbnail-style prompt/frame.

## Success criteria
~5 photos reliably yield a trained Soul, from which we render a clean likeness image that
HeyGen accepts as an avatar — and per-video thumbnails on demand.

## Resolved / open questions
- ✅ **Programmatic access**: confirmed via the CLI (Soul IDs) — no UI-only blocker.
- Best path Soul → HeyGen avatar: render a clean portrait via `generate`, then register
  that image with HeyGen's Photo Avatar / Avatar IV. (Confirm HeyGen ingestion params.)
- Cost per Soul training + per generation (track against the ultra-plan credit pool).
- Server-side: install + `auth login` the CLI on the control server (device flow) for the
  automated pipeline; store the auth token securely.
