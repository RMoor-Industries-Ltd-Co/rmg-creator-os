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

  async function remove(id: string) {
    setError(null);
    try {
      await productions.discardVideo(id);
      setClips((cur) => cur.filter((c) => c.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function saveTags(id: string, tagStr: string) {
    const tags = tagStr.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const v = await productions.tagVideo(id, tags);
      setClips((cur) => cur.map((c) => (c.id === id ? v : c)));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function saveDrive(id: string) {
    setError(null);
    try {
      const v = await productions.saveToDrive(id);
      setClips((cur) => cur.map((c) => (c.id === id ? v : c)));
    } catch (e: unknown) {
      setError(String(e));
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
                {v.driveLink ? (
                  <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ✓</a>
                ) : (
                  <button className="attach sm" onClick={() => saveDrive(v.id)} title="Save to B-Roll library">⬆ Drive</button>
                )}
                <button className="attach sm danger" onClick={() => remove(v.id)} title="Delete clip">✕</button>
              </div>
              <input
                className="tag-input"
                type="text"
                placeholder="tags (comma-separated)…"
                defaultValue={((v.config as { tags?: string[] })?.tags ?? []).join(', ')}
                onBlur={(e) => saveTags(v.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
