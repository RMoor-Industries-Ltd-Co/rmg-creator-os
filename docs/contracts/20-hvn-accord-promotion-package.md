# Contract — HVN Accord Promotion Package

> A contract captures the **ambition and boundaries** of a feature before it is built.
> It is a living document: update it as scope sharpens. Code should honor it.

- **Service id:** `hvn-accord-promotion-package`
- **Status:** Planned — spec only, no implementation
- **Phase:** Distribution (upstream handoff)
- **Owner:** Rahm Moore

## Mission

Define how an approved HVN Global "Accord" editorial article (copy + images + SEO
metadata) becomes a promotion-ready input for Master Atelier's existing publishing
stack, without HVN Global reinventing any part of that stack. **HVN Global produces
the article package; Master Atelier (My Poster → Social Manager/Postiz) produces and
publishes the social promotion.** This contract defines the handoff shape, not a new
posting mechanism.

## Inputs

From HVN Global / The Accord (`hvnglobalco-com`'s Accord system —
`docs/accord-architecture.md`, `docs/accord-editorial-image-system.md` in that repo):

- Article title
- Article slug
- Article copy (full body)
- SEO title / meta description
- Hero image + section images (approved final assets only)
- Per-image metadata: product-presence classification (None/Environmental/Editorial/
  Product-forward), distinctiveness-log fields (location, camera angle, palette,
  motif — see that repo's `docs/accord-image-distinctiveness-log.md`)
- CTA (e.g. Inner Circle "Request Access")
- Target audience / category (from the Accord's category list)
- Drive folder location of the approved article package

## Outputs

To Master Atelier, specifically as an input **My Poster** can consume (per
`06-my-poster.md`):

- A promotion brief (article summary, positioning, target audience)
- Platform caption drafts (per-platform, length-aware — My Poster's own per-platform
  metadata editor still does the real editing; this is a starting draft)
- Short teaser copy / hook lines
- Hashtag suggestions
- Image selections (which approved images are candidates for cover/post images)
- Platform-specific crop/variant requirements (dimensions/aspect ratios by platform)
- Suggested schedule/cadence (a recommendation, not a commitment — My Poster owns
  actual scheduling)
- A Postiz package **placeholder** (structure only — no live Postiz call originates
  from this contract; Social Manager remains the only thing that calls Postiz)
- Status fields for published URLs, to be written back **by Social Manager**, not by
  HVN Global

## Responsibilities (in scope)

- Defining the article-package → promotion-brief data shape.
- Defining the Drive folder convention HVN Global stages an approved article package
  in, so Master Atelier has one predictable read location.
- Documenting that Article 1 (or whichever Accord article is used as the pilot — see
  "Open questions" on numbering) is the validation case for this handoff, reviewed by
  the founder end-to-end before any future article skips per-image approval.

## Out of scope (for now)

- Any Postiz API integration or credential — **Social Manager (`03-social-manager.md`)
  remains the only caller of Postiz.**
- Any actual social post, scheduled or published — this contract produces a package,
  not a publish action.
- Any change to `hvnglobalco-com` or `hvnhavenry-com` code.
- Any change to Drive folder contents — moving assets into the structure this
  contract describes is a separate, later, explicitly-authorized action.
- Automating founder approval of Accord images — that stays governed entirely by
  `hvnglobalco-com`'s own `docs/accord-editorial-image-system.md`; this contract
  only consumes the *output* of that approval, never decides it.

## Dependencies

- **Services:** My Poster (`06-my-poster.md`, consumes this package), Social Manager
  (`03-social-manager.md`, publishes once My Poster hands off a post package).
- **Integrations / external:** Google Drive (asset/package storage — HVN Global's own
  `HVN_GLOBAL_LLC_WEBSITE` Drive folder, not a shared bucket).
- **Models / AI:** none introduced by this contract — ALLIE's existing suggestion role
  inside My Poster is unchanged.
- **Data:** the Accord article's own captured/approved copy and image metadata, per
  `hvnglobalco-com`'s existing Accord docs — this contract does not duplicate that
  data, it defines how a *subset* of it maps into a promotion brief.

## Interface (high-level)

- **Exposes:** a documented Drive folder shape (see below) that Master Atelier can
  read from once implementation begins — no API in this phase.
- **Consumes:** nothing automatically yet — a human (or a future automation, once
  built) moves an approved article package into the location this contract defines.

### Drive organization this contract assumes

```
HVN_GLOBAL_LLC_WEBSITE/
├── 00_BRAND/
├── 01_HERO/
├── 02_BLOG/                          <- NEW, permanent home for approved articles
│   └── accord/
│       └── article-[N]-[slug]/
│           ├── copy/
│           ├── prompts/
│           ├── images/
│           │   ├── approved-final/
│           │   └── source-candidates/
│           ├── metadata/
│           └── promotion/
│               ├── social-copy/
│               ├── postiz-package/         <- placeholder structure only
│               └── platform-variants/
├── PROMOTIONS/                        (broader campaign-level creative, unchanged)
├── _REFERENCE/
├── _INBOX/
│   └── generated-room-concepts/
│       └── accord/
│           └── article-[N]-[slug]/    <- staging only, pre-approval
└── _ARCHIVE/
```

`_INBOX` is staging/review. `02_BLOG` is the approved, permanent article package —
only an article that has cleared HVN Global's own founder-approval gate moves there.
`[N]` is the article's resolved position in the Accord's own capture index
(`hvnglobalco-com`'s `docs/accord-content-inventory.md`), not an assumed "Article 1."

## Brands / stores touched

HVN (via HVN Global's Accord)

## Success criteria

- A founder can look at one Accord article's Drive folder and find everything Master
  Atelier would need to build a promotion package, without cross-referencing
  `hvnglobalco-com`'s own docs.
- My Poster's existing per-platform editor is unchanged — this contract feeds it a
  better starting draft, it doesn't replace any of its responsibilities.
- No Postiz call, scheduled post, or published post results from this contract alone.

## Open questions

- Article numbering: the pilot article currently used to validate this whole system
  ("Elevate Your Private Space...") is index position **#1** in
  `hvnglobalco-com`'s `docs/accord-content-inventory.md` capture — which is also the
  **most recently published** of the 10 indexed articles (Jul 31, 2026, the latest
  date among all 10). Index position and recency agree here, so no renumbering is
  needed for this pilot — see `hvnglobalco-com`'s `docs/accord-article-index.md` for
  the full resolution. Future articles should resolve their own `[N]` the same way
  (index position in the capture ledger) before a Drive folder is created for them.
- When does automation take over article-package → promotion-brief generation, vs.
  a human assembling it by hand the first few times? Not decided — Article 1's pilot
  run should answer this empirically.
- Exact per-platform crop/variant dimensions — deferred to whenever My Poster's own
  cover-generation step needs them; not specified here.
