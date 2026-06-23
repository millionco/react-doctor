import type { SourceFileEntry } from "../types/index.js";

// LPT (longest-processing-time-first) batch ordering: feed the largest files
// first so the greedy work-stealing pool in `mapWithConcurrency` starts the
// heaviest batch in wave 1 instead of stranding it after the cheap batches
// drain. File size is a WEAK AST-cost proxy (persisted per-batch durations are
// the v2 signal); it is free here because the size was already stat'd by the
// minified gate. Stable on ties (V8 `Array.prototype.sort` is stable) so
// equal-size files keep their `git ls-files` order — and the deterministic
// diagnostic sort downstream means batch order no longer affects any output
// regardless.
export const sortSourceFilesByCost = (entries: ReadonlyArray<SourceFileEntry>): string[] =>
  [...entries].sort((left, right) => right.sizeBytes - left.sizeBytes).map((entry) => entry.path);
