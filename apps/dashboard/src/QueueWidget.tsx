import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

interface ProductionJob {
  id: string;
  productionId: string;
  capability: string;
  provider: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  priority: number;
  attempt: number;
  maxAttempts: number;
  resultId: string | null;
  error: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function QueueWidget() {
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const r = await fetch(`${API}/queue?status=running,failed`);
        if (r.ok && !cancelled) {
          const data = (await r.json()) as { jobs: ProductionJob[] };
          setJobs(data.jobs ?? []);
        }
      } catch {
        // silently ignore network errors in the widget
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function retry(jobId: string) {
    setRetrying(jobId);
    try {
      const r = await fetch(`${API}/queue/${jobId}/retry`, { method: 'POST' });
      if (r.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      }
    } finally {
      setRetrying(null);
    }
  }

  if (jobs.length === 0) return null;

  const running = jobs.filter((j) => j.status === 'running');
  const failed = jobs.filter((j) => j.status === 'failed');

  return (
    <>
      {/* Floating bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          background: '#1a1a1a',
          borderTop: '1px solid #333',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          fontSize: '13px',
          color: '#ccc'
        }}
      >
        {running.length > 0 && (
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#4a9eff',
                marginRight: 6,
                animation: 'pulse 1.5s infinite'
              }}
            />
            {running.length} running
          </span>
        )}
        {failed.length > 0 && (
          <span style={{ color: '#ff6b6b' }}>
            ✕ {failed.length} failed
          </span>
        )}
        <button
          className="btn ghost"
          style={{ marginLeft: 'auto', fontSize: '12px', padding: '4px 10px' }}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          {drawerOpen ? 'Hide queue' : 'View queue →'}
        </button>
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 44,
            left: 0,
            right: 0,
            zIndex: 999,
            background: '#141414',
            borderTop: '1px solid #333',
            maxHeight: '40vh',
            overflowY: 'auto',
            padding: '16px 20px'
          }}
        >
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#eee' }}>Production Queue</h3>
          {jobs.length === 0 && <p className="muted">No active or failed jobs.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map((job) => (
              <li
                key={job.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  background: '#1e1e1e',
                  borderRadius: 6,
                  fontSize: '13px'
                }}
              >
                <span
                  className="badge"
                  style={{
                    background:
                      job.status === 'running'
                        ? '#1a3a5c'
                        : job.status === 'failed'
                        ? '#5c1a1a'
                        : '#2a2a2a',
                    color:
                      job.status === 'running'
                        ? '#4a9eff'
                        : job.status === 'failed'
                        ? '#ff6b6b'
                        : '#aaa',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: '11px',
                    textTransform: 'uppercase'
                  }}
                >
                  {job.status}
                </span>
                <span style={{ color: '#ccc', flex: 1 }}>
                  <strong>{job.capability}</strong>
                  <span className="muted" style={{ marginLeft: 8 }}>
                    via {job.provider}
                  </span>
                </span>
                <span className="muted" style={{ fontSize: '11px' }}>
                  {job.id.slice(0, 8)}…
                </span>
                {job.error && (
                  <span className="err" style={{ fontSize: '11px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.error}
                  </span>
                )}
                {job.status === 'failed' && (
                  <button
                    className="btn"
                    style={{ fontSize: '11px', padding: '3px 10px' }}
                    disabled={retrying === job.id}
                    onClick={() => retry(job.id)}
                  >
                    {retrying === job.id ? '…' : 'Retry'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
