import { useEffect, useState } from 'react';
import { productions, type Production, type VideoRow } from './api';

const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);

/**
 * Stock B-Roll — free clips from Pexels + Pixabay, found via transcript keywords.
 * Each clip lands in the production's asset bin.
 */
export function StockBroll({ p }: { p: Production }) {
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState('');
  const [clips, setClips] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productions.brollStatus().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
    productions.videos(p.id).then((vs) => setClips(vs.filter((v) => v.source === 'stock'))).catch(() => undefined);
  }, [p.id]);

  async function fetchClips() {
    setBusy(true);
    setError(null);
    try {
      const r = await productions.stockBroll(p.id, { query: query.trim() || undefined });
      setQuery(r.query);
      setClips((cur) => [...r.clips, ...cur]);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-card">
      <div className="video-head">
        <strong>③ Stock B-Roll</strong>
        <span className={`badge ${enabled ? 'live' : ''}`}>{enabled ? 'Pexels + Pixabay' : 'not configured'}</span>
      </div>
      <p className="muted">Free commercial-use clips, found by keywords from your transcript. Leave blank to auto-pull keywords.</p>

      <div className="gen-row">
        <input
          className="hf-select"
          style={{ flex: 1, minWidth: 200 }}
          type="text"
          placeholder="Keywords (auto from transcript if blank)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!enabled}
        />
        <button className="btn" onClick={fetchClips} disabled={!enabled || busy}>
          {busy ? 'Finding…' : '🔎 Find b-roll'}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {clips.length > 0 && (
        <div className="gen-videos">
          {clips.map((v) => (
            <div key={v.id} className="gen-video">
              {isVideoUrl(v.videoUrl) ? (
                <video src={v.videoUrl ?? undefined} controls preload="metadata" />
              ) : (
                <div className="video-ph">clip</div>
              )}
              <div className="gen-video-meta">
                <span className="badge">{(v.config as { source?: string })?.source ?? 'stock'}</span>
                {v.driveLink && (
                  <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
