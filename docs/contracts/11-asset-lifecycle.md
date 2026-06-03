# Contract — Asset Storage & Lifecycle (Google Drive)

- **Capability id:** `asset-lifecycle`
- **Status:** Planned (Drive folder skeleton created)
- **Phase:** Creative / Distribution
- **Owner:** Rahm Moore

## Mission
Never lose content. Persist every raw and intermediate asset to the right place in the
**RMG Creator OS Drive** as it's produced, stage finished posts through **SCHEDULED**, and
**move** them to **ARCHIVE** after they go live so anything can be reposted later.

## Lifecycle

```
RAW / INTERMEDIATE  (written as produced)
  Higgsfield avatar/likeness → AI_GENERATED_ASSETS
  ElevenLabs voice audio     → AUDIO_PRODUCTION
  HeyGen raw video           → VIDEO_PRODUCTION
  Higgsfield thumbnail       → THUMBNAIL_DESIGN
        │
        ▼  ASSEMBLED        → ACTIVE_PROJECTS
        ▼  SCHEDULED        → PUBLISHING_OPERATIONS/SCHEDULED/<BRAND>
        ▼  (move job, once posted)
        ▼  ARCHIVED         → ARCHIVE/<BRAND>
        └─ reuse candidates → REPURPOSING_SYSTEM
```

- **Save-as-you-go:** each pipeline step uploads its output to the matching folder.
- **Move job:** after Social Manager confirms a post is live, re-parent the scheduled
  bundle from `SCHEDULED/<BRAND>` → `ARCHIVE/<BRAND>` (Drive "move" = change parents;
  cheap, no re-upload). Implemented later as a queued (BullMQ) job.
- **Per-brand** subfolders in SCHEDULED and ARCHIVE (decision: brand-organized).

## Drive folder map (live IDs)
Root **RMG Creator OS**: `1AxL5st3pmVNolAdSOVep1L-AgviPn7mB`
`06_CONTENT_ENGINE`: `1k1WKwQKPawwUzUsdTWocay4R3_A04X44`

| Stage / folder | ID |
|---|---|
| AI_GENERATED_ASSETS | `15ZFkyzcPl-0jOVRWjimETTDL9M2myeHn` |
| VIDEO_PRODUCTION | `1cQDK4jIsCxD8DCAMm7L6cfOft2pwGdEB` |
| AUDIO_PRODUCTION | `1YNUKhOiEJqN3koxL92TxhEg3BIKCx19Z` |
| THUMBNAIL_DESIGN | `1oGNyhsyS2dQ5qBFhd7WxOMoCGls8oIXD` |
| ACTIVE_PROJECTS | `1iVS4ovItMKpGE1nUXzlKW-InFb2dGV1-` |
| PUBLISHING_OPERATIONS | `1T_SV66tWnaEBicrOHeFbqT2G7uyQFM_A` |
| PUBLISHING_OPERATIONS/**SCHEDULED** | `1WGCg6TSrTxFQBEOBCIKgssdO7Hsfe6vz` |
| REPURPOSING_SYSTEM | `1kupGao1B863c7_HGC33sFZNZ3xQ0nbSe` |
| **ARCHIVE** | `1SQZN1o7VskiPhXZ73fNAC8P0R2TX6g6T` |

Per-brand subfolders (created):

| Brand | SCHEDULED/<brand> | ARCHIVE/<brand> |
|---|---|---|
| VLOG | `1Bnpgj7n_8IlCwivF7kSUCv0Vun4XTDPQ` | `13fuIlM3I8jHyg3qR6Ow0NJO3tQaLM2Y1` |
| COM | `1JKvJ65Mqrq_BPSPO72CXp8EEbu1XhP9s` | `1hWwxkKSkgGGp551boC6NWZrrFRxwXlUa` |
| THE_RAHM_COUNCIL | `1FRd3ycHaIsbnKHwREoVqHyRlqF2ass6n` | `1Z4HBNNdpN_WFX9OTQrDIk0T8Z7QQc-zZ` |
| ROYAL_RESERVATIONS | `1K2d_wLQ2bXaDtsyzBwY-NGEuNwB4JIp0` | `1soNrBwmO4bHsT7_jBb4UCKXALo1wUtbf` |
| BUSY_MF | `1v5bqZtwM_xdTCZGRngM0_ndtQE6d0ect` | `1W78izJrKJowgDJEzcqbsqAxRL5k1aRbk` |

## Thumbnail feedback loop
After HeyGen renders a video, kick a **Higgsfield** job to generate a thumbnail →
`THUMBNAIL_DESIGN`, and link it back to the video's DB record (`thumbnailDriveId`).

## Responsibilities (in scope)
- Upload each asset to its stage folder as produced (server-side via rclone/Drive API).
- Stage scheduled bundles into `SCHEDULED/<BRAND>`.
- Move job `SCHEDULED → ARCHIVE` on go-live.
- Record every Drive file id on the corresponding DB row.

## Out of scope (for now)
- The actual generation (HeyGen/ElevenLabs/Higgsfield) and scheduling (Social Manager).
- Retention/cleanup policy beyond "keep in ARCHIVE."

## Dependencies
- **Drive access:** server-side rclone (already configured for backups) and/or the
  google-workspace MCP. Folder IDs above are config.
- **Services:** gateway (records ids), Social Manager (triggers the move on post), Higgsfield (thumbnails).
- **Data (follow-up schema):** add `driveFileId`, `thumbnailDriveId`, and `lifecycleState`
  (`raw | assembled | scheduled | archived`) to the `videos` table (and a future `assets` table).

## Success criteria
Every generated asset lands in Drive automatically; a posted item ends up in
`ARCHIVE/<BRAND>` with all its source pieces, so it can be found and reposted months later.

## Open questions / risks
- **Higgsfield MCP**: not in the connector registry — add manually (`claude mcp add`) once
  we have its endpoint/package. Confirms thumbnail + avatar capability.
- Which account owns writes (rmoorindustries vs rahm) and quota implications.
- Naming convention for files within brand folders (e.g. `YYYY-MM-DD__<slug>__<assetType>`).
