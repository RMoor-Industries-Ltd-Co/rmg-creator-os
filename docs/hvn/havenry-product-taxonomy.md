# HVN Havenry Product Taxonomy — Promotion Pipeline Contract

**Status:** Founder-directed working taxonomy  
**Decision date:** 2026-09-29  
**Domain:** HVN Havenry  
**Authority source:** AMGPx Havenry product-taxonomy decision

## Why Creator OS needs this

Master Atelier and promotion workflows may receive requests about an HVN **family**, a
**variation/form**, a specific **sellable product/SKU**, or an **Appointment**. Those are not
interchangeable.

Creative jobs must identify the intended level explicitly. Creator OS must never infer that a
family/form name represents a single sellable product.

## Identity levels

| Level | Meaning | Examples |
|---|---|---|
| **Family** | Canonical HVN product grouping | Atmos Chambers, Ember Lines, Sanctums, Repose Cushions, Ritual Instruments, Lucerns, Prime Anchors |
| **Variation / Form** | Design or physical expression within a family | Shadow Chamber, Column Chamber, Atlas Chamber; Dual/Flat/Transitional Ember Lines; Regalia/Elemental Sanctums; Bolster/Lumbar/Body Repose Cushions |
| **Sellable Product / SKU** | Specific approved commerce item/variant | Must come from the governed product/commerce record; do not fabricate from taxonomy |
| **Appointment** | Curated non-proprietary object selected for HVN | Governed separately from HVN Originals |

## Corrected family semantics

### Atmos Chambers
Shadow Chamber, Column Chamber and Atlas Chamber are forms/subcategories. There may be many
distinct designs beneath each. A promotion about "Shadow Chambers" may be family/form creative;
it is not automatically a product ad for one SKU.

### Ember Lines
Known forms include Continuous, Dual, Flat, Segmented and Transitional Ember Lines.

**Drift Sanctum is not a canonical product and must not be generated or promoted as one.**

### Sanctums
Sanctums are a separate ritual-object family. Current form language includes Regalia Sanctums
and Elemental Sanctums. A Sanctum may later be paired with an Ember Line only when a specific
approved sellable product relationship exists.

### Repose Cushions
Bolster, Lumbar and Body are forms beneath Repose Cushions. They are not automatically one
sellable SKU each.

### Ritual Instruments
Current named product concepts include Framing Mist Flask, Comb Rail Diffuser and Atmosphere
Mist. Treat them as product concepts until a governed sellable-product/variant record exists.

### Lucerns / Prime Anchors
Both may have family/form creative while no sellable Havenry inventory exists. Family existence
must not be interpreted as market availability.

### Appointments
Appointments are curated non-proprietary objects selected for HVN. Promotion metadata must
preserve their ownership/category distinction from HVN Originals.

## Promotion-package requirements

For any HVN Havenry production job that references an offering, carry or resolve:

- `architectureRole`: `family | variation_form | sellable_product | appointment`
- `canonicalFamily`
- `offeringId` or governed source reference when one exists
- `sellableProductId` / Shopify merchandise identity only when approved
- `inventoryBearing`: never inferred from the family/form name
- campaign/product availability claims only from the approved commerce authority

A family-level campaign can advertise the concept, craftsmanship or coming line without
claiming a particular item is available. Product-level CTAs, prices, availability, checkout
links and inventory claims require a governed sellable-product record.

## Asset and prompt rules

- Label generated imagery at the same architecture level as the creative brief.
- Do not turn a conceptual form into a named product merely because an image was generated.
- Do not synthesize product prices, stock, Shopify handles or variants.
- Do not use **Drift Sanctum** as a product fixture.
- Preserve Lexicon-approved names exactly.
- When a requested name is ambiguous between family/form/product, stop at the most conservative
  architecture level and require a governed product reference before commerce-specific output.

## Cross-system source precedence

1. **AMGPx** — Founder product-architecture decision and governance precedence.
2. **CAPPO Official Product Catalog / governed product records** — operational catalog identity and architecture role.
3. **HVN Lexicon** — canonical terminology/meaning.
4. **HVN Havenry implementation** — presentation and commerce binding; not independent taxonomy authority.
5. **Creator OS** — consumes the identity for creative production; does not redefine it.

## Current implementation note

Existing historical creative or mock-commerce references may contain flat product assumptions.
Do not rewrite provenance. New work must use this corrected taxonomy, and migrations should mark
legacy assumptions as superseded rather than pretending they were always classified correctly.
