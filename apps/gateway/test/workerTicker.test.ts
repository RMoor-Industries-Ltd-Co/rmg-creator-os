import { describe, it, expect, vi } from 'vitest';
import { createNonOverlappingRunner, startWorkerTicker, DEFAULT_TICK_INTERVAL_MS } from '../src/worker.js';
import type { Database } from '@rmg-creator-os/db';

// Phase A.1 §3 — the in-process dispatcher. Before this, nothing called /worker/tick at all,
// so queued jobs stayed queued indefinitely.

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createNonOverlappingRunner', () => {
  it('runs the tick and logs a claimed job', async () => {
    const log = logger();
    const { tick } = createNonOverlappingRunner(
      async () => ({ claimed: true, jobId: 'j1', status: 'done' }),
      log
    );
    await tick();
    expect(log.info).toHaveBeenCalledWith({ jobId: 'j1', status: 'done' }, expect.any(String));
  });

  it('stays quiet when the queue had nothing to claim', async () => {
    const log = logger();
    const { tick } = createNonOverlappingRunner(async () => ({ claimed: false }), log);
    await tick();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('does not overlap — a second tick while one is in flight is skipped', async () => {
    const log = logger();
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { tick, isRunning } = createNonOverlappingRunner(async () => {
      started += 1;
      await gate;
      return { claimed: false };
    }, log);

    const first = tick();
    expect(isRunning()).toBe(true);
    await tick();          // would be the next interval firing
    await tick();
    expect(started).toBe(1);

    release();
    await first;
    expect(isRunning()).toBe(false);
  });

  it('accepts a new tick once the previous one finished', async () => {
    const log = logger();
    let started = 0;
    const { tick } = createNonOverlappingRunner(async () => { started += 1; return { claimed: false }; }, log);
    await tick();
    await tick();
    expect(started).toBe(2);
  });

  it('swallows a failing tick and releases the guard', async () => {
    // An unhandled rejection inside a setInterval callback can take the process down; the
    // dispatcher must outlive a bad job.
    const log = logger();
    const { tick, isRunning } = createNonOverlappingRunner(async () => { throw new Error('boom'); }, log);
    await expect(tick()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith({ err: 'boom' }, expect.any(String));
    expect(isRunning()).toBe(false);
  });

  it('keeps ticking after a failure', async () => {
    const log = logger();
    let n = 0;
    const { tick } = createNonOverlappingRunner(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return { claimed: true, jobId: 'j2', status: 'done' };
    }, log);
    await tick();
    await tick();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledTimes(1);
  });
});

describe('startWorkerTicker — off by default', () => {
  const db = {} as Database;

  it('returns null when WORKER_TICK_ENABLED is unset', () => {
    vi.stubEnv('WORKER_TICK_ENABLED', '');
    expect(startWorkerTicker({ db, log: logger() })).toBeNull();
    vi.unstubAllEnvs();
  });

  it('returns null for any value other than the exact string "true"', () => {
    for (const v of ['1', 'yes', 'TRUE', 'false']) {
      vi.stubEnv('WORKER_TICK_ENABLED', v);
      expect(startWorkerTicker({ db, log: logger() })).toBeNull();
    }
    vi.unstubAllEnvs();
  });

  it('starts, schedules on an interval, and stops cleanly when enabled', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WORKER_TICK_ENABLED', 'true');
    const log = logger();
    const ticker = startWorkerTicker({ db, intervalMs: 1000, log });
    expect(ticker).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    ticker!.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('has a sane default interval', () => {
    expect(DEFAULT_TICK_INTERVAL_MS).toBe(15_000);
  });
});
