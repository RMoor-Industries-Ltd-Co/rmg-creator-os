// Renderer/provider execution boundary (Sprint 1 PR 4 — "formalize, do not expand").
//
// This gives the worker's existing `(capability, provider)` dispatch a named interface —
// mirroring the shape of `HiggsfieldClient` — instead of hard-branching inline. It does NOT
// add any new execution surface: NullRenderer reproduces today's ad-hoc console.log + stub-id
// stubs byte-for-byte, and the registry is a lookup table, not a new dispatch mechanism.
//
// No real renderer (Adobe/Resolve/etc.) exists here; this is intentionally the only
// implementation for now. See docs/atelier/renderer-boundary.md.

/** The minimal shape `dispatch()` already has on a claimed production_jobs row. */
export interface RenderJob {
  id: string;
  capability: string;
  provider: string;
  payload: unknown;
}

export interface RenderResult {
  resultId: string;
}

/** What a renderer can execute. Intentionally minimal — a name + which capabilities it
 *  handles + whether it has any real-world side effect (NullRenderer does not). */
export interface RendererCapabilities {
  capabilities: string[];
  headless: boolean;
}

export interface Renderer {
  readonly name: string;
  readonly capabilities: RendererCapabilities;
  render(job: RenderJob): Promise<RenderResult>;
}

// --- NullRenderer ------------------------------------------------------------
// Reproduces, verbatim, the four stub behaviors `dispatch()` had inline before this PR:
// broll/audio/thumbnail each log a capability-specific line and return a capability-prefixed
// resultId; anything else falls through to the generic `stub-${job.id}` line. No behavior
// change — only named and made independently testable/registrable.

type LogMessage = (job: RenderJob) => string;
type ResultId = (job: RenderJob) => string;

interface StubConfig {
  logMessage: LogMessage;
  resultId: ResultId;
}

const DEFAULT_STUB: StubConfig = {
  logMessage: (job) => `[worker] dispatching job ${job.id} capability=${job.capability} provider=${job.provider}`,
  resultId: (job) => `stub-${job.id}`
};

const CAPABILITY_STUBS: Record<string, StubConfig> = {
  broll: {
    logMessage: (job) => `[worker] broll job ${job.id} provider=${job.provider} — dispatch via external API`,
    resultId: (job) => `broll-${job.id}`
  },
  audio: {
    logMessage: (job) => `[worker] audio job ${job.id} provider=${job.provider}`,
    resultId: (job) => `audio-${job.id}`
  },
  thumbnail: {
    logMessage: (job) => `[worker] thumbnail job ${job.id} provider=${job.provider}`,
    resultId: (job) => `thumbnail-${job.id}`
  }
};

/**
 * A headless renderer with no external side effects: it logs for observability and returns a
 * deterministic stub result, exactly as the pre-PR-4 inline dispatch did. This is the default
 * for any capability/provider that has no real execution path — including the Word Art
 * planning boundary later — so pipelines can be exercised with no external engine present.
 */
export class NullRenderer implements Renderer {
  readonly name = 'null';
  readonly capabilities: RendererCapabilities = {
    capabilities: ['broll', 'audio', 'thumbnail'],
    headless: true
  };

  async render(job: RenderJob): Promise<RenderResult> {
    const stub = CAPABILITY_STUBS[job.capability] ?? DEFAULT_STUB;
    // eslint-disable-next-line no-console -- preserves the exact prior observability behavior
    console.log(stub.logMessage(job));
    return { resultId: stub.resultId(job) };
  }
}

// --- Registry ------------------------------------------------------------------
// A lookup table from (capability, provider) -> Renderer, plus an optional fallback used when
// no specific entry matches. This is what replaces the inline if/else chain in worker.ts; it
// adds no new behavior, only a name for the existing one.

function registryKey(capability: string, provider: string): string {
  return `${capability}::${provider}`;
}

export class RendererRegistry {
  private readonly byKey = new Map<string, Renderer>();
  private fallback: Renderer | undefined;

  register(capability: string, provider: string, renderer: Renderer): void {
    this.byKey.set(registryKey(capability, provider), renderer);
  }

  setFallback(renderer: Renderer | undefined): void {
    this.fallback = renderer;
  }

  /** Exact match first, then the fallback (if any). Undefined means "not supported". */
  resolve(capability: string, provider: string): Renderer | undefined {
    return this.byKey.get(registryKey(capability, provider)) ?? this.fallback;
  }
}

/** The registry preserving today's worker behavior: NullRenderer as the universal fallback,
 *  covering broll/audio/thumbnail and any other capability the same way `dispatch()` already
 *  did inline. No specific (capability, provider) entries are pre-registered — HeyGen's `aroll`
 *  path stays a direct client call in worker.ts, unchanged by this PR. */
export function createDefaultRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.setFallback(new NullRenderer());
  return registry;
}
