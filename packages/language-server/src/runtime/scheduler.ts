import {
  SILENT_LOGGER,
  type CancellationToken,
  type ScanRequest,
  type ScanRequestInput,
  type Scheduler,
  type SchedulerOptions,
  type ScanPriority,
} from "../types.js";

const PRIORITY_RANK: Record<ScanPriority, number> = {
  interactive: 0,
  save: 1,
  background: 2,
};

/** Coalescing key: one in-flight scan per project + file-scope. */
const keyOf = (request: Pick<ScanRequestInput, "projectDirectory" | "files">): string => {
  const scope = request.files.length === 0 ? "<project>" : [...request.files].sort().join("|");
  return `${request.projectDirectory}::${scope}`;
};

/**
 * Priority queue for scans. Interactive (open-buffer) scans preempt save
 * and background scans; per-key debounce collapses bursts of edits; a
 * monotonic generation per key supersedes stale work so a slow oxlint
 * subprocess can never clobber a fresher result. Bounded concurrency
 * keeps large monorepos responsive.
 */
export const createScheduler = (options: SchedulerOptions): Scheduler => {
  const debounceMs = options.debounceMs ?? 300;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const reservedInteractiveSlots = Math.max(0, options.reservedInteractiveSlots ?? 0);
  // Background scans never occupy the reserved slots, so an interactive /
  // save scan can always start while a big workspace scan churns.
  const maxBackground = Math.max(1, concurrency - reservedInteractiveSlots);
  const logger = options.logger ?? SILENT_LOGGER;

  let generation = 0;
  let running = 0;
  let runningBackground = 0;
  let disposed = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const latestGeneration = new Map<string, number>();
  const queue: ScanRequest[] = [];

  const notifyIdle = (): void => {
    options.onIdleChange?.(running === 0 && queue.length === 0 && timers.size === 0);
  };

  const isEligible = (request: ScanRequest): boolean =>
    request.priority === "background" ? runningBackground < maxBackground : running < concurrency;

  /** Highest-priority queue entry that can run under the current slot budget. */
  const takeEligible = (): ScanRequest | undefined => {
    let bestIndex = -1;
    for (let index = 0; index < queue.length; index += 1) {
      if (!isEligible(queue[index])) continue;
      if (
        bestIndex === -1 ||
        PRIORITY_RANK[queue[index].priority] < PRIORITY_RANK[queue[bestIndex].priority]
      ) {
        bestIndex = index;
      }
    }
    return bestIndex === -1 ? undefined : queue.splice(bestIndex, 1)[0];
  };

  const drain = (): void => {
    while (!disposed && running < concurrency) {
      const request = takeEligible();
      if (!request) break;
      const key = keyOf(request);
      // Superseded while it waited in the queue.
      if (latestGeneration.get(key) !== request.id) continue;

      running += 1;
      const isBackground = request.priority === "background";
      if (isBackground) runningBackground += 1;
      const token: CancellationToken = {
        get isCancelled() {
          return disposed || latestGeneration.get(key) !== request.id;
        },
      };

      Promise.resolve(options.performScan(request, token))
        .then((outcome) => {
          if (outcome && !token.isCancelled) options.onResult(outcome);
        })
        .catch((error: unknown) => {
          if (options.onError) options.onError(error, request);
          else
            logger.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          running -= 1;
          if (isBackground) runningBackground -= 1;
          drain();
          notifyIdle();
        });
    }
    notifyIdle();
  };

  const enqueue = (input: ScanRequestInput): void => {
    if (disposed) return;
    const key = keyOf(input);
    const id = (generation += 1);
    latestGeneration.set(key, id);
    const request: ScanRequest = { ...input, id };

    const delay = input.priority === "interactive" ? debounceMs : 0;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      timers.delete(key);
      // A newer enqueue for this key arrived during the debounce window.
      if (latestGeneration.get(key) !== id) {
        notifyIdle();
        return;
      }
      queue.push(request);
      drain();
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    timers.set(key, timer);
  };

  const cancelProject = (projectDirectory: string): void => {
    const prefix = `${projectDirectory}::`;
    for (const [key, timer] of timers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }
    for (const key of latestGeneration.keys()) {
      // Bump to a generation no live request carries → supersedes them.
      if (key.startsWith(prefix)) latestGeneration.set(key, (generation += 1));
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (keyOf(queue[index]).startsWith(prefix)) queue.splice(index, 1);
    }
    notifyIdle();
  };

  const dispose = (): void => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    queue.length = 0;
  };

  const pendingCount = (): number => queue.length + running + timers.size;

  return { enqueue, cancelProject, pendingCount, dispose };
};
