// Thin client for the isolated ALLEN service (PIAAR/rmg-ai), reached at ALLEN_URL.

const ALLEN_URL = process.env.ALLEN_URL ?? '';
const ALLEN_API_KEY = process.env.ALLEN_API_KEY ?? '';

function allenHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ALLEN_API_KEY) h['x-allen-key'] = ALLEN_API_KEY;
  return h;
}

export const allenConfigured = (): boolean => Boolean(ALLEN_URL);

export interface AllenDraft {
  title: string;
  script: string;
  doc_url?: string;
  doc_id?: string;
  model: string;
}

export async function allenDraft(body: {
  brand: string;
  topic: string;
  persona?: string;
  output_kind?: string;
  allie_context?: string;
  write_doc?: boolean;
}): Promise<AllenDraft> {
  const res = await fetch(`${ALLEN_URL}/draft`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as AllenDraft & { detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN draft failed (${res.status})`);
  return json;
}

export interface AllenDirect {
  tagged_script: string;
  stability_mode: string;
  stability: number;
  audio_tag_palette: string;
}

// Emotion Director: annotate an approved script with eleven_v3 audio tags + emphasis.
export async function allenDirect(body: {
  script: string;
  brand: string;
  persona?: string;
  intensity?: string;
  stability_mode?: string;
}): Promise<AllenDirect> {
  const res = await fetch(`${ALLEN_URL}/direct`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as AllenDirect & { detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN direct failed (${res.status})`);
  return json;
}

export interface AllenEmotionProfile {
  brand: string;
  label: string;
  tags: string;
  emphasis: string;
  pacing: string;
  stability_mode: string;
  stability: number;
}

export async function allenEmotionProfiles(): Promise<{
  profiles: AllenEmotionProfile[];
  stability_values: Record<string, number>;
}> {
  const res = await fetch(`${ALLEN_URL}/emotion/profiles`, { headers: allenHeaders() });
  if (!res.ok) throw new Error(`ALLEN profiles failed (${res.status})`);
  return res.json() as Promise<{
    profiles: AllenEmotionProfile[];
    stability_values: Record<string, number>;
  }>;
}

export interface AllenMetadata {
  title: string;
  caption: string;
  hashtags: string[];
  first_comment: string;
  audience: string;
}

export interface AllenTopic {
  title: string;
  hook: string;
  angle: string;
}

export async function allenTopics(body: {
  brand: string;
  count?: number;
  context?: string;
}): Promise<{ topics: AllenTopic[] }> {
  const res = await fetch(`${ALLEN_URL}/topics`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as { topics?: AllenTopic[]; detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN topics failed (${res.status})`);
  return { topics: json.topics ?? [] };
}

export interface AllenChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function allenChat(body: {
  message: string;
  brand?: string;
  persona?: string;
  history?: AllenChatMessage[];
}): Promise<{ reply: string }> {
  const res = await fetch(`${ALLEN_URL}/chat`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as { reply?: string; detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN chat failed (${res.status})`);
  return { reply: json.reply ?? '' };
}

export async function allenMetadata(body: {
  brand: string;
  platform: string;
  topic?: string;
  persona?: string;
  script?: string;
}): Promise<AllenMetadata> {
  const res = await fetch(`${ALLEN_URL}/metadata`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as AllenMetadata & { detail?: string };
  if (!res.ok) throw new Error(json.detail ?? `ALLEN metadata failed (${res.status})`);
  return json;
}

export async function allenSpeak(
  text: string,
  opts: { voiceId?: string; modelId?: string; stability?: number } = {}
): Promise<Buffer> {
  const res = await fetch(`${ALLEN_URL}/speak`, {
    method: 'POST',
    headers: allenHeaders(),
    body: JSON.stringify({
      text,
      voice_id: opts.voiceId,
      model_id: opts.modelId,
      stability: opts.stability
    })
  });
  if (!res.ok) throw new Error(`ALLEN speak failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
