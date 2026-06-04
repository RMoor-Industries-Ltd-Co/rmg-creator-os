// Free stock B-roll — Pexels + Pixabay (both free for commercial use).
// Returns playable mp4 links; the gateway downloads + mixes them into the video.

export interface StockClip {
  url: string;
  width: number;
  height: number;
  duration: number;
  source: 'pexels' | 'pixabay';
}

export interface StockClient {
  enabled(): boolean;
  search(query: string, orientation: 'portrait' | 'landscape', limit?: number): Promise<StockClip[]>;
}

export function createStockClient(cfg: { pexelsKey?: string; pixabayKey?: string }): StockClient {
  async function pexels(query: string, orientation: string, limit: number): Promise<StockClip[]> {
    if (!cfg.pexelsKey) return [];
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${limit}`;
    const res = await fetch(url, { headers: { Authorization: cfg.pexelsKey } });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      videos?: Array<{
        duration?: number;
        video_files?: Array<{ link: string; width?: number; height?: number; quality?: string }>;
      }>;
    };
    const out: StockClip[] = [];
    for (const v of j.videos ?? []) {
      const files = (v.video_files ?? []).filter((f) => (f.width ?? 0) <= 1920);
      const f = files.find((x) => x.quality === 'hd') ?? files[0] ?? v.video_files?.[0];
      if (f?.link) out.push({ url: f.link, width: f.width ?? 0, height: f.height ?? 0, duration: v.duration ?? 0, source: 'pexels' });
    }
    return out;
  }

  async function pixabay(query: string, orientation: string, limit: number): Promise<StockClip[]> {
    if (!cfg.pixabayKey) return [];
    const url = `https://pixabay.com/api/videos/?key=${cfg.pixabayKey}&q=${encodeURIComponent(query)}&per_page=${Math.max(3, limit)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const j = (await res.json()) as {
      hits?: Array<{
        duration?: number;
        videos?: Record<string, { url: string; width: number; height: number }>;
      }>;
    };
    const out: StockClip[] = [];
    for (const h of j.hits ?? []) {
      const v = h.videos?.medium ?? h.videos?.large ?? h.videos?.small;
      if (!v?.url) continue;
      const isPortrait = v.height >= v.width;
      if (orientation === 'portrait' && !isPortrait) continue;
      if (orientation === 'landscape' && isPortrait) continue;
      out.push({ url: v.url, width: v.width, height: v.height, duration: h.duration ?? 0, source: 'pixabay' });
    }
    return out;
  }

  return {
    enabled: () => Boolean(cfg.pexelsKey || cfg.pixabayKey),
    async search(query, orientation, limit = 4) {
      const half = Math.max(2, Math.ceil(limit / 2));
      const [a, b] = await Promise.all([
        pexels(query, orientation, half).catch(() => []),
        pixabay(query, orientation, half).catch(() => [])
      ]);
      // Interleave the two sources for variety.
      const merged: StockClip[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) merged.push(a[i]);
        if (b[i]) merged.push(b[i]);
      }
      return merged.slice(0, limit);
    }
  };
}
