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
  createdAt: string;
  updatedAt: string;
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

export const api = {
  avatars: () => req<HeyGenAvatar[]>('/heygen/avatars'),
  voices: () => req<HeyGenVoice[]>('/heygen/voices'),
  listVideos: () => req<VideoRow[]>('/heygen/videos'),
  getVideo: (id: string) => req<VideoRow>(`/heygen/videos/${id}`),
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

export const TERMINAL = new Set(['completed', 'failed']);
