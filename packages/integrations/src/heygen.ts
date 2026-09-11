// HeyGen avatar-video API client — **v3**.
// Docs: https://developers.heygen.com  ·  auth via X-Api-Key header.
//
// Ported from v1/v2, which HeyGen retires on 2026-11-01. This is a compatibility and
// execution-safety track, not a feature change: the exported surface is kept as close to the
// v2 client as v3 allows, and every place v3 forced a real difference is named in
// docs/atelier/heygen-v3-migration.md rather than papered over.
//
// Three things v3 gives us that v2 had no equivalent for, and that the A-Roll design
// (docs/atelier/aroll-candidate-canonical-design.md, decision D-J3) depends on:
//
//   1. `Idempotency-Key` — a client-supplied key; a retry within 24 hours replays the original
//      response instead of rendering (and charging) again.
//   2. `callback_id` — a caller-set correlation id echoed back on the completion webhook.
//   3. `GET /v3/videos` with a `title` filter — a searchable history, which is the only way to
//      reconcile a submission whose response we lost *after* the 24-hour replay window closes.
//
// Nothing here adopts webhooks. `callback_url`/`callback_id` are plumbed so a caller can use
// them, but this client neither requires nor receives deliveries.

const HEYGEN_BASE = 'https://api.heygen.com';

/** HeyGen's documented bound on `Idempotency-Key`: 1-255 chars from this set. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{1,255}$/;

// --- Public types ------------------------------------------------------------------------
//
// `HeyGenAvatar` and `HeyGenVoice` deliberately keep their v2 field names. v3 renamed
// `avatar_id` to `id` on a look, but the dashboard reads `avatar_id`/`avatar_name`
// (apps/dashboard/src/Studio.tsx) and the rename carries no information — so the mapping
// happens here, once, instead of rippling into the UI.

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name?: string;
  gender?: string;
  preview_image_url?: string;
}

export interface HeyGenVoice {
  voice_id: string;
  name?: string;
  language?: string;
  gender?: string;
}

export type HeyGenAspectRatio = '16:9' | '9:16' | '4:5' | '5:4' | '1:1';
export type HeyGenResolution = '4k' | '1080p' | '720p';

export interface GenerateVideoOptions {
  /** A look id from `listAvatars()` or `createPhotoAvatar()`. In v3 a photo avatar and a
   *  studio avatar are both addressed by look id — v2's separate `talking_photo_id` is gone. */
  avatarId: string;
  /** Voice: HeyGen TTS (voiceId + inputText) OR lip-sync to a hosted track (audioUrl) OR to an
   *  uploaded asset (audioAssetId). Exactly one of the three forms. */
  voiceId?: string;
  inputText?: string;
  audioUrl?: string;
  audioAssetId?: string;
  background?: { type: 'color'; value: string };
  /** Avatar IV: the newer photo-to-video engine. v2 spelled this `use_avatar_iv_model`. */
  useAvatarIv?: boolean;
  /** Free-text motion/expression direction. v2 spelled this `custom_motion_prompt`. */
  customMotionPrompt?: string;
  /** v3 takes `aspect_ratio` + `resolution`, not pixel dimensions. Pass either this — which is
   *  mapped by `dimensionToFormat()` — or `aspectRatio`/`resolution` directly. */
  dimension?: { width: number; height: number };
  aspectRatio?: HeyGenAspectRatio;
  resolution?: HeyGenResolution;
  title?: string;
  /** Caller-set correlation id, echoed on the completion webhook. Not used for lookup —
   *  `GET /v3/videos` cannot filter by it; use `title` for reconciliation. */
  callbackId?: string;
  callbackUrl?: string;
}

export type HeyGenVideoStatus = 'pending' | 'processing' | 'completed' | 'failed' | string;

export interface HeyGenVideoStatusResult {
  videoId: string;
  status: HeyGenVideoStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
  completedAt?: number;
  /** v3 splits a failure into a stable code and a human message; v2 returned one opaque blob. */
  failureCode?: string;
  failureMessage?: string;
  error?: unknown;
}

export interface HeyGenVideoListPage {
  videos: HeyGenVideoStatusResult[];
  hasMore: boolean;
  nextToken?: string;
}

export interface ListVideosOptions {
  /** Substring match on the video title. The only caller-influenced filter v3 exposes. */
  title?: string;
  limit?: number;
  token?: string;
  folderId?: string;
}

export class HeyGenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'HeyGenError';
  }

  /** A 409 from an endpoint given an `Idempotency-Key` means *the original request is still in
   *  flight* — not that it failed. A retry loop that treats this as a generic error will either
   *  give up on work that is about to succeed or, worse, resubmit it under a new key. */
  get isIdempotencyConflict(): boolean {
    return this.status === 409;
  }
}

export interface HeyGenClient {
  listAvatars(): Promise<HeyGenAvatar[]>;
  listVoices(): Promise<HeyGenVoice[]>;
  /** Upload an image and create a photo avatar from it, returning the **look id** to pass as
   *  `avatarId`. Replaces v2's `uploadTalkingPhoto`; see the note on the implementation — this
   *  one is asynchronous on HeyGen's side and therefore polls. */
  createPhotoAvatar(
    bytes: Buffer,
    mimeType: string,
    opts?: CreatePhotoAvatarOptions
  ): Promise<{ avatarId: string; avatarGroupId?: string }>;
  generateVideo(opts: GenerateVideoOptions, req?: RequestOptions): Promise<{ videoId: string }>;
  getVideoStatus(videoId: string): Promise<HeyGenVideoStatusResult>;
  listVideos(opts?: ListVideosOptions): Promise<HeyGenVideoListPage>;
  /** Submit, but look for an existing render first when the idempotency key can no longer help.
   *  See `reconcileBeforeRetry` below for why both halves are needed. */
  generateVideoReconciled(
    opts: GenerateVideoOptions,
    req: ReconciledRequestOptions
  ): Promise<ReconciledResult>;
}

export interface RequestOptions {
  /** Sent as the `Idempotency-Key` header. Must match `[A-Za-z0-9_\-:.]{1,255}`; a UUID does.
   *  A repeat within 24 hours replays the original response rather than rendering again. */
  idempotencyKey?: string;
}

export interface ReconciledRequestOptions extends RequestOptions {
  /** The exact `title` this submission uses. Reconciliation searches history for it, so it has
   *  to be unique to this attempt — a bare production title is not. */
  reconcileByTitle: string;
  /** Skip straight to the search. Callers set this when the attempt is older than HeyGen's
   *  24-hour replay window, where the idempotency key no longer protects anything. */
  assumeKeyExpired?: boolean;
}

export interface ReconciledResult {
  videoId: string;
  /** `submitted` — a new render was started. `recovered` — an existing render for this exact
   *  title was found and adopted, and no second paid call was made. */
  outcome: 'submitted' | 'recovered';
}

export interface CreatePhotoAvatarOptions {
  name?: string;
  avatarGroupId?: string;
  idempotencyKey?: string;
  /** How long to wait for HeyGen to finish training the look. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

// --- Format mapping ------------------------------------------------------------------------

const ASPECT_RATIOS: Array<{ ratio: HeyGenAspectRatio; value: number }> = [
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '9:16', value: 9 / 16 },
  { ratio: '4:5', value: 4 / 5 },
  { ratio: '5:4', value: 5 / 4 },
  { ratio: '1:1', value: 1 }
];

/**
 * v2 accepted arbitrary pixel dimensions; v3 accepts an aspect ratio and a resolution tier.
 * That is a genuine narrowing, so the mapping is explicit and lossy in a stated direction:
 * the *nearest* supported ratio, and the resolution tier the requested pixels fit within.
 *
 * The two dimensions this repository actually uses map exactly — 720x1280 to 9:16 at 720p and
 * 1280x720 to 16:9 at 720p — so today's renders are unchanged in shape. An unusual dimension
 * is snapped rather than rejected, because refusing it would turn a working call into a 4xx
 * for a difference the provider would have absorbed anyway.
 */
export function dimensionToFormat(dimension: { width: number; height: number }): {
  aspectRatio: HeyGenAspectRatio;
  resolution: HeyGenResolution;
} {
  const { width, height } = dimension;
  if (!(width > 0) || !(height > 0)) {
    throw new HeyGenError(`invalid dimension ${width}x${height}`);
  }
  const target = width / height;
  let best = ASPECT_RATIOS[0]!;
  for (const candidate of ASPECT_RATIOS) {
    if (Math.abs(candidate.value - target) < Math.abs(best.value - target)) best = candidate;
  }
  const longest = Math.max(width, height);
  const resolution: HeyGenResolution = longest >= 3840 ? '4k' : longest >= 1920 ? '1080p' : '720p';
  return { aspectRatio: best.ratio, resolution };
}

function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HeyGenError(
      `invalid Idempotency-Key ${JSON.stringify(key)}: must be 1-255 chars matching [A-Za-z0-9_-:.]`
    );
  }
}

// --- Client ---------------------------------------------------------------------------------

export function createHeyGenClient(apiKey: string): HeyGenClient {
  if (!apiKey) throw new Error('HeyGen API key is required');

  function parse(text: string): unknown {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text };
    }
  }

  async function req<T = unknown>(
    path: string,
    init?: RequestInit & { idempotencyKey?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-Api-Key': apiKey,
      ...((init?.headers as Record<string, string>) ?? {})
    };
    if (init?.body !== undefined && !(init.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    // `!== undefined`, not truthiness: an empty-string key is a caller bug, and silently
    // dropping it would send an UNPROTECTED paid request while the caller believes the
    // submission is idempotent. Fail instead.
    if (init?.idempotencyKey !== undefined) {
      assertIdempotencyKey(init.idempotencyKey);
      headers['Idempotency-Key'] = init.idempotencyKey;
    }
    const res = await fetch(`${HEYGEN_BASE}${path}`, { ...init, headers });
    const json = parse(await res.text());
    if (!res.ok) {
      throw new HeyGenError(`HeyGen ${path} failed (${res.status})`, res.status, json);
    }
    // HeyGen wraps failures in a non-null `error` field even on HTTP 200. Carried over from
    // the v2 client — it was true there and the v3 envelope is the same shape.
    const err = (json as { error?: unknown }).error;
    if (err) throw new HeyGenError(`HeyGen ${path} returned an error`, res.status, err);
    return json as T;
  }

  interface V3VideoDetail {
    id?: string;
    video_id?: string;
    status?: string;
    video_url?: string | null;
    thumbnail_url?: string | null;
    title?: string | null;
    duration?: number | null;
    created_at?: number | null;
    completed_at?: number | null;
    failure_code?: string | null;
    failure_message?: string | null;
  }

  function toStatusResult(d: V3VideoDetail, fallbackId?: string): HeyGenVideoStatusResult {
    const videoId = d.id ?? d.video_id ?? fallbackId ?? '';
    const failureCode = d.failure_code ?? undefined;
    const failureMessage = d.failure_message ?? undefined;
    return {
      videoId,
      status: d.status ?? 'unknown',
      videoUrl: d.video_url ?? undefined,
      thumbnailUrl: d.thumbnail_url ?? undefined,
      title: d.title ?? undefined,
      durationSeconds: d.duration ?? undefined,
      createdAt: d.created_at ?? undefined,
      completedAt: d.completed_at ?? undefined,
      failureCode,
      failureMessage,
      // Kept so callers written against the v2 client still see a truthy `error` on a failed
      // render rather than silently reading `undefined`.
      error: failureCode || failureMessage ? { code: failureCode, message: failureMessage } : undefined
    };
  }

  const client: HeyGenClient = {
    async listAvatars() {
      const j = await req<{ data?: Array<Record<string, unknown>> }>(
        '/v3/avatars/looks?limit=50'
      );
      return (j.data ?? []).map((a) => ({
        avatar_id: String(a.id ?? ''),
        avatar_name: (a.name as string | undefined) ?? undefined,
        gender: (a.gender as string | undefined) ?? undefined,
        preview_image_url: (a.preview_image_url as string | undefined) ?? undefined
      }));
    },

    async listVoices() {
      const j = await req<{ data?: Array<Record<string, unknown>> }>('/v3/voices?limit=100');
      return (j.data ?? []).map((v) => ({
        voice_id: String(v.voice_id ?? ''),
        name: (v.name as string | undefined) ?? undefined,
        language: (v.language as string | undefined) ?? undefined,
        gender: (v.gender as string | undefined) ?? undefined
      }));
    },

    // v2 did this in one synchronous call to upload.heygen.com and handed back an id that was
    // immediately usable. v3 splits it into upload -> create -> train, and the look is not
    // usable until training completes — so this polls, and can time out. Callers that used to
    // treat the id as instantly available must tolerate the wait (or the timeout).
    async createPhotoAvatar(bytes, mimeType, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const pollIntervalMs = opts.pollIntervalMs ?? 2_000;

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), 'upload');
      const uploaded = await req<{ data?: { asset_id?: string } }>('/v3/assets', {
        method: 'POST',
        body: form,
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:asset` : undefined
      });
      const assetId = uploaded.data?.asset_id;
      if (!assetId) throw new HeyGenError('asset upload: missing asset_id', undefined, uploaded);

      const created = await req<{
        data?: { avatar_item?: { id?: string; status?: string }; avatar_group?: { id?: string } };
      }>('/v3/avatars', {
        method: 'POST',
        body: JSON.stringify({
          type: 'photo',
          name: opts.name ?? `aroll-${Date.now()}`,
          file: { type: 'asset_id', asset_id: assetId },
          ...(opts.avatarGroupId ? { avatar_group_id: opts.avatarGroupId } : {})
        }),
        idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:avatar` : undefined
      });
      const avatarId = created.data?.avatar_item?.id;
      if (!avatarId) throw new HeyGenError('create photo avatar: missing look id', undefined, created);
      const avatarGroupId = created.data?.avatar_group?.id;

      const deadline = Date.now() + timeoutMs;
      // The status field is only present for private avatars; an absent status means there is
      // nothing to wait for, so treat it as ready rather than polling until the deadline.
      for (;;) {
        const look = await req<{ data?: { status?: string; error?: unknown } }>(
          `/v3/avatars/looks/${encodeURIComponent(avatarId)}`
        );
        const status = look.data?.status;
        if (!status || status === 'completed') return { avatarId, avatarGroupId };
        if (status === 'failed' || status === 'pending_consent') {
          throw new HeyGenError(`photo avatar ${avatarId} is ${status}`, undefined, look.data);
        }
        if (Date.now() >= deadline) {
          throw new HeyGenError(
            `photo avatar ${avatarId} still ${status} after ${timeoutMs}ms`,
            undefined,
            look.data
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },

    async generateVideo(opts, request = {}) {
      const voiceForms = [opts.audioUrl, opts.audioAssetId, opts.inputText].filter(Boolean).length;
      if (voiceForms === 0) {
        throw new HeyGenError('generateVideo: provide audioUrl, audioAssetId, or inputText');
      }
      if (voiceForms > 1) {
        throw new HeyGenError(
          'generateVideo: audioUrl, audioAssetId and inputText are mutually exclusive'
        );
      }
      if (opts.inputText && !opts.voiceId) {
        throw new HeyGenError('generateVideo: voiceId is required with inputText');
      }
      if (!opts.avatarId) throw new HeyGenError('generateVideo: avatarId is required');

      const format = opts.dimension ? dimensionToFormat(opts.dimension) : undefined;
      const aspectRatio = opts.aspectRatio ?? format?.aspectRatio;
      const resolution = opts.resolution ?? format?.resolution;

      const body = {
        type: 'avatar',
        avatar_id: opts.avatarId,
        ...(opts.inputText ? { script: opts.inputText, voice_id: opts.voiceId } : {}),
        ...(opts.audioUrl ? { audio_url: opts.audioUrl } : {}),
        ...(opts.audioAssetId ? { audio_asset_id: opts.audioAssetId } : {}),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(opts.background ? { background: opts.background } : {}),
        ...(opts.useAvatarIv ? { engine: { type: 'avatar_iv' } } : {}),
        ...(opts.customMotionPrompt ? { motion_prompt: opts.customMotionPrompt } : {}),
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.callbackId ? { callback_id: opts.callbackId } : {}),
        ...(opts.callbackUrl ? { callback_url: opts.callbackUrl } : {})
      };

      const j = await req<{ data?: { video_id?: string } }>('/v3/videos', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: request.idempotencyKey
      });
      const videoId = j.data?.video_id;
      if (!videoId) throw new HeyGenError('HeyGen generate: missing video_id', undefined, j);
      return { videoId };
    },

    async getVideoStatus(videoId) {
      const j = await req<{ data?: V3VideoDetail }>(
        `/v3/videos/${encodeURIComponent(videoId)}`
      );
      return toStatusResult(j.data ?? {}, videoId);
    },

    async listVideos(opts = {}) {
      const params = new URLSearchParams();
      if (opts.title) params.set('title', opts.title);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.token) params.set('token', opts.token);
      if (opts.folderId) params.set('folder_id', opts.folderId);
      const query = params.toString();
      const j = await req<{
        data?: V3VideoDetail[];
        has_more?: boolean;
        next_token?: string | null;
      }>(`/v3/videos${query ? `?${query}` : ''}`);
      return {
        videos: (j.data ?? []).map((d) => toStatusResult(d)),
        hasMore: Boolean(j.has_more),
        nextToken: j.next_token ?? undefined
      };
    },

    generateVideoReconciled: (opts, request) => reconcileBeforeRetry(client, opts, request)
  };

  return client;
}

/**
 * Reconcile before retry (A-Roll design §4.3, decision D-J3).
 *
 * The failure this exists for: a paid submission is accepted by HeyGen and the process dies
 * before the response is persisted. The request succeeded; we just do not know its id. Retrying
 * naively renders — and charges — a second time, and a local uniqueness constraint cannot stop
 * it, because it deduplicates rows rather than outbound calls.
 *
 * Two mechanisms, because neither covers the whole window:
 *
 *   - Inside 24 hours, `Idempotency-Key` is exact: HeyGen replays the original response and no
 *     second render happens. This is the path that should normally run.
 *   - Past 24 hours the key is expired and means nothing, so the only remaining handle is
 *     history. `reconcileByTitle` is searched first, and a hit is adopted rather than
 *     resubmitted. Callers signal this case with `assumeKeyExpired`.
 *
 * The title must be unique to the attempt. A production title is not — two attempts at the same
 * segment would share it, and reconciliation would adopt the wrong render. Callers are expected
 * to embed the attempt's own identifier; that is why this takes the title explicitly rather
 * than reusing `opts.title`.
 *
 * A 409 is not an error here. It means the original request is still in flight, which is
 * precisely the situation this function exists to avoid duplicating — so it resolves by
 * searching rather than failing.
 */
export async function reconcileBeforeRetry(
  client: HeyGenClient,
  opts: GenerateVideoOptions,
  request: ReconciledRequestOptions
): Promise<ReconciledResult> {
  const { reconcileByTitle, assumeKeyExpired, idempotencyKey } = request;
  if (!reconcileByTitle) {
    throw new HeyGenError('reconcileBeforeRetry: reconcileByTitle is required');
  }

  const findExisting = async (): Promise<string | undefined> => {
    const page = await client.listVideos({ title: reconcileByTitle, limit: 100 });
    // `title` is a substring filter, so an exact comparison is required on the way back out —
    // otherwise a title that is a prefix of another attempt's would adopt the wrong render.
    const exact = page.videos.filter((v) => v.title === reconcileByTitle);
    if (exact.length === 0) return undefined;
    // Prefer a render that is alive or done over one that failed: a failed prior attempt is
    // not something to adopt, it is something to supersede.
    const usable = exact.find((v) => v.status !== 'failed') ?? undefined;
    return usable?.videoId;
  };

  if (assumeKeyExpired) {
    const existing = await findExisting();
    if (existing) return { videoId: existing, outcome: 'recovered' };
  }

  try {
    const { videoId } = await client.generateVideo(
      { ...opts, title: reconcileByTitle },
      { idempotencyKey }
    );
    return { videoId, outcome: 'submitted' };
  } catch (err) {
    if (err instanceof HeyGenError && err.isIdempotencyConflict) {
      const existing = await findExisting();
      if (existing) return { videoId: existing, outcome: 'recovered' };
    }
    throw err;
  }
}
