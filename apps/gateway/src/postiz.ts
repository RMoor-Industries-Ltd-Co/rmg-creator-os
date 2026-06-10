// Client for the self-hosted Postiz public API (the Social Manager engine).
// Gated on POSTIZ_API_KEY — inert until the key is set, so it deploys safely.
// Base path for self-host is {NEXT_PUBLIC_BACKEND_URL}/public/v1.

const POSTIZ_API_URL = (process.env.POSTIZ_API_URL ?? 'https://social.rmasters.group/api/public/v1').replace(
  /\/$/,
  ''
);
const POSTIZ_API_KEY = process.env.POSTIZ_API_KEY ?? '';

export const postizConfigured = (): boolean => Boolean(POSTIZ_API_KEY);

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: POSTIZ_API_KEY };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string; // providerIdentifier: tiktok | youtube | instagram | facebook | linkedin | x ...
  picture?: string;
  disabled?: boolean;
}

export interface PostizMedia {
  id: string;
  path: string;
}

export interface PostizPostInput {
  integrationId: string;
  identifier: string;
  content: string;
  media?: PostizMedia[];
}

export async function listIntegrations(): Promise<PostizIntegration[]> {
  const res = await fetch(`${POSTIZ_API_URL}/integrations`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Postiz integrations failed (${res.status})`);
  return (await res.json()) as PostizIntegration[];
}

export async function uploadFromUrl(url: string): Promise<PostizMedia> {
  const res = await fetch(`${POSTIZ_API_URL}/upload-from-url`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ url })
  });
  if (!res.ok) throw new Error(`Postiz upload failed (${res.status}): ${await res.text().catch(() => '')}`);
  return (await res.json()) as PostizMedia;
}

export async function createPost(opts: {
  type: 'draft' | 'schedule' | 'now';
  date?: string;
  posts: PostizPostInput[];
}): Promise<unknown> {
  const body = {
    type: opts.type,
    date: opts.date ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    shortLink: false,
    tags: [],
    posts: opts.posts.map((p) => ({
      integration: { id: p.integrationId },
      value: [{ content: p.content, image: (p.media ?? []).map((m) => ({ id: m.id, path: m.path })) }],
      settings: { __type: p.identifier }
    }))
  };
  const res = await fetch(`${POSTIZ_API_URL}/posts`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Postiz create post failed (${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

// Match our platform keys to a connected Postiz channel.
export function matchIntegration(
  platform: string,
  integrations: PostizIntegration[]
): PostizIntegration | undefined {
  const aliases: Record<string, string[]> = {
    x: ['x', 'twitter'],
    twitter: ['x', 'twitter'],
    facebook: ['facebook', 'page'],
    instagram: ['instagram', 'instagram-standalone']
  };
  const wanted = aliases[platform] ?? [platform];
  return integrations.find((i) => wanted.includes(i.identifier) && !i.disabled);
}
