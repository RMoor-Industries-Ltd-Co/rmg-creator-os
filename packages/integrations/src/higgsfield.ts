// Higgsfield integration — wraps the authenticated `higgsfield` CLI (no public API).
// The binary + credentials live on the gateway host; we shell out with --json.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export interface HiggsModel {
  job_set_type: string;
  display_name: string;
  type: string; // image | video | text
}

export interface HiggsJob {
  id: string;
  status: string; // queued | in_progress | completed | failed | nsfw | ...
  resultUrl?: string;
  jobSetType?: string;
}

export interface HiggsfieldClient {
  account(): Promise<{ email?: string; credits?: number; plan?: string }>;
  listModels(type?: 'image' | 'video'): Promise<HiggsModel[]>;
  createJob(opts: { model: string; prompt: string; imagePath?: string }): Promise<{ jobId: string }>;
  getJob(jobId: string): Promise<HiggsJob>;
}

// `generate create --json` returns a bare array of job-id strings (e.g. ["uuid"]);
// other commands nest under id/jobs/data. Handle all shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findId(o: any): string | undefined {
  if (typeof o === 'string') return o || undefined;
  if (!o || typeof o !== 'object') return undefined;
  if (typeof o.id === 'string') return o.id;
  if (Array.isArray(o)) {
    for (const el of o) {
      const f = findId(el);
      if (f) return f;
    }
    return undefined;
  }
  for (const k of ['jobs', 'data', 'job_set', 'job']) {
    if (o[k]) {
      const f = findId(o[k]);
      if (f) return f;
    }
  }
  return undefined;
}

export function createHiggsfieldClient(bin = 'higgsfield'): HiggsfieldClient {
  async function run(args: string[], timeoutMs = 120_000): Promise<unknown> {
    const { stdout } = await pexec(bin, [...args, '--json', '--no-color'], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs
    });
    const t = stdout.trim();
    try {
      return JSON.parse(t);
    } catch {
      const line = t
        .split('\n')
        .reverse()
        .find((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
      if (line) return JSON.parse(line);
      throw new Error(`higgsfield: non-JSON output: ${t.slice(0, 200)}`);
    }
  }

  return {
    async account() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await run(['account', 'status']);
      return { email: d.email, credits: d.credits, plan: d.subscription_plan_type };
    },

    async listModels(type) {
      const args = ['model', 'list'];
      if (type) args.push(`--${type}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await run(args);
      const items = Array.isArray(d) ? d : d.models ?? d.data ?? [];
      return items as HiggsModel[];
    },

    async createJob({ model, prompt, imagePath }) {
      const args = ['generate', 'create', model, '--prompt', prompt];
      if (imagePath) args.push('--image', imagePath);
      const d = await run(args);
      const jobId = findId(d);
      if (!jobId) throw new Error('higgsfield: no job id in create output');
      return { jobId };
    },

    async getJob(jobId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await run(['generate', 'get', jobId], 30_000);
      const job = Array.isArray(d) ? d[0] : d.job ?? d.data ?? d;
      return {
        id: job?.id ?? jobId,
        status: job?.status ?? 'unknown',
        resultUrl: job?.result_url,
        jobSetType: job?.job_set_type
      };
    }
  };
}
