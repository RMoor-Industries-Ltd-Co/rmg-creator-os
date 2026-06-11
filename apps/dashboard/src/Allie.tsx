import { useEffect, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { feeds, productions, type BrandFeed, type TopicSuggestion, type TrendItem } from './api';

const BRAND_OPTIONS = BRANDS.filter((b) => b.contentFolder).map((b) => ({ value: b.key, label: b.code }));

// ALLIE's Trend Desk — validate the RSS feeds she reads, the live headlines she pulls,
// and the topics she suggests, per brand.
export function Allie() {
  const [brand, setBrand] = useState<string>(BRAND_OPTIONS[0]?.value ?? '');
  const [feedList, setFeedList] = useState<BrandFeed[]>([]);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [topics, setTopics] = useState<TopicSuggestion[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadFeeds() {
    try {
      setFeedList((await feeds.list(brand)).feeds);
    } catch (e) {
      setErr(String(e));
    }
  }
  async function loadTrends() {
    setLoadingTrends(true);
    try {
      setTrends((await productions.trends(brand)).items);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingTrends(false);
    }
  }
  useEffect(() => {
    setTopics([]);
    void loadFeeds();
    void loadTrends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  async function addFeed() {
    const url = newUrl.trim();
    if (!url) return;
    try {
      const f = await feeds.add(brand, url, newTitle.trim() || undefined);
      setFeedList((c) => [...c, f]);
      setNewUrl('');
      setNewTitle('');
      void loadTrends();
    } catch (e) {
      setErr(String(e));
    }
  }
  async function removeFeed(id: string) {
    try {
      await feeds.remove(id);
      setFeedList((c) => c.filter((f) => f.id !== id));
    } catch (e) {
      setErr(String(e));
    }
  }
  async function suggest() {
    setSuggesting(true);
    try {
      const r = await productions.topics(brand, 6, true);
      setTopics(r.topics);
      if (r.trends?.length) setTrends(r.trends);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <section className="allie-page">
      <div className="ask-head">
        <div>
          <h2>ALLIE — Trend Desk</h2>
          <p className="muted">
            Validate ALLIE’s inputs: the feeds she reads, the live headlines she’s pulling, and the topics she suggests.
          </p>
        </div>
        <select value={brand} onChange={(e) => setBrand(e.target.value)}>
          {BRAND_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="allie-grid">
        <section className="panel">
          <h3>
            RSS / news feeds <span className="muted">({feedList.length})</span>
          </h3>
          <p className="muted hint">Sources ALLIE reads for {brand.toUpperCase()}. Add any RSS feed URL.</p>
          <ul className="feed-list">
            {feedList.map((f) => (
              <li key={f.id}>
                <div className="feed-main">
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.title || f.url}
                  </a>
                  <span className="muted feed-kind">{f.kind}</span>
                </div>
                <button type="button" className="mem-del" onClick={() => removeFeed(f.id)} title="Remove">
                  ✕
                </button>
              </li>
            ))}
            {feedList.length === 0 && <li className="muted">No feeds yet — add one below.</li>}
          </ul>
          <div className="feed-add">
            <input placeholder="Title (optional)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <input
              placeholder="https://…/rss"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFeed()}
            />
            <button type="button" className="btn sm" onClick={addFeed} disabled={!newUrl.trim()}>
              Add
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>
            Live trends{' '}
            <button type="button" className="attach sm" onClick={() => void loadTrends()} disabled={loadingTrends}>
              ↻
            </button>
          </h3>
          <p className="muted hint">Headlines ALLIE is pulling from these feeds right now.</p>
          {loadingTrends ? (
            <p className="muted">Pulling…</p>
          ) : trends.length === 0 ? (
            <p className="muted">No headlines.</p>
          ) : (
            <ul className="trend-feed">
              {trends.map((t, i) => (
                <li key={i}>
                  <a href={t.link} target="_blank" rel="noreferrer">
                    {t.title}
                  </a>
                  {t.source && <span className="muted"> · {t.source}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h3>Topic suggestions</h3>
        <p className="muted hint">What ALLIE would suggest for {brand.toUpperCase()}, grounded in the feeds above.</p>
        <button type="button" className="btn" onClick={suggest} disabled={suggesting}>
          {suggesting ? 'ALLIE is thinking…' : '✨ Generate suggestions'}
        </button>
        {topics.length > 0 && (
          <ul className="topic-cards" style={{ marginTop: 12 }}>
            {topics.map((t, i) => (
              <li key={i} className="topic-card">
                <div className="topic-main">
                  <strong>{t.title}</strong>
                  {t.hook && <span className="topic-hook">“{t.hook}”</span>}
                  {t.angle && <span className="muted topic-angle">{t.angle}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
