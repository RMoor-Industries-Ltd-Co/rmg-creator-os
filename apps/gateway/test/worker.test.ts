import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatch } from '../src/worker.js';
import { createDefaultRendererRegistry, RendererRegistry, NullRenderer } from '@rmg-creator-os/integrations';

// Minimal shape matching what dispatch() destructures off a production_jobs row.
const job = (capability: string, provider: string, payload: unknown = {}) =>
  ({ id: 'job-abc', capability, provider, payload }) as Parameters<typeof dispatch>[0];

afterEach(() => vi.restoreAllMocks());

describe('worker dispatch — behavior preservation (Sprint 1 PR 4)', () => {
  it('HeyGen aroll path is unchanged: calls the client and returns its videoId', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'hg-vid-1' });
    const out = await dispatch(
      job('aroll', 'heygen', { talkingPhotoId: 'tp1', audioUrl: 'https://a' }),
      { heygen: { generateVideo }, drive: null },
      createDefaultRendererRegistry()
    );
    expect(out).toEqual({ resultId: 'hg-vid-1' });
    expect(generateVideo).toHaveBeenCalledOnce();
  });

  it('aroll/heygen still throws when the client is not configured', async () => {
    await expect(
      dispatch(job('aroll', 'heygen', { talkingPhotoId: 't', audioUrl: 'u' }), { heygen: null, drive: null }, createDefaultRendererRegistry())
    ).rejects.toThrow(/HeyGen client not configured/);
  });

  it('aroll/heygen still throws on a missing payload field', async () => {
    await expect(
      dispatch(job('aroll', 'heygen', { talkingPhotoId: 't' }), { heygen: { generateVideo: vi.fn() }, drive: null }, createDefaultRendererRegistry())
    ).rejects.toThrow(/aroll payload missing/);
  });

  it('broll/audio/thumbnail/unknown route through the default NullRenderer with the exact prior resultId shape', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = createDefaultRendererRegistry();
    const clients = { heygen: null, drive: null };
    expect(await dispatch(job('broll', 'higgsfield'), clients, registry)).toEqual({ resultId: 'broll-job-abc' });
    expect(await dispatch(job('audio', 'elevenlabs'), clients, registry)).toEqual({ resultId: 'audio-job-abc' });
    expect(await dispatch(job('thumbnail', 'my-poster'), clients, registry)).toEqual({ resultId: 'thumbnail-job-abc' });
    expect(await dispatch(job('poster', 'canva'), clients, registry)).toEqual({ resultId: 'stub-job-abc' });
  });

  it('an explicitly registered renderer for a (capability, provider) pair is used over the fallback', async () => {
    const custom = { name: 'custom', capabilities: { capabilities: ['broll'], headless: true }, render: vi.fn().mockResolvedValue({ resultId: 'custom-result' }) };
    const registry = new RendererRegistry();
    registry.register('broll', 'higgsfield', custom);
    registry.setFallback(new NullRenderer());
    const out = await dispatch(job('broll', 'higgsfield'), { heygen: null, drive: null }, registry);
    expect(out).toEqual({ resultId: 'custom-result' });
    expect(custom.render).toHaveBeenCalledOnce();
  });

  it('falls through to the defensive inline stub when a capability/provider truly has no renderer', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = new RendererRegistry(); // no fallback set
    const out = await dispatch(job('mystery', 'nobody'), { heygen: null, drive: null }, registry);
    expect(out).toEqual({ resultId: 'stub-job-abc' });
  });
});

describe('worker dispatch — unimplemented capabilities fail loudly (Phase B1)', () => {
  // Migration 0023 makes `accord_article` a legal enum value so an Accord job can be
  // ENQUEUED without fabricating a video production. Legal to enqueue is not the same as
  // executable: without an explicit guard, `claimNextJob` claims the row, the registry's
  // NullRenderer fallback returns a stub id, and `runWorkerTick` marks the job `done` —
  // reporting governed work as complete having produced nothing. A visible failure is
  // strictly better than an invisible success.
  it('throws for accord_article rather than returning a NullRenderer stub', async () => {
    await expect(
      dispatch(job('accord_article', 'internal'), { heygen: null, drive: null }, createDefaultRendererRegistry())
    ).rejects.toThrow(/no dispatcher yet/);
  });

  it('does not silently fall through to the stub id for it', async () => {
    // The precise regression: the pre-guard behavior resolved to a renderer and produced
    // `stub-<jobId>`, which the tick then stored as a real resultId.
    let out: unknown;
    try {
      out = await dispatch(job('accord_article', 'internal'), { heygen: null, drive: null }, createDefaultRendererRegistry());
    } catch {
      out = 'threw';
    }
    expect(out).toBe('threw');
  });

  it('leaves every implemented capability unaffected', async () => {
    const out = await dispatch(job('broll', 'higgsfield'), { heygen: null, drive: null }, createDefaultRendererRegistry());
    expect(out.resultId).toBeTruthy();
  });
});
