# Contract — My Poster

- **Service id:** `my-poster`
- **Status:** Planned
- **Phase:** Creative (graphics)
- **Owner:** Rahm Moore

## Mission
The static/graphic creative engine. Enhances images, creates and manages product
placement photos for the stores, and manages product descriptions, tags, and prices.

## Inputs
- Raw images / product photos.
- Brand + store context; product data.
- (From gateway) a job requesting a graphic, ad, or product listing update.

## Outputs
- Enhanced images and graphic creatives (posters, thumbnails, image ads).
- Product placement photos for stores.
- Generated/updated product descriptions, tags, and prices.

## Responsibilities (in scope)
- Image enhancement + brand-styled graphic generation.
- Product placement composition for HVN, R+R, BU$Y_MF.
- Manage Shopify product copy: descriptions, tags, pricing.

## Out of scope (for now)
- Video (Story Director).
- Publishing/scheduling (Social Manager).
- Copy *voice* generation may defer to ALLEN; My Poster handles product-data fields.

## Dependencies
- **Services:** gateway (jobs), Social Manager (hands off graphics/ads), ALLEN (optional copy voice).
- **Integrations / external:** Shopify Admin API (HVN, R+R, BU$Y_MF); image models.
- **Models / AI:** image enhancement/generation; product-copy model (TBD).
- **Data:** Postgres (product/creative records); Drive (image assets).

## Interface (high-level)
- **Exposes:** `POST /enhance`, `POST /product-creative`, product listing endpoints.
- **Consumes:** graphic/ad jobs; product-update jobs.

## Brands / stores touched
HVN · R+R · BU$Y_MF (stores) + brand styling for all brands.

## Success criteria
Submit a raw product photo → get an enhanced, brand-styled placement image plus a
ready-to-publish Shopify listing (description, tags, price).

## Open questions
- Image model(s) for enhancement vs. generation.
- Pricing logic source of truth (manual, rules, or assisted).
