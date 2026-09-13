# Contract — Composer

> **Renamed 2026-09-13** from "Story Director" (founder decision D1,
> `docs/contracts/21-production-recipe-architecture.md`). This service's
> responsibility — assembly/finishing of already-generated material into a
> publishable package — was always closer to a Composer than a director. The
> "Story Director" name now belongs to the distinct pre-production role defined
> in `docs/contracts/22-story-director.md` (brief → shot plan → storyboard
> gate). Neither role was live in code at the time of the rename.

- **Service id:** `composer`
- **Status:** In build
- **Phase:** Foundation → Editorial
- **Owner:** Rahm Moore

## Mission
Turn a raw scripted recording (or, for a Promotion Story recipe, a set of
approved canonical shots from Story Director's storyboard) into a
brand-aligned, segmented, captioned, music-backed, timeline-editable video
package ready for publishing.

## Inputs
- A source video (talking-head) and a source script — Creator Content path.
- For a Promotion Story recipe: canonical selected shots + the approved
  storyboard/shot plan from Story Director (see contract 22), not a raw
  recording.
- A brand voice/treatment selection.
- (From gateway) a job requesting a video creative.

## Outputs
- A cleaned, timestamped transcript; script↔transcript alignment (Creator
  Content path).
- Detected segments (hook / body / CTA) and candidate clips (Creator Content
  path), or an assembled composition from canonical shots (Promotion Story
  path).
- Branded captions + suggested music/transitions.
- An editable timeline and an exported draft (render delegated to the render
  node) — i.e. the **composition manifest** referenced by contract 21.

## Responsibilities (in scope)
- Ingest/upload pipeline; transcription; filler cleanup (Creator Content).
- Script comparison + segmentation (Creator Content).
- Assembly of canonical shots into a composition manifest (Promotion Story).
- Brand-aware caption/music/transition suggestion.
- Timeline assembly + edit; export request.

## Out of scope (for now)
- Heavy rendering (runs on the **render node** via `worker-render`).
- Scriptwriting (future: ALLEN) — for now scripts are provided.
- Scheduling/publishing (Social Manager).
- Pre-production creative direction, shot/scene planning, and the Human
  Storyboard Gate — that is Story Director's role (contract 22), upstream of
  this service.

## Dependencies
- **Services:** gateway (jobs), Story Director (hands off canonical shots for
  a Promotion Story recipe), Social Manager (hands off finished video), ALLEN
  (future scripts).
- **Integrations / external:** transcription provider (TBD); Google Drive
  (media).
- **Models / AI:** transcription; later, ALLEN for script/voice.
- **Data:** Postgres (projects, transcripts, segments, timeline, jobs); Redis
  (queue).

## Interface (high-level)
- **Exposes:** project/asset/transcript/timeline endpoints (migrated from
  current API).
- **Consumes:** `render.*` jobs (produced for the render node); transcript/
  media jobs; for Promotion Story, canonical-shot handoff from Story Director.

## Brands / stores touched
VLOG · COM · The Rahm Council · Royal Reservations · BU$Y_MF · HVN ·
Connection Circle

## Success criteria
Upload a script + video → reliable transcript → aligned segments → branded
captions + music → editable timeline → exported draft. For Promotion Story:
canonical shots in → composition manifest out, ready for the Human Final-Cut
Gate.

## Open questions
- Transcription provider and model.
- Render queue protocol between control and render nodes.
- Whether the Promotion Story composition-manifest path shares the same
  timeline/editing primitives as the Creator Content path, or needs its own
  data shape (see contract 21's open questions).

## Migration note
The existing `story_director_version_2.0` repo is the source. Its Postgres/
Drizzle work folds into `packages/db`; its API becomes this service behind
the gateway. The repo/service name predates this rename and is historical,
not a naming inconsistency to fix.
