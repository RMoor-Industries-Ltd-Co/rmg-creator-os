const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

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

export interface VideoRow {
  id: string;
  heygenVideoId: string;
  status: string;
  avatarId: string;
  voiceId: string;
  inputText: string;
  title: string | null;
  brand: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  driveFileId: string | null;
  driveLink: string | null;
  source: string;
  approved: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateConfig {
  avatarId: string;
  avatarStyle?: string;
  background?: { type: 'color'; value: string };
  dimension?: { width: number; height: number };
  stabilityMode?: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  const body = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export interface HiggsModel {
  job_set_type: string;
  display_name: string;
  type: string;
}

export const api = {
  avatars: () => req<HeyGenAvatar[]>('/heygen/avatars'),
  voices: () => req<HeyGenVoice[]>('/heygen/voices'),
  listVideos: () => req<VideoRow[]>('/heygen/videos'),
  getVideo: (id: string) => req<VideoRow>(`/heygen/videos/${id}`),
  higgsfieldModels: (type: 'image' | 'video' = 'image') =>
    req<HiggsModel[]>(`/higgsfield/models?type=${type}`),
  generate: (input: {
    avatarId: string;
    voiceId: string;
    text: string;
    title?: string;
    brand?: string;
  }) => req<VideoRow>('/heygen/videos', { method: 'POST', body: JSON.stringify(input) })
};

export interface Production {
  id: string;
  brand: string;
  persona: string | null;
  outputKind: string;
  topic: string;
  context: string | null;
  title: string | null;
  scriptText: string | null;
  scriptDocId: string | null;
  scriptDocUrl: string | null;
  scriptStatus: string;
  model: string | null;
  voiceBrand: string | null;
  taggedScript: string | null;
  stabilityMode: string | null;
  stability: number | null;
  audioTagPalette: string | null;
  intensity: string | null;
  voiceId: string | null;
  emotionLocked: boolean;
  stage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmotionProfile {
  brand: string;
  label: string;
  tags: string;
  emphasis: string;
  pacing: string;
  stability_mode: string;
  stability: number;
}

export const productions = {
  get: (id: string) => req<Production>(`/productions/${id}`),
  list: () => req<Production[]>('/productions'),
  create: (input: {
    brand: string;
    topic: string;
    persona?: string;
    outputKind?: string;
    context?: string;
  }) => req<Production>('/productions', { method: 'POST', body: JSON.stringify(input) }),
  emotionProfiles: () =>
    req<{ profiles: EmotionProfile[]; stability_values: Record<string, number> }>(
      '/emotion/profiles'
    ),
  generate: (id: string, body: GenerateConfig) =>
    req<VideoRow>(`/productions/${id}/generate`, { method: 'POST', body: JSON.stringify(body) }),
  videos: (id: string) => req<VideoRow[]>(`/productions/${id}/videos`),
  higgsfield: (id: string, body: { prompt: string; model: string; sourceAssetId?: string }) =>
    req<VideoRow>(`/productions/${id}/higgsfield`, { method: 'POST', body: JSON.stringify(body) }),
  compose: (
    id: string,
    body: {
      voice?: 'elevenlabs';
      audioAssetId?: string;
      imageAssetIds?: string[];
      orientation?: 'portrait' | 'landscape';
      broll?: boolean;
      brollQuery?: string;
    }
  ) => req<VideoRow>(`/productions/${id}/compose`, { method: 'POST', body: JSON.stringify(body) }),
  brollStatus: () => req<{ enabled: boolean }>('/broll/status'),
  aroll: (
    id: string,
    body: { imageAssetId: string; audioAssetId?: string; orientation?: 'portrait' | 'landscape'; stabilityMode?: string }
  ) => req<VideoRow>(`/productions/${id}/aroll`, { method: 'POST', body: JSON.stringify(body) }),
  stockBroll: (id: string, body: { query?: string; orientation?: 'portrait' | 'landscape' }) =>
    req<{ query: string; clips: VideoRow[] }>(`/productions/${id}/broll`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  approveVideo: (videoId: string) =>
    req<VideoRow>(`/videos/${videoId}/approve`, { method: 'POST' }),
  async discardVideo(videoId: string): Promise<void> {
    const res = await fetch(`${API}/videos/${videoId}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `discard failed (${res.status})`);
    }
  },
  direct: (
    id: string,
    body: { voiceBrand?: string; intensity?: string; stabilityMode?: string; lock?: boolean }
  ) =>
    req<Production>(`/productions/${id}/direct`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  async speak(
    id: string,
    opts: { directed?: boolean; stabilityMode?: string } = {}
  ): Promise<string> {
    const res = await fetch(`${API}/productions/${id}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts)
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `speak failed (${res.status})`);
    }
    return URL.createObjectURL(await res.blob());
  }
};

export interface Asset {
  id: string;
  productionId: string;
  kind: 'image' | 'video' | 'audio' | 'reference';
  role: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string | null;
  driveFileId: string | null;
  driveLink: string | null;
  status: string;
  createdAt: string;
}

export const assets = {
  list: (productionId: string) => req<Asset[]>(`/productions/${productionId}/assets`),
  rawUrl: (assetId: string) => `${API}/assets/${assetId}/raw`,
  async upload(productionId: string, files: FileList | File[]): Promise<Asset[]> {
    const form = new FormData();
    for (const f of Array.from(files)) form.append('file', f, f.name);
    const res = await fetch(`${API}/productions/${productionId}/assets`, {
      method: 'POST',
      body: form
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `upload failed (${res.status})`);
    }
    return (await res.json()) as Asset[];
  },
  async remove(assetId: string): Promise<void> {
    const res = await fetch(`${API}/assets/${assetId}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `delete failed (${res.status})`);
    }
  }
};

export const TERMINAL = new Set(['completed', 'failed']);
