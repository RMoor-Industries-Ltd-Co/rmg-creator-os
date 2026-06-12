// ALLIE's Outlier Radar — the 1of10 replacement, on the free YouTube Data API.
// Finds videos performing far above their channel's normal (views ÷ channel average),
// which is the signal that a topic/format is resonating. Key-only (public data, no OAuth).

const YT_KEY = process.env.YOUTUBE_API_KEY ?? '';
const YT = 'https://www.googleapis.com/youtube/v3';

export const youtubeConfigured = (): boolean => Boolean(YT_KEY);

// Per-brand default YouTube search when the user doesn't type one.
export const BRAND_QUERY: Record<string, string> = {
  orr: 'cruise review royal caribbean travel',
  com: 'self mastery discipline mindset growth',
  vlog: 'ai tools software tutorial build',
  'busy-mf': 'product review gadgets worth it',
  'mstr-rahm': 'masculinity self improvement discipline men',
  trc: "men's issues relationships dating advice",
  tgl: 'legacy power rise and fall story'
};

export interface Outlier {
  videoId: string;
  title: string;
  channel: string;
  views: number;
  channelAvgViews: number;
  score: number; // views ÷ channel average
  publishedAt: string;
  thumbnail: string;
  url: string;
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function outliers(query: string, opts: { days?: number; max?: number } = {}): Promise<Outlier[]> {
  const days = opts.days ?? 120;
  const publishedAfter = new Date(Date.now() - days * 86_400_000).toISOString();
  const sp = new URLSearchParams({
    key: YT_KEY,
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'viewCount',
    maxResults: '25',
    publishedAfter,
    relevanceLanguage: 'en'
  });
  const search = (await getJson(`${YT}/search?${sp}`)) as {
    items?: Array<{ id?: { videoId?: string }; snippet?: { channelId?: string } }>;
  };
  const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => Boolean(v));
  const channelIds = [...new Set((search.items ?? []).map((i) => i.snippet?.channelId).filter(Boolean))] as string[];
  if (!ids.length) return [];

  const videos = (await getJson(`${YT}/videos?${new URLSearchParams({ key: YT_KEY, part: 'snippet,statistics', id: ids.join(',') })}`)) as {
    items?: Array<{
      id: string;
      snippet: { title: string; channelTitle: string; channelId: string; publishedAt: string; thumbnails?: { medium?: { url?: string } } };
      statistics: { viewCount?: string };
    }>;
  };
  const channels = (await getJson(`${YT}/channels?${new URLSearchParams({ key: YT_KEY, part: 'statistics', id: channelIds.join(',') })}`)) as {
    items?: Array<{ id: string; statistics: { viewCount?: string; videoCount?: string } }>;
  };
  const avg = new Map<string, number>();
  for (const c of channels.items ?? []) {
    const tv = Number(c.statistics.viewCount ?? 0);
    const vc = Number(c.statistics.videoCount ?? 0);
    avg.set(c.id, vc > 0 ? tv / vc : 0);
  }

  const out: Outlier[] = (videos.items ?? []).map((v) => {
    const views = Number(v.statistics.viewCount ?? 0);
    const chAvg = avg.get(v.snippet.channelId) ?? 0;
    return {
      videoId: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      views,
      channelAvgViews: Math.round(chAvg),
      score: chAvg > 0 ? Math.round((views / chAvg) * 10) / 10 : 0,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.medium?.url ?? '',
      url: `https://www.youtube.com/watch?v=${v.id}`
    };
  });
  return out.filter((o) => o.score >= 1.5).sort((a, b) => b.score - a.score).slice(0, opts.max ?? 12);
}
