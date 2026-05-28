/**
 * Maps `mapItem` over `items` with at most `concurrencyLimit` calls
 * in flight at once, preserving result order. A minimal Promise-based
 * worker pool: `concurrencyLimit` workers each pull the next index off
 * a shared cursor until the list drains.
 *
 * The oxlint runner uses it to fan a project's file batches across CPU
 * cores instead of awaiting one subprocess at a time. Plain async code
 * (not Effect) because the runner it serves — `spawnLintBatches` →
 * `spawnOxlint` — is plain async around `child_process.spawn`.
 */
export const mapWithConcurrency = async <Item, Result>(
  items: ReadonlyArray<Item>,
  concurrencyLimit: number,
  mapItem: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> => {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapItem(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(Math.floor(concurrencyLimit), items.length));
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
};
