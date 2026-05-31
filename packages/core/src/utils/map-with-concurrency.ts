/**
 * Runs `task` over `items` with at most `concurrency` tasks in flight at
 * once, returning results in input order. A pool of workers each pulls the
 * next not-yet-started index until the list drains — so a worker that
 * finishes a fast task immediately picks up the next one (greedy load
 * balancing), which matters when tasks have uneven durations (oxlint
 * batches do).
 *
 * Failure semantics mirror a bounded `Promise.all`: on the first rejection
 * no further tasks are started, the already-in-flight tasks are awaited to
 * settle (so no subprocess is orphaned mid-write), and the returned promise
 * rejects with that first error. This keeps the caller's fail-fast retry
 * path (e.g. oxlint's retry-without-extends) from spawning a second wave on
 * top of a still-running first one.
 */
export const mapWithConcurrency = async <Input, Output>(
  items: ReadonlyArray<Input>,
  concurrency: number,
  task: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array(items.length);
  if (items.length === 0) return results;

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency) || 1), items.length);
  let nextIndex = 0;
  const errors: unknown[] = [];

  const runWorker = async (): Promise<void> => {
    while (errors.length === 0) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        errors.push(error);
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  if (errors.length > 0) throw errors[0];
  return results;
};
