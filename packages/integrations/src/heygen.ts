// HeyGen avatar-video API client (v2 generate + status).
// Docs: https://docs.heygen.com  ·  auth via X-Api-Key header.
// v2 is supported through 2026-10-31; migrate to v3 before then.

const HEYGEN_BASE = 'https://api.heygen.com';

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

export interface GenerateVideoOptions {
  avatarId: string;
  // Voice: either HeyGen TTS (voiceId + inputText) OR lip-sync to a hosted audio
  // track (audioUrl) — e.g. ALLEN's emotion-directed ElevenLabs render.
  voiceId?: string;
  inputText?: string;
  audioUrl?: string;
  avatarStyle?: string;
  dimension?: { width: number; height: number };
  title?: string;
}

export type HeyGenVideoStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'waiting'
  | string;

export interface HeyGenVideoStatusResult {
  videoId: string;
  status: HeyGenVideoStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: unknown;
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
}

export interface HeyGenClient {
  listAvatars(): Promise<HeyGenAvatar[]>;
  listVoices(): Promise<HeyGenVoice[]>;
  generateVideo(opts: GenerateVideoOptions): Promise<{ videoId: string }>;
  getVideoStatus(videoId: string): Promise<HeyGenVideoStatusResult>;
}

export function createHeyGenClient(apiKey: string): HeyGenClient {
  if (!apiKey) throw new Error('HeyGen API key is required');

  async function req<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${HEYGEN_BASE}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new HeyGenError(`HeyGen ${path} failed (${res.status})`, res.status, json);
    }
    // HeyGen wraps failures in a non-null `error` field even on HTTP 200.
    const err = (json as { error?: unknown }).error;
    if (err) throw new HeyGenError(`HeyGen ${path} returned an error`, res.status, err);
    return json as T;
  }

  return {
    async listAvatars() {
      const j = await req<{ data?: { avatars?: HeyGenAvatar[] } }>('/v2/avatars');
      return j.data?.avatars ?? [];
    },

    async listVoices() {
      const j = await req<{ data?: { voices?: HeyGenVoice[] } }>('/v2/voices');
      return j.data?.voices ?? [];
    },

    async generateVideo(opts) {
      // Lip-sync to a hosted audio track when given, else HeyGen TTS from text.
      const voice = opts.audioUrl
        ? { type: 'audio', audio_url: opts.audioUrl }
        : { type: 'text', input_text: opts.inputText ?? '', voice_id: opts.voiceId };
      if (!opts.audioUrl && (!opts.voiceId || !opts.inputText)) {
        throw new HeyGenError('generateVideo: provide audioUrl, or voiceId + inputText');
      }
      const body = {
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: opts.avatarId,
              avatar_style: opts.avatarStyle ?? 'normal'
            },
            voice
          }
        ],
        dimension: opts.dimension ?? { width: 1280, height: 720 },
        ...(opts.title ? { title: opts.title } : {})
      };
      const j = await req<{ data?: { video_id?: string } }>('/v2/video/generate', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const videoId = j.data?.video_id;
      if (!videoId) throw new HeyGenError('HeyGen generate: missing video_id', undefined, j);
      return { videoId };
    },

    async getVideoStatus(videoId) {
      const j = await req<{
        data?: { status?: string; video_url?: string; thumbnail_url?: string; error?: unknown };
      }>(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
      const d = j.data ?? {};
      return {
        videoId,
        status: d.status ?? 'unknown',
        videoUrl: d.video_url,
        thumbnailUrl: d.thumbnail_url,
        error: d.error
      };
    }
  };
}
