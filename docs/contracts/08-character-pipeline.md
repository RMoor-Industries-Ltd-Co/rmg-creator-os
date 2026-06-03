# Contract — Character Pipeline

- **Capability id:** `character-pipeline`
- **Status:** Planned
- **Phase:** Creative (avatars & voice)
- **Owner:** Rahm Moore

## Mission
Turn a person's **photos/video + voice samples** into a reusable AI **Character**
(branded avatar + cloned voice), then generate brand-voiced talking-head videos
on demand and route them to editing (Story Director) or scheduling (Social Manager).
This is the engine for net-new "quick post" content at brand scale.

## The Character entity (new DB model)
A Character is created once and reused for every generation.

    Character {
      id            uuid
      name          text          // e.g. "Rahm — VLOG"
      brand         BrandKey      // vlog | com | the-rahm-council | royal-reservations | busy-mf
      // avatar (visual likeness)
      avatarSource  json          // Higgsfield asset ids / uploaded photo or video refs
      heygenAvatarId text         // registered Photo/Avatar IV id used for generation
      avatarStatus  enum          // pending | ready | failed
      // voice
      voiceSource   json          // ElevenLabs sample refs
      elevenVoiceId text          // ElevenLabs voice id
      voiceStatus   enum          // pending | ready | failed
      createdAt, updatedAt
    }

## Create-a-Character flow
1. **Upload** still photos or a short video of the character.
2. **Higgsfield** generates the avatar likeness from the upload.
3. **Register** that likeness with **HeyGen** (Photo Avatar / Avatar IV) → `heygenAvatarId`.
4. **Upload** voice samples → **ElevenLabs** creates a voice profile → `elevenVoiceId`.
5. Character is saved as `ready` and reusable.

## Generate-a-video flow
1. Pick a **Character** + a **script** (A.L.L.E.N can write it in brand voice).
2. **ElevenLabs** synthesizes the script to **audio** in the character's voice.
3. **HeyGen** generates the video from `heygenAvatarId` + that **audio track**
   (`voice.type: "audio"`), so ElevenLabs owns the voice and HeyGen owns the visual.
4. Persist the result (the existing `videos` table), then **route**:
   - → **Story Director** for editing/finishing, or
   - → **Social Manager** straight to the calendar.

## Responsibilities (in scope)
- Character CRUD + lifecycle (avatar/voice readiness).
- Orchestrate Higgsfield → HeyGen registration and ElevenLabs voice creation.
- Generation: script → ElevenLabs audio → HeyGen video → persisted asset.
- Hand-off to Story Director or Social Manager.

## Out of scope (for now)
- Scriptwriting (A.L.L.E.N) — script is provided/another service.
- Editing (Story Director) and scheduling (Social Manager).
- Permanent media storage (handled by the persist-to-Drive step).

## Dependencies
- **Integrations:** Higgsfield (avatar), ElevenLabs (voice), HeyGen (generation) — all in `packages/integrations`.
- **Services:** gateway (orchestration), Story Director, Social Manager (consumers), A.L.L.E.N (scripts).
- **Data:** Postgres (`characters`, `videos`); Google Drive (uploads + final MP4s).

## Interface (high-level)
- `POST /characters` (create from uploads) · `GET /characters` · `GET /characters/:id`
- `POST /characters/:id/generate` (script → video, persisted) → routes to SD or SM
- Reuses existing `/heygen/videos*` persistence.

## Brands / stores touched
All brand voices (each Character is brand-scoped).

## Success criteria
Upload a few photos + voice clips once → get a reusable branded Character → from then
on, a script becomes a finished talking-head video in one step, ready to edit or schedule.

## Open questions / risks
- **Higgsfield API**: confirm it exposes programmatic avatar creation from photos/video
  (vs. UI-only). If UI-only at first, step 2 is a manual hand-off that produces an image
  we then register with HeyGen.
- **HeyGen Photo Avatar / Avatar IV API**: exact endpoints + how an external likeness
  image is registered to get an `avatar_id`.
- **HeyGen audio voice input**: confirm `voice.type: "audio"` params (audio_url vs.
  uploaded asset id) for the ElevenLabs hand-off.
- **Cost model**: credits per generation across all three vendors.
- **Likeness/consent**: store consent for each person whose likeness/voice is cloned.
