# Master Atelier — Provider Line Refinement Proposal

- **Status:** PROPOSED
- **Scope:** Master Atelier production line only
- **Decision date:** 2026-09-11
- **Owner:** Rahm Moore

## Purpose

Refine the Master Atelier production provider line so each external service has a narrow,
intentional production authority. The goal is to reduce capability overlap, protect identity
consistency, and keep the production spine provider-agnostic enough to add or retire services
without destabilizing the end-to-end workflow.

This proposal does **not** change live provider wiring. It documents the target arrangement
for evaluation and future implementation.

## Commercial status change

The SuperCool subscription has been cancelled. No new Master Atelier capability should depend
on SuperCool. Existing code, contracts, UI labels, or import paths that reference SuperCool are
legacy state and should be removed or migrated deliberately in a later implementation change.

## Proposed provider authority model

| Authority | Preferred service | Role in Master Atelier | Status |
|---|---|---|---|
| Creative intelligence / orchestration | ALLEN / ChatGPT-facing intelligence layer | Script development, direction, planning, production decisions, metadata and orchestration | KEEP |
| Canonical character imagery / cinematic identity | Higgsfield | Character-critical imagery, Soul/Element consistency, cinematic character scenes, visual identity preservation | KEEP — STRATEGIC |
| Canonical avatar performance / lip-sync | HeyGen | Talking-head performance, presenter video, digital-twin/avatar execution and lip-sync | KEEP — SPECIALIZED |
| Canonical voice | ElevenLabs via ALLEN | Persistent voice identity, approved voice takes and narration | KEEP — STRATEGIC |
| Licensed production assets + commodity generation | Artlist | Proposed source for licensed music/SFX/stock footage/templates and non-identity-critical AI image/video generation | PROPOSED — NOT YET ENABLED |
| Brand graphics / lightweight motion | Canva | Brand-forward graphics, title cards, simple motion assets and design handoff | KEEP — SUPPORTING |
| Media system of record | Google Drive | Durable source of truth for production assets, approved outputs and imported media | KEEP — SYSTEM OF RECORD |
| Fast external finishing | CapCut | Optional operator finishing path while native finishing remains incomplete | KEEP — EXTERNAL FALLBACK |
| Social publishing | Postiz / existing publishing layer | Platform post creation and publishing after approval | KEEP |

## Artlist boundary

Artlist is proposed as a **production-services and licensed-assets layer**, not as a replacement
for the identity-critical providers.

If adopted, Artlist should be preferred for:

- stock footage and establishing shots;
- licensed music beds and sound effects;
- templates and non-character production assets;
- commodity AI image/video generation where character identity is not authoritative;
- alternate model access when a specialized provider is unnecessary;
- future MCP/plugin integration if its production interface proves suitable for unattended or
  governed Creator OS execution.

Artlist should **not** automatically replace:

- Higgsfield Soul/Element-based character identity;
- HeyGen canonical avatar/digital-twin performance;
- ElevenLabs canonical voice identity or the approved-take lock;
- Drive as the media source of truth;
- the Creator OS production queue, approval gates, or provenance model.

No Artlist credentials, provider enums, worker branches, MCP routes, or production dependencies
should be added until the service has been purchased and evaluated.

## Provider-selection principle

Creator OS should choose a provider by **production authority**, not by whichever vendor exposes
the largest feature list.

A provider may expose overlapping capabilities, but only one service should be authoritative for
an identity-critical concern. Commodity work may use interchangeable providers behind the
existing `(capability, provider)` job model.

### Identity-critical work

Identity-critical work must remain deterministic at the provider boundary:

1. Character identity → Higgsfield Soul/Element binding.
2. Avatar/talking-head identity → HeyGen canonical avatar/digital-twin binding.
3. Voice identity → ElevenLabs canonical voice binding via ALLEN.
4. Approved media → Drive-backed immutable/pointer-swapped approved asset.

Artlist may assist around these stages, but should not become authoritative for a canonical
identity unless a future contract explicitly promotes it.

### Commodity production work

The following should remain provider-swappable:

- generic B-roll;
- environmental shots;
- stock cutaways;
- textures/backgrounds;
- non-canonical generated imagery;
- non-canonical generated video;
- licensed music beds;
- sound effects;
- simple motion/template assets.

This is the preferred Artlist insertion point.

## Target production line

```text
TOPIC / BRIEF
    |
    v
ALLEN / CREATIVE INTELLIGENCE
    |
    +------------------------------+
    |                              |
    v                              v
SCRIPT / DIRECTION            CHARACTER AUTHORITY
                                   |
                                   v
                              HIGGSFIELD
                           Soul / Element identity
                                   |
                                   v
                                HEYGEN
                         avatar / lip-sync performance
                                   |
                                   v
                             ELEVENLABS
                         canonical voice / approved take
                                   |
                                   +--------------------+
                                                        |
ARTLIST (proposed) -------------------------------------+
stock / SFX / music / commodity image-video generation |
                                                        v
                                                   ASSET REVIEW
                                                        |
                                                        v
                                                  GOOGLE DRIVE
                                             source of truth / locks
                                                        |
                                                        v
                                            ASSEMBLY / FINAL REVIEW
                                                        |
                                      +-----------------+----------------+
                                      |                                  |
                                      v                                  v
                              NATIVE CREATOR OS                    CAPCUT FALLBACK
                                      |                                  |
                                      +-----------------+----------------+
                                                        |
                                                        v
                                                   APPROVAL GATE
                                                        |
                                                        v
                                                     POSTIZ
```

## SuperCool retirement rule

SuperCool is now **RETIRED** for future Master Atelier planning.

Until implementation cleanup is completed:

- legacy `supercool` provider values may remain readable so historical production records do not
  break;
- no new jobs should be designed around SuperCool;
- no new contract should cite SuperCool as a required dependency;
- UI references should be removed only when doing so does not break old records/import paths;
- historical provenance must remain intelligible after retirement.

## Architecture changes recommended after evaluation

These are follow-on implementation tasks, not part of this proposal:

1. Formalize a provider adapter interface instead of hard-branching providers in `worker.ts`.
2. Add provider lifecycle state: `active | proposed | deprecated | retired`.
3. Separate **identity authority** from **generation capability** in provider metadata.
4. Preserve legacy provider identifiers for historical provenance even after retirement.
5. Add cost/credit provenance per generated asset and production job.
6. Add an Artlist adapter only after hands-on validation of licensing, output quality,
   authentication, API/MCP behavior, rate limits and credit economics.
7. Route commodity B-roll through policy-based provider selection rather than vendor-specific UI.
8. Keep human approval mandatory before generated assets become canonical or enter final delivery.

## Acceptance gates for Artlist

Artlist should not move from `PROPOSED` to `ACTIVE` until all of the following are verified:

- commercial plan purchased and licensing terms accepted for RMG production use;
- export quality meets Master Atelier requirements;
- generated/downloaded asset provenance can be recorded;
- cost/credit usage can be attributed to a production job;
- integration method is known (API, MCP/plugin, operator-in-loop, or import-only);
- no regression to Higgsfield/HeyGen/ElevenLabs identity authority;
- Drive ingest and asset review work reliably;
- at least one complete Master Atelier production successfully uses Artlist-sourced assets.

## Out of scope

This proposal intentionally excludes:

- FL Studio;
- Suno;
- Bond Daddy or recording-artist workflows;
- broader RMG music-production architecture;
- immediate removal of legacy SuperCool code;
- immediate Artlist implementation or subscription activation.

## Decision summary

The preferred Master Atelier line is a **specialist core plus commodity asset layer**:

- Higgsfield owns canonical visual character identity.
- HeyGen owns canonical avatar performance.
- ElevenLabs owns canonical voice identity.
- Artlist is proposed to own licensed assets and non-identity-critical generation.
- Canva remains a supporting brand-design surface.
- Drive remains the media system of record.
- Creator OS remains the orchestration, queue, review, provenance and approval authority.
- SuperCool is retired from future planning.

This arrangement should be treated as the target architecture to evaluate before further MCP and
provider expansion.