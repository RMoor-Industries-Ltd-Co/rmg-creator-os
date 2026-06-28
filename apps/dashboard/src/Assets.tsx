import { useEffect, useRef, useState } from 'react';
import { assets, type Asset, type LibraryFile, type Production } from './api';

/**
 * Assets step — upload images/video for a production. They store privately in
 * Drive (IMAGE_PRODUCTION) and show here. These are the visual inputs that later
 * route to Higgsfield (image → video) and My Poster.
 *
 * Also exposes a "Brand Library" tab: browse a shared Drive folder of evergreen
 * reference photos (e.g. Coach Rahm headshots) and attach them without re-uploading.
 */
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
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    assets
      .list(p.id)
      .then(setRows)
      .catch((e: unknown) => setError(String(e)));
  }
  useEffect(load, [p.id]);

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

  const attachedDriveIds = new Set((rows ?? []).map((a) => a.driveFileId).filter(Boolean));

  return (
    <div className="assets">
      <div className="video-head">
        <strong>Assets</strong>
        <span className="badge">{rows ? `${rows.length} file${rows.length === 1 ? '' : 's'}` : '…'}</span>
      </div>
      <p className="muted">
        Upload images, video, or your own <strong>voiceover</strong> (wav/mp3/aac) for{' '}
        <strong>{p.title || p.topic}</strong>. Stored in Drive. Images + voice feed the custom
        video in Generate; images also feed Higgsfield.
      </p>

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
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files);
          }}
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
          {uploading ? (
            <span>Uploading…</span>
          ) : (
            <span>
              <strong>Drop images/video here</strong> or click to choose
            </span>
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
                        <span className="asset-name" title={f.name}>
                          {f.name}
                        </span>
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

      {rows && rows.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: '1rem' }}>
            <strong>This production's assets</strong>
          </p>
          <div className="asset-grid">
            {rows.map((a) => (
              <figure key={a.id} className="asset-card">
                {a.kind === 'image' ? (
                  <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
                ) : a.kind === 'video' ? (
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
                  <span className="asset-name" title={a.fileName}>
                    {a.fileName}
                  </span>
                  <button className="asset-del" onClick={() => remove(a.id)} title="Remove">
                    ✕
                  </button>
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
