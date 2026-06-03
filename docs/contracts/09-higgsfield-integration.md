# Contract — Higgsfield Integration (Avatar Creation)

- **Integration id:** `higgsfield`
- **Status:** Planned
- **Phase:** Creative (avatars & voice)
- **Owner:** Rahm Moore
- **Home:** Higgsfield **MCP server** (added via `claude mcp add` — not in the connector
  registry yet). Wrapped behind the gateway like other integrations.

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
- **External:** Higgsfield AI API + account/key.
- **Consumers:** Character Pipeline (gateway).
- **Data:** Drive (source uploads), Postgres (`characters.avatarSource`, `heygenAvatarId`).

## Interface (high-level, proposed)
- `createAvatar({ images?, videoUrl?, options })` → `{ jobId }`
- `getAvatarStatus(jobId)` → `{ status, assetUrl?, assetId? }`

## Success criteria
A handful of photos (or one short video) reliably yields a usable character likeness
that HeyGen accepts as an avatar.

## Open questions / risks
- **Does Higgsfield expose a public API** for programmatic avatar creation, or is it
  UI-only today? If UI-only, this becomes a manual export step (produce image → upload to
  HeyGen) until/if an API exists. **Verify before building.**
- Auth model + rate limits + cost per avatar.
- Output format compatibility with HeyGen's photo-avatar ingestion.
