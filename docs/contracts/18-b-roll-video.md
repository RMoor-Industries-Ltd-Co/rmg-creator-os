# Contract — B-Roll Video (Scene-Based Footage)

- **Capability id:** `b-roll-video`
- **Status:** Planned (spec)
- **Phase:** Master Atelier / Production
- **Owner:** Rahm Moore
- **Depends on:** `production-queue` (17), `a-roll-video` (16), `higgsfield-integration` (09)

## Mission

B-Roll is **supporting footage** — scene-setting clips, product visuals, lifestyle shots,
and motion graphics that cut between or around the A-Roll. The key property: **Rahm's
image (face, likeness, or brand identity) can appear in B-Roll clips**, making them
genuine branded content rather than generic stock. Providers that generate video from an
image reference are the primary B-Roll engine.

B-Roll clips **pass through to the B-Roll library** (Google Drive → `VIDEO_PRODUCTION/B_ROLL/`),
available for use in the CapCut final cut loop (contract 19).

---

## How B-Roll differs from A-Roll

| | A-Roll | B-Roll |
|---|---|---|
| **Subject** | Rahm talking / presenting | Scene, product, lifestyle |
| **Lip-sync** | Yes (HeyGen) | No |
| **Rahm's image** | Avatar-driven | Optional reference photo in the scene |
| **Output target** | HeyGen lip-sync input | B-Roll library → CapCut |
| **Prompt style** | Script excerpt + persona | Scene description + visual style |

---

## Provider roster

Same provider roster as A-Roll; all are valid B-Roll generators. Checkbox selection
follows the same pattern.

| # | Provider | Strength for B-Roll |
|---|---|---|
| **Higgsfield** | Scene motion, character placement, cinematic | Best for Rahm-in-scene |
| **HIGGSFIELD Marketing Studio** | Product showcases, marketing visuals | Ad-style B-Roll |
| **SuperCool** (`video_generate`) | General AI video | Quick scene coverage |
| **Canva** (video export) | Brand-forward motion graphics | Title cards, lower thirds |

B-Roll providers output to the **same queue** (contract 17) with `capability = broll`.

---

## Image reference in B-Roll

Rahm's photos (uploaded or pulled from `BRAND_ASSETS`) can be attached as **scene reference
images** so the model places him in the scene. This is the same ref-photo mechanism as the
Scene/Assets page. For B-Roll:

- Reference images are **per-clip**, not global — a single production can have a Rahm-in-gym
  clip and a product-on-desk clip with different refs.
- Providers that do not accept image refs (SuperCool v1, Canva) simply ignore the ref field.

---

## Prompting

Each B-Roll clip has its own prompt. The **scene list** (one row per planned clip) lets Rahm
specify:

```
[Scene description ···················] [📎 Refs] [☑ Higgsfield] [☑ SuperCool] [▶ Render]
```

Multiple clips can be queued simultaneously since they are independent scenes. The queue
worker runs them sequentially per-provider to avoid simultaneous API hammering.

ALLEN can **auto-generate a B-Roll shot list** from the production's script: it breaks the
script into visual beats and suggests one scene description per beat. Rahm edits before
rendering.

---

## B-Roll page layout

```
[B-Roll page]
  ┌── Shot list ──────────────────────────────────────────────────────┐
  │  Scene 1 [gym morning workout] [📎 Rahm photo] ☑ HGF ☑ SC □ CAN │
  │  Scene 2 [product on desk, dramatic light]      ☑ HGF □ SC □ CAN │
  │  [+ Add scene]  [✨ Auto-generate shot list from script]          │
  │                                                                   │
  │  [▶ Render all queued scenes]                                     │
  └───────────────────────────────────────────────────────────────────┘
        ↓ renders via production queue
  [Results — cards per scene per provider]
    Card: scene name · provider · thumbnail · status
          [▶ Preview] [✓ Add to B-Roll library] [✕ Discard]
  [📁 B-Roll library — clips approved for this production]
    (mini-grid of approved clips, downloadable for CapCut)
```

---

## B-Roll library

Approved B-Roll clips for a production are tagged in Drive:
- Drive path: `VIDEO_PRODUCTION/B_ROLL/{brand}/{production_id}/`
- Each clip named: `{type}-{product}-{region}-{tz}-{version}-broll-scene{n}-{provider}.mp4`

The library panel on the B-Roll page lists and previews all approved clips. Bulk download
(ZIP of the production's B-Roll folder) feeds the CapCut session.

---

## Data model additions to `productions`

```
broll_scenes    jsonb    # [{id, description, ref_ids[], providers[], takes[{id,provider,drive_id,status}], approved_ids[]}]
broll_library   jsonb    # [{drive_id, scene_id, provider, label}] — approved clips
```

---

## Gateway API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/productions/:id/broll` | Scene list + library |
| POST | `/productions/:id/broll/scenes` | Add a scene |
| PATCH | `/productions/:id/broll/scenes/:sid` | Update prompt / refs / providers |
| DELETE | `/productions/:id/broll/scenes/:sid` | Remove a scene |
| POST | `/productions/:id/broll/scenes/:sid/render` | Enqueue renders for scene |
| POST | `/productions/:id/broll/takes/:tid/approve` | Add take to B-Roll library |
| DELETE | `/productions/:id/broll/takes/:tid` | Discard take |
| POST | `/productions/:id/broll/suggest-scenes` | ALLEN generates shot list |
| GET | `/productions/:id/broll/download` | Signed Drive URLs for bulk download |

---

## CapCut handoff

B-Roll clips are **downloaded individually or as a ZIP** from the library panel. Rahm
imports them into CapCut alongside the A-Roll / HeyGen lip-sync export. No in-browser
editing — the Creator OS delivers the assets; CapCut is the NLE.

After editing in CapCut, the final export is **re-uploaded** to the Creator OS via the
Final Cut contract (19) for approval indexing and social delivery.

---

## Build order

1. Production queue (17) — B-Roll render jobs use the same queue.
2. B-Roll data model + gateway endpoints.
3. B-Roll UI (shot list, render cards, library panel).
4. ALLEN shot-list generation.
5. Bulk download to CapCut.
