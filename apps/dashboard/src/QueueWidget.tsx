import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_BASE_URL ?? '/api';

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

interface ProductionJob {
  id: string;
  productionId: string;
  capability: string;
  provider: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  error?: string | null;
  enqueuedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

function statusChip(status: JobStatus) {
  const map: Record<JobStatus, string> = {
    queued: '⏳',
    running: '⚙',
    done: '✓',
    failed: '✗',
    cancelled: '—',
  };
  return map[status] ?? status;
}

export function QueueWidget() {
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch(`${API}/queue`);
        if (!r.ok) return;
        const data = (await r.json()) as { jobs: ProductionJob[] };
        if (!cancelled) setJobs(data.jobs ?? []);
      } catch {
        // silently ignore polling errors
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const rendering = jobs.filter((j) => j.status === 'running').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;

  // Hide widget when there's nothing to show
  if (jobs.length === 0) return null;

  async function retry(id: string) {
    setRetrying(id);
    try {
      await fetch(`${API}/queue/${id}/retry`, { method: 'POST' });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#1a1a1a',
          borderTop: '1px solid #333',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          fontSize: '13px',
          zIndex: 1000,
        }}
      >
        {rendering > 0 && <span>⚙ {rendering} rendering</span>}
        {queued > 0 && <span>⏳ {queued} queued</span>}
        {done > 0 && <span style={{ color: '#4caf50' }}>✓ {done} done</span>}
        {failed > 0 && <span style={{ color: '#f44336' }}>✗ {failed} failed</span>}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid #555',
            color: '#ccc',
            padding: '2px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {open ? 'Hide queue ↓' : 'View queue →'}
        </button>
      </div>

      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '40px',
            left: 0,
            right: 0,
            maxHeight: '320px',
            overflowY: 'auto',
            background: '#111',
            borderTop: '1px solid #333',
            zIndex: 999,
            padding: '8px 0',
          }}
        >
          {jobs.map((job) => (
            <div
              key={job.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 16px',
                borderBottom: '1px solid #222',
                fontSize: '13px',
              }}
            >
              <span style={{ width: '16px', textAlign: 'center' }}>{statusChip(job.status)}</span>
              <span style={{ minWidth: '80px', color: '#aaa' }}>{job.capability}</span>
              <span style={{ minWidth: '100px' }}>{job.provider}</span>
              <span
                style={{
                  flex: 1,
                  color:
                    job.status === 'failed'
                      ? '#f44336'
                      : job.status === 'done'
                      ? '#4caf50'
                      : '#ccc',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {job.error ?? job.status}
              </span>
              {(job.status === 'failed' || job.status === 'cancelled') && (
                <button
                  onClick={() => retry(job.id)}
                  disabled={retrying === job.id}
                  style={{
                    background: '#333',
                    border: '1px solid #555',
                    color: '#ccc',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {retrying === job.id ? '…' : 'Retry'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
