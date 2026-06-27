# Contract — A-Roll Video (Provider-Select Rendering)

- **Capability id:** `a-roll-video`
- **Status:** Planned (spec)
- **Phase:** Master Atelier / Production
- **Owner:** Rahm Moore
- **Depends on:** `production-wizard` (13), `asset-lifecycle` (11), `higgsfield-integration` (09)

## Mission

A-Roll is the **primary talking-head or character-driven video**: Rahm on camera (via AI
avatar + lip-sync) with HeyGen as the final delivery engine. The *inputs* to HeyGen (the
base video render before lip-sync) come from multiple provider services. Rather than
rendering all providers simultaneously and wasting credits chasing the perfect take, Rahm
**selects which providers to render via checkboxes**, reviews the result, picks a winner,
and passes it to B-Roll or directly to HeyGen lip-sync.

No in-browser NLE. Trims and delivery happen via the CapCut download/re-upload loop (see
contract 18 — Final Cut). The A-Roll page is about **generating the highest-quality base
video** for HeyGen to lip-sync onto.

---

## Provider roster

Each provider renders from a prompt; some also accept image/character references.
A checkbox next to each provider controls whether it is included in the current render run.

| # | Provider | Render type | Ref images? |
|---|---|---|---|
| 1 | **Higgsfield** | Video (character motion, scene, style) | Yes |
| 2 | **HIGGSFIELD Marketing Studio** | Marketing/product video | Yes |
| 3 | **SuperCool** (`video_generate`) | AI video via SuperCool gateway | No |
| 4 | **Canva** (video export) | Slide/brand-forward video | No |
| Additional providers can be added to this list as they become available. | | | |

---

## Prompting

Each checked provider gets its **own prompt field**, pre-populated with the production's
script excerpt or an AI-suggested prompt, but **independently editable** before render.
This matches the pattern already established on the Scene page.

Prompt fields are only shown for **checked** providers. A provider unchecked has no prompt
field visible — keeps the UI clean.

A **"Generate prompts for all checked providers"** action calls ALLEN via the gateway to
suggest tailored prompts per-provider based on the production topic, brand, and persona.
These populate the fields; Rahm may edit before rendering.

---

## Render flow

```
[A-Roll page]
  ┌── provider list with checkboxes ──────────────────────────────────┐
  │  ☑ Higgsfield    [prompt field ················]                  │
  │  ☐ HIGGSFIELD MKT (unchecked — no field shown)                   │
  │  ☑ SuperCool     [prompt field ················]                  │
  │  ☐ Canva         (unchecked)                                      │
  │                                                                   │
  │  [📎 Reference photos — optional, shared across checked providers]│
  │  [▶ Render checked]                                               │
  └───────────────────────────────────────────────────────────────────┘
        ↓ each checked provider renders independently (queued)
  [Results grid — one card per render]
    Card: provider name · thumbnail · status (queued/rendering/done/failed)
          [▶ Preview] [✓ Select as A-Roll winner] [✕ Discard]
        ↓ winner selected
  [Pass to B-Roll →] or [Send to HeyGen lip-sync →]
```

Renders run through the **production queue** (contract 17). Only one render per provider
runs at a time per production; a second render of the same provider creates a new take
card without deleting the prior one (useful for A/B comparison).

---

## Take naming

Takes follow the production's ad-index nomenclature (contract 19):

```
{type}-{product}-{region}-{tz}-{version}-take{n}
```

Example: `vlog-software-news-usa-est-001-take1`. The take number auto-increments per
provider per production.

---

## Passing to B-Roll

A-Roll winner is stored as `production.aroll_video_id` (Drive URL of the rendered file).
The B-Roll page reads this and optionally incorporates it as an overlay/anchor clip. If
no A-Roll winner is set, B-Roll generates independently.

---

## Data model additions to `productions`

```
aroll_takes     jsonb    # [{id, provider, prompt, drive_id, status, selected_at}]
aroll_video_id  text?    # Drive id of selected winner
aroll_prompts   jsonb?   # {provider_key: prompt_text} — last used prompts per provider
aroll_providers jsonb?   # {provider_key: true/false} — checkbox state per provider
```

---

## Gateway API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/productions/:id/aroll` | Current takes + provider/prompt state |
| PATCH | `/productions/:id/aroll/config` | Save checkbox state + prompts |
| POST | `/productions/:id/aroll/render` | Enqueue render for checked providers |
| GET | `/productions/:id/aroll/takes` | Poll take statuses |
| POST | `/productions/:id/aroll/takes/:tid/select` | Mark take as winner |
| DELETE | `/productions/:id/aroll/takes/:tid` | Discard a take |
| POST | `/productions/:id/aroll/suggest-prompts` | ALLEN generates per-provider prompts |

---

## UI principles

- **Professional, not cluttered.** Provider list on left or top; result cards in a grid.
- **Status chips** on each card: `queued · rendering · done · failed`.
- **No simultaneous render pressure.** Checkboxes default to none checked; Rahm picks
  intentionally.
- **Reference photos** carry over from the Scene/Assets page by default; can be cleared
  or swapped on this page.
- **One winner per production at a time.** Selecting a new winner un-marks the old one
  (but does not delete the take).

---

## Build order

1. Production queue foundation (contract 17) — A-Roll render jobs slot into it.
2. A-Roll gateway endpoints + data model migration.
3. A-Roll UI (provider list, prompt fields, render cards, winner selection).
4. Pass-through to B-Roll and HeyGen lip-sync.
