/**
 * Bounded-concurrency "race N candidates, return the first success" pool.
 * Framework-free so both the web app's live playback retry loop
 * (PlaybackControls' playIndex) and its next-episode background prefetch
 * can share one implementation instead of two near-duplicate ones.
 *
 * Real constraint this is designed around: nothing in the debrid layer
 * rate-limits requests today except the old sequential retry loop's own
 * one-at-a-time nature (see resolve-stream/route.ts's `retryable` doc
 * comment in apps/web for the real incident that shaped that). Racing
 * candidates concurrently means this pool is now the only thing bounding
 * burst size, so `isRetryable` returning false stops NEW dispatches
 * immediately (already-in-flight candidates are left to finish — one of
 * them can still win) rather than being ignored the way plain concurrency
 * would.
 */
export interface RacePoolOptions<T, R> {
  candidates: T[];
  concurrency: number;
  /** Must never throw — wrap any real error handling inside this so isSuccess/isRetryable can operate uniformly on the return value. */
  resolveOne: (candidate: T, index: number, signal: AbortSignal) => Promise<R>;
  isSuccess: (result: R) => boolean;
  isRetryable: (result: R) => boolean;
  signal: AbortSignal;
  onAttemptStart?: (index: number) => void;
  onAttemptSettled?: (index: number, result: R) => void;
}

export interface RacePoolResult<R> {
  winner: { index: number; result: R } | null;
  lastFailure?: R;
}

export async function racePool<T, R>(opts: RacePoolOptions<T, R>): Promise<RacePoolResult<R>> {
  const { candidates, concurrency, resolveOne, isSuccess, isRetryable, signal, onAttemptStart, onAttemptSettled } =
    opts;

  const poolController = new AbortController();
  const onOuterAbort = () => poolController.abort();
  if (signal.aborted) poolController.abort();
  else signal.addEventListener("abort", onOuterAbort);

  let nextIndex = 0;
  let stopDispatch = false;
  let winner: { index: number; result: R } | null = null;
  let lastFailure: R | undefined;

  async function worker(): Promise<void> {
    for (;;) {
      if (poolController.signal.aborted || stopDispatch || winner) return;
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      if (candidate === undefined) continue;
      onAttemptStart?.(index);
      const result = await resolveOne(candidate, index, poolController.signal);
      onAttemptSettled?.(index, result);
      if (poolController.signal.aborted) return;
      if (isSuccess(result)) {
        winner = { index, result };
        poolController.abort();
        return;
      }
      lastFailure = result;
      if (!isRetryable(result)) stopDispatch = true;
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    signal.removeEventListener("abort", onOuterAbort);
  }

  return { winner, lastFailure };
}
