# 06 — Social Manager Disposition

## 0. Scope limit, stated up front

`PIAAR/Social_Manager_v2.0` is under a **personal account**, is not in this session's authorized
repository scope, and the directive instructs that only repositories under
`RMoor-Industries-Ltd-Co` be used. **It was therefore not read.**

Every question below that depends on its *contents* is answered as **UNANSWERABLE FROM
AUTHORIZED EVIDENCE**, with the specific access that would be needed. No inference was made
about its code from its name. That limitation is the honest result, not a gap in the audit.

Questions about **Creator OS** are fully answerable and are answered definitively.

## 1. Is `Social_Manager_v2.0` referenced by Creator OS today?

**No. Definitively no.**

An exhaustive sweep of the repository (source, config, Docker, Compose, Caddy, CI/CD, env
examples, docs, lockfile, dependencies) for `Social_Manager`, `social-manager-v2`,
`github.com/PIAAR`, and `PIAAR/` returns **two hits, both unrelated**:

- `apps/gateway/src/allen.ts:1` — *"Thin client for the isolated ALLEN service (PIAAR/rmg-ai)"*
- `docs/contracts/04-allen.md:10` — the same reference to `rmg-ai`

Both name **`rmg-ai`** under a legacy `PIAAR/` org spelling. Neither references
`Social_Manager_v2.0`.

There is **no** repository reference, git dependency, package dependency, URL, API endpoint,
environment variable, Docker service, CI/CD step, webhook, network call, shared schema,
deployment reference, credential placeholder, source import, or runtime assumption pointing at
it anywhere in Creator OS.

## 2. Is any Social Manager implementation running as part of Creator OS today?

**Yes — but it is Postiz, not `Social_Manager_v2.0`.**

"Social Manager" in Creator OS denotes **self-hosted Postiz**:

- `apps/gateway/src/postiz.ts:1` — *"Client for the self-hosted Postiz public API (the Social
  Manager engine)"*
- `infra/control-server/Caddyfile:28-34` — *"Social Manager for RMG (self-hosted Postiz) —
  separate app, owns its host"*; `social.rmasters.group` → `postiz:5000`
- `infra/control-server/.env.example:38-39` — `POSTIZ_API_KEY`, `POSTIZ_API_URL`
- `apps/dashboard/public/{privacy,terms}.html` — published platform-review pages for *"Social
  Manager for RMG"*, i.e. the OAuth-facing public identity already exists under that name
- `packages/types/src/index.ts:87` — `'social-manager'` is a declared `ServiceId`

Postiz itself runs at `/opt/postiz`, **outside this repository**, bridged onto the Caddy
network. The Creator OS client is **inert without `POSTIZ_API_KEY`** (`postizConfigured()`),
which is why it deploys safely today.

**Note for the founder:** the name "Social Manager" is already publicly bound to the Postiz
deployment through published privacy/terms pages used for platform app review. Two different
systems sharing that name is not merely an internal naming collision.

## 3. Is Social Manager needed for the current Accord MCP work?

**No.**

The current initiative's first reference run terminates at an **acknowledged promotion
handoff**, not at distribution. No publishing engine is on the critical path. The blockers are
authority, durable pause, and an article-shaped job (see [03](03-gap-analysis.md) §2) — none of
which involve publishing.

## 4. At what exact future stage does a publishing engine become necessary?

At the transition **`PROMOTION_READY` → `PROMOTION_ACTIVE`** in the Accord Producer lifecycle —
i.e. after publication of the article, after the promotion package is emitted in the contracted
shape, and after a human authorizes distribution.

In roadmap terms: **LATER**, not NOW and not NEXT.

## 5. What contract does Creator OS currently expect from a publishing engine?

Precisely the **Postiz public API v1** surface, as consumed by `apps/gateway/src/postiz.ts`:

| Operation | Endpoint | Shape |
|---|---|---|
| List connected channels | `GET /integrations` | `{ id, name, identifier, picture?, disabled? }[]` |
| Ingest media by URL | `POST /upload-from-url` | `{ url }` → `{ id, path }` |
| Create post | `POST /posts` | `{ type: draft\|schedule\|now, date, shortLink, tags, posts: [{ integration:{id}, value:[{content, image[]}], settings:{__type: identifier} }] }` |
| Auth | `Authorization: <api key>` | Single static key |

Plus `matchIntegration()`, which aliases platform keys to channel identifiers
(`x`↔`twitter`, `facebook`↔`page`, `instagram`↔`instagram-standalone`).

**Important:** this is a *de facto* contract — it is the shape of Postiz's API, not an
abstraction Creator OS defined. There is **no `PublishEngine` interface** in the codebase. Any
alternative engine would have to either impersonate Postiz's wire format or motivate the
adapter that does not yet exist.

## 6. Does `Social_Manager_v2.0` satisfy that contract today?

**UNANSWERABLE FROM AUTHORIZED EVIDENCE.** Requires read access to the repository, which is
out of scope. What *can* be said: the directive reports it pursuing **direct provider API
integration beginning with YouTube**, which is a fundamentally different shape from a
Postiz-compatible aggregator API. On that description alone the answer is *unlikely*, but that
is the directive's characterization, not a verified finding.

## 7. What overlaps?

**UNANSWERABLE IN DETAIL.** At the level of *intent*, both address "publish content to social
platforms". At the level of *architecture*, the audit can only establish the Creator OS side:
Creator OS expects an **aggregator** (one API fronting many channels, channel identity managed
by the aggregator, one static key). A direct-provider implementation places OAuth, token
refresh, per-platform quota and per-platform payload shaping **inside** the engine.

Those are not variants of one design; they are different placements of the same
responsibilities. That is the architectural divergence the directive anticipated, and this
audit confirms it exists **on the Creator OS side**.

## 8. What conflicts?

Three conflicts are established from authorized evidence:

1. **Name collision with a published identity.** "Social Manager for RMG" is already bound to
   the Postiz deployment in live privacy/terms pages used for platform review (§2). A second
   system under the same name creates ambiguity in a place that faces external reviewers.
2. **Credential-placement conflict.** Postiz holds channel OAuth today. A direct-provider engine
   would hold provider credentials itself. Both holding them simultaneously means two systems
   authorized to post as the same brand — a governance problem, not a technical one.
3. **Contract 03's exclusivity.** `rmg-piaar-system/contracts/03-social-manager.md` makes Social
   Manager **the only caller of Postiz**. A second engine that publishes directly does not
   violate the letter of that rule but does dissolve its intent — single-point publication
   authority.

## 9. What capabilities exist in `Social_Manager_v2.0` that Creator OS should preserve?

**UNANSWERABLE FROM AUTHORIZED EVIDENCE.** Determining this requires reading it.

## 10. What Creator OS requirements are missing from `Social_Manager_v2.0`?

**PARTIALLY ANSWERABLE.** The Creator OS side of the requirement is now documented (§5), so the
comparison can be made the moment access is granted. From the Creator OS side, any engine must
provide: channel enumeration, media ingest by URL, multi-channel post creation with per-channel
payload settings, draft/schedule/now modes, and — a capability **Creator OS does not have
today and needs** — post-publication status and URL **write-back** (`createPost`'s result is
returned to the caller but never persisted; `contracts/11-asset-lifecycle.md` assumes Social
Manager triggers a Drive move on post, which is unimplemented).

## 11. Is migration into `RMoor-Industries-Ltd-Co` warranted?

**Not yet — and not on this initiative's evidence.**

Migration is an organizational act that makes a repository authoritative. Nothing in the current
initiative requires a publishing engine (§3), Creator OS references it nowhere (§1), and its
suitability cannot be assessed without reading it (§6). Migrating first and evaluating second
would invert the order.

**Recommended precondition:** grant read access, run a focused comparison against §5's contract,
*then* decide. That is a small, bounded task and it is the correct next step if the founder
wants this resolved.

## 12. Adopt / adapt / partially reuse / replace / archive / defer?

**DEFER — with a bounded evaluation task.**

Not "archive": that discards work whose value is unknown. Not "adopt" or "replace": both are
decisions that require reading the code. Defer is the only classification the evidence supports.

The deferral is not indefinite. It ends when either (a) the Accord pipeline reaches
`PROMOTION_ACTIVE` and a distribution engine is genuinely needed, or (b) the founder authorizes
the read-access evaluation above — whichever comes first.

## Verdict for the founder

| Question | Answer |
|---|---|
| Currently used by Creator OS? | **No** — zero references, definitively |
| Currently needed for the Accord initiative? | **No** — off the critical path entirely |
| Eventually useful? | **Unknown, not unlikely** — cannot be assessed without read access |
| Architecturally unnecessary? | **Not established.** Postiz is deployed and working, which makes a second engine *currently redundant*; whether it is *permanently* unnecessary depends on decision D-E |

The most consequential thing this audit can say about Social Manager is that **nothing is
blocked by it, and nothing depends on it** — so the decision can be made deliberately, later,
with better evidence, rather than under initiative pressure.
