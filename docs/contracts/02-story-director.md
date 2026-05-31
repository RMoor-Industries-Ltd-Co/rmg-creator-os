# Contract — Story Director

- **Service id:** `story-director`
- **Status:** In build
- **Phase:** Foundation → Editorial
- **Owner:** Rahm Moore

## Mission
Turn a raw scripted recording into a brand-aligned, segmented, captioned,
music-backed, timeline-editable video package ready for publishing.

## Inputs
- A source video (talking-head) and a source script.
- A brand voice/treatment selection.
- (From gateway) a job requesting a video creative.

## Outputs
- A cleaned, timestamped transcript; script↔transcript alignment.
- Detected segments (hook / body / CTA) and candidate clips.
- Branded captions + suggested music/transitions.
- An editable timeline and an exported draft (render delegated to the render node).

## Responsibilities (in scope)
- Ingest/upload pipeline; transcription; filler cleanup.
- Script comparison + segmentation.
- Brand-aware caption/music/transition suggestion.
- Timeline assembly + edit; export request.

## Out of scope (for now)
- Heavy rendering (runs on the **render node** via `worker-render`).
- Scriptwriting (future: ALLEN) — for now scripts are provided.
- Scheduling/publishing (Social Manager).

## Dependencies
- **Services:** gateway (jobs), Social Manager (hands off finished video), ALLEN (future scripts).
- **Integrations / external:** transcription provider (TBD); Google Drive (media).
- **Models / AI:** transcription; later, ALLEN for script/voice.
- **Data:** Postgres (projects, transcripts, segments, timeline, jobs); Redis (queue).

## Interface (high-level)
- **Exposes:** project/asset/transcript/timeline endpoints (migrated from current API).
- **Consumes:** `render.*` jobs (produced for the render node); transcript/media jobs.

## Brands / stores touched
VLOG · COM · The Rahm Council · Royal Reservations · BU$Y_MF

## Success criteria
Upload a script + video → reliable transcript → aligned segments → branded captions +
music → editable timeline → exported draft.

## Open questions
- Transcription provider and model.
- Render queue protocol between control and render nodes.

## Migration note
The existing `story_director_version_2.0` repo is the source. Its Postgres/Drizzle work
folds into `packages/db`; its API becomes this service behind the gateway.
