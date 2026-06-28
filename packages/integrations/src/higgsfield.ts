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

export interface HiggsModelSchema {
  model: string;
  supportsPrompt: boolean;
  supportsImages: boolean;
  params: string[];
  raw: unknown;
}

export interface HiggsfieldClient {
  account(): Promise<{ email?: string; credits?: number; plan?: string }>;
  listModels(type?: 'image' | 'video'): Promise<HiggsModel[]>;
  getModelSchema(model: string): Promise<HiggsModelSchema>;
  createJob(opts: { model: string; prompt?: string; imagePaths?: string[] }): Promise<{ jobId: string }>;
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
  async function run(args: string[], timeoutMs = 120_000, extraFlags: string[] = ['--json', '--no-color']): Promise<unknown> {
    const { stdout } = await pexec(bin, [...args, ...extraFlags], {
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

  // Parse plain-text output from `hf model get` (not JSON — returns usage info).
  function parseModelParams(text: string): string[] {
    const params: string[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/--(\w[\w-]*)/g);
      if (m) params.push(...m.map((p) => p.slice(2)));
    }
    return [...new Set(params)];
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

    async getModelSchema(model) {
      // `hf model get <model>` outputs plain usage text, not JSON — parse it.
      let raw: unknown = null;
      let text = '';
      try {
        const { stdout, stderr } = await pexec(bin, ['model', 'get', model], {
          maxBuffer: 64 * 1024 * 1024, timeout: 30_000
        });
        text = (stdout + '\n' + stderr).trim();
        try { raw = JSON.parse(text); } catch { raw = text; }
      } catch (err: unknown) {
        text = String(err);
        raw = text;
      }
      const params = parseModelParams(text);
      return {
        model,
        supportsPrompt: params.includes('prompt') || text.toLowerCase().includes('--prompt'),
        supportsImages: params.includes('image') || text.toLowerCase().includes('--image'),
        params,
        raw,
      };
    },

    async createJob({ model, prompt, imagePaths }) {
      const args = ['generate', 'create', model];
      if (prompt) args.push('--prompt', prompt);
      for (const p of imagePaths ?? []) args.push('--image', p);
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
