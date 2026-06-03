# Contract — Brand & Capability Model

- **Capability id:** `brand-model`
- **Status:** Canonical (source of truth)
- **Owner:** Rahm Moore
- **Source of truth:** ClickUp **RMG - CREATOR SPACE** + brand definitions.

## Mission
Define the brands, their channels, and the store/sector relationships so every job,
folder, and service speaks the same brand vocabulary. Implemented in
`packages/types` (`BrandKey`, `StoreKey`, `Channel`, `BRANDS`).

## RMG = Renaissance Masters Group (master brand)
The umbrella. Carries its own **newsletter**. Microbrands sit under it.

## Brand capability matrix
| Brand | Full name | Social | Store | Newsletter | Books |
|---|---|:--:|:--:|:--:|:--:|
| **RMG** | Renaissance Masters Group (master) | — | — | ✅ | — |
| **MSTR_RAHM** | Master Rahm | ✅ | ✅ | — | — |
| **COM** | Conversations of Mastery | ✅ | — | ✅ | ✅ |
| **BU$Y_MF** | Business Monday–Friday | ✅ | — | — | — |
| **ORR / R+R** | Our Royal Reservations | ✅ | ✅ | ✅ | — |
| **VLOG** | Virtual Legacy of Greatness | ✅ | ✅ | ✅ | ✅ |
| **TRC** | The Rahm Council | ✅ | — | — | — |
| **TGL / TAL** | The Afterlife (Godfather) Lounge | ✅ | — | — | — |

## Shopify stores
**HVN** (Havenry — under the HVN Global jurisdiction), **ORR**, **MSTR_RAHM**, **VLOG**.
My Poster owns product photos, descriptions, tags, and pricing for these.

**Promotion:** **BU$Y_MF** is the **TikTok promo engine** that drives traffic to the
ORR, MSTR_RAHM, and VLOG stores. (BU$Y_MF is a content brand, **not** a store.)

## PIAAR — proprietary software sector
Builds and manages the apps, **including RMG Creator OS itself**. GitHub only —
**no social channels, no content folder.** May add a flagship project later.
Tracked in ClickUp as a sector; excluded from Drive content brand folders.

## Jurisdictions (own ClickUp spaces + Drive entity folders)
| Jurisdiction | ClickUp space | Drive folder |
|---|---|---|
| RMoor Industries | RMI - Company Headquarters ADMIN | `01_RMOOR_INDUSTRIES` |
| Renaissance Masters Group | RMG - CREATOR SPACE | `02_RENAISSANCE_MASTERS_GROUP` + `06_CONTENT_ENGINE` |
| Apex Meridian Group (AMG) | AMG | `03_APEX_MERIDIAN_GROUP` |
| HVN Global (Havenry) | (own space) | `04_HVN_GLOBAL` |
| Personal Systems + Life OS | PERSONAL SYSTEMS | `05_PERSONAL_BRAND_RAHM` |

## Drive ↔ ClickUp alignment (content brands)
The Drive `SCHEDULED/<BRAND>` and `ARCHIVE/<BRAND>` folders mirror the ClickUp
creator-space content brands: **MSTR_RAHM · COM · BU$Y_MF · ORR · VLOG · THE_RAHM_COUNCIL · TGL**.
PIAAR appears in ClickUp (dev sector) but has no Drive content folder.

## Implications for the architecture
- A **job/campaign targets a brand + a channel** (`social | store | newsletter | books`).
- New channels slot in without reshaping: an **email/newsletter** service (RMG, COM, ORR, VLOG)
  and a **book/lead-magnet** flow (COM, VLOG) become additional services/outputs.
- `OutputKind` extended: `content | ad | post | newsletter | book`.

## Open questions
- Confirm **MSTR_RAHM** is the Master Rahm flagship brand (kept by assumption).
- Naming normalization across systems (`THE_RAHM_COUNCIL` vs "The Rahm Council"; `BUSY_MF` vs `BU$Y_MF`).
- Newsletter platform + book sales channel (Shopify? separate?) — TBD.
