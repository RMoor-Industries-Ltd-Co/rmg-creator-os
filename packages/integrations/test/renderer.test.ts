import { describe, it, expect, vi, afterEach } from 'vitest';
import { NullRenderer, RendererRegistry, createDefaultRendererRegistry } from '../src/renderer.js';

const job = (capability: string, provider = 'anything') => ({
  id: 'job-123',
  capability,
  provider,
  payload: {}
});

afterEach(() => vi.restoreAllMocks());

describe('NullRenderer output shape', () => {
  it('reproduces the exact prior broll stub: resultId + log line', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await new NullRenderer().render(job('broll', 'higgsfield'));
    expect(out).toEqual({ resultId: 'broll-job-123' });
    expect(spy).toHaveBeenCalledWith('[worker] broll job job-123 provider=higgsfield — dispatch via external API');
  });

  it('reproduces the exact prior audio stub', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await new NullRenderer().render(job('audio', 'elevenlabs'));
    expect(out).toEqual({ resultId: 'audio-job-123' });
    expect(spy).toHaveBeenCalledWith('[worker] audio job job-123 provider=elevenlabs');
  });

  it('reproduces the exact prior thumbnail stub', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await new NullRenderer().render(job('thumbnail', 'my-poster'));
    expect(out).toEqual({ resultId: 'thumbnail-job-123' });
    expect(spy).toHaveBeenCalledWith('[worker] thumbnail job job-123 provider=my-poster');
  });

  it('reproduces the exact prior default/unknown-capability stub', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await new NullRenderer().render(job('poster', 'canva'));
    expect(out).toEqual({ resultId: 'stub-job-123' });
    expect(spy).toHaveBeenCalledWith('[worker] dispatching job job-123 capability=poster provider=canva');
  });

  it('declares itself headless with no external side effects', () => {
    expect(new NullRenderer().capabilities.headless).toBe(true);
  });
});

describe('RendererRegistry lookup behavior', () => {
  it('returns an exact (capability, provider) match when registered', () => {
    const registry = new RendererRegistry();
    const renderer = new NullRenderer();
    registry.register('broll', 'higgsfield', renderer);
    expect(registry.resolve('broll', 'higgsfield')).toBe(renderer);
  });

  it('falls back when no exact match exists and a fallback is set', () => {
    const registry = new RendererRegistry();
    const fallback = new NullRenderer();
    registry.setFallback(fallback);
    expect(registry.resolve('audio', 'unregistered-provider')).toBe(fallback);
  });

  it('returns undefined for an unsupported capability/provider with no fallback', () => {
    const registry = new RendererRegistry();
    expect(registry.resolve('wordart', 'adobe')).toBeUndefined();
  });

  it('prefers an exact match over the fallback', () => {
    const registry = new RendererRegistry();
    const specific = new NullRenderer();
    const fallback = new NullRenderer();
    registry.register('broll', 'higgsfield', specific);
    registry.setFallback(fallback);
    expect(registry.resolve('broll', 'higgsfield')).toBe(specific);
    expect(registry.resolve('broll', 'other-provider')).toBe(fallback);
  });
});

describe('createDefaultRendererRegistry', () => {
  it('is a NullRenderer fallback covering every capability (matches pre-PR-4 total dispatch)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = createDefaultRendererRegistry();
    for (const capability of ['broll', 'audio', 'thumbnail', 'anything-else']) {
      const renderer = registry.resolve(capability, 'some-provider');
      expect(renderer).toBeInstanceOf(NullRenderer);
    }
  });
});
