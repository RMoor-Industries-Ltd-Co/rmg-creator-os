# Contract — Gateway / Orchestrator

- **Service id:** `gateway`
- **Status:** Planned
- **Phase:** Foundation
- **Owner:** Rahm Moore

## Mission
The control plane of RMG Creator OS. Turns a single high-value input into scheduled,
brand-voiced output by running a **Recipe** — an ordered set of steps across services —
as a tracked **Job**. It is the single API surface the dashboard talks to.

## Inputs
- An asset (image, video, music, transcript) or a **topic**.
- A chosen brand voice and target (content / ad / post; platform or Shopify store).
- A Recipe selection (or "auto" — gateway picks a Recipe from intent).

## Outputs
- A `Job` record tracking status across every step.
- Emitted BullMQ jobs to the relevant services.
- A final social-ready creative handed to Social Manager for scheduling.

## Responsibilities (in scope)
- Define and store `Recipe` and `Job` models.
- Route work to services via the queue; track step status, retries, failures.
- Enforce auth; expose one coherent API to the dashboard.
- Hold the brand/store registry and resolve which voice/target applies.

## Out of scope (for now)
- The actual creative work (delegated to services).
- Model selection / inference (ALLEN/ALLIE own that).
- Direct platform publishing (Social Manager owns that).

## Dependencies
- **Services:** all of them (it orchestrates the suite).
- **Integrations / external:** none directly; via services.
- **Models / AI:** none directly.
- **Data:** Postgres (Recipes, Jobs, brand/store registry), Redis (queue).

## Interface (high-level)
- **Exposes:** `POST /jobs` (start from input+recipe), `GET /jobs/:id`,
  `GET /recipes`, brand/store registry endpoints, auth.
- **Consumes:** step-completion events from each service.

## Brands / stores touched
All — it is the registry of record.

## Success criteria
A topic or asset submitted once flows through the right services and arrives at a
scheduled post with no manual hand-offs; every step is observable in the dashboard.

## Open questions
- Recipe authoring: code-defined, data-defined, or visual builder?
- Auth/identity provider.
