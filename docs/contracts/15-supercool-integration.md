# Contract — SuperCool Integration (Finishing & Publishing)

- **Integration id:** `supercool`
- **Status:** Connected (MCP authorized) — wiring planned
- **Phase:** Egress (finishing & social distribution)
- **Owner:** Rahm Moore
- **Home:** SuperCool **MCP** (`https://mcp.supercool.com/mcp`, 41 tools). Auth: OAuth
  device/sign-in per MCP client. Credit-based ("tools consume credits like solo chat").

## Mission
Take the **assembled final cut** (our A-Roll + Higgsfield scenes + stock b-roll, stitched by
the gateway's ffmpeg sequencer over the ElevenLabs narration) and **finish + publish** it —
add a music bed, captions, and post directly to TikTok/Twitter — so a production can ship
without leaving the ecosystem (replacing the manual CapCut + re-upload step).

## Inputs
- The approved final-cut video (a `PUBLIC_API_BASE/videos/:id/raw` URL).
- Optional: brand music direction, caption preference, platform + caption/hashtags.

## Outputs
- A finished video (music bed + captions) returned for review.
- A published TikTok/Twitter post (or draft) + the captured post URL for ClickUp write-back.

## Responsibilities (in scope)
- **Audio finishing** — `video_audio_enhance` (`add_music` with a brand `music_prompt`;
  `voice_convert` only for long stitched cuts; `transcribe` for caption text).
- **Captioning** — burn social captions onto the cut **(capability to verify before relied
  upon; fall back to CapCut if SuperCool cannot burn-in)**.
- **Publishing** — `tiktok` / `twitter` publish (or `upload_draft`) from the cut's URL,
  carrying title/hashtags and privacy level.
- Return the final file + post URL to the production record.

## Out of scope (for now)
- **Identity-critical A-Roll** — HeyGen owns the talking head (contract 09/character pipeline).
  SuperCool's `avatar_talking_head` (1080p) is a *future A/B alternate*, not the default.
- **Shot assembly/order** — the gateway's ffmpeg sequencer owns the cut so the operator keeps
  carousel control; SuperCool finishes the already-ordered cut, it does not re-stitch.
- **Visual re-render** — there is no "make my finished edit more cinematic" tool; cinematic
  quality comes from the Higgsfield/HeyGen inputs, not a SuperCool post-pass.

## Dependencies
- **Services:** gateway (produces the final cut + URL), Social Manager (contract 03), Drive.
- **Integrations / external:** SuperCool MCP; its TikTok/Twitter connectors (authorized inside
  SuperCool) for publishing.
- **Constraint:** **MCP/OAuth = assistant-in-loop.** SuperCool actions run with an AI client
  in the session (or SuperCool's own UI/automation) — they are **not** callable from the
  unattended gateway worker (see contract 14, Auth models).

## Interface (high-level)
- **Consumes:** a final-cut URL + finishing/publish params.
- **Tools used:** `video_audio_enhance`, `tiktok`, `twitter` (primary); `avatar_talking_head`,
  `video_generate`, `image_generate`, `audio_generate` (optional alternates).
- **Dashboard surface:** a **"Finish & Publish in SuperCool"** action on the Post step that
  hands the cut to the assistant to execute, then records the result.

## Brands / stores touched
All social brands — primarily **BU$Y_MF** (TikTok promo engine), plus COM · VLOG · ORR ·
MSTR_RAHM · TRC for their channels. Not PIAAR (GitHub only).

## Success criteria
Given an approved final cut, SuperCool returns a captioned, music-scored video and a live
(or draft) TikTok/Twitter post with its URL captured — no CapCut, no manual upload.

## Open questions
- Caption **burn-in** capability (verify; else captions stay in CapCut).
- Headless automation bridge (SuperCool routines / n8n vs assistant-in-loop).
- Credit tracking for SuperCool calls (feeds contract 14 cost governance).
- Whether music/voice finishing ever conflicts with the ElevenLabs master-audio timing
  (must preserve lip-sync timing of the A-Roll).
