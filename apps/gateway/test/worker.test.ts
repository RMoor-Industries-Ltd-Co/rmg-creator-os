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
