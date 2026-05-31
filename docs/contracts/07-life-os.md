# Contract — Life OS

- **Service id:** `life-os`
- **Status:** Live (standalone, to be integrated)
- **Phase:** Personal (deeper layer)
- **Owner:** Rahm Moore

## Mission
A personal daily-activity tracker. Captures journal/activity events and keeps ClickUp
updated. It is a personal utility, not part of the content pipeline — surfaced quietly
in the dashboard under "Personal."

## Inputs
- Fillout form submissions (daily journal / activity).
- Personal events/triggers.

## Outputs
- Updates to ClickUp (tasks/records).
- Personal logs/exports.

## Responsibilities (in scope)
- Receive Fillout journal events; map them to ClickUp updates.
- Maintain personal logs/exports.

## Out of scope (for now)
- Any content/marketing function.
- Exposure to the public pipeline — access only via the dashboard "Personal" link.

## Dependencies
- **Services:** dashboard (link to Fillout form only).
- **Integrations / external:** Fillout (forms); ClickUp (API).
- **Models / AI:** none currently.
- **Data:** its own store (Python project: `rmg_creator_os`).

## Interface (high-level)
- **Exposes:** Fillout webhook/endpoints; ClickUp sync.
- **Consumes:** Fillout submissions.

## Brands / stores touched
None (personal).

## Success criteria
Daily journal entries reliably flow from Fillout into ClickUp, reachable from the
dashboard's "Personal" area without cluttering the content surfaces.

## Implementation note
This is the existing **Python** `rmg_creator_os` repo. It stays its own deployable
service on the tailnet; only a dashboard link and its ClickUp/Fillout integrations
connect it to the suite.
