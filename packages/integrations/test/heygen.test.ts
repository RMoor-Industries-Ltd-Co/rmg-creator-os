import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createHeyGenClient,
  dimensionToFormat,
  HeyGenError,
  reconcileBeforeRetry,
  type HeyGenClient
} from '../src/heygen.js';

// The v3 port is a request-shape change against a paid API, so these tests assert the shape
// itself — path, method, headers, body — rather than only that the client returns something.
// A wrong field name here costs a rejected render or, worse, a charged duplicate.

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: unknown;
}

function mockFetch(responders: Array<(call: Call) => { status?: number; json: unknown } | undefined>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const rawBody = init.body;
    let body: unknown;
    if (typeof rawBody === 'string') {
      body = JSON.parse(rawBody);
    }
    const call: Call = { url: String(url), method: init.method ?? 'GET', headers, body, rawBody };
    calls.push(call);
    for (const responder of responders) {
      const hit = responder(call);
      if (hit) {
        return {
          ok: (hit.status ?? 200) < 400,
          status: hit.status ?? 200,
          text: async () => JSON.stringify(hit.json)
        } as Response;
      }
    }
    throw new Error(`unexpected request: ${call.method} ${call.url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const generateOk = (videoId = 'v_1') => (c: Call) =>
  c.url.endsWith('/v3/videos') && c.method === 'POST'
    ? { json: { data: { video_id: videoId } } }
    : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dimensionToFormat — v2 pixel dimensions to v3 aspect_ratio + resolution', () => {
  it('maps the two dimensions this repository actually uses, exactly', () => {
    expect(dimensionToFormat({ width: 720, height: 1280 })).toEqual({
      aspectRatio: '9:16',
      resolution: '720p'
    });
    expect(dimensionToFormat({ width: 1280, height: 720 })).toEqual({
      aspectRatio: '16:9',
      resolution: '720p'
    });
  });

  it('picks the resolution tier the requested pixels fit within', () => {
    expect(dimensionToFormat({ width: 1920, height: 1080 }).resolution).toBe('1080p');
    expect(dimensionToFormat({ width: 3840, height: 2160 }).resolution).toBe('4k');
    expect(dimensionToFormat({ width: 640, height: 360 }).resolution).toBe('720p');
  });

  it('reads the tier off the short edge, so a squarer frame is not downgraded', () => {
    // A tier name is a short-edge pixel count in both orientations (1920x1080 and 1080x1920
    // are both 1080p). Reading the LONG edge assumes 16:9 and cuts anything squarer: this
    // 1:1 frame genuinely needs 1080p, but its longest edge is only 1080.
    expect(dimensionToFormat({ width: 1080, height: 1080 })).toEqual({
      aspectRatio: '1:1',
      resolution: '1080p'
    });
    // Portrait and landscape at the same tier agree.
    expect(dimensionToFormat({ width: 1080, height: 1920 }).resolution).toBe('1080p');
    expect(dimensionToFormat({ width: 2160, height: 2160 }).resolution).toBe('4k');
  });

  it('snaps an unsupported ratio to the nearest supported one rather than failing', () => {
    // 4:3 is not in v3's set; 5:4 (1.25) is nearer to 1.333 than 16:9 (1.778) or 1:1.
    expect(dimensionToFormat({ width: 1024, height: 768 }).aspectRatio).toBe('5:4');
    expect(dimensionToFormat({ width: 1080, height: 1080 }).aspectRatio).toBe('1:1');
  });

  it('refuses a nonsensical dimension instead of emitting a NaN ratio', () => {
    expect(() => dimensionToFormat({ width: 0, height: 100 })).toThrow(HeyGenError);
    expect(() => dimensionToFormat({ width: 100, height: -1 })).toThrow(HeyGenError);
  });
});

describe('generateVideo — v3 request shape', () => {
  it('posts /v3/videos with the flat avatar body, not v2 video_inputs', async () => {
    const calls = mockFetch([generateOk('v_abc')]);
    const client = createHeyGenClient('k');
    const out = await client.generateVideo({
      avatarId: 'lk_1',
      audioUrl: 'https://audio',
      useAvatarIv: true,
      customMotionPrompt: 'lean in',
      dimension: { width: 720, height: 1280 },
      title: 'Take 1'
    });

    expect(out).toEqual({ videoId: 'v_abc' });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.heygen.com/v3/videos');
    expect(call.method).toBe('POST');
    expect(call.headers['X-Api-Key']).toBe('k');
    expect(call.body).toEqual({
      type: 'avatar',
      avatar_id: 'lk_1',
      audio_url: 'https://audio',
      aspect_ratio: '9:16',
      resolution: '720p',
      engine: { type: 'avatar_iv' },
      motion_prompt: 'lean in',
      title: 'Take 1'
    });
    // The v2 spellings must be gone, not merely unused.
    expect(call.body).not.toHaveProperty('video_inputs');
    expect(call.body).not.toHaveProperty('dimension');
    expect(call.body).not.toHaveProperty('character');
    expect(call.body).not.toHaveProperty('voice');
    expect(call.body).not.toHaveProperty('use_avatar_iv_model');
    expect(call.body).not.toHaveProperty('custom_motion_prompt');
  });

  it('sends script + voice_id for the TTS form', async () => {
    const calls = mockFetch([generateOk()]);
    await createHeyGenClient('k').generateVideo({
      avatarId: 'lk_1',
      voiceId: 'vo_1',
      inputText: 'hello'
    });
    expect(calls[0]!.body).toMatchObject({ script: 'hello', voice_id: 'vo_1' });
  });

  it('accepts aspectRatio/resolution directly, overriding a dimension', async () => {
    const calls = mockFetch([generateOk()]);
    await createHeyGenClient('k').generateVideo({
      avatarId: 'lk_1',
      audioUrl: 'https://a',
      dimension: { width: 720, height: 1280 },
      aspectRatio: '1:1',
      resolution: '1080p'
    });
    expect(calls[0]!.body).toMatchObject({ aspect_ratio: '1:1', resolution: '1080p' });
  });

  it('rejects contradictory voice inputs rather than letting the provider pick', async () => {
    mockFetch([generateOk()]);
    const client = createHeyGenClient('k');
    await expect(
      client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a', inputText: 'hi', voiceId: 'v' })
    ).rejects.toThrow(/mutually exclusive/);
    await expect(client.generateVideo({ avatarId: 'lk_1' })).rejects.toThrow(/provide audioUrl/);
    await expect(client.generateVideo({ avatarId: 'lk_1', inputText: 'hi' })).rejects.toThrow(
      /voiceId is required/
    );
  });
});

describe('Idempotency-Key', () => {
  it('is sent when provided, and absent when not', async () => {
    const calls = mockFetch([generateOk()]);
    const client = createHeyGenClient('k');

    await client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' });
    expect(calls[0]!.headers).not.toHaveProperty('Idempotency-Key');

    await client.generateVideo(
      { avatarId: 'lk_1', audioUrl: 'https://a' },
      { idempotencyKey: '0b9c1a2e-0000-4000-8000-000000000001' }
    );
    expect(calls[1]!.headers['Idempotency-Key']).toBe('0b9c1a2e-0000-4000-8000-000000000001');
  });

  it('refuses a key HeyGen would reject, before spending the call', async () => {
    const calls = mockFetch([generateOk()]);
    const client = createHeyGenClient('k');
    await expect(
      client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' }, { idempotencyKey: 'has space' })
    ).rejects.toThrow(/invalid Idempotency-Key/);
    // An empty key must fail rather than quietly sending an unprotected paid request.
    await expect(
      client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' }, { idempotencyKey: '' })
    ).rejects.toThrow(/invalid Idempotency-Key/);
    // The point of validating locally is that no paid request went out.
    expect(calls.filter((c) => c.url.endsWith('/v3/videos'))).toHaveLength(0);
  });

  it('marks a 409 as an idempotency conflict rather than a generic failure', async () => {
    mockFetch([
      (c) =>
        c.url.endsWith('/v3/videos') && c.method === 'POST'
          ? { status: 409, json: { message: 'in flight' } }
          : undefined
    ]);
    const err = await createHeyGenClient('k')
      .generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' }, { idempotencyKey: 'key-1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HeyGenError);
    expect((err as HeyGenError).isIdempotencyConflict).toBe(true);
  });
});

describe('callback_id', () => {
  it('is sent when provided, and absent when not', async () => {
    const calls = mockFetch([generateOk()]);
    const client = createHeyGenClient('k');

    await client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' });
    expect(calls[0]!.body).not.toHaveProperty('callback_id');

    await client.generateVideo({
      avatarId: 'lk_1',
      audioUrl: 'https://a',
      callbackId: 'attempt-77',
      callbackUrl: 'https://hook'
    });
    expect(calls[1]!.body).toMatchObject({ callback_id: 'attempt-77', callback_url: 'https://hook' });
  });
});

describe('status and history lookup', () => {
  it('reads GET /v3/videos/{id} and surfaces the split failure fields', async () => {
    const calls = mockFetch([
      (c) =>
        c.url.includes('/v3/videos/v_9')
          ? {
              json: {
                data: {
                  id: 'v_9',
                  status: 'failed',
                  failure_code: 'avatar_error',
                  failure_message: 'look not ready',
                  created_at: 111,
                  completed_at: 222
                }
              }
            }
          : undefined
    ]);
    const s = await createHeyGenClient('k').getVideoStatus('v_9');
    expect(calls[0]!.url).toBe('https://api.heygen.com/v3/videos/v_9');
    expect(s).toMatchObject({
      videoId: 'v_9',
      status: 'failed',
      failureCode: 'avatar_error',
      failureMessage: 'look not ready',
      createdAt: 111,
      completedAt: 222
    });
    // v2 callers branched on a truthy `error`; that must keep working.
    expect(s.error).toBeTruthy();
  });

  it('lists by title with pagination fields', async () => {
    const calls = mockFetch([
      (c) =>
        c.url.includes('/v3/videos?')
          ? {
              json: {
                data: [{ id: 'v_1', status: 'completed', title: 'attempt-1' }],
                has_more: true,
                next_token: 'tok'
              }
            }
          : undefined
    ]);
    const page = await createHeyGenClient('k').listVideos({ title: 'attempt-1', limit: 50 });
    expect(calls[0]!.url).toContain('title=attempt-1');
    expect(calls[0]!.url).toContain('limit=50');
    expect(page.hasMore).toBe(true);
    expect(page.nextToken).toBe('tok');
    expect(page.videos[0]).toMatchObject({ videoId: 'v_1', status: 'completed' });
  });
});

describe('reconcile before retry', () => {
  const opts = { avatarId: 'lk_1', audioUrl: 'https://a' };

  function fakeClient(over: Partial<HeyGenClient>): HeyGenClient {
    return {
      listAvatars: vi.fn(),
      listVoices: vi.fn(),
      createPhotoAvatar: vi.fn(),
      generateVideo: vi.fn(),
      getVideoStatus: vi.fn(),
      listVideos: vi.fn(),
      generateVideoReconciled: vi.fn(),
      ...over
    } as unknown as HeyGenClient;
  }

  it('submits normally when the key is still live and nothing conflicts', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn();
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-1',
      idempotencyKey: 'attempt-1'
    });
    expect(out).toEqual({ videoId: 'v_new', outcome: 'submitted' });
    // No speculative search while the idempotency key still protects the call.
    expect(listVideos).not.toHaveBeenCalled();
  });

  it('past the replay window, adopts an existing render instead of paying twice', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_dupe' });
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_old', status: 'completed', title: 'attempt-1' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-1',
      assumeKeyExpired: true
    });
    expect(out).toEqual({ videoId: 'v_old', outcome: 'recovered' });
    // The whole point: no second paid submission.
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('past the replay window with no prior render, submits once', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn().mockResolvedValue({ videos: [], hasMore: false });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-2',
      assumeKeyExpired: true
    });
    expect(out).toEqual({ videoId: 'v_new', outcome: 'submitted' });
    expect(generateVideo).toHaveBeenCalledOnce();
  });

  it('does not adopt a render whose title merely contains the search term', async () => {
    // `title` is a substring filter server-side, so "attempt-1" matches "attempt-10".
    // Adopting that would bind this attempt to a different segment's render.
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_other', status: 'completed', title: 'attempt-10' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-1',
      assumeKeyExpired: true
    });
    expect(out).toEqual({ videoId: 'v_new', outcome: 'submitted' });
  });

  it('does not adopt a failed prior render', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_bad', status: 'failed', title: 'attempt-3' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-3',
      assumeKeyExpired: true
    });
    expect(out).toEqual({ videoId: 'v_new', outcome: 'submitted' });
  });

  it('resolves a 409 by searching, not by resubmitting under a new key', async () => {
    const conflict = new HeyGenError('in flight', 409, {});
    const generateVideo = vi.fn().mockRejectedValue(conflict);
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_inflight', status: 'processing', title: 'attempt-4' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-4',
      idempotencyKey: 'attempt-4'
    });
    expect(out).toEqual({ videoId: 'v_inflight', outcome: 'recovered' });
    expect(generateVideo).toHaveBeenCalledOnce();
  });

  it('walks every page of history — the exact match may not be on page one', async () => {
    // `title` is a substring filter, so a short title can match far more rows than this
    // attempt's. Stopping at page one turns "not found yet" into a second paid render.
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_dupe' });
    const listVideos = vi
      .fn()
      .mockResolvedValueOnce({
        videos: [{ videoId: 'v_x', status: 'completed', title: 'attempt-70' }],
        hasMore: true,
        nextToken: 't2'
      })
      .mockResolvedValueOnce({
        videos: [{ videoId: 'v_want', status: 'completed', title: 'attempt-7' }],
        hasMore: false
      });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, {
      reconcileByTitle: 'attempt-7',
      assumeKeyExpired: true
    });
    expect(out).toEqual({ videoId: 'v_want', outcome: 'recovered' });
    expect(listVideos).toHaveBeenCalledTimes(2);
    expect(listVideos.mock.calls[1]![0]).toMatchObject({ token: 't2' });
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('refuses to submit when the search ran out of pages without resolving', async () => {
    // An incomplete search has not established "no prior render exists". Treating it as a
    // miss would authorize exactly the duplicate charge this function prevents.
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_dupe' });
    const listVideos = vi
      .fn()
      .mockResolvedValue({ videos: [], hasMore: true, nextToken: 'always-more' });
    const client = fakeClient({ generateVideo, listVideos });
    await expect(
      reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-8', assumeKeyExpired: true })
    ).rejects.toThrow(/incomplete search/);
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('searches first when no idempotency key was supplied at all', async () => {
    // With no key the submission is unprotected, so a lost response is unrecoverable. "No
    // key" must mean "search", not "submit and hope".
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_dupe' });
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_prior', status: 'processing', title: 'attempt-9' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-9' });
    expect(out).toEqual({ videoId: 'v_prior', outcome: 'recovered' });
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('still submits, once, when there is no key and no prior render', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn().mockResolvedValue({ videos: [], hasMore: false });
    const client = fakeClient({ generateVideo, listVideos });
    const out = await reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-11' });
    expect(out).toEqual({ videoId: 'v_new', outcome: 'submitted' });
    expect(listVideos).toHaveBeenCalledOnce();
    expect(generateVideo).toHaveBeenCalledOnce();
  });

  it('refuses to submit when history claims more pages but returns no cursor', async () => {
    // Same rule as the page bound: only an exhausted search licenses "no prior render
    // exists", which is the conclusion that authorizes spending money.
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_dupe' });
    const listVideos = vi
      .fn()
      .mockResolvedValue({ videos: [], hasMore: true, nextToken: undefined });
    const client = fakeClient({ generateVideo, listVideos });
    await expect(
      reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-12', assumeKeyExpired: true })
    ).rejects.toThrow(/no cursor/);
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('rejects an empty supplied key instead of treating it as absent', async () => {
    // `generateVideo` throws on an empty key. If this path quietly searched and returned
    // `recovered`, the same malformed input would be fatal on one entry point and fine on
    // the other. Supplied-and-wrong is not the same as not-supplied.
    const generateVideo = vi.fn();
    const listVideos = vi.fn().mockResolvedValue({
      videos: [{ videoId: 'v_prior', status: 'completed', title: 'attempt-13' }],
      hasMore: false
    });
    const client = fakeClient({ generateVideo, listVideos });
    await expect(
      reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-13', idempotencyKey: '' })
    ).rejects.toThrow(/invalid Idempotency-Key/);
    expect(listVideos).not.toHaveBeenCalled();
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('rethrows a non-409 failure rather than silently adopting something', async () => {
    const generateVideo = vi.fn().mockRejectedValue(new HeyGenError('boom', 500, {}));
    const listVideos = vi.fn();
    const client = fakeClient({ generateVideo, listVideos });
    await expect(
      reconcileBeforeRetry(client, opts, { reconcileByTitle: 'attempt-5', idempotencyKey: 'k5' })
    ).rejects.toThrow(/boom/);
    expect(listVideos).not.toHaveBeenCalled();
  });

  it('overrides the options title with the reconciliation title, so the two cannot drift', async () => {
    const generateVideo = vi.fn().mockResolvedValue({ videoId: 'v_new' });
    const listVideos = vi.fn().mockResolvedValue({ videos: [], hasMore: false });
    const client = fakeClient({ generateVideo, listVideos });
    await reconcileBeforeRetry(
      client,
      { ...opts, title: 'something else' },
      { reconcileByTitle: 'attempt-6' }
    );
    expect(generateVideo.mock.calls[0]![0]).toMatchObject({ title: 'attempt-6' });
  });

  it('requires a reconciliation title — a search with no term would match everything', async () => {
    const client = fakeClient({});
    await expect(
      reconcileBeforeRetry(client, opts, { reconcileByTitle: '' })
    ).rejects.toThrow(/reconcileByTitle is required/);
  });
});

describe('createPhotoAvatar — v2 talking photo replaced by upload + create + train', () => {
  const bytes = Buffer.from('imagedata');

  function photoAvatarFetch(lookStatuses: Array<string | undefined>) {
    let lookCall = 0;
    return mockFetch([
      (c) =>
        c.url.endsWith('/v3/assets') && c.method === 'POST'
          ? { json: { data: { asset_id: 'as_1' } } }
          : undefined,
      (c) =>
        c.url.endsWith('/v3/avatars') && c.method === 'POST'
          ? { json: { data: { avatar_item: { id: 'lk_9' }, avatar_group: { id: 'ag_9' } } } }
          : undefined,
      (c) => {
        if (!c.url.includes('/v3/avatars/looks/')) return undefined;
        const status = lookStatuses[Math.min(lookCall, lookStatuses.length - 1)];
        lookCall += 1;
        return { json: { data: status === undefined ? {} : { status } } };
      }
    ]);
  }

  it('uploads the asset, creates the photo avatar, and returns the look id', async () => {
    const calls = photoAvatarFetch(['completed']);
    const out = await createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
      name: 'aroll-p1'
    });
    expect(out).toEqual({ avatarId: 'lk_9', avatarGroupId: 'ag_9' });

    expect(calls[0]!.url).toBe('https://api.heygen.com/v3/assets');
    // Multipart: the client must not set Content-Type itself or the boundary is lost.
    expect(calls[0]!.rawBody).toBeInstanceOf(FormData);
    expect(calls[0]!.headers).not.toHaveProperty('Content-Type');

    expect(calls[1]!.url).toBe('https://api.heygen.com/v3/avatars');
    expect(calls[1]!.body).toMatchObject({
      type: 'photo',
      name: 'aroll-p1',
      file: { type: 'asset_id', asset_id: 'as_1' }
    });

    expect(calls[2]!.url).toBe('https://api.heygen.com/v3/avatars/looks/lk_9');
  });

  it('polls until the look finishes training', async () => {
    const calls = photoAvatarFetch(['processing', 'processing', 'completed']);
    const out = await createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
      pollIntervalMs: 0
    });
    expect(out.avatarId).toBe('lk_9');
    expect(calls.filter((c) => c.url.includes('/looks/'))).toHaveLength(3);
  });

  it('treats an absent status as ready — status is only present for private avatars', async () => {
    const calls = photoAvatarFetch([undefined]);
    await createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', { pollIntervalMs: 0 });
    expect(calls.filter((c) => c.url.includes('/looks/'))).toHaveLength(1);
  });

  it('fails fast on a failed look instead of polling to the deadline', async () => {
    photoAvatarFetch(['failed']);
    await expect(
      createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', { pollIntervalMs: 0 })
    ).rejects.toThrow(/is failed/);
  });

  it('times out rather than hanging when training never completes', async () => {
    photoAvatarFetch(['processing']);
    await expect(
      createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
        pollIntervalMs: 0,
        timeoutMs: 0
      })
    ).rejects.toThrow(/still processing/);
  });

  it('refuses a base key too long to derive from, before uploading anything', async () => {
    // 250 chars passes the raw 255 bound, but ':avatar' would push the second derived key to
    // 257. Validating only at use would upload the asset and then fail, stranding it.
    const calls = photoAvatarFetch(['completed']);
    await expect(
      createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
        idempotencyKey: 'a'.repeat(250),
        pollIntervalMs: 0
      })
    ).rejects.toThrow(/invalid Idempotency-Key/);
    expect(calls).toHaveLength(0);
  });

  it('accepts a base key that still fits once the suffix is added', async () => {
    const calls = photoAvatarFetch(['completed']);
    await createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
      idempotencyKey: 'a'.repeat(248),
      pollIntervalMs: 0
    });
    expect(calls[1]!.headers['Idempotency-Key']!.length).toBeLessThanOrEqual(255);
  });

  it('derives distinct idempotency keys for the two mutating steps', async () => {
    const calls = photoAvatarFetch(['completed']);
    await createHeyGenClient('k').createPhotoAvatar(bytes, 'image/png', {
      idempotencyKey: 'attempt-1',
      pollIntervalMs: 0
    });
    // One key reused across two different mutations would make the second replay the first.
    expect(calls[0]!.headers['Idempotency-Key']).toBe('attempt-1:asset');
    expect(calls[1]!.headers['Idempotency-Key']).toBe('attempt-1:avatar');
  });
});

describe('catalog pagination — v2 returned everything in one response', () => {
  function pagedFetch(path: string, pages: Array<{ data: unknown[]; next?: string }>) {
    return mockFetch([
      (c) => {
        if (!c.url.includes(path)) return undefined;
        const token = new URL(c.url).searchParams.get('token');
        const index = token ? Number(token) : 0;
        const page = pages[index]!;
        return {
          json: { data: page.data, has_more: Boolean(page.next), next_token: page.next ?? null }
        };
      }
    ]);
  }

  it('follows next_token across avatar pages instead of truncating at one', async () => {
    const calls = pagedFetch('/v3/avatars/looks', [
      { data: [{ id: 'lk_1', name: 'A' }], next: '1' },
      { data: [{ id: 'lk_2', name: 'B' }], next: '2' },
      { data: [{ id: 'lk_3', name: 'C' }] }
    ]);
    const avatars = await createHeyGenClient('k').listAvatars();
    // A single page would have returned one avatar, and lk_3 would be unselectable forever.
    expect(avatars.map((a) => a.avatar_id)).toEqual(['lk_1', 'lk_2', 'lk_3']);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toContain('limit=50');
    expect(calls[1]!.url).toContain('token=1');
  });

  it('follows next_token across voice pages too', async () => {
    pagedFetch('/v3/voices', [
      { data: [{ voice_id: 'vo_1' }], next: '1' },
      { data: [{ voice_id: 'vo_2' }] }
    ]);
    const voices = await createHeyGenClient('k').listVoices();
    expect(voices.map((v) => v.voice_id)).toEqual(['vo_1', 'vo_2']);
  });

  it('stops when has_more is false even if a token is still echoed', async () => {
    const calls = pagedFetch('/v3/avatars/looks', [{ data: [{ id: 'lk_1' }] }]);
    await createHeyGenClient('k').listAvatars();
    expect(calls).toHaveLength(1);
  });

  it('throws rather than returning a partial catalog when the page bound is hit', async () => {
    // Returning what accumulated would be the truncation bug this function fixes, back again
    // at a higher page count — and indistinguishable from a complete catalog to the caller.
    mockFetch([
      (c) =>
        c.url.includes('/v3/avatars/looks')
          ? { json: { data: [{ id: 'lk_x' }], has_more: true, next_token: 'endless' } }
          : undefined
    ]);
    await expect(createHeyGenClient('k').listAvatars()).rejects.toThrow(/partial catalog/);
  });

  it('throws when the server claims more pages but returns no cursor', async () => {
    mockFetch([
      (c) =>
        c.url.includes('/v3/voices')
          ? { json: { data: [{ voice_id: 'vo_1' }], has_more: true, next_token: null } }
          : undefined
    ]);
    await expect(createHeyGenClient('k').listVoices()).rejects.toThrow(/no next_token/);
  });
});

describe('avatars and voices keep their v2-shaped output for the dashboard', () => {
  it('maps a v3 look to avatar_id/avatar_name', async () => {
    const calls = mockFetch([
      (c) =>
        c.url.includes('/v3/avatars/looks')
          ? {
              json: {
                data: [{ id: 'lk_1', name: 'Rahm', gender: 'male', preview_image_url: 'https://p' }]
              }
            }
          : undefined
    ]);
    const avatars = await createHeyGenClient('k').listAvatars();
    expect(calls[0]!.url).toContain('/v3/avatars/looks');
    expect(avatars).toEqual([
      { avatar_id: 'lk_1', avatar_name: 'Rahm', gender: 'male', preview_image_url: 'https://p' }
    ]);
  });

  it('reads voices from /v3/voices', async () => {
    const calls = mockFetch([
      (c) =>
        c.url.includes('/v3/voices')
          ? { json: { data: [{ voice_id: 'vo_1', name: 'Narrator', language: 'English' }] } }
          : undefined
    ]);
    const voices = await createHeyGenClient('k').listVoices();
    expect(calls[0]!.url).toContain('/v3/voices');
    expect(voices[0]).toMatchObject({ voice_id: 'vo_1', name: 'Narrator' });
  });
});

describe('no v1 or v2 endpoint is reachable from this client', () => {
  it('every request path is under /v3', async () => {
    const calls = mockFetch([
      generateOk(),
      (c) => (c.url.includes('/v3/videos/') ? { json: { data: { id: 'v_1', status: 'completed' } } } : undefined),
      (c) => (c.url.endsWith('/v3/videos') && c.method === 'GET' ? { json: { data: [] } } : undefined),
      (c) => (c.url.includes('/v3/avatars/looks') ? { json: { data: [] } } : undefined),
      (c) => (c.url.includes('/v3/voices') ? { json: { data: [] } } : undefined)
    ]);
    const client = createHeyGenClient('k');
    await client.listAvatars();
    await client.listVoices();
    await client.generateVideo({ avatarId: 'lk_1', audioUrl: 'https://a' });
    await client.getVideoStatus('v_1');
    await client.listVideos();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.startsWith('https://api.heygen.com/v3/')).toBe(true);
    }
    // The v2/v1 paths and the separate upload host, specifically.
    const joined = calls.map((c) => c.url).join(' ');
    expect(joined).not.toContain('/v2/');
    expect(joined).not.toContain('/v1/');
    expect(joined).not.toContain('upload.heygen.com');
  });
});
