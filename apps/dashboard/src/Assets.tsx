import { useEffect, useRef, useState } from 'react';
import {
  assets,
  characters,
  productions,
  type Asset,
  type Character,
  type HiggsSoul,
  type LibraryFile,
  type Production
} from './api';

export const SHORTLIST_KEY = (productionId: string) => `atelier-img-shortlist-${productionId}`;

export function loadShortlist(productionId: string): string[] {
  try {
    const raw = localStorage.getItem(SHORTLIST_KEY(productionId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function saveShortlist(productionId: string, ids: string[]) {
  try { localStorage.setItem(SHORTLIST_KEY(productionId), JSON.stringify(ids)); } catch { /* ignore */ }
}

export function Assets({ p }: { p: Production }) {
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  const [library, setLibrary] = useState<LibraryFile[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<Set<string>>(new Set());
  const [shortlist, setShortlist] = useState<string[]>(() => loadShortlist(p.id));
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    assets
      .list(p.id)
      .then(setRows)
      .catch((e: unknown) => setError(String(e)));
  }
  useEffect(load, [p.id]);

  useEffect(() => {
    saveShortlist(p.id, shortlist);
  }, [p.id, shortlist]);

  function loadLibrary() {
    if (library) return;
    setLibraryLoading(true);
    setLibraryError(null);
    assets
      .library()
      .then(setLibrary)
      .catch((e: unknown) => setLibraryError(String(e)))
      .finally(() => setLibraryLoading(false));
  }

  useEffect(() => {
    if (tab === 'library') loadLibrary();
  }, [tab]);

  async function upload(files: FileList | File[]) {
    if (!files || (files as FileList).length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await assets.upload(p.id, files);
      load();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await assets.remove(id);
      setRows((r) => (r ? r.filter((a) => a.id !== id) : r));
      setShortlist((s) => s.filter((sid) => sid !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function attach(file: LibraryFile) {
    if (attaching.has(file.id)) return;
    setAttaching((s) => new Set(s).add(file.id));
    setError(null);
    try {
      const row = await assets.attach(p.id, file);
      setRows((r) => (r ? [row, ...r] : [row]));
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setAttaching((s) => {
        const next = new Set(s);
        next.delete(file.id);
        return next;
      });
    }
  }

  function toggleShortlist(id: string) {
    setShortlist((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const attachedDriveIds = new Set((rows ?? []).map((a) => a.driveFileId).filter(Boolean));
  const imageRows = (rows ?? []).filter((a) => a.kind === 'image');
  const otherRows = (rows ?? []).filter((a) => a.kind !== 'image');

  return (
    <div className="assets">
      <div className="video-head">
        <strong>Assets</strong>
        <span className="badge">{rows ? `${rows.length} file${rows.length === 1 ? '' : 's'}` : '…'}</span>
        {shortlist.length > 0 && (
          <span className="badge live" title="Images shortlisted for Scenes">
            {shortlist.length} shortlisted
          </span>
        )}
      </div>
      <p className="muted">
        Upload images, video, or your own <strong>voiceover</strong> (wav/mp3/aac) for{' '}
        <strong>{p.title || p.topic}</strong>. Stored in Drive. Images + voice feed the custom
        video in Generate; images also feed Higgsfield.
      </p>

      <CharacterPanel p={p} />

      <div className="asset-tabs">
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          Upload
        </button>
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          Brand Library
        </button>
      </div>

      {tab === 'upload' && (
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          role="button"
        >
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,video/*,audio/*"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
          {uploading ? <span>Uploading…</span> : (
            <span><strong>Drop images/video here</strong> or click to choose</span>
          )}
        </div>
      )}

      {tab === 'library' && (
        <div className="library-panel">
          {libraryError && <p className="err">{libraryError}</p>}
          {libraryLoading && <p className="muted">Loading library…</p>}
          {library && library.length === 0 && (
            <p className="muted">No files in the Brand Library yet. Upload to the shared Drive folder and they'll appear here.</p>
          )}
          {library && library.length > 0 && (
            <div className="asset-grid">
              {library
                .filter((f) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/'))
                .map((f) => {
                  const already = attachedDriveIds.has(f.id);
                  const busy = attaching.has(f.id);
                  return (
                    <figure key={f.id} className={`asset-card library-card ${already ? 'attached' : ''}`}>
                      {f.thumbnailLink ? (
                        <img src={f.thumbnailLink} alt={f.name} loading="lazy" />
                      ) : (
                        <div className="asset-file">🖼</div>
                      )}
                      <figcaption>
                        <span className="asset-name" title={f.name}>{f.name}</span>
                        <button
                          className="asset-attach"
                          onClick={() => attach(f)}
                          disabled={already || busy}
                          title={already ? 'Already in this production' : 'Add to production'}
                        >
                          {busy ? '…' : already ? '✓' : '+'}
                        </button>
                      </figcaption>
                    </figure>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {error && <p className="err">{error}</p>}

      {imageRows.length > 0 && (
        <>
          <div className="asset-section-head">
            <strong>Images</strong>
            <span className="muted asset-section-hint">Click to shortlist for Scenes — only shortlisted images load on the Scenes page</span>
          </div>
          <div className="asset-grid">
            {imageRows.map((a) => {
              const selected = shortlist.includes(a.id);
              return (
                <figure
                  key={a.id}
                  className={`asset-card shortlistable ${selected ? 'shortlisted' : ''}`}
                  onClick={() => toggleShortlist(a.id)}
                  title={selected ? 'Remove from Scenes shortlist' : 'Add to Scenes shortlist'}
                >
                  <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
                  {selected && <span className="shortlist-check">✓</span>}
                  <figcaption>
                    <span className="asset-name" title={a.fileName}>{a.fileName}</span>
                    <button
                      className="asset-del"
                      onClick={(e) => { e.stopPropagation(); remove(a.id); }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </>
      )}

      {otherRows.length > 0 && (
        <>
          <div className="asset-section-head" style={{ marginTop: imageRows.length > 0 ? 12 : 0 }}>
            <strong>Video / Audio</strong>
          </div>
          <div className="asset-grid">
            {otherRows.map((a) => (
              <figure key={a.id} className="asset-card">
                {a.kind === 'video' ? (
                  <video src={assets.rawUrl(a.id)} controls preload="metadata" />
                ) : a.kind === 'audio' ? (
                  <div className="asset-file">
                    🎙
                    <audio src={assets.rawUrl(a.id)} controls preload="none" />
                  </div>
                ) : (
                  <div className="asset-file">📄</div>
                )}
                <figcaption>
                  <span className="asset-name" title={a.fileName}>{a.fileName}</span>
                  <button className="asset-del" onClick={() => remove(a.id)} title="Remove">✕</button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      {rows && rows.length === 0 && !uploading && (
        <p className="muted">No assets yet — add some above or pick from the Brand Library.</p>
      )}
    </div>
  );
}

function CharacterPanel({ p }: { p: Production }) {
  const [list, setList] = useState<Character[] | null>(null);
  const [roster, setRoster] = useState<string[]>(p.characterIds ?? (p.characterId ? [p.characterId] : []));
  const [err, setErr] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [souls, setSouls] = useState<HiggsSoul[] | null>(null);
  const [soulsErr, setSoulsErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [soulId, setSoulId] = useState('');
  const [soulModel, setSoulModel] = useState('soul_2');
  const [elementId, setElementId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    characters.list(p.brand).then(setList).catch((e: unknown) => setErr(String(e)));
  }, [p.brand]);

  async function toggle(id: string) {
    const next = roster.includes(id) ? roster.filter((x) => x !== id) : [...roster, id];
    const prev = roster;
    setRoster(next);
    setErr(null);
    try {
      await productions.setCharacters(p.id, next);
    } catch (e: unknown) {
      setErr(String(e));
      setRoster(prev); // revert on failure
    }
  }

  function openRegister() {
    setRegistering(true);
    if (!souls) characters.souls().then(setSouls).catch((e: unknown) => setSoulsErr(String(e)));
  }

  async function register() {
    if (!name.trim() || (!soulId && !elementId.trim())) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await characters.create({ name: name.trim(), brand: p.brand, soulId: soulId || undefined, soulModel, elementId: elementId.trim() || undefined });
      setList((l) => (l ? [c, ...l] : [c]));
      const next = roster.includes(c.id) ? roster : [...roster, c.id];
      setRoster(next);
      await productions.setCharacters(p.id, next);
      setRegistering(false);
      setName('');
      setSoulId('');
      setElementId('');
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="character-panel">
      <div className="asset-section-head">
        <strong>Character</strong>
        <span className="muted asset-section-hint">
          Add the Higgsfield Souls in this production's cast — pick which one each A-Roll segment and scene uses
        </span>
      </div>
      {err && <p className="err">{err}</p>}
      {list && list.length > 0 && (
        <div className="asset-tabs">
          {list.map((c) => (
            <button
              key={c.id}
              className={roster.includes(c.id) ? 'active' : ''}
              onClick={() => toggle(c.id)}
              title={c.soulId ? `Soul ${c.soulId} (${c.soulModel})` : 'No Soul attached'}
            >
              {roster.includes(c.id) ? '✓ ' : ''}
              {c.name}
              {c.soulId ? '' : ' (no soul)'}
            </button>
          ))}
        </div>
      )}
      {list && list.length === 0 && !registering && (
        <p className="muted">No characters yet for {p.brand}. Register one from a Higgsfield Soul.</p>
      )}
      {!registering ? (
        <button onClick={openRegister}>+ Register a Soul character</button>
      ) : (
        <div className="character-register">
          {soulsErr && <p className="err">{soulsErr}</p>}
          <input
            placeholder="Character name (e.g. Rahm — VLOG)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select value={soulId} onChange={(e) => setSoulId(e.target.value)}>
            <option value="">{souls ? 'Select a ready Soul…' : 'Loading Souls…'}</option>
            {(souls ?? []).map((s) => (
              <option key={s.soulId} value={s.soulId}>
                {s.name ?? s.soulId}
                {s.status ? ` (${s.status})` : ''}
              </option>
            ))}
          </select>
          <select value={soulModel} onChange={(e) => setSoulModel(e.target.value)}>
            <option value="soul_2">Soul 2.0</option>
            <option value="soul_cinema_studio">Soul Cinema</option>
          </select>
          <input
            placeholder="Reference element id (optional — for two-in-a-frame)"
            value={elementId}
            onChange={(e) => setElementId(e.target.value)}
          />
          <div className="row-actions">
            <button disabled={busy || !name.trim() || (!soulId && !elementId.trim())} onClick={register}>
              {busy ? 'Saving…' : 'Register & bind'}
            </button>
            <button onClick={() => setRegistering(false)}>Cancel</button>
          </div>
          <p className="muted">
            Souls are trained in Higgsfield (Soul 2.0). Pick your ready Rahm Soul — it drives the
            A-Roll avatar portrait and keeps B-Roll scenes consistent.
          </p>
        </div>
      )}
    </div>
  );
}
