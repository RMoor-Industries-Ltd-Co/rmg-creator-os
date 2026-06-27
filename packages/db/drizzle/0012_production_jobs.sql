CREATE TYPE production_job_status AS ENUM ('queued', 'running', 'done', 'failed', 'cancelled');
CREATE TYPE production_job_capability AS ENUM ('aroll', 'broll', 'lipsync', 'audio', 'thumbnail', 'poster');

CREATE TABLE production_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  capability    production_job_capability NOT NULL,
  provider      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        production_job_status NOT NULL DEFAULT 'queued',
  priority      int NOT NULL DEFAULT 10,
  attempt       int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 2,
  result_id     text,
  error         text,
  locked_until  timestamptz,
  worker_id     text,
  enqueued_at   timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

CREATE INDEX production_jobs_status_priority ON production_jobs (status, priority, enqueued_at)
  WHERE status = 'queued';
CREATE INDEX production_jobs_production_id ON production_jobs (production_id);
