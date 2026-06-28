import { useEffect, useRef, useState } from 'react';
import { api, assets, productions, type Asset, type HiggsModel, type HiggsModelSchema, type Production, type VideoRow } from './api';

const PROCESSING = new Set(['processing', 'pending', 'waiting', 'unknown', 'queued', 'in_progress']);
const isVideoUrl = (u: string | null) => !!u && /\.(mp4|mov|webm)(\?|$)/i.test(u);

const DIRECTOR: Record<string, string[]> = {
  Shot: ['Extreme close-up', 'Close-up', 'Medium close-up', 'Waist-up', 'Wide', 'Establishing', 'Over-the-shoulder', 'Profile', 'Three-quarter', 'Hero', 'Product macro', 'Walking'],
  Lens: ['24mm wide', '35mm documentary', '50mm portrait', '85mm cinematic compression'],
  Angle: ['Eye-level', 'Slight low angle', 'Slight high angle', 'Three-quarter', 'Side profile', 'Centered symmetrical'],
  Movement: ['Locked-off tripod', 'Slow push-in', 'Slow pull-back', 'Smooth lateral slide', 'Subtle handheld', 'Gentle orbit', 'Slow pan', 'Gimbal walking'],
  Lighting: ['Soft key light', 'Camera-left key', 'Practical lamp glow', 'Warm office', 'Cool monitor glow', 'Candlelit', 'Atlanta golden hour', 'Low-key studio', 'High-contrast cinematic', 'Soft luxury lounge'],
  Timing: ['Hook 2-3s', 'A-roll 8-20s', 'B-roll 2-6s', 'Product 2-4s', 'Travel establishing 3-5s', 'Closing 2s']
};

interface Scene {
  id: string;
  name: string;
  prompt: string;
  director: Record<string, string>;
}

function newScene(index: number): Scene {
  return { id: crypto.randomUUID(), name: `Scene ${index + 1}`, prompt: '', director: {} };
}

function loadScenes(pid: string): Scene[] {
  try {
    const raw = localStorage.getItem(`atelier-scenes-${pid}`);
    if (raw) return JSON.parse(raw) as Scene[];
  } catch { /* ignore */ }
  return [newScene(0)];
}

function saveScenes(pid: string, scenes: Scene[]) {
  try { localStorage.setItem(`atelier-scenes-${pid}`, JSON.stringify(scenes)); } catch { /* ignore */ }
}

function hasKeyword(opts: string[], prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return opts.some((o) => lower.includes(o.toLowerCase()));
}

export function HiggsfieldPanel({ p }: { p: Production }) {
  const [models, setModels] = useState<HiggsModel[]>([]);
  const [model, setModel] = useState('');
  const [modelSchema, setModelSchema] = useState<HiggsModelSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [scenePrompts, setScenePrompts] = useState<Array<{ name: string; text: string }>>([]);
  const [imgAssets, setImgAssets] = useState<Asset[]>([]);
  const [sourceAssetIds, setSourceAssetIds] = useState<string[]>([]);
  const MAX_SOURCE_IMAGES = 4;
  const [takes, setTakes] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>(() => loadScenes(p.id));
  const [activeIdx, setActiveIdx] = useState(0);
  const polls = useRef<Record<string, number>>({});

  const activeScene = scenes[activeIdx] ?? scenes[0];

  useEffect(() => { saveScenes(p.id, scenes); }, [p.id, scenes]);

  useEffect(() => {
    if (!model) return;
    setModelSchema(null);
    setSchemaLoading(true);
    api.higgsfieldModelSchema(model)
      .then(setModelSchema)
      .catch(() => setModelSchema(null))
      .finally(() => setSchemaLoading(false));
  }, [model]);

  function updateScene(idx: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  useEffect(() => {
    api.higgsfieldModels('image').then((m) => {
      setModels(m);
      setModel((cur) => cur || m[0]?.job_set_type || '');
    }).catch(() => setEnabled(false));
    productions.prompts('scene').then(setScenePrompts).catch(() => setScenePrompts([]));
    assets.list(p.id).then((a) => setImgAssets(a.filter((x) => x.kind === 'image'))).catch(() => undefined);
    productions.videos(p.id).then((vs) => {
      const hf = vs.filter((v) => v.source === 'higgsfield');
      setTakes(hf);
      hf.filter((v) => PROCESSING.has(v.status)).forEach((v) => watch(v.id));
    }).catch(() => undefined);
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
      } catch { /* keep polling */ }
    }, 6000);
  }

  async function generate() {
    if (!activeScene.prompt.trim() || !model) return;
    setBusy('generate');
    setError(null);
    try {
      const v = await productions.higgsfield(p.id, {
        prompt: activeScene.prompt.trim(),
        model,
        sourceAssetIds: sourceAssetIds.length ? sourceAssetIds : undefined,
        sceneId: activeScene.id
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
    } catch (e: unknown) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function discard(id: string) {
    setBusy(id);
    try {
      await productions.discardVideo(id);
      setTakes((rows) => rows.filter((r) => r.id !== id));
    } catch (e: unknown) { setError(String(e)); }
    finally { setBusy(null); }
  }

  function addScene() {
    const next = [...scenes, newScene(scenes.length)];
    setScenes(next);
    setActiveIdx(next.length - 1);
  }

  function removeScene(idx: number) {
    if (scenes.length <= 1) return;
    setScenes((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => (cur >= idx && cur > 0 ? cur - 1 : cur));
  }

  const sceneTakes = takes.filter((v) => (v.config?.sceneId as string | undefined) === activeScene?.id);
  const legacyTakes = takes.filter((v) => !v.config?.sceneId);

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
        <strong>① Clean Image — Higgsfield</strong>
        <span className="badge live">connected</span>
      </div>
      <p className="muted">Multi-scene composer. Each scene has its own directorial prompt and takes. Approve the best take per scene before moving to A-Roll.</p>

      {/* Scene tabs */}
      <div className="scene-tabs">
        {scenes.map((s, i) => (
          <div key={s.id} className={`scene-tab ${i === activeIdx ? 'active' : ''}`}>
            <button type="button" onClick={() => setActiveIdx(i)}>{s.name}</button>
            {scenes.length > 1 && (
              <button type="button" className="scene-tab-del" onClick={() => removeScene(i)} title="Remove scene">×</button>
            )}
          </div>
        ))}
        <button type="button" className="scene-tab-add" onClick={addScene}>＋ Scene</button>
      </div>

      {/* Scene name */}
      <input
        className="scene-name-input"
        value={activeScene.name}
        onChange={(e) => updateScene(activeIdx, { name: e.target.value })}
        placeholder="Scene name…"
      />

      <label className="vd-label">Model</label>
      <select className="hf-select" value={model} onChange={(e) => { setModel(e.target.value); setSourceAssetIds([]); }}>
        {models.map((m) => (
          <option key={m.job_set_type} value={m.job_set_type}>{m.display_name} ({m.type})</option>
        ))}
      </select>
      {schemaLoading && <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>Checking model capabilities…</p>}
      {modelSchema && !schemaLoading && (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          {modelSchema.supportsPrompt ? '✓ Text prompt' : '✗ No text prompt'}
          {' · '}
          {modelSchema.supportsImages ? '✓ Reference images' : '✗ No reference images'}
          {modelSchema.params.length > 0 && ` · params: ${modelSchema.params.slice(0, 8).join(', ')}`}
        </p>
      )}

      {scenePrompts.length > 0 && (
        <>
          <label className="vd-label">Brand / scene prompt</label>
          <div className="vd-segment" style={{ flexWrap: 'wrap' }}>
            {scenePrompts.map((sp) => (
              <button key={sp.name} type="button" onClick={() => updateScene(activeIdx, { prompt: sp.text })} title={sp.name}>
                {sp.name}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="vd-label">Director notes</label>
      <div className="director-row">
        {Object.entries(DIRECTOR).map(([field, opts]) => {
          const lit = hasKeyword(opts, activeScene.prompt);
          return (
            <div key={field} className="director-field">
              {lit && <span className="led-dot" title={`${field} keyword in prompt`} />}
              <select
                value={activeScene.director[field] ?? ''}
                onChange={(e) => updateScene(activeIdx, { director: { ...activeScene.director, [field]: e.target.value } })}
              >
                <option value="">{field}…</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        })}
        <button
          type="button"
          className="attach sm"
          onClick={() => {
            const notes = Object.entries(activeScene.director)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join('. ');
            if (notes) {
              const cur = activeScene.prompt.trim();
              updateScene(activeIdx, { prompt: `${cur}${cur ? '\n' : ''}${notes}.` });
            }
          }}
        >
          ＋ Insert
        </button>
      </div>

      <label className="vd-label">Prompt — {activeScene.name}</label>
      <textarea
        className="intake-box"
        rows={5}
        placeholder="Describe the image/scene to generate…"
        value={activeScene.prompt}
        onChange={(e) => updateScene(activeIdx, { prompt: e.target.value })}
      />

      {imgAssets.length > 0 && (!modelSchema || modelSchema.supportsImages) && (
        <>
          <label className="vd-label">
            Reference photos (optional)
            {sourceAssetIds.length > 0 && (
              <span className={`hf-src-count ${sourceAssetIds.length >= MAX_SOURCE_IMAGES ? 'maxed' : ''}`}>
                {sourceAssetIds.length}/{MAX_SOURCE_IMAGES} selected{sourceAssetIds.length >= MAX_SOURCE_IMAGES ? ' — max reached' : ''}
              </span>
            )}
          </label>
          <div className="hf-sources">
            <button type="button" className={`hf-src none ${sourceAssetIds.length === 0 ? 'on' : ''}`}
              onClick={() => setSourceAssetIds([])}>
              none
            </button>
            {imgAssets.map((a) => {
              const selected = sourceAssetIds.includes(a.id);
              const atMax = sourceAssetIds.length >= MAX_SOURCE_IMAGES;
              return (
                <button key={a.id} type="button"
                  className={`hf-src ${selected ? 'on' : ''} ${!selected && atMax ? 'disabled' : ''}`}
                  disabled={!selected && atMax}
                  onClick={() => setSourceAssetIds((prev) =>
                    selected ? prev.filter((id) => id !== a.id) : [...prev, a.id]
                  )}
                  title={selected ? `${a.fileName} (click to deselect)` : atMax ? `Max ${MAX_SOURCE_IMAGES} images selected` : a.fileName}>
                  {selected && <span className="hf-src-check">✓</span>}
                  <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="gen-row">
        {modelSchema && !modelSchema.supportsPrompt ? (
          <p className="err" style={{ margin: 0 }}>
            This model doesn't accept a text prompt — select a different model or check Higgsfield docs for required inputs.
          </p>
        ) : (
          <button className="btn" onClick={generate} disabled={busy === 'generate' || !activeScene.prompt.trim() || !model}>
            {busy === 'generate' ? 'Sending…' : '✨ Generate imagery'}
          </button>
        )}
        <span className="muted">{activeScene.name} · Spends Higgsfield credits</span>
      </div>

      {error && <p className="err">{error}</p>}

      {sceneTakes.length > 0 && (
        <div className="gen-videos">
          {sceneTakes.map((v) => {
            const done = v.status === 'completed';
            return (
              <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                {v.videoUrl && done ? (
                  isVideoUrl(v.videoUrl)
                    ? <video src={v.videoUrl} controls />
                    : <img src={v.videoUrl} alt="render" />
                ) : (
                  <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                    {v.status === 'failed' ? 'Failed' : <><span className="spinner" /> {v.status}…</>}
                  </div>
                )}
                <div className="gen-video-meta">
                  <span className={`badge ${v.approved ? 'live' : ''}`}>{v.approved ? 'approved ✓' : v.status}</span>
                  {v.driveLink && <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>}
                </div>
                <div className="take-actions">
                  {done && !v.approved && (
                    <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>✓ Approve</button>
                  )}
                  {done && (
                    <button className="attach sm" onClick={generate} disabled={busy === 'generate'}>↻ Regenerate</button>
                  )}
                  {!v.approved && (
                    <button className="attach sm danger" onClick={() => discard(v.id)} disabled={busy === v.id}>✕ Discard</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {legacyTakes.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>Earlier takes (no scene tag)</p>
          <div className="gen-videos">
            {legacyTakes.map((v) => {
              const done = v.status === 'completed';
              return (
                <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''}`}>
                  {v.videoUrl && done ? (
                    isVideoUrl(v.videoUrl)
                      ? <video src={v.videoUrl} controls />
                      : <img src={v.videoUrl} alt="render" />
                  ) : (
                    <div className={`video-ph ${v.status === 'failed' ? 'err' : ''}`}>
                      {v.status === 'failed' ? 'Failed' : <><span className="spinner" /> {v.status}…</>}
                    </div>
                  )}
                  <div className="gen-video-meta">
                    <span className={`badge ${v.approved ? 'live' : ''}`}>{v.approved ? 'approved ✓' : v.status}</span>
                    {v.driveLink && <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>}
                  </div>
                  <div className="take-actions">
                    {done && !v.approved && (
                      <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>✓ Approve</button>
                    )}
                    {done && (
                      <button className="attach sm" onClick={generate} disabled={busy === 'generate'}>↻ Regenerate</button>
                    )}
                    {!v.approved && (
                      <button className="attach sm danger" onClick={() => discard(v.id)} disabled={busy === v.id}>✕ Discard</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
