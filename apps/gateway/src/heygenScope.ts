// Studio's own HeyGen catalog scope — kept as two tiny pure functions, not inlined into the
// `/heygen/avatars` / `/heygen/voices` route handlers in server.ts, specifically so the scope
// choice cannot silently regress to unscoped without a test catching it.
//
// Incident: Studio's first production live-read called `listAvatars()`/`listVoices()` with no
// scope at all, which HeyGen resolves to its full public preset library plus the account's own
// — large enough to exceed `listAll`'s 40-page safety bound (a correctly-firing safety stop, not
// a bug in the bound itself). Studio only ever needs the account's OWN configured avatars and
// voices, never HeyGen's public stock catalog — see docs/atelier/heygen-v3-migration.md, "Studio
// catalog scoping". A future caller that legitimately wants the public library is expected to
// request `'public'` explicitly at its own call site, not by this module's default changing.

import type { HeyGenClient } from '@rmg-creator-os/integrations';

export function listStudioAvatars(client: Pick<HeyGenClient, 'listAvatars'>) {
  return client.listAvatars({ ownership: 'private' });
}

export function listStudioVoices(client: Pick<HeyGenClient, 'listVoices'>) {
  return client.listVoices({ type: 'private' });
}
