# Contract — Production Wizard & Production Record

- **Capability id:** `production-wizard`
- **Status:** Planned (spec — maps the full content E2E)
- **Phase:** Orchestration / UI
- **Owner:** Rahm Moore

## Mission
A simple, modular, **stage-stepped wizard** (onboarding-style) that walks a single piece
of content from idea to published post — one view per stage, **Back** on every step, a
final **Post** button. Each stage operates on one **Production** record. The UI is
mobile-ready; all logic lives behind the gateway API so a future mobile app reuses it.

## The Production record (`productions` table)
The "AI Production Package" made concrete. One row per content piece; the wizard reads
and advances it.

    Production {
      id              uuid
      content_id      text          # RMG-CR-000001
      brand           BrandKey      # com, vlog, ...
      persona         text?         # Coach Rahm
      output_kind     OutputKind    # post | content | ad | newsletter | book
      # --- Script (Stage 1) ---
      topic           text
      script_text     text?
      script_doc_id   text?         # Google Doc in 06_CONTENT_ENGINE/SCRIPTS
      script_doc_url  text?
      script_status   enum          # draft | edited | approved
      # --- Character / assets (Stage 2) ---
      character_id    uuid?         # resolved Character (avatar+voice), when available
      avatar_id       text?         # HeyGen avatar
      voice_id        text?         # ElevenLabs voice (e.g. COM Coach Rahm)
      asset_ids       jsonb         # selected/uploaded BRAND_ASSETS drive ids
      # --- Generation (Stage 3) ---
      audio_drive_id  text?         # ElevenLabs render → AUDIO_PRODUCTION
      heygen_video_id text?
      video_drive_id  text?         # → VIDEO_PRODUCTION (auto-save, already live)
      thumbnail_drive_id text?      # Higgsfield → THUMBNAIL_DESIGN
      # --- Schedule (Stage 4) ---
      scheduled_at    timestamptz?
      platform        text?         # tiktok | ig | youtube | linkedin ...
      social_account  text?
      caption         text?
      hashtags        jsonb?
      # --- Post (Stage 5) ---
      post_url        text?
      post_status     enum          # none | scheduled | published | failed
      # --- Lifecycle ---
      stage           enum          # script | assets | generate | schedule | post | done
      status          enum          # active | blocked | done | failed
      error_log       jsonb
      createdAt, updatedAt
    }

## Stage state machine
```
script ──approve──▶ assets ──confirm──▶ generate ──complete──▶ schedule ──set──▶ post ──publish──▶ done
   ◀──────────────────── Back (any prior stage; data preserved) ────────────────────
```
Each forward transition is **gated** (cannot advance until the stage requirement is met).
**Back** never destroys data. `status=blocked` surfaces a fixable issue (e.g. ElevenLabs
payment, missing avatar).

## The five stages

### ① Script
- **View:** editable script (from ALLEN), brand/persona header, **▶ Hear it**, **Save**, **Approve →**.
- **Actions:** edit text · hear (TTS preview in the brand voice) · save (updates the Drive Doc) · approve.
- **Gate:** `script_status = approved`.
- **Services:** ALLEN (`/draft`, `/speak`), Drive (update SCRIPTS Doc).

### ② Assets
- **View:** image/video viewer; **upload** or **pick** from `BRAND_ASSETS`; define the
  **avatar** (HeyGen) + **voice** (ElevenLabs) — i.e. confirm/select the Character.
- **Gate:** `avatar_id` + `voice_id` set (a usable Character).
- **Services:** Drive (BRAND_ASSETS upload/list), HeyGen (avatars), ElevenLabs (voices).

### ③ Generate
- **View:** live render progress **per sub-stage** — voice → avatar video → thumbnail —
  each updating as it completes; inline preview when done.
- **Flow:** ElevenLabs synth (→ AUDIO_PRODUCTION) → HeyGen `voice.type:"audio"` (→ VIDEO_PRODUCTION, auto-save live) → Higgsfield thumbnail (→ THUMBNAIL_DESIGN).
- **Gate:** video `completed`.
- **Services:** ElevenLabs, HeyGen, Higgsfield, Drive.

### ④ Schedule
- **View:** date/time picker + **social account/platform** + caption + hashtags.
- **Gate:** `scheduled_at` + `platform` set.
- **Services:** Social Manager (schedule queue).

### ⑤ Post
- **View:** final review of the package; **Post** button (publish now or confirm schedule).
- **On post:** Social Manager publishes → capture `post_url` → move the bundle
  `SCHEDULED/<brand>` → `ARCHIVE/<brand>` → write back to ClickUp.
- **Gate:** `post_status = published`.
- **Services:** Social Manager, Drive (move job), ClickUp.

## Gateway API surface
| Method | Path | Purpose |
|---|---|---|
| POST | `/productions` | create from `{brand, persona?, topic, output_kind}` → calls ALLEN `/draft`, stores record + Doc |
| GET | `/productions` · `/productions/:id` | list / read |
| PATCH | `/productions/:id/script` | save edited script → update Drive Doc |
| POST | `/productions/:id/speak` | TTS preview (ALLEN `/speak`) → audio url |
| POST | `/productions/:id/approve` | gate Script → advance to Assets |
| GET/POST | `/productions/:id/assets` | list BRAND_ASSETS / upload / select; set avatar+voice |
| POST | `/productions/:id/generate` | run voice→video→thumbnail; poll via GET `/productions/:id` |
| PATCH | `/productions/:id/schedule` | set time/platform/caption |
| POST | `/productions/:id/post` | publish via Social Manager; archive; ClickUp write-back |
| POST | `/productions/:id/back` | move to a prior stage (no data loss) |

## Gateway ↔ ALLEN
The gateway calls **ALLEN** (deployed under PIAAR `rmg-ai`, reachable over the tailnet):
`/draft` (create), `/speak` (hear), and updates the script Doc on save. ALLEN stays
isolated; the gateway is its only consumer.

## Wizard UI architecture
- `<Wizard>` = a **stepper** + an array of **independent stage components** sharing one
  `production` state object (fetched/advanced via the gateway).
- Per-stage **gating** + **Back**; the final stage shows **Post**.
- **Mobile-first** responsive layout; no business logic in the client — the gateway API is
  the contract, so the future mobile app reuses it verbatim.

## Maps to the current build
| Piece | Status |
|---|---|
| ALLEN scriptwriting (`/draft`, `/speak`) | ✅ built (local) — needs **deploy** |
| HeyGen generation + auto-save to Drive | ✅ live |
| ElevenLabs voice (COM Coach Rahm) | ✅ ready — ⚠️ **billing block** on TTS |
| Drive folders (SCRIPTS, BRAND_ASSETS, AUDIO/VIDEO/THUMBNAIL, SCHEDULED/ARCHIVE) | ✅ exist |
| `productions` table + stage endpoints | ⬜ to build |
| Wizard UI (5 stages) | ⬜ to build |
| Social Manager (schedule/post) | ⬜ not built — Stages 4–5 depend on it |
| Character creation (Higgsfield Soul → HeyGen avatar) | ⬜ — Stage 2 can use a stock avatar until then |

## Build order
1. **Deploy ALLEN** + wire gateway↔ALLEN.
2. **`productions` model** + Script-stage endpoints.
3. **Wizard Stage 1 (Script)** end-to-end, then **Assets → Generate** (these light up the
   existing HeyGen/Drive pieces), then **Schedule → Post** once Social Manager exists.

## Open questions / blockers
- **ElevenLabs billing** (failed invoice) blocks TTS + voice render — fix to test Stages 1/3.
- **Social Manager** must be built for Stages 4–5 (the post leg).
- **Avatar for characters** (Higgsfield Soul → HeyGen) — until then use a stock HeyGen avatar.
- Social platform APIs (which platforms first; ads vs organic).
- `productions` vs the existing `videos` table — `videos` becomes a child/detail of a production.
