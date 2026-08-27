import { describe, it, expect } from "vitest";
import { racePool } from "./resolve-pool.js";

interface Result {
  ok: boolean;
  retryable?: boolean;
  message?: string;
}

describe("racePool", () => {
  it("returns the first success and aborts still-in-flight siblings", async () => {
    const settledVia: Record<number, string> = {};
    const result = await racePool<string, Result>({
      candidates: ["a", "b", "c"],
      concurrency: 3,
      signal: new AbortController().signal,
      resolveOne: (_candidate, index, signal) =>
        new Promise<Result>((resolve) => {
          if (index === 2) {
            // Resolves on its own, without waiting for anything — the winner.
            settledVia[index] = "own-success";
            resolve({ ok: true });
            return;
          }
          // Never resolves on its own — only settles if/when the pool
          // aborts it, modeling a genuinely still-in-flight sibling.
          signal.addEventListener("abort", () => {
            settledVia[index] = "aborted";
            resolve({ ok: false });
          });
        }),
      isSuccess: (r) => r.ok,
      isRetryable: () => true,
    });

    expect(result.winner?.index).toBe(2);
    expect(result.winner?.result).toEqual({ ok: true });
    expect(settledVia[0]).toBe("aborted");
    expect(settledVia[1]).toBe("aborted");
  });

  it("never runs more than `concurrency` candidates at once", async () => {
    let active = 0;
    let maxActive = 0;
    let totalDispatched = 0;
    const releasers: Array<() => void> = [];

    const poolPromise = racePool<number, Result>({
      candidates: [0, 1, 2, 3, 4],
      concurrency: 2,
      signal: new AbortController().signal,
      resolveOne: () =>
        new Promise<Result>((resolve) => {
          active++;
          totalDispatched++;
          maxActive = Math.max(maxActive, active);
          releasers.push(() => {
            active--;
            resolve({ ok: false, retryable: true });
          });
        }),
      isSuccess: (r) => r.ok,
      isRetryable: (r) => r.retryable === true,
    });

    while (totalDispatched < 5 || active > 0) {
      if (releasers.length > 0) releasers.shift()!();
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    await poolPromise;
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(totalDispatched).toBe(5);
  });

  it("stops dispatching new candidates after a retryable:false failure, but an already-in-flight one can still win", async () => {
    const started: number[] = [];
    const result = await racePool<number, Result>({
      candidates: [0, 1, 2, 3],
      concurrency: 2,
      signal: new AbortController().signal,
      resolveOne: async (_candidate, index) => {
        started.push(index);
        if (index === 0) return { ok: false, retryable: false };
        if (index === 1) return { ok: true };
        return { ok: false, retryable: true };
      },
      isSuccess: (r) => r.ok,
      isRetryable: (r) => r.retryable === true,
    });

    expect(result.winner?.index).toBe(1);
    // 2 and 3 were queued but never dispatched — index 0's retryable:false
    // stopped new work before either of their slots could open up.
    expect(started).toEqual([0, 1]);
  });

  it("returns no winner and the last failure when every candidate fails", async () => {
    const result = await racePool<number, Result>({
      candidates: [0, 1, 2],
      concurrency: 3,
      signal: new AbortController().signal,
      resolveOne: async (_candidate, index) => ({ ok: false, retryable: true, message: `fail-${index}` }),
      isSuccess: (r) => r.ok,
      isRetryable: (r) => r.retryable === true,
    });

    expect(result.winner).toBeNull();
    expect(result.lastFailure?.ok).toBe(false);
    expect(["fail-0", "fail-1", "fail-2"]).toContain(result.lastFailure?.message);
  });

  it("resolves immediately with no winner for an empty candidate list", async () => {
    const resolveOne = async () => ({ ok: true }) as Result;
    const result = await racePool<number, Result>({
      candidates: [],
      concurrency: 2,
      signal: new AbortController().signal,
      resolveOne,
      isSuccess: (r) => r.ok,
      isRetryable: () => true,
    });
    expect(result.winner).toBeNull();
    expect(result.lastFailure).toBeUndefined();
  });

  it("dispatches nothing when the outer signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const started: number[] = [];
    const result = await racePool<number, Result>({
      candidates: [0, 1, 2],
      concurrency: 2,
      signal: controller.signal,
      resolveOne: async (_candidate, index) => {
        started.push(index);
        return { ok: true };
      },
      isSuccess: (r) => r.ok,
      isRetryable: () => true,
    });
    expect(result.winner).toBeNull();
    expect(started).toEqual([]);
  });
});
