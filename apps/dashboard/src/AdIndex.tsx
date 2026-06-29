import { useEffect, useState } from 'react';
import { adIndex, type AdIndexCode } from './api';
import { navigate } from './router';

const AD_TYPES = ['ad', 'short', 'long', 'promo', 'podcast', 'vlog'];
const PRODUCTS = ['books', 'software', 'merch', 'store', 'news'];
const REGIONS = ['usa', 'can', 'uk', 'global'];
const TIMEZONES = ['est', 'pst', 'cst', 'gmt', 'utc'];
const STATUSES = ['draft', 'approved', 'published', 'archived'];

function driveLink(id: string) {
  return `https://drive.google.com/file/d/${id}/view`;
}

export function AdIndex() {
  const [codes, setCodes] = useState<AdIndexCode[]>([]);
  const [filterType, setFilterType] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [issueProductionId, setIssueProductionId] = useState('');
  const [issueType, setIssueType] = useState(AD_TYPES[0]);
  const [issueProduct, setIssueProduct] = useState(PRODUCTS[0]);
  const [issueRegion, setIssueRegion] = useState(REGIONS[0]);
  const [issueTz, setIssueTz] = useState(TIMEZONES[0]);
  const [issuing, setIssuing] = useState(false);

  const [selected, setSelected] = useState<AdIndexCode | null>(null);
  const [downloadData, setDownloadData] = useState<{ adIndexCode: string | null; assets: Record<string, unknown> | null; caption: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const filters: Record<string, string> = {};
      if (filterType) filters.type = filterType;
      if (filterProduct) filters.product = filterProduct;
      if (filterRegion) filters.region = filterRegion;
      if (filterStatus) filters.status = filterStatus;
      const r = await adIndex.list(filters);
      setCodes(r.codes);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filterType, filterProduct, filterRegion, filterStatus]);

  async function issue() {
    if (!issueProductionId.trim()) return;
    setIssuing(true);
    setErr(null);
    try {
      const r = await adIndex.issue({
        production_id: issueProductionId.trim(),
        type: issueType,
        product: issueProduct,
        region: issueRegion,
        tz: issueTz,
      });
      setCodes((c) => [r.code, ...c]);
      setIssueProductionId('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setIssuing(false);
    }
  }

  async function download(code: AdIndexCode) {
    if (!code.productionId) return;
    setDownloading(true);
    setDownloadData(null);
    setErr(null);
    try {
      const r = await adIndex.download(code.productionId);
      setDownloadData(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="allie-page">
      <div className="ask-head">
        <div>
          <h2>Ad Index</h2>
          <p className="muted">Browse, issue, and download production delivery packages.</p>
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      {/* Filter bar */}
      <div className="feed-add" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {AD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
          <option value="">All products</option>
          {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="attach sm" onClick={() => void load()} disabled={loading}>
          {loading ? '…' : '↻'}
        </button>
      </div>

      {/* Codes table */}
      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h3>Codes <span className="muted">({codes.length})</span></h3>
        {codes.length === 0 && !loading && <p className="muted">No codes found.</p>}
        {codes.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.4rem 0.6rem' }}>Code</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Production</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Created</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Final</th>
                <th style={{ padding: '0.4rem 0.6rem' }}>Poster</th>
                <th style={{ padding: '0.4rem 0.6rem' }} />
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr
                  key={c.code}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: selected?.code === c.code ? 'var(--surface-hover, #f5f5f5)' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => { setSelected(c); setDownloadData(null); }}
                >
                  <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace' }}>{c.code}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    <span className={`badge ${c.status}`}>{c.status}</span>
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    {c.productionId ? (
                      <button
                        type="button"
                        className="attach sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/produce/${c.productionId}/script`); }}
                      >
                        {c.productionId.slice(0, 8)}
                      </button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }} className="muted">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    {c.finalDriveId
                      ? <a href={driveLink(c.finalDriveId)} target="_blank" rel="noreferrer">Drive ↗</a>
                      : <span className="muted">—</span>}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    {c.posterDriveId
                      ? <a href={driveLink(c.posterDriveId)} target="_blank" rel="noreferrer">Drive ↗</a>
                      : <span className="muted">—</span>}
                  </td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>
                    {c.productionId && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={(e) => { e.stopPropagation(); setSelected(c); void download(c); }}
                        disabled={downloading && selected?.code === c.code}
                      >
                        {downloading && selected?.code === c.code ? '…' : 'Package'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Download panel */}
      {selected && downloadData && (
        <section className="panel" style={{ marginBottom: '1.5rem' }}>
          <h3>Package — <span style={{ fontFamily: 'monospace' }}>{selected.code}</span></h3>
          {downloadData.caption && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label className="vd-label">Caption</label>
              <textarea
                className="script-view"
                rows={4}
                readOnly
                value={downloadData.caption}
                style={{ marginTop: '0.25rem' }}
              />
            </div>
          )}
          {downloadData.assets && (
            <pre style={{ fontSize: '0.75rem', overflowX: 'auto', background: 'var(--surface, #f9f9f9)', padding: '0.75rem', borderRadius: '4px' }}>
              {JSON.stringify(downloadData.assets as Record<string, unknown>, null, 2)}
            </pre>
          )}
        </section>
      )}

      {/* Issue code panel */}
      <section className="panel">
        <h3>Issue a code</h3>
        <p className="muted hint">Link a finished production to a new Ad Index code.</p>
        <div className="feed-add" style={{ flexWrap: 'wrap' }}>
          <input
            placeholder="Production ID"
            value={issueProductionId}
            onChange={(e) => setIssueProductionId(e.target.value)}
            style={{ minWidth: '200px' }}
          />
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            {AD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={issueProduct} onChange={(e) => setIssueProduct(e.target.value)}>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={issueRegion} onChange={(e) => setIssueRegion(e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={issueTz} onChange={(e) => setIssueTz(e.target.value)}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <button
            type="button"
            className="btn sm"
            onClick={() => void issue()}
            disabled={issuing || !issueProductionId.trim()}
          >
            {issuing ? 'Issuing…' : 'Issue'}
          </button>
        </div>
      </section>
    </section>
  );
}
