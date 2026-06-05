# Feature Contracts

Each feature of RMG Creator OS has a contract describing its mission, inputs/outputs,
scope, dependencies, and the interface it will expose. Contracts let us **track the
ambition of future initiatives** before committing code, and serve as the spec each
service is built against.

Start new contracts from [`_template.md`](_template.md).

## Index

| # | Contract | Service id | Status |
|---|---|---|---|
| 00 | [Gateway / Orchestrator](00-gateway-orchestrator.md) | `gateway` | Planned |
| 01 | [Dashboard](01-dashboard.md) | `dashboard` | Planned |
| 02 | [Story Director](02-story-director.md) | `story-director` | In build |
| 03 | [Social Manager (Publish Engine)](03-social-manager.md) | `social-manager` | Planned (Postiz chosen) |
| 04 | [A.L.L.E.N](04-allen.md) | `allen` | Planned |
| 05 | [A.L.L.I.E](05-allie.md) | `allie` | Planned |
| 06 | [My Poster (Publishing Cockpit)](06-my-poster.md) | `my-poster` | Planned (scheduler cockpit) |
| 07 | [Life OS](07-life-os.md) | `life-os` | Live (standalone) |
| 08 | [Character Pipeline](08-character-pipeline.md) | `character-pipeline` | Planned |
| 09 | [Higgsfield Integration](09-higgsfield-integration.md) | `higgsfield` | Planned (CLI auth'd) |
| 10 | [ElevenLabs Integration](10-elevenlabs-integration.md) | `elevenlabs` | Planned (key set) |
| 11 | [Asset Storage & Lifecycle](11-asset-lifecycle.md) | `asset-lifecycle` | Planned (Drive folders live) |
| 12 | [Brand & Capability Model](12-brand-model.md) | `brand-model` | **Canonical** |
| 13 | [Production Wizard & Record](13-production-wizard.md) | `production-wizard` | Planned (spec) |
| 14 | [Integration Contract (Control Plane ⇄ Services)](14-integration-contract.md) | `integration` | In build |
| 15 | [SuperCool Integration (Finishing & Publishing)](15-supercool-integration.md) | `supercool` | Connected (MCP) |

**Integrations note:** HeyGen (avatar video) is built and live in `packages/integrations`;
Higgsfield (CLI) + ElevenLabs (REST) + Pexels/Pixabay (REST) are wired; SuperCool joins via
MCP for finishing & publishing. **Contract 14** governs the seams (auth, payloads, statuses,
retries, errors, cost) across all of them — it is the ASR §12 "Integration Contract."
Contracts **12** (Brand & Capability Model) and **13** (Production Wizard), also recommended by
ASR §12, are already present above.

## Conventions

- **Status:** Planned → In design → In build → Live.
- A contract change that alters inputs/outputs is a breaking change — note it and bump
  the consuming services.
- Cross-service work flows as **BullMQ jobs**; contracts name the jobs they emit/consume.
