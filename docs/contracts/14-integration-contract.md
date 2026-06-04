# Contract — Integration Contract (Control Plane ⇄ Services)

> The cross-cutting contract for **how the gateway talks to every service and external
> tool**: auth models, payload shapes, status lifecycle, retries, errors, idempotency,
> and cost governance. Per-tool capability lives in its own contract (04, 05, 09, 10, 15);
> this document governs the *seams between them*.

- **Service id:** `integration`
- **Status:** In build (HeyGen, ALLEN, ElevenLabs, Higgsfield, Drive, Pexels/Pixabay live; SuperCool, ClickUp, Social Manager wiring in progress)
- **Phase:** Cross-cutting (AI Production Spine)
- **Owner:** Rahm Moore
- **Recommended by:** ASR §12 (Recommended Supporting Documents).

## Mission
Guarantee that every integration the control plane drives — AI participants and external
media/publishing tools — speaks a **predictable contract**: known auth, known request and
response shapes, a single status vocabulary, deterministic retries, surfaced errors, and
save-as-you-go persistence. AI systems *participate*; the gateway + Redis/BullMQ *own
execution*.

## Inputs
- Production/job records (the unit each integration acts on).
- Per-service credentials from the control-server `.env` (never in images or the repo).
- Triggers from the dashboard (synchronous) or BullMQ jobs (asynchronous).

## Outputs
- Normalized results written back to Postgres (`productions`, `assets`, `videos`).
- Assets persisted to Google Drive (save-as-you-go) with ids/links recorded.
- Status transitions + errors visible to the dashboard and (planned) ClickUp write-back.

## Auth models (the seam that bites first)
| Model | Used by | Where it lives | Headless-safe? |
|---|---|---|---|
| API key header | ElevenLabs, HeyGen, Pexels, Pixabay | `.env` on control server | ✅ yes |
| OAuth refresh token | Google Drive | `GDRIVE_*` in `.env` | ✅ yes |
| CLI + device-flow token | Higgsfield (`@higgsfield/cli`) | mounted `~/.config/higgsfield` | ✅ yes (token ported) |
| API-key-guarded HTTP | ALLEN (`x-allen-key`) | `ALLEN_API_KEY` | ✅ yes |
| **MCP + OAuth (per-client)** | **SuperCool, ClickUp, Google Docs** | client session auth | ⚠️ **assistant-in-loop only** |

**Rule:** headless pipeline stages may only depend on headless-safe integrations. MCP/OAuth
tools (SuperCool, ClickUp, Docs) run **with an AI client in the loop** or via that tool's own
UI/automation — never assumed callable from an unattended worker.

## Integration matrix
| Service | Role | Mechanism | Config | Primary surface |
|---|---|---|---|---|
| ALLEN | Brand-voice script + emotion direction + TTS proxy | HTTP (Fastify→FastAPI) | `ALLEN_URL`, `ALLEN_API_KEY` | `/draft`, `/direct`, `/speak`, `/emotion/profiles` |
| ElevenLabs | Cloned-voice TTS (master audio); `eleven_v3` tags | REST | `ELEVENLABS_API_KEY`, `ALLEN_VOICE_ID` | text+voice → mp3 |
| HeyGen | A-Roll talking head (Avatar IV / Talking Photo) | REST | `HEYGEN_API_KEY` | upload talking_photo, `/v2/video/generate`, status |
| Higgsfield | Clean reference still + b-roll scenes (Soul IDs) | CLI `--json` | mounted creds, `HIGGSFIELD_ENABLED` | `generate create/get`, `soul-id`, `upload` |
| Pexels + Pixabay | Free stock b-roll by transcript keywords | REST | `PEXELS_API_KEY`, `PIXABAY_API_KEY` | video search → clip URLs |
| SuperCool | Finishing (music/captions) + social publishing | MCP/OAuth | session auth | `video_audio_enhance`, `tiktok`, `twitter` (see contract 15) |
| Google Drive | Save-as-you-go asset storage + prompt libraries | Drive API (OAuth) | `GDRIVE_*_FOLDER_ID` | upload/download/list/export |
| ClickUp | Ops + brand source of truth + write-back | MCP | session auth | tasks/docs (planned write-back) |
| Social Manager | Schedule, publish, capture URLs | internal + SuperCool/HeyGen | — | contract 03 |

## Conventions (in scope)
- **Status vocabulary (single source):** `queued → processing → completed | failed`. External
  provider statuses are normalized into these before they reach the dashboard.
- **Idempotent save-as-you-go:** on `completed`, the artifact is uploaded to its Drive
  production folder (`AUDIO_/IMAGE_/VIDEO_PRODUCTION`) and the `driveFileId`/link recorded;
  re-runs that already have a `driveFileId` are no-ops.
- **External job ids:** stored on the record (`heygenVideoId` doubles as the external job id
  for Higgsfield/custom/final renders) and polled via one status endpoint.
- **Retries:** transient provider/network errors retry with backoff inside the worker;
  user-visible failures set `status='failed'` with the provider message surfaced (never a
  bare "(400)").
- **Private media proxy:** Drive-only artifacts are streamed via `/assets/:id/raw` and
  `/videos/:id/raw` so nothing needs public sharing; only when a tool (HeyGen audio, SuperCool
  publish) requires a fetchable URL do we expose `PUBLIC_API_BASE/...`.
- **Secrets:** live in the control-server `.env` (`chmod 600`); never echoed, committed, or
  baked into images.

## Out of scope (for now)
- Per-tool creative capability (owned by 04/05/09/10/15).
- The BullMQ recipe authoring/versioning model (open decision, ASR §11).
- Public SaaS multi-tenant auth.

## Cost & quota governance (ASR §11 open item)
Each credit-consuming call (ElevenLabs, HeyGen, Higgsfield, SuperCool, Claude) should record
`{ service, units, productionId, ts }` so per-production and per-month spend is queryable.
Until built, the operating rule is: **no unattended loop may call a credit-consuming tool
without a bounded count.**

## Success criteria
A new integration can be added by: dropping creds in `.env`, implementing a client in
`packages/integrations` (or an MCP entry), and mapping its statuses to the vocabulary — with
no change to how the dashboard reads results.

## Open questions
- The headless bridge for MCP/OAuth tools (SuperCool/ClickUp) — agent runner vs. that tool's
  native automation (n8n/routines).
- Cost-tracking store + dashboards.
- Recipe/job versioning + promotion to production.
