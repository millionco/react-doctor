import fs from "node:fs";

// cgroup v2 writes the limit (or the literal "max" when unlimited) here; v1
// exposes it as a byte count (and a near-2^63 value when unlimited). Probed in
// that order so a v2 host wins before the v1 fallback path is consulted.
const CGROUP_V2_MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";
const CGROUP_V1_MEMORY_LIMIT_PATH = "/sys/fs/cgroup/memory/memory.limit_in_bytes";

// "Unlimited" sentinel: v2 writes the literal "max" (handled below) while v1
// writes a near-2^63 value when no limit is set. Anything at or above this is
// treated as "no limit" so an unconstrained container doesn't read as a tiny
// budget. `Number.MAX_SAFE_INTEGER` is a safe floor — real container limits
// (gigabytes) sit far below it, and v1's unlimited value sits far above.
const CGROUP_UNLIMITED_SENTINEL_BYTES = Number.MAX_SAFE_INTEGER;

/**
 * Parses one raw cgroup memory-limit file value into a positive byte count, or
 * `undefined` when it represents "no limit" (the v2 `"max"` literal, an empty
 * read, a non-positive / non-finite value, or v1's near-2^63 unlimited
 * sentinel). Pure and exported so the classification is unit-testable without
 * touching the filesystem.
 */
export const parseCgroupMemoryLimitBytes = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "max") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= CGROUP_UNLIMITED_SENTINEL_BYTES) {
    return undefined;
  }
  return parsed;
};

const CGROUP_MEMORY_LIMIT_PATHS: ReadonlyArray<string> = [
  CGROUP_V2_MEMORY_MAX_PATH,
  CGROUP_V1_MEMORY_LIMIT_PATH,
];

/**
 * Reads this process's cgroup memory limit in bytes from the first candidate
 * path that yields a real limit, or `undefined` when none does — no cgroup, no
 * limit, or the files are unreadable (e.g. macOS / Windows dev machines).
 * `os.totalmem()` reports the HOST total and ignores cgroup memory limits, so a
 * memory-constrained container over-reports total memory; `resolveAutoScan-
 * Concurrency` takes `min(totalmem, this)` to honor the limit.
 *
 * The cgroup v2 read is the mount-root `memory.max`, which IS the container's
 * limit under the standard cgroup-namespace setup CI runners use (the
 * container's own cgroup is the root of its namespaced view). A process in a
 * non-namespaced nested/delegated cgroup whose root reads `"max"` is not
 * detected here and falls back to the host total; the EAGAIN/ENOMEM serial
 * replay in `spawnLintBatches` remains the runtime backstop for that case.
 *
 * `candidatePaths` is injectable so tests exercise the v2-wins-over-v1
 * precedence, the skip-unreadable fallback, and the all-missing case without a
 * real `/sys/fs/cgroup`.
 */
export const readCgroupMemoryLimitBytes = (
  candidatePaths: ReadonlyArray<string> = CGROUP_MEMORY_LIMIT_PATHS,
): number | undefined => {
  for (const limitPath of candidatePaths) {
    let raw: string;
    try {
      raw = fs.readFileSync(limitPath, "utf8");
    } catch {
      continue;
    }
    const limitBytes = parseCgroupMemoryLimitBytes(raw);
    if (limitBytes !== undefined) return limitBytes;
  }
  return undefined;
};
