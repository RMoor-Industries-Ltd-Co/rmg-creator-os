# Contract — A.L.L.I.E

- **Service id:** `allie`
- **Status:** Planned
- **Phase:** Intelligence
- **Owner:** Rahm Moore

## Mission
The investigator agent. ALLIE makes ALLEN knowledgeable — continuously gathering,
vetting, and structuring context from RSS feeds, internet deep-dives, and the personal
online library, so ALLEN's scripts are current, accurate, and grounded.

## Inputs
- RSS feeds (trending articles per brand/topic).
- Research targets / queries (from gateway or ALLEN).
- The personal online library (documents, references).

## Outputs
- Structured, cited knowledge context for ALLEN.
- Trend signals (what's hot per brand) that can seed topics → Recipes.
- A maintained knowledge base / index for retrieval.

## Responsibilities (in scope)
- RSS ingestion + dedup + relevance ranking per brand.
- Deep-research runs (multi-source fetch, verify, synthesize, cite).
- Ingest + index the personal library for retrieval.
- Hand ALLEN grounded, sourced context on demand.

## Out of scope (for now)
- Writing brand copy (that is ALLEN's job).
- Publishing decisions (Social Manager).
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
