import { useEffect, useRef, useState } from 'react';
import { api, assets, productions, type Asset, type HiggsModel, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown', 'queued', 'in_progress']);
const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);

/**
 * Higgsfield imagery — generate image/video from a prompt (+ optional source image
 * from Assets), then approve / regenerate / discard. Same loop as the avatar render.
 */
export function HiggsfieldPanel({ p }: { p: Production }) {
  const [models, setModels] = useState<HiggsModel[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [imgAssets, setImgAssets] = useState<Asset[]>([]);
  const [sourceAssetId, setSourceAssetId] = useState('');
  const [takes, setTakes] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const polls = useRef<Record<string, number>>({});

  useEffect(() => {
    api
      .higgsfieldModels('image')
      .then((m) => {
        setModels(m);
        setModel((cur) => cur || m[0]?.job_set_type || '');
      })
      .catch(() => setEnabled(false));
    assets
      .list(p.id)
      .then((a) => setImgAssets(a.filter((x) => x.kind === 'image')))
      .catch(() => undefined);
    productions
      .videos(p.id)
      .then((vs) => {
        const hf = vs.filter((v) => v.source === 'higgsfield');
        setTakes(hf);
        hf.filter((v) => PROCESSING.has(v.status)).forEach((v) => watch(v.id));
      })
      .catch(() => undefined);
    const map = polls.current;
    return () => Object.values(map).forEach((t) => window.clearInterval(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  function watch(id: string) {
    if (polls.current[id]) return;
    polls.current[id] = window.setInterval(async () => {
      try {
        const v = await api.getVideo(id);
        setTakes((rows) => rows.map((r) => (r.id === id ? v : r)));
        if (!PROCESSING.has(v.status)) {
          window.clearInterval(polls.current[id]);
          delete polls.current[id];
        }
      } catch {
        /* keep polling */
      }
    }, 6000);
  }

  async function generate() {
    if (!prompt.trim() || !model) return;
    setBusy('generate');
    setError(null);
    try {
      const v = await productions.higgsfield(p.id, {
        prompt: prompt.trim(),
        model,
        sourceAssetId: sourceAssetId || undefined
      });
      setTakes((rows) => [v, ...rows]);
      watch(v.id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: string) {
    setBusy(id);
    try {
      const v = await productions.approveVideo(id);
      setTakes((rows) => rows.map((r) => (r.id === id ? v : { ...r, approved: false })));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function discard(id: string) {
    setBusy(id);
    try {
      await productions.discardVideo(id);
      setTakes((rows) => rows.filter((r) => r.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!enabled) {
    return (
      <div className="higgs-card">
        <div className="video-head">
          <strong>B-roll imagery — Higgsfield</strong>
          <span className="badge">not connected</span>
        </div>
        <p className="muted">The Higgsfield CLI isn't reachable from the gateway. Check the mounted credentials.</p>
      </div>
    );
  }

  return (
    <div className="higgs-panel">
      <div className="video-head">
        <strong>Imagery — Higgsfield</strong>
        <span className="badge live">connected</span>
      </div>
      <p className="muted">Generate image/video, then approve · regenerate · discard. Optional source image from Assets.</p>

      <label className="vd-label">Model</label>
      <select className="hf-select" value={model} onChange={(e) => setModel(e.target.value)}>
        {models.map((m) => (
          <option key={m.job_set_type} value={m.job_set_type}>
            {m.display_name} ({m.type})
          </option>
        ))}
      </select>

      <label className="vd-label">Prompt</label>
      <textarea
        className="intake-box"
        rows={4}
        placeholder="Describe the image/scene to generate…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {imgAssets.length > 0 && (
        <>
          <label className="vd-label">Source image (optional)</label>
          <div className="hf-sources">
            <button type="button" className={`hf-src none ${sourceAssetId === '' ? 'on' : ''}`} onClick={() => setSourceAssetId('')}>
              none
            </button>
            {imgAssets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`hf-src ${sourceAssetId === a.id ? 'on' : ''}`}
                onClick={() => setSourceAssetId(a.id)}
                title={a.fileName}
              >
                <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="gen-row">
        <button className="btn" onClick={generate} disabled={busy === 'generate' || !prompt.trim() || !model}>
          {busy === 'generate' ? 'Sending…' : '✨ Generate imagery'}
        </button>
        <span className="muted">Spends Higgsfield credits</span>
      </div>

      {error && <p className="err">{error}</p>}

      {takes.length > 0 && (
        <div className="gen-videos">
          {takes.map((v) => {
            const done = v.status === 'completed';
            return (
              <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                {v.videoUrl && done ? (
                  isVideoUrl(v.videoUrl) ? (
                    <video src={v.videoUrl} controls />
                  ) : (
                    <img src={v.videoUrl} alt="render" />
                  )
                ) : (
                  <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                    {v.status === 'failed' ? 'Failed' : (
                      <>
                        <span className="spinner" /> {v.status}…
                      </>
                    )}
                  </div>
                )}
                <div className="gen-video-meta">
                  <span className={`badge ${v.approved ? 'live' : ''}`}>{v.approved ? 'approved ✓' : v.status}</span>
                  {v.driveLink && (
                    <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">
                      Drive ↗
                    </a>
                  )}
                </div>
                <div className="take-actions">
                  {done && !v.approved && (
                    <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>
                      ✓ Approve
                    </button>
                  )}
                  {done && (
                    <button className="attach sm" onClick={generate} disabled={busy === 'generate'}>
                      ↻ Regenerate
                    </button>
                  )}
                  {!v.approved && (
                    <button className="attach sm danger" onClick={() => discard(v.id)} disabled={busy === v.id}>
                      ✕ Discard
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
