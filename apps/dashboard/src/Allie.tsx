import { useEffect, useState } from 'react';
import { BRANDS } from '@rmg-creator-os/types';
import { feeds, productions, radar, type BrandFeed, type Outlier, type TopicSuggestion, type TrendItem } from './api';
import { navigate } from './router';

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
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [radarOn, setRadarOn] = useState(false);
  const [radarQ, setRadarQ] = useState('');
  const [outlierList, setOutlierList] = useState<Outlier[]>([]);
  const [radarBusy, setRadarBusy] = useState(false);

  useEffect(() => {
    radar.status().then((r) => setRadarOn(r.configured)).catch(() => setRadarOn(false));
  }, []);

  async function findOutliers() {
    setRadarBusy(true);
    setErr(null);
    try {
      const r = await radar.outliers(brand, radarQ.trim() || undefined);
      setOutlierList(r.outliers);
      if (!radarQ.trim()) setRadarQ(r.query);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRadarBusy(false);
    }
  }

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
    setOutlierList([]);
    setRadarQ('');
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

  async function startFromTopic(t: TopicSuggestion) {
    setStarting(t.title);
    setErr(null);
    try {
      const prod = await productions.create({ brand, topic: t.title, context: t.hook ?? t.angle });
      navigate(`/produce/${prod.id}/script`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setStarting(null);
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
            Validate ALLIE's inputs: the feeds she reads, the live headlines she's pulling, and the topics she suggests.
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
        <h3>🎯 Outlier Radar <span className="muted">— viral YouTube videos for this lane</span></h3>
        <p className="muted hint">
          Videos doing far more views than their channel's norm — the "why did this pop?" signal. Score = views ÷ channel average.
        </p>
        {!radarOn ? (
          <p className="muted">
            Not connected. Add a free <strong>YouTube Data API key</strong> (Google Cloud Console) to switch this on.
          </p>
        ) : (
          <>
            <div className="feed-add">
              <input
                placeholder="Search (defaults to this brand's lane)"
                value={radarQ}
                onChange={(e) => setRadarQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && findOutliers()}
              />
              <button type="button" className="btn sm" onClick={findOutliers} disabled={radarBusy}>
                {radarBusy ? 'Scanning…' : 'Find outliers'}
              </button>
            </div>
            {outlierList.length > 0 && (
              <ul className="outlier-list">
                {outlierList.map((o) => (
                  <li key={o.videoId} className="outlier">
                    <a href={o.url} target="_blank" rel="noreferrer" className="outlier-thumb">
                      {o.thumbnail && <img src={o.thumbnail} alt="" loading="lazy" />}
                      <span className="outlier-score">{o.score}×</span>
                    </a>
                    <div className="outlier-meta">
                      <a href={o.url} target="_blank" rel="noreferrer" className="outlier-title">
                        {o.title}
                      </a>
                      <span className="muted">
                        {o.channel} · {o.views.toLocaleString()} views · {o.score}× channel avg
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

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
                  {t.hook && <span className="topic-hook">&ldquo;{t.hook}&rdquo;</span>}
                  {t.angle && <span className="muted topic-angle">{t.angle}</span>}
                </div>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void startFromTopic(t)}
                  disabled={starting !== null}
                >
                  {starting === t.title ? 'Starting…' : '▶ Start production'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
