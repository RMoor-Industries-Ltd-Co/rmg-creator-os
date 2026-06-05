# Contract — A.L.L.I.E

- **Service id:** `allie`
- **Status:** Planned
- **Phase:** Intelligence
- **Owner:** Rahm Moore

## ⚠️ Two ALLIEs — Agent vs Persona (do not conflate)
Like ALLEN, "ALLIE" names two things:
- **ALLIE — the Agent** (THIS contract): the investigator/research AI service.
- **ALLIE — the Persona**: a **content character** (defined by the "ALLIE — Persona
  Default" preset) — a speaker in produced content, and a **Character** with its own
  ElevenLabs voice + HeyGen avatar (see contract 08).
The Agent writes/voices the Persona, same recursion as ALLEN (see contract 04).

## Mission (the Agent)
The investigator agent — and the **always-on distribution brain**. ALLIE makes ALLEN
knowledgeable *and* makes **My Poster** effective: continuously gathering, vetting, and
structuring context from RSS, agentic searches, and deep dives, so (a) ALLEN's scripts are
current and grounded, and (b) every post ships with **research-backed SEO metadata**. She is
always working, and always **suggesting the next topic for each brand**.

## Inputs
- RSS feeds (trending articles per brand/topic).
- Research targets / queries (from gateway, ALLEN, or My Poster).
- The personal online library (documents, references).
- A production's brand + topic + final transcript (to tailor post metadata).

## Outputs
- Structured, cited knowledge context for ALLEN.
- **Post metadata suggestions for My Poster:** popular **hashtags**, platform-tuned
  **descriptions/captions**, **first comments**, and **suggested target audiences**.
- Trend signals + a **next-topic suggestion per brand** (the always-on queue).
- A maintained knowledge base / index for retrieval.

## Responsibilities (in scope)
- RSS ingestion + dedup + relevance ranking per brand.
- Deep-research runs (multi-source fetch, verify, synthesize, cite).
- **SEO/metadata research:** trending + high-reach hashtags, audience targeting, and
  description/first-comment drafts per platform, fed to My Poster.
- Always-on **topic generation** per brand (a standing suggestion queue).
- Ingest + index the personal library for retrieval.

## Out of scope (for now)
- Writing the brand *script* copy (that is ALLEN's job) and the final caption *voice*
  (ALLEN may polish); ALLIE supplies the researched raw metadata.
- The actual scheduling/publishing (My Poster cockpit + Social Manager engine).
- Final retrieval/model stack (deferred).

## Dependencies
- **Services:** ALLEN (primary consumer), gateway (topic seeding/jobs).
- **Integrations / external:** RSS sources; web search/fetch; personal library store.
- **Models / AI:** embeddings + retrieval; summarization/verification model (TBD).
- **Data:** vector index + Postgres (sources, claims, citations); Drive (library files).

## Interface (high-level)
- **Exposes:** `POST /research` (query → cited synthesis), `GET /trends?brand=`,
  library ingest endpoints.
- **Consumes:** RSS pulls; research jobs.

## Brands / stores touched
All brands (trend/topic sourcing), plus store-relevant research for HVN, R+R, BU$Y_MF.

## Success criteria
Given a brand, ALLIE surfaces fresh trending topics and, on request, returns a
verified, cited briefing that measurably improves ALLEN's drafts.

## Open questions
- Retrieval architecture (vector DB choice, chunking, freshness).
- Source trust/verification policy.
- Personal library format + access.
