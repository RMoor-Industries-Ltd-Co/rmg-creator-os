# Architecture Overview

## Topology

```
            rmg-creator-os.rmasters.group  ──►  Caddy (auto-TLS reverse proxy)
                                                      │
   ┌──────────────────────────────────────────────────┐
   │  CONTROL LINODE (new)                              │
   │   dashboard          (web UI)                      │
   │   gateway            (orchestrator: Job + Recipe)  │
   │   story-director     (service)                     │
   │   social-manager     (service)                     │
   │   allen              (service)                     │
   │   allie              (service)                     │
   │   my-poster          (service)                     │
   │   life-os            (Python service, "Personal")  │
   │   shared:  Postgres · Redis (BullMQ) · scheduler   │
   └───────────────┬────────────────────────────────────┘
                   │  Tailscale (private mesh; Redis/Postgres bind to tailnet)
   ┌───────────────┴────────────────────────────────────┐
   │  RENDER LINODE (former Story Director box)          │
   │   worker-render (+ heavy ffmpeg / transcribe)       │
   │   consumes render jobs from the control Redis queue │
   └─────────────────────────────────────────────────────┘
```

## The orchestrator (the actual product)

```
input (image | video | music | transcript | topic)
   → Recipe (which services, in what order)
   → output (content | ad | post)
   → schedule (Social Manager)
```

**Topic path:** ALLIE pulls RSS / deep-research / personal library → ALLEN drafts a
brand-voice script → Story Director (video) or My Poster (graphic) → Social Manager
schedules to the platform / Shopify store.

A `Job` is a single run of a `Recipe`. Both are first-class entities in the shared
Postgres DB and move between services as durable BullMQ jobs.

## Cross-cutting decisions

| Concern | Decision |
|---|---|
| Repo | Single TS monorepo (`rmg-creator-os`); Story Director folds in |
| Deploy | Microservices — one deployable per service |
| Front door | Caddy auto-TLS → `rmg-creator-os.rmasters.group` |
| Inter-service comms | Redis + BullMQ durable jobs (not brittle direct calls) |
| Shared state | Postgres (Drizzle ORM) |
| Assets | Google Drive (media) + Google Docs (creative writing) |
| Nodes | Control Linode + render Linode, joined by Tailscale |
| Auth | Internal/proprietary; single small team |
| Brand voice | Shared `packages/brand-voice` (grown from brand-presets) |

## Planned monorepo layout

```
apps/
  gateway/          social-manager/   allie/        worker-transcribe/
  dashboard/        allen/            my-poster/     worker-media/
  story-director/                                    worker-render/  (→ render node)
packages/
  types/  brand-voice/  ai-prompts/  integrations/  db/  queue/  storage/  auth/  ui/
infra/
  control-server/   render-node/   caddy/
docs/
  architecture/  adr/  contracts/
```

`life-os` (Python) stays its own service; the dashboard links to its Fillout form
under "Personal," and it continues pushing to ClickUp.
