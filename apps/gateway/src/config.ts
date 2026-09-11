// Configuration preflight (B1.3, docs/atelier — incident #65–#71). Pure and dependency-free so
// every classification and every capability-status rule is directly unit-testable
// (apps/gateway/test/config.test.ts) with no environment mocking required.
//
// The incident this module exists to prevent: `assertStepUpCookieSecret()` ran at module scope
// in server.ts and threw when STEP_UP_COOKIE_SECRET was unset in production — since that runs
// before Fastify starts listening, the crash took down every route, not just step-up, for ~1.5h
// across five deploys the pipeline reported as "success". The rule this module enforces:
//
//   A missing FEATURE-REQUIRED credential must disable that feature safely — never crash the
//   gateway — unless the feature is truly mandatory for the gateway to exist at all.
//
// "Mandatory" is not "never crash on anything": COOKIE_SECRET stays REQUIRED_TO_START (see
// below) precisely because session auth gates nearly the whole API once AUTH_ENABLED=true, and
// a forgeable session secret is worse than an outage. The incident's actual lesson was that
// STEP_UP_COOKIE_SECRET's blast radius (the entire process) exceeded what it protects (one
// not-yet-live route) — not that fail-closed-by-crashing is always wrong.

/**
 * REQUIRED_TO_START — missing means the gateway cannot safely function AT ALL; failing loudly
 * at boot is correct, not a defect.
 *
 * FEATURE_REQUIRED — missing disables only the associated capability, which must fail closed
 * (refuse requests to that capability) without taking down anything else.
 *
 * OPTIONAL — a safe, documented default exists and the gateway's core behavior is unaffected
 * either way.
 */
export type ConfigTier = 'required_to_start' | 'feature_required' | 'optional';

export interface ConfigVarSpec {
  name: string;
  tier: ConfigTier;
  /** The capability this variable gates — present for feature_required and optional vars whose
   *  absence maps to a specific reported capability (see configReport.ts). Absent for
   *  required_to_start vars, which have no "disabled" state to report — the process doesn't
   *  reach a point where reporting matters. */
  capability?: string;
  /** Why this classification, and what happens when the variable is absent. Never states or
   *  implies a value. */
  note: string;
}

/**
 * The classification table (B1.3 §1). Each entry names one variable's tier and the reasoning —
 * this is the audit the directive asked for, expressed as data so it can be asserted by test
 * rather than only read in a document that can drift from the code.
 */
export const CONFIG_VARS: readonly ConfigVarSpec[] = [
  {
    name: 'DATABASE_URL',
    tier: 'required_to_start',
    note: 'Migrations run synchronously at boot and the process exits(1) on failure — intentional, logged, and controlled, unlike the incident\'s uncontrolled crash. There is no meaningful gateway without a database.'
  },
  {
    name: 'REDIS_URL',
    tier: 'optional',
    capability: 'redis',
    note: 'The queue is Postgres-backed (ratified decision D-B) — redis is not on any request path today. The client is constructed with lazyConnect and never blocks boot; an unreachable redis degrades only its own /health entry.'
  },
  {
    name: 'AUTH_ENABLED',
    tier: 'optional',
    capability: 'session_auth',
    note: 'Documented default false (auth off). Startup is safe either way; this is a deployment policy choice, not a missing credential — production SHOULD set it true, but its absence does not crash or corrupt anything.'
  },
  {
    name: 'COOKIE_SECRET',
    tier: 'required_to_start',
    capability: 'session_auth',
    note: 'Conditional on AUTH_ENABLED=true and NODE_ENV=production: assertCookieSecret() deliberately still crashes the process in that case. Session auth gates nearly every route once enabled, so a forgeable/default secret is a security failure across the whole API, not one feature — "do not weaken authentication to achieve availability" applies here specifically.'
  },
  {
    name: 'STEP_UP_COOKIE_SECRET',
    tier: 'feature_required',
    capability: 'step_up',
    note: 'Gates only POST /auth/google/step-up, which has no live write-path caller yet (§13 step 6 is blocked). Fixed in #71 to refuse (503) that one route rather than crash the process — this is the exact incident this table exists to prevent recurring elsewhere.'
  },
  {
    name: 'STEP_UP_MAX_AGE_SECONDS',
    tier: 'optional',
    capability: 'step_up',
    note: 'parseStepUpMaxAgeSeconds() falls back to 900 on anything unset, empty, or non-positive — never to "unlimited".'
  },
  {
    name: 'FOUNDER_PRINCIPALS',
    tier: 'feature_required',
    capability: 'founder_approval',
    note: 'Unset means an empty map — no principal resolves to founder, so every founder-gated write refuses (§7.2: "unset means empty ... never everyone"). Already fails closed without crashing; parseFounderPrincipals() never throws.'
  },
  {
    name: 'WORKER_SECRET',
    tier: 'feature_required',
    capability: 'worker_auth',
    note: 'checkWorkerSecret() (workerAuth.ts) refuses every worker-route request with worker_auth_required when unset — the worker execution lane closes, the gateway does not crash. This is the pattern §7.1\'s step-up fix (#71) was brought into line with.'
  },
  {
    name: 'WORKER_TICK_ENABLED',
    tier: 'optional',
    capability: 'worker_dispatch',
    note: 'Documented default false/unset — automatic dispatch has never been enabled in production. An explicit, intentional flag, not a credential gap; startWorkerTicker() simply returns null when it is not exactly "true".'
  },
  {
    name: 'POSTIZ_API_KEY',
    tier: 'optional',
    capability: 'postiz',
    note: 'postizConfigured() gates the publish routes with a 503 when unset; no crash, no partial client.'
  },
  {
    name: 'HEYGEN_API_KEY',
    tier: 'feature_required',
    capability: 'heygen',
    note: 'heygen client is null when unset; withHeyGen() returns 503 for any HeyGen-dependent route rather than throwing.'
  },
  {
    name: 'GDRIVE_CLIENT_ID',
    tier: 'feature_required',
    capability: 'drive',
    note: 'Drive requires all three of GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN together (see the two entries below) — drive stays null and asset-upload routes refuse rather than crash if any one is missing.'
  },
  {
    name: 'GDRIVE_CLIENT_SECRET',
    tier: 'feature_required',
    capability: 'drive',
    note: 'See GDRIVE_CLIENT_ID.'
  },
  {
    name: 'GDRIVE_REFRESH_TOKEN',
    tier: 'feature_required',
    capability: 'drive',
    note: 'See GDRIVE_CLIENT_ID.'
  }
] as const;

/**
 * ALLEN is deliberately NOT in this table. It is a separate container reached over the internal
 * Docker network at a fixed hostname (`http://allen:8090`) — there is no gateway env var that
 * configures "whether ALLEN is available"; its reachability and its own sub-checks (llm/tts/stt)
 * are dependency health (§3), proxied straight through by /health, not a Creator OS feature flag.
 */
export const ALLEN_IS_A_DEPENDENCY_NOT_A_CONFIG_VAR = true;
