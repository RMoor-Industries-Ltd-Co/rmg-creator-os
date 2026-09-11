// Startup configuration report (B1.3 §2). Pure — takes already-computed booleans/counts as
// plain-value input rather than reading process.env itself, so the report vocabulary is
// unit-testable with no environment mocking and, just as important, can never leak a secret
// value: nothing in this module ever sees the raw env var, only whether it was usable.
//
// The report is deliberately built from the SAME facts server.ts already computes for its own
// client construction (heygen !== null, drive !== null, Object.keys(founderPrincipals).length,
// STEP_UP_CONFIGURED, WORKER_TICK_ENABLED === 'true', postizConfigured()) — it is a second view
// of those facts, not a second source of truth for them.

export type CapabilityStatus =
  | 'enabled'
  | 'configured'
  | 'unconfigured'
  | 'disabled_by_flag'
  | 'disabled_missing_secret'
  | 'disabled_no_principals';

export interface ConfigReportInput {
  /** AUTH_ENABLED === 'true' */
  authEnabled: boolean;
  /** STEP_UP_CONFIGURED from server.ts — false whenever assertStepUpCookieSecret() failed. */
  stepUpConfigured: boolean;
  /** Object.keys(parseFounderPrincipals(...)).length */
  founderPrincipalCount: number;
  /** WORKER_SECRET !== '' */
  workerSecretConfigured: boolean;
  /** WORKER_TICK_ENABLED === 'true' (startWorkerTicker() returned non-null) */
  workerTickEnabled: boolean;
  /** postizConfigured() */
  postizConfigured: boolean;
  /** heygen !== null */
  heygenConfigured: boolean;
  /** drive !== null */
  driveConfigured: boolean;
  /** higgs !== null */
  higgsfieldConfigured: boolean;
  /** redis client constructed (always true today — redis has no "unconfigured" state, only
   *  reachable/unreachable, which is dependency health, not capability readiness). Kept as an
   *  explicit input rather than a hardcoded true so a future optional-redis change doesn't have
   *  to touch this module's logic, only the value server.ts passes in. */
  redisConfigured: boolean;
}

export interface ConfigReport {
  session_auth: CapabilityStatus;
  step_up: CapabilityStatus;
  founder_approval: CapabilityStatus;
  worker_auth: CapabilityStatus;
  worker_dispatch: CapabilityStatus;
  postiz: CapabilityStatus;
  heygen: CapabilityStatus;
  drive: CapabilityStatus;
  higgsfield: CapabilityStatus;
  redis: CapabilityStatus;
  // Index signature so a ConfigReport is directly assignable to HealthResponse['readiness']
  // (Record<string, string>) without a cast at the call site — the shared type intentionally
  // stays loose (a plain string map) so packages/types does not need to depend on this
  // module's exact capability vocabulary.
  [key: string]: CapabilityStatus;
}

/**
 * Build the startup configuration report. Never accepts or echoes a secret value — every field
 * here is a status word, nothing else. Safe to log in full at boot and to serve from /health.
 */
export function buildConfigReport(input: ConfigReportInput): ConfigReport {
  return {
    session_auth: input.authEnabled ? 'enabled' : 'disabled_by_flag',
    // Reported relative to AUTH_ENABLED: step-up presupposes session auth exists to step up
    // FROM. When auth itself is off, step-up is not "missing a secret" — it's simply moot.
    step_up: !input.authEnabled
      ? 'disabled_by_flag'
      : input.stepUpConfigured
        ? 'enabled'
        : 'disabled_missing_secret',
    founder_approval: input.founderPrincipalCount > 0 ? 'enabled' : 'disabled_no_principals',
    worker_auth: input.workerSecretConfigured ? 'enabled' : 'disabled_missing_secret',
    worker_dispatch: input.workerTickEnabled ? 'enabled' : 'disabled_by_flag',
    postiz: input.postizConfigured ? 'configured' : 'unconfigured',
    heygen: input.heygenConfigured ? 'configured' : 'unconfigured',
    drive: input.driveConfigured ? 'configured' : 'unconfigured',
    higgsfield: input.higgsfieldConfigured ? 'configured' : 'unconfigured',
    redis: input.redisConfigured ? 'configured' : 'unconfigured'
  };
}
