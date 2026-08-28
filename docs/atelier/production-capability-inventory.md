# Master Atelier — Production Capability Inventory

Companion to [`sprint-00-readiness-audit.md`](sprint-00-readiness-audit.md). Every row is
evidence-linked to real code. **Maturity** uses the 0–5 scale (0 absent · 1 concept · 2 partly
documented · 3 implemented-but-fragile · 4 repeatable-with-known-gaps · 5 production-ready &
validated).

## Pipeline capabilities

| Stage | Capability | Key code | Maturity | Notes |
|---|---|---|---|---|
| Script | Topic → brand-voice script + Google Doc | `POST /productions` → ALLEN `/draft` | 4 | Works; wholly dependent on external ALLEN. |
| Script | Manual script edit | `PATCH /productions/:id/script` | 4 | |
| Voice | Emotional direction → tagged script (v2/v3) | `POST /productions/:id/direct` (ALLEN) | 3 | v3 non-deterministic; edits saved via `PATCH .../tagged-script`. |
| Voice | Render take (mp3) to Drive | `POST /productions/:id/speak` (ALLEN) | 3 | Take stored as asset; pointer-swap per version. |
| Voice | **Approved-take lock** | `voiceTakeAssetIdV3`, `hostVoiceTrack()` | 4 | A-Roll serves the approved take, never a re-synth (PR #28). High-value. |
| Assets | Upload / library / attach / thumbnails | `/productions/:id/assets`, `/assets/library` | 4 | Drive-backed; clean lifecycle. |
| Generate (A-Roll) | Voice synth + HeyGen lip-sync | `POST /productions/:id/generate` | 3 | HeyGen HTTP client; v2 API sunset 2026-10-31. |
| Scene/Image | Higgsfield imagery + Soul/Element consistency | `POST /productions/:id/higgsfield`, `/souls`, `/elements` | 3 | **CLI wrapper on host** — deployment coupling. |
| Characters | Reusable identity + roster binding | `characters` table, `/characters*`, `/productions/:id/character(s)` | 3 | Soul/Element (PR #28); status text-union. |
| B-Roll | Atelier providers (Higgsfield/SuperCool/Canva) | `routes/atelier_broll.ts` | 3 | SuperCool = MCP-in-loop (not server-callable); Canva = string only. |
| B-Roll | Stock (Pexels/Pixabay) | `stock.ts`, `/broll/*`, `/productions/:id/broll-suggest` | 4 | Real HTTP client. |
| Clips/Final | Label + download every clip; import external clip by URL | `/productions/:id/clips`, `/import-clip` | 3 | CapCut/offsite loop; SuperCool import via URL. |
| Final Cut | Assemble + upload offsite-edited final | `routes/delivery.ts` `POST /productions/:id/final-cut` | 3 | Primary QA/approval surface. |
| Delivery | Per-brand approval gate + Ad Index | `deliveryApprovals` jsonb, `/ad-index/:code` | 4 | Ad Index nomenclature is canonical. |
| Social | Post composition + Postiz publish | `postiz.ts`, `/productions/:id/{posts,publish,suggest}` | 3 | Per-platform copy; brand post-defaults. |
| Thumbnail/Poster | My Poster cover selection | contract 06 / `production_job_capability: poster` | 2 | Contracted + enum value; thin in-repo surface. |
| Assistant | ALLEN chat / brief / STT / memory | `/allen/*` | 3 | All external ALLEN. |
| Trends | Allie outliers / feeds | `/allie/*`, `/brands/:brand/{trends,feeds}`, `youtube.ts` | 3 | |

## Platform capabilities

| Capability | Key code | Maturity | Notes |
|---|---|---|---|
| Durable job queue | `production_jobs`, `queue.ts`, `worker.ts` `POST /worker/tick` | 3 | Attempt/backoff/lock/cancel present; **HTTP-tick driven** (architecture names BullMQ, impl is DB-poll). |
| Provider/renderer abstraction | `(capability, provider)` branch in `worker.ts` | 3 | No formal interface; each provider hard-branched. |
| Brand model | `packages/types` `BrandKey`/`BrandProfile`/`BRANDS`; `brandPostDefaults` | 3 | DB stores `brand` as **free text** (no FK/enum). |
| Asset storage | `drive.ts` (OAuth) | 4 | Source of truth for media. |
| AI orchestration | `allen.ts` → external ALLEN | 3 | Single dependency; **no output validation**. |
| Human review/approval | dashboard `*.tsx` per stage + `deliveryApprovals` | 4 | Broad coverage; strong asset. |
| Auth | single-user Google (`/auth/*`) | 4 | Small-team model, by design. |
| Health/observability | `GET /health` aggregating pg/redis/heygen/higgsfield/drive/ALLEN | 3 | Good health probe; no render/AI provenance standard. |
| CI/CD | `.github/workflows/{ci,publish-images,deploy}.yml` | 3 | Chain works; gate = **typecheck + build only**, no tests. |
| Testing/QA | `e2e/smoke.spec.ts` (3 smoke tests vs live prod) | 1 | No unit runner, no fixtures. |
| Contracts/docs | `rmg-piaar-system/contracts/` 00–29; `docs/{architecture,adr}` | 4 | Strong; drift + duplicate frozen mirror. |

## Integrations maturity

| Vendor | Form | Maturity | Notes |
|---|---|---|---|
| HeyGen | HTTP client (`heygen.ts`) | 4 | v2 API; migrate to v3 before 2026-10-31. |
| Google Drive | HTTP client (`drive.ts`) | 4 | OAuth refresh-token. |
| Pexels/Pixabay | HTTP client (`stock.ts`) | 4 | |
| Higgsfield | **Host CLI wrapper** (`higgsfield.ts`) | 3 | Binary + creds on gateway host; no public API. |
| ElevenLabs | via external ALLEN only | 2 | No in-repo wrapper; contract 10 documents it. |
| SuperCool | MCP/assistant-in-loop | 2 | Not server-callable; URL import only. |
| Canva | reference string only | 1 | No module. |
| Postiz | app module (`postiz.ts`) | 3 | Publishing. |

## Sustained assets to protect (high-value — do not regress)

1. **`production_jobs` queue + `(capability, provider)` dispatch** — the durable spine
   (`packages/db/src/queue.ts`, `apps/gateway/src/worker.ts`).
2. **Staged Production Wizard + `productions` record** — the whole operator flow
   (`ProductionWizard.tsx`, `productions` schema).
3. **Approved-voice-take lock** (`voiceTakeAssetIdV3` / `hostVoiceTrack`) — kills voice drift.
4. **Soul/Element character consistency** (`characters`, `/higgsfield` soul/element binding).
5. **Drive-as-source-of-truth asset lifecycle** (`drive.ts` + asset routes + library).
6. **Per-brand delivery approval gate + Ad Index nomenclature** (`deliveryApprovals`, `/ad-index`).
7. **Human-review surfaces at every stage** (VoiceDirection/HiggsfieldPanel/FinalCut/Post…).
8. **Contract/ADR discipline + canonical registry** (`rmg-piaar-system/contracts/`, house template,
   the new DECIDED/PROVISIONAL tagging).
9. **CI → Publish → Deploy automation** (Doppler + GHCR + auto-deploy).
10. **Aggregated `/health` probe** across every external dependency.

These are the components any future refactor (including Sprint 1's foundation work) must keep
green.
