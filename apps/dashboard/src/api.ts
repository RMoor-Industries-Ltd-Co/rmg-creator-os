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

export const TERMINAL = new Set(['completed', 'failed']);
