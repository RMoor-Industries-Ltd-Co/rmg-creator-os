# RMG PIAAR — Session 3 Handoff

**Date:** 2026-06-28  
**Continuing from:** Session 2 (`claude/rmg-piaar-session-2-ye98zv`)  
**Dashboard URL:** https://rmg-creator-os.rmasters.group/  
**Server:** 45.33.96.135 (SSH as root)

---

## Immediate First Actions

1. **Merge PR #22** in `rmg-creator-os` — CI is green, branch is clean, `mergeable_state: clean`.  
   URL: https://github.com/RMoor-Industries-Ltd-Co/rmg-creator-os/pull/22

2. **Test the dashboard UI** at https://rmg-creator-os.rmasters.group/ using Playwright (Chromium is pre-installed). Test:
   - Assets step → Brand Library tab (thumbnails from `GDRIVE_LIBRARY_FOLDER_ID`)
   - Assets step → click image to shortlist (accent border + ✓ badge), count shows in header
   - Scenes step → model picker opens dropdown with 📝/📷 badges loading per model
   - Scenes step → image-only model (e.g. AutoSprite Animation) shows "reference images required" instead of red error
   - Scenes step → only shortlisted images appear as reference photo options

3. **Set up `rmg-piaar-system` repo** — newly created at `RMoor-Industries-Ltd-Co/rmg-piaar-system`, not yet populated. Clone it and:
   - Move `rmg-creator-os/docs/contracts/` into it as the canonical contracts location
   - Write a system-wide `CLAUDE.md` covering how all repos relate (see structure below)
   - Add a one-line pointer to `rmg-piaar-system` in each repo's `CLAUDE.md`

---

## Repo Map

| Repo | Purpose | Stack |
|---|---|---|
| `rmg-creator-os` | Control plane — production wizard, gateway API, dashboard | pnpm monorepo: Fastify gateway, Vite/React dashboard, Drizzle/Postgres |
| `rmg-ai` | ALLEN AI service — script generation, WhatsApp, voice direction | Python FastAPI |
| `hvnhavenry-com` | Haven Henry marketing site | Next.js |
| `axis-tekhen` | Forex algo trading platform | Flask/Python + React/Vite |
| `cappo_meridian` | Apex Meridian Group project-management hub | Next.js App Router |
| `connection-circle` | (not yet explored this session) | Unknown |
| `rmg-piaar-system` | NEW — cross-project contracts, architecture, pipeline specs | Docs only |

---

## Branch Convention (this session)

All repos use branch: `claude/rmg-piaar-session-2-ye98zv`  
New session should use a new branch name — suggest: `claude/rmg-piaar-session-3-XXXXXX`

---

## What Was Built This Session (all merged to main except PR #22)

### rmg-creator-os

| Feature | Status | Notes |
|---|---|---|
| ElevenLabs v3 emotion bracket tags | ✅ main | ALLEN generates `[emphatic]`, `[drawn out]`, `[pause]` etc. |
| Brand voice memory | ✅ main | Few-shot examples from prior `tagged_script` records |
| Drive write non-fatal | ✅ main | ALLEN soft-warns on Drive failure instead of 502 |
| Editable script textarea + Save/Discard | ✅ main | Script step in ProductionWizard |
| "✨ Enhance for voice" button | ✅ main | Runs emotion direction inline on Script step |
| Per-model capability detection | ✅ main | `/higgsfield/models/:model/schema` endpoint |
| Production queue (Phase 0) | ✅ main | `production_jobs` table, worker tick, queue widget |
| A-Roll / B-Roll / Ad Index routes | ✅ main | Delivery routes, queue wiring |
| Brand Library tab (Assets) | 🟡 PR #22 | Drive folder `GDRIVE_LIBRARY_FOLDER_ID` → thumbnails → one-click attach |
| Smart model picker with badges | 🟡 PR #22 | Custom dropdown, batch schema load, 📝/📷 per model |
| Image-only model fix | 🟡 PR #22 | No more red blocking error; `--prompt` skipped when model doesn't support it |
| Image shortlist (Assets → Scenes) | 🟡 PR #22 | Click thumbnails to shortlist; Scenes page only proxies shortlisted images |

### rmg-ai (all merged)

| Feature | Status |
|---|---|
| Drive write non-fatal | ✅ main |
| v3 audio bracket tags in `draft` and `direct` endpoints | ✅ main |
| Brand voice memory via few-shot DB query | ✅ main |

---

## Open Items / Next Up

### 1. `rmg-piaar-system` Setup (highest priority)
- Clone into session
- Copy `rmg-creator-os/docs/contracts/` → `rmg-piaar-system/contracts/`
- Write `CLAUDE.md` with full system overview (repo map, production pipeline, secret strategy, naming conventions, Ad Index codes)
- Add pointer from each repo's `CLAUDE.md` → `rmg-piaar-system`
- Remove `docs/contracts/` from `rmg-creator-os` (it doesn't belong there)

### 2. My Poster — Contract 06 (production pipeline)
- Core post/delivery routes already built (`Post.tsx`, delivery routes, Postiz integration)
- **Missing:** cover/poster image generation — after Higgsfield produces a clean image, user picks or auto-generates a cover for the social post
- **Missing:** per-brand approval gate — before a post goes to Postiz/scheduling, require explicit approve per brand
- Contract lives at `rmg-creator-os/docs/contracts/06-my-poster.md` (to be moved to `rmg-piaar-system`)

### 3. UI Validation (after PR #22 merge + deploy)
- Use Playwright at https://rmg-creator-os.rmasters.group/
- Test Assets Brand Library, shortlist, Scenes model picker, image-only model flow
- Report pass/fail per feature before marking session complete

### 4. Server SSH Access
- User wants to give admin SSH access to Claude for direct validation, log tailing, migration checks
- Server: `45.33.96.135`, SSH as `root`
- Action: user to add a Claude-session SSH key; store private key as an environment variable in the Claude Code web environment

---

## Key Secrets / Config

| Secret | Location | Notes |
|---|---|---|
| `GDRIVE_LIBRARY_FOLDER_ID` | Doppler `master-atelier prd` | Added this session — folder ID: `1FGviBasJq-7lMjQCM1L5bdd7or3Z3zN8` |
| `YOUTUBE_API_KEY` | Doppler `master-atelier prd` | Added Jun 27 2026 |
| `DATABASE_URL` | Built by docker-compose | Never add to Doppler |
| All other secrets | Doppler `master-atelier prd` | Injected by deploy script |

---

## Architecture Quick-Reference (rmg-creator-os)

- **Monorepo:** pnpm workspaces — `apps/gateway`, `apps/dashboard`, `packages/db`, `packages/integrations`
- **DB:** Drizzle ORM + PostgreSQL 16. Migrations in `packages/db/drizzle/`. Auto-run on gateway startup.
- **Queue:** `production_jobs` table, claimed by `POST /worker/tick`
- **CI/CD:** push to `main` → CI (typecheck) → Publish Images (GHCR) → Deploy to `45.33.96.135`
- **Containers:** gateway, dashboard, allen, db, redis, caddy (compose project: `control-server`)

---

## PR #22 Details

**Repo:** `rmg-creator-os`  
**Branch:** `claude/rmg-piaar-session-2-ye98zv`  
**Status:** CI green, `mergeable_state: clean`, 3 commits, 512 additions / 155 deletions  
**Files changed:**
- `packages/integrations/src/drive.ts` — listFolder adds thumbnailLink
- `apps/gateway/src/server.ts` — /assets/library + /productions/:id/assets/attach routes
- `apps/dashboard/src/api.ts` — LibraryFile type, library(), attach()
- `apps/dashboard/src/Assets.tsx` — Brand Library tab + shortlist selection
- `apps/dashboard/src/HiggsfieldPanel.tsx` — batch schema load, custom picker, image-only model fix
- `packages/integrations/src/higgsfield.ts` — prompt optional in createJob
- `apps/dashboard/src/index.css` — model picker + shortlist styles
