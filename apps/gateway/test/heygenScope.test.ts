import { describe, it, expect, vi } from 'vitest';
import { listStudioAvatars, listStudioVoices } from '../src/heygenScope.js';

// Regression coverage for the production incident: Studio's HeyGen live-read requested an
// unscoped catalog (HeyGen's full public library + the account's own), which exceeded the
// pagination safety bound. The fix is that Studio's route handlers must ALWAYS request the
// account's own ('private') catalog — never omit scope, never default to 'public'. These tests
// exist so that regression cannot silently reappear behind a passing typecheck: removing the
// `ownership`/`type` argument, or flipping it to 'public', fails the assertion below, not just
// the type system.

describe('listStudioAvatars', () => {
  it('always requests the private (account-owned) avatar catalog', async () => {
    const listAvatars = vi.fn().mockResolvedValue([]);
    await listStudioAvatars({ listAvatars });
    expect(listAvatars).toHaveBeenCalledWith({ ownership: 'private' });
    expect(listAvatars).toHaveBeenCalledOnce();
  });

  it('returns exactly what the client returns', async () => {
    const avatars = [{ avatar_id: 'lk_1' }];
    const listAvatars = vi.fn().mockResolvedValue(avatars);
    await expect(listStudioAvatars({ listAvatars })).resolves.toBe(avatars);
  });
});

describe('listStudioVoices', () => {
  it('always requests the private (account-owned) voice catalog', async () => {
    const listVoices = vi.fn().mockResolvedValue([]);
    await listStudioVoices({ listVoices });
    expect(listVoices).toHaveBeenCalledWith({ type: 'private' });
    expect(listVoices).toHaveBeenCalledOnce();
  });

  it('returns exactly what the client returns', async () => {
    const voices = [{ voice_id: 'vo_1' }];
    const listVoices = vi.fn().mockResolvedValue(voices);
    await expect(listStudioVoices({ listVoices })).resolves.toBe(voices);
  });
});
