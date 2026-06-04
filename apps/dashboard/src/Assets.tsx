import { useEffect, useRef, useState } from 'react';
import { assets, type Asset, type Production } from './api';

/**
 * Assets step — upload images/video for a production. They store privately in
 * Drive (IMAGE_PRODUCTION) and show here. These are the visual inputs that later
 * route to Higgsfield (image → video) and My Poster.
 */
export function Assets({ p }: { p: Production }) {
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    assets
      .list(p.id)
      .then(setRows)
      .catch((e: unknown) => setError(String(e)));
  }
  useEffect(load, [p.id]);

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

  return (
    <div className="assets">
      <div className="video-head">
        <strong>Assets</strong>
        <span className="badge">{rows ? `${rows.length} file${rows.length === 1 ? '' : 's'}` : '…'}</span>
      </div>
      <p className="muted">
        Upload images or video for <strong>{p.title || p.topic}</strong>. Stored in Drive
        (IMAGE_PRODUCTION). These feed the next stage — Higgsfield (image → video) &amp; My Poster.
      </p>

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
          accept="image/*,video/*"
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

      {error && <p className="err">{error}</p>}

      {rows && rows.length > 0 && (
        <div className="asset-grid">
          {rows.map((a) => (
            <figure key={a.id} className="asset-card">
              {a.kind === 'image' ? (
                <img src={assets.rawUrl(a.id)} alt={a.fileName} loading="lazy" />
              ) : a.kind === 'video' ? (
                <video src={assets.rawUrl(a.id)} controls preload="metadata" />
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
      )}

      {rows && rows.length === 0 && !uploading && (
        <p className="muted">No assets yet — add some above.</p>
      )}
    </div>
  );
}
