# RMG Creator OS

## Master Atelier

**Master Atelier is the full RMG creator suite.**

`rmg-creator-os` is the software platform and monorepo that implements Master Atelier behind the scenes. The repository should always be understood in that context: individual applications and services are subsystems of one unified product, not disconnected standalone products.

Master Atelier is RMG's proprietary end-to-end content production, intelligence, orchestration, advertising, and publishing environment.

**Core promise:** minimal high-value input -> maximum social-ready output.

- **Input:** a raw image, video, music, transcript - or a **topic**.
- **Output:** social-ready creative that ships as **content, ads, or posts**, on a schedule, in the correct **brand voice**.

The operator-facing Master Atelier experience is the control surface for the suite. Current product areas include **Overview**, **Production**, **Studio**, and **Ad Index**, while the services below operate behind that interface.

## The suite

| Service | Role in Master Atelier |
|---|---|
| **Gateway / Orchestrator** | Control plane. The Job + Recipe engine that turns input into scheduled output by routing work across services. |
| **Dashboard** | Unified Master Atelier control-plane UI at `rmg-creator-os.rmasters.group`. |
| **Story Director** | Raw recording + script -> edited, branded, captioned video packages. |
| **Social Manager** | Scheduling, provider integration, and publishing across social platforms and Shopify ad targets. It is a native Master Atelier subsystem, even when independently deployable. |
| **A.L.L.E.N** | Speech-enabled interface to the company LLM. Owns or evolves toward scriptwriting, brand voice, and operator interaction. |
| **A.L.L.I.E** | Investigator agent. Feeds ALLEN knowledge from RSS, deep web research, and the personal library. |
| **My Poster** | Image enhancement + Shopify product photos, descriptions, tags, and pricing. |
| **Life OS** | Personal daily-activity tracking -> ClickUp. Surfaced under the dashboard "Personal" area. (Python service.) |

## Product model

The orchestrator is the operational core of Master Atelier:

```text
input (image | video | music | transcript | topic)
   -> Recipe (which services, in what order)
   -> Job (one durable execution of that Recipe)
   -> output (content | ad | post)
   -> schedule / publish (Social Manager)
```

A representative autonomous path is:

```text
Topic
  -> ALLIE research
  -> ALLEN brand-voice script
  -> Story Director or My Poster
  -> Social Manager
  -> destination platform / Shopify target
```

This repository should preserve that end-to-end model as services evolve. Local optimizations inside one service must not obscure Master Atelier's system-level workflow, shared contracts, or control-plane responsibilities.

## Brands & stores

- **Brand voices:** VLOG, COM, The Rahm Council, Royal Reservations, BU$Y_MF
- **Shopify stores (ad targets):** HVN, R+R, BU$Y_MF

## Architecture at a glance

- **Monorepo**, TypeScript-first. Each service is independently deployable (**microservices**) while remaining part of Master Atelier.
- **Control Linode** runs the stack behind **Caddy** (auto-TLS) on `rmg-creator-os.rmasters.group`.
- **Render Linode** (the former Story Director box) is a dedicated render worker.
- Nodes are joined privately over **Tailscale**; **Redis + BullMQ** is the job backbone; **Postgres** is shared state.
- **Google Drive** stores media assets; **Google Docs** holds creative writing.

See [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md) and the decision record in [`docs/adr/0001-ecosystem-architecture.md`](docs/adr/0001-ecosystem-architecture.md).

## Feature contracts

Each feature has a **contract** capturing its mission, inputs/outputs, scope, dependencies, and phase - so future initiatives are tracked before they're built. Contracts now live in [`rmg-piaar-system/contracts/`](https://github.com/RMoor-Industries-Ltd-Co/rmg-piaar-system/tree/main/contracts) - read that repo first for the full system picture; [`docs/contracts/`](docs/contracts/README.md) here is a frozen, unmaintained archive.

## Status

Master Atelier is actively evolving. Infrastructure, contracts, orchestration, production workflows, AI services, and publishing capabilities should be developed as one coordinated suite.
