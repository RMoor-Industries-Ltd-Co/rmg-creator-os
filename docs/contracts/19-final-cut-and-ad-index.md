# Contract — Final Cut, My Poster & Ad Index

- **Capability id:** `final-cut-ad-index`
- **Status:** Planned (spec)
- **Phase:** Master Atelier / Delivery
- **Owner:** Rahm Moore
- **Depends on:** `production-wizard` (13), `b-roll-video` (18), `a-roll-video` (16)

---

## Part 1 — Final Cut (CapCut Loop)

### Mission

The Creator OS does **not** include an in-browser NLE. All timeline editing happens in
**CapCut** (Rahm's preferred editor). The Final Cut contract defines the **download →
CapCut edit → re-upload** loop that closes the gap between asset generation and social
delivery.

### The loop

```
[Creator OS — Final Cut page]
  1. Download package
     ├── A-Roll winner (HeyGen lip-sync export)
     ├── B-Roll library clips (ZIP)
     ├── Thumbnail / My Poster image
     └── Caption + hashtags (copied to clipboard)
            ↓
  2. CapCut (external)
     ├── Import A-Roll + B-Roll
     ├── Cut timeline (in/out trims, transitions, overlays)
     ├── Add captions (CapCut auto-caption or manual)
     └── Export final MP4
            ↓
  3. Re-upload to Creator OS
     └── POST /productions/:id/final-cut  (multipart upload)
            ↓
  4. Final Cut stored in Drive → VIDEO_PRODUCTION/FINAL/{brand}/
     └── Named: {ad-index-code}.mp4
            ↓
  5. Advance to My Poster approval → social delivery
```

### In/out trim (optional, in-app)

For simple trims (trim the first/last N seconds before sending to CapCut), the Final Cut
page offers a **minimal trim UI** — a single clip player with two handles (in point / out
point). This is **not a timeline editor** — it only trims the outer edges of a single
clip. Implemented client-side via `ffmpeg.wasm` (or a gateway call to server-side ffmpeg).

Use case: ALLEN's HeyGen video has a half-second of black at the start — trim it here
without opening CapCut for a one-second fix.

### Download package

The download button produces a ZIP containing:
- `aroll.mp4` — A-Roll (HeyGen lip-sync output)
- `broll/` — all approved B-Roll clips
- `thumbnail.{ext}` — My Poster image (if approved)
- `caption.txt` — platform caption + hashtags
- `README.txt` — naming scheme + CapCut import tips

### Re-upload endpoint

```
POST /productions/:id/final-cut
  multipart: file (mp4/mov)
Response:
  { drive_id, drive_url, ad_index_code }
```

Gateway saves to `VIDEO_PRODUCTION/FINAL/{brand}/` and names the file with the
production's **Ad Index code** (see Part 2). Sets `production.final_video_id`.

---

## Part 2 — My Poster (Approval + Thumbnail)

### Mission

"My Poster" is the **cover image / thumbnail** for a piece of content — the visual hook
that gets the click. It is generated (Higgsfield or Adobe) and must be **explicitly
approved** before the production advances to delivery. An approved My Poster gets an
**Ad Index code** and is archived in Drive.

### Approval flow

```
[My Poster page]
  Generated candidates (from Higgsfield / asset pipeline)
    Card: image · provider · [▶ Preview full size] [✓ Approve] [✕ Reject] [↻ Re-generate]
          [Approve] → assigns Ad Index code → saves to Drive THUMBNAIL_DESIGN/APPROVED/
          Sets production.thumbnail_drive_id
```

Approval is **manual and intentional** — no auto-approve. One approval per production at
a time (approving a new one moves the old one to `THUMBNAIL_DESIGN/ARCHIVED/`).

---

## Part 3 — Ad Index

### Nomenclature scheme

Every approved production (video, ad, short, poster, newsletter segment) gets a unique
**Ad Index code** assigned at approval time. The scheme:

```
{type}-{product}-{region}-{tz}-{version}
```

| Field | Values (examples) | Notes |
|---|---|---|
| **type** | `ad` `short` `long` `promo` `podcast` `vlog` | Content format |
| **product** | `books` `software` `merch` `store` `news` | What is being promoted |
| **region** | `usa` `can` `uk` `global` | Target market |
| **tz** | `est` `pst` `cst` `gmt` `utc` | Timezone for scheduling |
| **version** | `001` `002` … (auto-increment) | A/B test or audience variant |

**Example codes:**

| Code | Meaning |
|---|---|
| `vlog-software-news-usa-est-001` | VLOG format, software product, newsletter campaign, US market, Eastern, first variant |
| `ad-merch-store-usa-pst-001` | Ad, merchandise/store, US Pacific, first run |
| `short-books-global-utc-001` | Short-form, books, global audience, first |
| `promo-news-usa-est-001` | Promo cut for newsletter, US East, first |
| `podcast-software-usa-est-001` | Podcast episode, software focus |

Version auto-increments per unique `{type}-{product}-{region}-{tz}` combination. So
`vlog-software-news-usa-est-001` and `vlog-software-news-usa-est-002` are A/B variants of
the same campaign slot; `vlog-software-news-can-est-001` is a separate Canadian variant
starting at `001`.

### Code issuance

Codes are issued by the **gateway** (not manually):

```
POST /ad-index/issue
  body: { production_id, type, product, region, tz }
Response:
  { code: "vlog-software-news-usa-est-003", drive_path: "..." }
```

The gateway:
1. Queries the `ad_index` table for the max version under `{type}-{product}-{region}-{tz}`.
2. Increments by 1, zero-pads to 3 digits.
3. Inserts a new `ad_index` row.
4. Returns the code.

Codes are **never re-used or recycled**, even if a production is cancelled.

### Ad Index table

```
AdIndex {
  code            text  PK    # vlog-software-news-usa-est-001
  type            text        # vlog | ad | short | long | promo | podcast
  product         text        # books | software | merch | store | news
  region          text        # usa | can | uk | global
  tz              text        # est | pst | cst | gmt | utc
  version         int         # 1, 2, 3 …
  production_id   uuid?       # linked production
  status          enum        # draft | approved | published | archived
  final_drive_id  text?       # final video in Drive
  poster_drive_id text?       # approved My Poster
  approved_at     timestamptz?
  published_at    timestamptz?
  created_at      timestamptz
}
```

### Ad Index browser

A dedicated **Ad Index** page (separate from the production wizard) shows the full
catalogue of codes with filter/sort by type, product, region, status. Each row links to
its production. This is the **content inventory** for the team.

---

## Gateway API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/productions/:id/final-cut` | Re-upload edited final video |
| GET | `/productions/:id/final-cut/download` | Signed URLs for download package ZIP |
| POST | `/productions/:id/poster/approve` | Approve a My Poster candidate |
| GET | `/ad-index` | Browse all codes (filterable) |
| POST | `/ad-index/issue` | Issue a new code (called on approval) |
| GET | `/ad-index/:code` | Single code detail |

---

## Build order

1. **Ad Index table** migration + `/ad-index/issue` endpoint.
2. **My Poster approval** flow + Drive save.
3. **Final Cut re-upload** endpoint + Drive naming.
4. **Download package** ZIP endpoint.
5. **In/out trim UI** (optional, after core loop is working).
6. **Ad Index browser** page.
