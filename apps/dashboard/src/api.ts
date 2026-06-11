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

export interface TopicSuggestion {
  title: string;
  hook: string;
  angle: string;
}

export interface TrendItem {
  title: string;
  link: string;
  source?: string;
  publishedAt?: string;
}

export const productions = {
  get: (id: string) => req<Production>(`/productions/${id}`),
  list: () => req<Production[]>('/productions'),
  topics: (brand: string, count = 6, useTrends = true) =>
    req<{ topics: TopicSuggestion[]; trends: TrendItem[] }>(
      `/brands/${brand}/topics?count=${count}&trends=${useTrends ? 1 : 0}`
    ),
  trends: (brand: string) => req<{ items: TrendItem[] }>(`/brands/${brand}/trends`),
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
    body: {
      imageAssetId?: string;
      sourceVideoId?: string;
      audioAssetId?: string;
      orientation?: 'portrait' | 'landscape';
      stabilityMode?: string;
      motionPrompt?: string;
    }
  ) => req<VideoRow>(`/productions/${id}/aroll`, { method: 'POST', body: JSON.stringify(body) }),
  arollPrompts: () => req<Array<{ name: string; text: string }>>('/aroll/prompts'),
  prompts: (kind: 'motion' | 'scene') => req<Array<{ name: string; text: string }>>(`/prompts?kind=${kind}`),
  stockBroll: (id: string, body: { query?: string; orientation?: 'portrait' | 'landscape' }) =>
    req<{ query: string; clips: VideoRow[] }>(`/productions/${id}/broll`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  assemble: (
    id: string,
    body: { items: Array<{ type: 'video' | 'image'; id: string }>; orientation?: 'portrait' | 'landscape' }
  ) => req<VideoRow>(`/productions/${id}/assemble`, { method: 'POST', body: JSON.stringify(body) }),
  tagVideo: (videoId: string, tags: string[]) =>
    req<VideoRow>(`/videos/${videoId}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) }),
  saveToDrive: (videoId: string) => req<VideoRow>(`/videos/${videoId}/save-to-drive`, { method: 'POST' }),
  archive: (id: string) =>
    req<{
      folder: string;
      aroll?: { name: string; link: string };
      final?: { name: string; link: string };
      voice?: { name: string; link: string };
      broll: Array<{ id: string; name: string | null; link: string | null; tags: string[] }>;
    }>(`/productions/${id}/archive`, { method: 'POST' }),
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

export interface Post {
  id: string;
  productionId: string;
  brand: string;
  platform: string;
  status: string;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  firstComment: string | null;
  coverAssetId: string | null;
  switches: Record<string, unknown> | null;
  scheduleAt: string | null;
  postUrl: string | null;
  error: string | null;
}

export interface BrandPostDefaults {
  brand: string;
  platforms: string[];
  hashtagStyle: string | null;
  audience: string | null;
  firstCommentTemplate: string | null;
  cadence: string | null;
}

export const poster = {
  posts: (id: string) => req<Post[]>(`/productions/${id}/posts`),
  savePost: (
    id: string,
    platform: string,
    body: {
      title?: string;
      caption?: string;
      hashtags?: string[];
      firstComment?: string;
      switches?: Record<string, unknown>;
      scheduleAt?: string | null;
      status?: string;
    }
  ) => req<Post>(`/productions/${id}/posts/${platform}`, { method: 'PUT', body: JSON.stringify(body) }),
  suggest: (id: string, platform: string) =>
    req<{ title: string; caption: string; hashtags: string[]; first_comment: string; audience: string }>(
      `/productions/${id}/suggest`,
      { method: 'POST', body: JSON.stringify({ platform }) }
    ),
  defaults: (brand: string) => req<BrandPostDefaults>(`/brands/${brand}/post-defaults`),
  saveDefaults: (brand: string, body: Partial<BrandPostDefaults>) =>
    req<BrandPostDefaults>(`/brands/${brand}/post-defaults`, { method: 'PUT', body: JSON.stringify(body) }),
  postizStatus: () =>
    req<{ configured: boolean; integrations: PostizIntegration[]; error?: string }>('/postiz/status'),
  publish: (id: string, body: { platforms?: string[]; type?: 'draft' | 'schedule' | 'now'; date?: string }) =>
    req<{
      ok: boolean;
      type: string;
      channels: Array<{ platform: string; ok: boolean; channel?: string; reason?: string }>;
    }>(`/productions/${id}/publish`, { method: 'POST', body: JSON.stringify(body) })
};

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Memory {
  id: string;
  brand: string | null;
  content: string;
  source: string;
  createdAt?: string;
}

export const allen = {
  chat: (body: { message: string; brand?: string; history?: ChatTurn[] }) =>
    req<{ reply: string; memoryChanged?: boolean }>('/allen/chat', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  async speak(text: string, voiceId?: string): Promise<string> {
    const res = await fetch(`${API}/allen/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId })
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `speak failed (${res.status})`);
    }
    return URL.createObjectURL(await res.blob());
  },
  async listen(blob: Blob): Promise<{ text: string }> {
    const form = new FormData();
    form.append('file', blob, 'speech.webm');
    const res = await fetch(`${API}/allen/listen`, { method: 'POST', body: form });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `transcription failed (${res.status})`);
    }
    return (await res.json()) as { text: string };
  },
  memories: (brand?: string) =>
    req<{ memories: Memory[] }>(`/allen/memory${brand ? `?brand=${brand}` : ''}`),
  addMemory: (content: string, brand?: string) =>
    req<Memory>('/allen/memory', { method: 'POST', body: JSON.stringify({ content, brand }) }),
  updateMemory: (id: string, content: string, brand?: string | null) =>
    req<Memory>(`/allen/memory/${id}`, { method: 'PUT', body: JSON.stringify({ content, brand }) }),
  async deleteMemory(id: string): Promise<void> {
    const res = await fetch(`${API}/allen/memory/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`delete failed (${res.status})`);
  }
};

export const TERMINAL = new Set(['completed', 'failed']);
