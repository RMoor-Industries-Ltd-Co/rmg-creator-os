import { useCallback, useEffect, useRef, useState } from 'react';
import { api, assets, poster, productions, type Asset, type HiggsModel, type HiggsModelSchema, type Production, type VideoRow } from './api';
import { loadShortlist } from './Assets';

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

function loadScenes(pid: string, fromDb?: Record<string, unknown>[]): Scene[] {
  // Prefer DB data if non-empty, then fall back to localStorage for migration.
  if (fromDb && fromDb.length > 0) return fromDb as unknown as Scene[];
  try {
    const raw = localStorage.getItem(`atelier-scenes-${pid}`);
    if (raw) return JSON.parse(raw) as Scene[];
  } catch { /* ignore */ }
  return [newScene(0)];
}

function hasKeyword(opts: string[], prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return opts.some((o) => lower.includes(o.toLowerCase()));
}

function CapBadges({ schema, loading }: { schema: HiggsModelSchema | null | undefined; loading: boolean }) {
  if (loading) return <span className="cap-spin" title="Loading capabilities…">·</span>;
  if (!schema) return null;
  return (
    <span className="model-caps">
      {schema.supportsPrompt && <span className="cap-tag cap-text" title="Accepts text prompt">T</span>}
      {schema.supportsImages && <span className="cap-tag cap-img" title="Accepts reference images">📷</span>}
    </span>
  );
}

export function HiggsfieldPanel({ p }: { p: Production }) {
  const [models, setModels] = useState<HiggsModel[]>([]);
  const [model, setModel] = useState('');
  const [schemaMap, setSchemaMap] = useState<Record<string, HiggsModelSchema | null>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const [scenePrompts, setScenePrompts] = useState<Array<{ name: string; text: string }>>([]);
  const [imgAssets, setImgAssets] = useState<Asset[]>([]);
  const [sourceAssetIds, setSourceAssetIds] = useState<string[]>([]);
  const MAX_SOURCE_IMAGES = 4;
  const [takes, setTakes] = useState<VideoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>(() => loadScenes(p.id, p.higgsfieldScenes));
  const [activeIdx, setActiveIdx] = useState(0);
  const [coverDriveId, setCoverDriveId] = useState<string | null>(p.thumbnailDriveId ?? null);
  const polls = useRef<Record<string, number>>({});
  const saveTimer = useRef<number | null>(null);

  const activeScene = scenes[activeIdx] ?? scenes[0];

  // Persist scenes to DB (debounced 1 s) and keep localStorage as a migration fallback.
  const shortlistRef = useRef<string[]>(p.higgsfieldShortlist ?? []);
  const persistScenes = useCallback((nextScenes: Scene[], shortlist: string[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void productions.saveScenes(p.id, nextScenes as unknown as Record<string, unknown>[], shortlist);
    }, 1000);
  }, [p.id]);
  useEffect(() => { persistScenes(scenes, shortlistRef.current); }, [scenes, persistScenes]);

  // Batch-fetch all model schemas in the background (5 at a time).
  useEffect(() => {
    if (models.length === 0) return;
    let cancelled = false;
    const BATCH = 5;
    async function run() {
      const todo = models.filter((m) => !fetchedRef.current.has(m.job_set_type));
      for (let i = 0; i < todo.length; i += BATCH) {
        if (cancelled) break;
        await Promise.all(todo.slice(i, i + BATCH).map(async (m) => {
          fetchedRef.current.add(m.job_set_type);
          try {
            const s = await api.higgsfieldModelSchema(m.job_set_type);
            if (!cancelled) setSchemaMap((prev) => ({ ...prev, [m.job_set_type]: s }));
          } catch {
            if (!cancelled) setSchemaMap((prev) => ({ ...prev, [m.job_set_type]: null }));
          }
        }));
      }
    }
    run();
    return () => { cancelled = true; };
  }, [models.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setPickerFilter('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  function updateScene(idx: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  useEffect(() => {
    api.higgsfieldModels('image').then((m) => {
      setModels(m);
      setModel((cur) => cur || m[0]?.job_set_type || '');
    }).catch(() => setEnabled(false));
    productions.prompts('scene').then(setScenePrompts).catch(() => setScenePrompts([]));
    assets.list(p.id).then((a) => {
      const all = a.filter((x) => x.kind === 'image');
      // Prefer DB shortlist, fall back to localStorage for migration.
      const dbSl = p.higgsfieldShortlist ?? [];
      const sl = dbSl.length > 0 ? dbSl : loadShortlist(p.id);
      shortlistRef.current = sl;
      setImgAssets(sl.length > 0 ? all.filter((x) => sl.includes(x.id)) : all);
    }).catch(() => undefined);
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

  const modelSchema = model ? (schemaMap[model] ?? null) : null;
  const schemaLoaded = model in schemaMap;
  // Image-only models animate/transform reference images; they don't need a text prompt.
  const imageOnly = schemaLoaded && modelSchema != null && !modelSchema.supportsPrompt && modelSchema.supportsImages;
  const canGenerate = imageOnly ? sourceAssetIds.length > 0 : !!activeScene.prompt.trim();

  async function generate() {
    if (!model || !canGenerate) return;
    setBusy('generate');
    setError(null);
    try {
      const v = await productions.higgsfield(p.id, {
        prompt: imageOnly ? '' : activeScene.prompt.trim(),
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

  async function setAsCover(v: VideoRow) {
    if (!v.driveFileId) return;
    setBusy(v.id + '-cover');
    try {
      await poster.setCover(p.id, v.driveFileId);
      setCoverDriveId(v.driveFileId);
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

  function selectModel(jobSetType: string) {
    setModel(jobSetType);
    setSourceAssetIds([]);
    setPickerOpen(false);
    setPickerFilter('');
  }

  const selectedModel = models.find((m) => m.job_set_type === model);
  const filteredModels = pickerFilter
    ? models.filter((m) => m.display_name.toLowerCase().includes(pickerFilter.toLowerCase()))
    : models;

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

  function TakeCard({ v }: { v: VideoRow }) {
    const done = v.status === 'completed';
    const isImg = done && !!v.videoUrl && !isVideoUrl(v.videoUrl);
    const isCover = isImg && !!v.driveFileId && coverDriveId === v.driveFileId;
    const coverBusy = busy === v.id + '-cover';
    return (
      <div key={v.id} className={`gen-video ${v.approved ? 'approved' : ''} ${isCover ? 'is-cover' : ''}`}>
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
          {isCover && <span className="badge live">★ cover</span>}
          {v.driveLink && <a className="drive-link" href={v.driveLink} target="_blank" rel="noreferrer">Drive ↗</a>}
        </div>
        <div className="take-actions">
          {done && !v.approved && (
            <button className="btn ghost sm" onClick={() => approve(v.id)} disabled={busy === v.id}>✓ Approve</button>
          )}
          {isImg && v.driveFileId && (
            <button
              className={`attach sm ${isCover ? 'active' : ''}`}
              onClick={() => setAsCover(v)}
              disabled={coverBusy || isCover}
              title={isCover ? 'This image is the current cover' : 'Set as production cover for My Poster'}
            >
              {isCover ? '★ Cover' : '☆ Set as cover'}
            </button>
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
  }

  return (
    <div className="higgs-panel">
      <div className="video-head">
        <strong>① Clean Image — Higgsfield</strong>
        <span className="badge live">connected</span>
        {coverDriveId && <span className="badge">cover set ★</span>}
      </div>
      <p className="muted">Multi-scene composer. Each scene has its own directorial prompt and takes. Approve the best take per scene before moving to A-Roll. Set a completed image as cover for My Poster.</p>

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

      {/* Custom model picker */}
      <label className="vd-label">
        Model
        <span className="vd-label-hint"> — 📝 accepts text · 📷 needs reference image</span>
      </label>
      <div className="model-picker" ref={pickerRef}>
        <button
          type="button"
          className="model-picker-trigger"
          onClick={() => { setPickerOpen((o) => !o); setPickerFilter(''); }}
        >
          <span className="model-picker-name">
            {selectedModel ? selectedModel.display_name : 'Select model…'}
          </span>
          <CapBadges schema={modelSchema} loading={!!model && !schemaLoaded} />
          <span className="model-picker-caret">{pickerOpen ? '▲' : '▼'}</span>
        </button>

        {pickerOpen && (
          <div className="model-picker-dropdown">
            <input
              className="model-picker-filter"
              autoFocus
              placeholder="Filter models…"
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
            />
            <div className="model-picker-list">
              {filteredModels.map((m) => {
                const s = schemaMap[m.job_set_type];
                const loading = !fetchedRef.current.has(m.job_set_type);
                return (
                  <button
                    key={m.job_set_type}
                    type="button"
                    className={`model-picker-option ${m.job_set_type === model ? 'selected' : ''}`}
                    onClick={() => selectModel(m.job_set_type)}
                  >
                    <span className="model-option-name">{m.display_name}</span>
                    <CapBadges schema={s} loading={loading} />
                  </button>
                );
              })}
              {filteredModels.length === 0 && (
                <p className="muted" style={{ padding: '8px 12px', margin: 0 }}>No models match "{pickerFilter}"</p>
              )}
            </div>
          </div>
        )}
      </div>

      {scenePrompts.length > 0 && !imageOnly && (
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

      {!imageOnly && (
        <>
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
        </>
      )}

      {imgAssets.length > 0 && (!schemaLoaded || modelSchema?.supportsImages || imageOnly) && (
        <>
          <label className="vd-label">
            Reference photos {imageOnly ? <strong>(required for this model)</strong> : '(optional)'}
            {sourceAssetIds.length > 0 && (
              <span className={`hf-src-count ${sourceAssetIds.length >= MAX_SOURCE_IMAGES ? 'maxed' : ''}`}>
                {sourceAssetIds.length}/{MAX_SOURCE_IMAGES} selected{sourceAssetIds.length >= MAX_SOURCE_IMAGES ? ' — max reached' : ''}
              </span>
            )}
          </label>
          <div className="hf-sources">
            {!imageOnly && (
              <button type="button" className={`hf-src none ${sourceAssetIds.length === 0 ? 'on' : ''}`}
                onClick={() => setSourceAssetIds([])}>
                none
              </button>
            )}
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

      {imageOnly && imgAssets.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          ℹ️ This model animates reference images — go to <strong>Assets</strong> to upload or pick a reference photo first.
        </p>
      )}

      <div className="gen-row">
        <button
          className="btn"
          onClick={generate}
          disabled={busy === 'generate' || !canGenerate || !model}
        >
          {busy === 'generate' ? 'Sending…' : '✨ Generate imagery'}
        </button>
        <span className="muted">{activeScene.name} · Spends Higgsfield credits</span>
      </div>

      {error && <p className="err">{error}</p>}

      {sceneTakes.length > 0 && (
        <div className="gen-videos">
          {sceneTakes.map((v) => <TakeCard key={v.id} v={v} />)}
        </div>
      )}

      {legacyTakes.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>Earlier takes (no scene tag)</p>
          <div className="gen-videos">
            {legacyTakes.map((v) => <TakeCard key={v.id} v={v} />)}
          </div>
        </>
      )}
    </div>
  );
}
