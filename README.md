# RMG Creator OS

A proprietary, in-house content ecosystem for marketing & sales.

**Core promise:** minimal high-value input → maximum social-ready output.

- **Input:** a raw image, video, music, transcript — or a **topic**.
- **Output:** social-ready creative that ships as **content, ads, or posts**, on a schedule, in the right **brand voice**.

## The suite

| Service | Role |
|---|---|
| **Gateway / Orchestrator** | Control plane. The Job + Recipe engine that turns input into scheduled output by routing work across services. |
| **Dashboard** | Unified control-plane UI at `rmg-creator-os.rmasters.group`. |
| **Story Director** | Raw recording + script → edited, branded, captioned video packages. |
| **Social Manager** | Scheduling & publishing across social platforms and Shopify ad targets. |
| **A.L.L.E.N** | Speech-enabled interface to the company LLM. Eventually owns scriptwriting + brand voice. |
| **A.L.L.I.E** | Investigator agent. Feeds ALLEN knowledge from RSS, deep web research, and the personal library. |
| **My Poster** | Image enhancement + Shopify product photos, descriptions, tags, and pricing. |
| **Life OS** | Personal daily-activity tracking → ClickUp. Surfaced under the dashboard "Personal" area. (Python service.) |

## Brands & stores

- **Brand voices:** VLOG, COM, The Rahm Council, Royal Reservations, BU$Y_MF
- **Shopify stores (ad targets):** HVN, R+R, BU$Y_MF

## Architecture at a glance

- **Monorepo**, TypeScript-first. Each service is independently deployable (**microservices**).
- **Control Linode** runs the stack behind **Caddy** (auto-TLS) on `rmg-creator-os.rmasters.group`.
- **Render Linode** (the former Story Director box) is a dedicated render worker.
- Nodes are joined privately over **Tailscale**; **Redis + BullMQ** is the job backbone; **Postgres** is shared state.
- **Google Drive** stores media assets; **Google Docs** holds creative writing.

See [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md) and the decision record in [`docs/adr/0001-ecosystem-architecture.md`](docs/adr/0001-ecosystem-architecture.md).

## Feature contracts

Each feature has a **contract** capturing its mission, inputs/outputs, scope, dependencies, and phase — so future initiatives are tracked before they're built. Contracts now live in [`rmg-piaar-system/contracts/`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/tree/main/contracts) — read that repo first for the full system picture; [`docs/contracts/`](docs/contracts/README.md) here is a frozen, unmaintained archive.

## Status

Bootstrapping. Contracts + control-server infra first; service code follows.
