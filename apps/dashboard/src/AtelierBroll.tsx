import { useEffect, useState, useCallback } from 'react';
import { useLoadingBar } from './loading';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

type Take = {
  id: string;
  provider: string;
  jobId: string;
  driveId: string | null;
  status: 'queued' | 'done' | 'failed';
  label: string;
};

type Scene = {
  id: string;
  description: string;
  refIds: string[];
  providers: string[];
  takes: Take[];
  approvedIds: string[];
};

type LibraryClip = {
  driveId: string;
  takeId: string;
  label: string;
};

type BrollData = {
  scenes: Scene[];
  library: LibraryClip[];
};

const PROVIDERS = ['higgsfield', 'supercool', 'heygen', 'manual'];

export function AtelierBroll({ productionId }: { productionId: string }) {
  const [data, setData] = useState<BrollData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDesc, setNewDesc] = useState('');
  const [newProviders, setNewProviders] = useState<string[]>(['higgsfield']);
  const loading = useLoadingBar();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/productions/${productionId}/broll`);
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json() as BrollData);
    } catch (e) {
      setError(String(e));
    }
  }, [productionId]);

  useEffect(() => { void load(); }, [load]);

  async function addScene() {
    if (!newDesc.trim()) return;
    const r = await fetch(`${API}/productions/${productionId}/broll/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: newDesc.trim(), providers: newProviders }),
    });
    if (r.ok) { setNewDesc(''); await load(); }
  }

  async function deleteScene(sid: string) {
    await fetch(`${API}/productions/${productionId}/broll/scenes/${sid}`, { method: 'DELETE' });
    await load();
  }

  async function renderScene(sid: string) {
    const r = await fetch(`${API}/productions/${productionId}/broll/scenes/${sid}/render`, { method: 'POST' });
    if (r.ok) await load();
  }

  async function approveTake(tid: string, driveId: string, label: string) {
    await fetch(`${API}/productions/${productionId}/broll/takes/${tid}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drive_id: driveId, label }),
    });
    await load();
  }

  async function discardTake(tid: string) {
    await fetch(`${API}/productions/${productionId}/broll/takes/${tid}`, { method: 'DELETE' });
    await load();
  }

  function toggleProvider(p: string) {
    setNewProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  if (error) return <p className="err">B-Roll load failed: {error}</p>;
  if (!data) return <p className="muted">Loading B-Roll…</p>;

  const { scenes, library } = data;

  return (
    <div className="atelier-broll">
      <h3>Atelier B-Roll</h3>

      {/* Add scene */}
      <div className="broll-add-scene panel">
        <h4>Add scene</h4>
        <textarea
          rows={2}
          placeholder="Scene description / prompt…"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          style={{ width: '100%', marginBottom: '0.5rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {PROVIDERS.map((p) => (
            <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={newProviders.includes(p)}
                onChange={() => toggleProvider(p)}
              />
              {p}
            </label>
          ))}
        </div>
        <button onClick={addScene} disabled={!newDesc.trim() || newProviders.length === 0}>
          + Add scene
        </button>
      </div>

      {/* Scene shot list */}
      {scenes.length === 0 && <p className="muted">No scenes yet. Add one above.</p>}
      {scenes.map((scene) => (
        <div key={scene.id} className="broll-scene panel" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: 0 }}><strong>{scene.description}</strong></p>
              <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                Providers: {scene.providers.join(', ') || '—'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => renderScene(scene.id)} disabled={scene.providers.length === 0}>
                Render
              </button>
              <button className="btn-danger" onClick={() => deleteScene(scene.id)}>
                ✕
              </button>
            </div>
          </div>

          {/* Takes */}
          {scene.takes.length > 0 && (
            <div className="broll-takes" style={{ marginTop: '0.75rem' }}>
              <p className="muted" style={{ margin: '0 0 0.5rem' }}>Takes</p>
              {scene.takes.map((take) => (
                <div key={take.id} className="broll-take" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span className={`status-dot ${take.status}`} />
                  <span style={{ flex: 1 }}>{take.label}</span>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>{take.status}</span>
                  {scene.approvedIds.includes(take.id) && (
                    <span className="badge-approved">✓ approved</span>
                  )}
                  {take.status === 'done' && !scene.approvedIds.includes(take.id) && take.driveId && (
                    <button
                      onClick={() => approveTake(take.id, take.driveId!, take.label)}
                      style={{ fontSize: '0.75rem' }}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="btn-danger"
                    onClick={() => discardTake(take.id)}
                    style={{ fontSize: '0.75rem' }}
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* B-Roll Library */}
      {library.length > 0 && (
        <div className="broll-library panel" style={{ marginTop: '1.5rem' }}>
          <h4>B-Roll Library ({library.length})</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {library.map((clip, i) => (
              <div key={clip.takeId ?? i} className="broll-clip-card">
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.85rem' }}>{clip.label || `Clip ${i + 1}`}</p>
                {clip.driveId && (
                  <a
                    href={`https://drive.google.com/file/d/${clip.driveId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '0.75rem' }}
                  >
                    View in Drive ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
