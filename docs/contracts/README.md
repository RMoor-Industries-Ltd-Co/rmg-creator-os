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
| 03 | [Social Manager](03-social-manager.md) | `social-manager` | Planned |
| 04 | [A.L.L.E.N](04-allen.md) | `allen` | Planned |
| 05 | [A.L.L.I.E](05-allie.md) | `allie` | Planned |
| 06 | [My Poster](06-my-poster.md) | `my-poster` | Planned |
| 07 | [Life OS](07-life-os.md) | `life-os` | Live (standalone) |
| 08 | [Character Pipeline](08-character-pipeline.md) | `character-pipeline` | Planned |
| 09 | [Higgsfield Integration](09-higgsfield-integration.md) | `higgsfield` | Planned |
| 10 | [ElevenLabs Integration](10-elevenlabs-integration.md) | `elevenlabs` | Planned |

**Integrations note:** HeyGen (avatar video) is already built and live in
`packages/integrations`; Higgsfield and ElevenLabs join it per the contracts above.

## Conventions

- **Status:** Planned → In design → In build → Live.
- A contract change that alters inputs/outputs is a breaking change — note it and bump
  the consuming services.
- Cross-service work flows as **BullMQ jobs**; contracts name the jobs they emit/consume.
