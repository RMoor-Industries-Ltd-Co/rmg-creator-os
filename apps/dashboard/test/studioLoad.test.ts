import { describe, it, expect } from 'vitest';
import { loadStudioData } from '../src/studioLoad.js';

// Regression coverage for the production incident: Studio's `Promise.all` bootstrap meant an
// avatar-catalog failure also erased the ability to observe whether voices or video history
// succeeded. `loadStudioData` must resolve each of the three surfaces independently — a failure
// on one must never affect the outcome recorded for another.

describe('loadStudioData', () => {
  it('resolves all three surfaces independently when everything succeeds', async () => {
    const result = await loadStudioData({
      avatars: () => Promise.resolve(['a1']),
      voices: () => Promise.resolve(['v1']),
      videos: () => Promise.resolve(['d1'])
    });
    expect(result).toEqual({
      avatars: { data: ['a1'] },
      voices: { data: ['v1'] },
      videos: { data: ['d1'] }
    });
  });

  it('an avatar failure does not prevent voices or video history from loading', async () => {
    const result = await loadStudioData({
      avatars: () => Promise.reject(new Error('HeyGen /v3/avatars/looks: more than 40 pages')),
      voices: () => Promise.resolve(['v1']),
      videos: () => Promise.resolve(['d1'])
    });
    expect(result.avatars.error).toContain('more than 40 pages');
    expect(result.avatars.data).toBeUndefined();
    expect(result.voices).toEqual({ data: ['v1'] });
    expect(result.videos).toEqual({ data: ['d1'] });
  });

  it('a voice failure does not prevent avatars or video history from loading', async () => {
    const result = await loadStudioData({
      avatars: () => Promise.resolve(['a1']),
      voices: () => Promise.reject(new Error('HeyGen /v3/voices: more than 40 pages')),
      videos: () => Promise.resolve(['d1'])
    });
    expect(result.avatars).toEqual({ data: ['a1'] });
    expect(result.voices.error).toContain('more than 40 pages');
    expect(result.voices.data).toBeUndefined();
    expect(result.videos).toEqual({ data: ['d1'] });
  });

  it('a video-history failure does not prevent avatars or voices from loading', async () => {
    const result = await loadStudioData({
      avatars: () => Promise.resolve(['a1']),
      voices: () => Promise.resolve(['v1']),
      videos: () => Promise.reject(new Error('history unavailable'))
    });
    expect(result.avatars).toEqual({ data: ['a1'] });
    expect(result.voices).toEqual({ data: ['v1'] });
    expect(result.videos.error).toBe('Error: history unavailable');
  });

  it('records each surface\'s own error independently when all three fail', async () => {
    const result = await loadStudioData({
      avatars: () => Promise.reject(new Error('avatar boom')),
      voices: () => Promise.reject(new Error('voice boom')),
      videos: () => Promise.reject(new Error('video boom'))
    });
    expect(result.avatars.error).toBe('Error: avatar boom');
    expect(result.voices.error).toBe('Error: voice boom');
    expect(result.videos.error).toBe('Error: video boom');
  });
});
