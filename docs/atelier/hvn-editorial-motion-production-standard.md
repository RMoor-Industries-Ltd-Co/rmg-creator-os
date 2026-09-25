# Master Atelier — HVN Editorial Motion Production Standard

> Movie-style promo and editorial-motion lane for HVN culture assets. This complements
> the Havenry showroom still-image production standard without replacing it.

## Purpose

Master Atelier will generate editorial motion assets for HVN Accord, HVN Promotions,
HVN Social Media, and Character-led campaign work. These assets deliver HVN culture to
the public, display Impressions with taste, and carry a CTA into the sales funnel.

They are not interactive showroom surfaces.

## Motion-promo rule

Motion promos may feature principal and supporting Impressions, but they do not support
clickable Impressions, hover outlines, or hotspot geometry. Their commercial contract is a
clear CTA, destination, caption/package metadata, and funnel routing.

## Production lanes

- `hvn-promotion-motion`: cinematic Impression/world display with CTA.
- `hvn-social-cutdown`: vertical, short-form, high-readability derivatives.
- `character-led-promo`: HVN Character model introduces or inhabits the scene.
- `hvn-accord-editorial`: visual culture, ritual, place, and philosophy.
- `detail-study`: close material/ritual shots used as inserts.

## Camera grammar

Camera choice is selected by filmography purpose:
- locked-off product tableau
- slow push-in
- restrained orbit
- lateral dolly
- character reveal
- detail macro drift
- atmospheric establishing frame
- social vertical close frame

The validator should reject monotonous repetition across a campaign batch while also
rejecting chaotic camera choices that do not belong to the lane.

## Required manifest fields

```
assetId
lane
jurisdiction
campaignId
sourceNotionPageId
principalImpressionIds[]
supportingImpressionIds[]
characterModelId
cameraLane
cameraMotion
aspectRatios[]
durationSeconds
ctaText
ctaTarget
promptVersion
provider
model
seed
sourceAssets[]
driveFileIds
validationScorecard
status
```

## Comprehensive generation algorithm

1. Ingest the campaign brief, Notion/Lexicon records, available Impressions, Character
   model, and target jurisdiction.
2. Select the output lane and camera grammar.
3. Generate still scene candidates when needed as anchors.
4. Generate motion variants from approved anchors or direct motion prompts.
5. Validate HVN fit, lane fit, camera purpose, realism, Impression display, Character use,
   CTA readiness, and crop safety.
6. Catalogue provider/model/seed/prompt/source/Drive metadata.
7. Route approved candidates to HVN Accord, HVN Promotions, HVN Social Media, Character
   promo library, or archive-only.
8. Only publish after the lane-specific approval gate passes.

## Validation scorecard

```
hvnFit: pass | fail | review
laneFit: pass | fail | review
cameraPurpose: pass | fail | review
motionContinuity: pass | fail | review
characterUse: pass | fail | not_applicable
impressionDisplay: pass | fail | review
ctaReadiness: pass | fail | review
cropSafety: pass | fail | review
funnelRouting: pass | fail | review
approvedDestination: hvn-accord | hvn-promotions | hvn-social-media | master-atelier | archive-only
approvedForPublication: true | false
```

## Integration relationship

- Character identity and voice are governed by the Character Pipeline contract.
- Higgsfield provides image/video generation and Character visual assets where appropriate.
- SuperCool or another finishing layer may add captions, music, and publishing support.
- The gateway/worker owns scheduling, retries, save-as-you-go persistence, and bounded
  credit usage.

_Initial lock: 2026-09-25._
