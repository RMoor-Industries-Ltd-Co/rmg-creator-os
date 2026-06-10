// ALLIE's trend layer — per-brand RSS / Google-News feeds that keep topic
// suggestions current with real events. Feeds are configurable per brand;
// sensible Google-News defaults are seeded on first use. Items are cached
// in-memory (TTL) so we don't hammer sources on every suggestion.

import Parser from 'rss-parser';
import { eq, tables, type Database } from '@rmg-creator-os/db';

const parser = new Parser({ timeout: 10_000 });

export interface TrendItem {
  title: string;
  link: string;
  source?: string;
  publishedAt?: string;
}

export interface BrandFeed {
  id: string;
  brand: string;
  url: string;
  title: string | null;
  kind: string;
  enabled: boolean;
}

const CACHE = new Map<string, { at: number; items: TrendItem[] }>();
const TTL_MS = 30 * 60 * 1000; // 30 min

const gnews = (q: string): string =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// Seed queries are derived from each brand's content lane. The user can add or
// remove feeds per brand via the /feeds endpoints; these only seed when empty.
const DEFAULT_FEEDS: Record<string, Array<{ title: string; url: string }>> = {
  orr: [{ title: 'Travel & cruise news', url: gnews('("royal caribbean" OR cruise OR "cruise deals" OR "all-inclusive resort" OR "travel deals") when:14d') }],
  com: [{ title: 'Growth & discipline', url: gnews('("personal growth" OR self-discipline OR mindset OR accountability OR "mental health") when:14d') }],
  vlog: [{ title: 'Builder & tech', url: gnews('("AI tools" OR "developer tools" OR software OR "open source" OR framework) when:7d') }],
  'busy-mf': [{ title: 'Gear & deals', url: gnews('("tech deals" OR "best gadgets" OR "product review" OR "creator gear") when:7d') }],
  'mstr-rahm': [{ title: 'Mindset & masculinity', url: gnews('(masculinity OR discipline OR "self improvement" OR motivation OR accountability) when:14d') }],
  trc: [{ title: "Men's issues & culture", url: gnews('(masculinity OR relationships OR fatherhood OR "men\'s issues" OR dating OR purpose) when:14d') }],
  tgl: [{ title: 'Legacy & power', url: gnews('(legacy OR "rise and fall" OR downfall OR mortality OR "famous last words") when:30d') }]
};

export async function listFeeds(db: Database, brand: string): Promise<BrandFeed[]> {
  return db.select().from(tables.brandFeeds).where(eq(tables.brandFeeds.brand, brand)) as Promise<BrandFeed[]>;
}

export async function ensureDefaultFeeds(db: Database, brand: string): Promise<BrandFeed[]> {
  const existing = await listFeeds(db, brand);
  if (existing.length) return existing;
  const defs = DEFAULT_FEEDS[brand] ?? [];
  if (!defs.length) return [];
  const rows = defs.map((d, i) => ({
    id: `${brand}-seed-${i}`,
    brand,
    url: d.url,
    title: d.title,
    kind: 'gnews',
    enabled: true
  }));
  await db.insert(tables.brandFeeds).values(rows).onConflictDoNothing();
  return rows as BrandFeed[];
}

async function fetchFeed(url: string): Promise<TrendItem[]> {
  const cached = CACHE.get(url);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.items;
  try {
    const feed = await parser.parseURL(url);
    const items: TrendItem[] = (feed.items ?? [])
      .slice(0, 25)
      .map((it) => ({
        title: (it.title ?? '').trim(),
        link: it.link ?? '',
        source:
          (it as { source?: { $?: { url?: string } } }).source?.$?.url ??
          (typeof (it as { creator?: string }).creator === 'string' ? (it as { creator?: string }).creator : undefined) ??
          feed.title ??
          undefined,
        publishedAt: it.isoDate ?? it.pubDate ?? undefined
      }))
      .filter((i) => i.title);
    CACHE.set(url, { at: Date.now(), items });
    return items;
  } catch {
    return cached?.items ?? [];
  }
}

export async function brandTrends(db: Database, brand: string, limit = 12): Promise<TrendItem[]> {
  const feeds = (await ensureDefaultFeeds(db, brand)).filter((f) => f.enabled);
  const batches = await Promise.all(feeds.map((f) => fetchFeed(f.url)));
  const seen = new Set<string>();
  const uniq = batches.flat().filter((i) => {
    const k = i.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort(
    (a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
  );
  return uniq.slice(0, limit);
}

export function trendContext(items: TrendItem[]): string {
  if (!items.length) return '';
  return items
    .slice(0, 12)
    .map((i) => `- ${i.title}${i.source ? ` (${i.source})` : ''}`)
    .join('\n');
}
