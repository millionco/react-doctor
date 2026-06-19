import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { readCgroupMemoryLimitBytes } from "./read-cgroup-memory-limit-bytes.js";

// Pages `vm_stat` reports as allocatable on demand: truly free, plus the
// inactive / speculative / purgeable pages macOS reclaims under pressure but
// which `os.freemem()` (wired + free only) excludes — the reason freemem reads
// ~3 GB on a 16 GB Mac that can actually hand out ~9 GB.
const VM_STAT_RECLAIMABLE_PAGE_KINDS = ["free", "inactive", "speculative", "purgeable"] as const;

const readLinuxMemAvailableBytes = (): number | undefined => {
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m);
    return match ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined;
  }
};

const readDarwinAvailableBytes = (): number | undefined => {
  try {
    const output = execFileSync("vm_stat", { encoding: "utf8" });
    const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
    if (!Number.isFinite(pageSize) || pageSize <= 0) return undefined;
    let reclaimablePages = 0;
    for (const pageKind of VM_STAT_RECLAIMABLE_PAGE_KINDS) {
      const match = output.match(new RegExp(`Pages ${pageKind}:\\s+(\\d+)\\.`));
      if (match) reclaimablePages += Number(match[1]);
    }
    return reclaimablePages > 0 ? reclaimablePages * pageSize : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Best-effort ALLOCATABLE memory in bytes — what the dead-code-overlap gate
 * budgets against. Prefers the OS's own estimate of memory it can hand out
 * under pressure (Linux `MemAvailable`, macOS `vm_stat` reclaimable pages),
 * because `os.freemem()` counts only wired + free pages and so badly
 * understates a Mac's real headroom — the reason the overlap gate never opened
 * on a 16 GB MacBook. Falls back to `os.freemem()` where neither is readable
 * (e.g. Windows), and is capped by the cgroup memory limit so a constrained
 * container reads its own budget, not the host's, and can't overcommit.
 */
export const resolveAvailableMemoryBytes = (): number => {
  const platformAvailable =
    process.platform === "linux"
      ? readLinuxMemAvailableBytes()
      : process.platform === "darwin"
        ? readDarwinAvailableBytes()
        : undefined;
  const available = platformAvailable ?? os.freemem();
  const cgroupLimitBytes = readCgroupMemoryLimitBytes();
  return cgroupLimitBytes === undefined ? available : Math.min(available, cgroupLimitBytes);
};
