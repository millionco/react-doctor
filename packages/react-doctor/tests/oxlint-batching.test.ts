import { describe, expect, it } from "vite-plus/test";
import { OXLINT_MAX_FILES_PER_BATCH, batchIncludePaths } from "@react-doctor/core";

describe("OXLINT_MAX_FILES_PER_BATCH (perf cliff guard)", () => {
  // HACK: empirically verified that the upstream `effect` plugin
  // (`eslint-plugin-react-you-might-not-need-an-effect`, the source of
  // the now-natively-ported `react-doctor/no-derived-state` family)
  // hits the 5-min oxlint spawn timeout at batch=500 on supabase/studio's
  // ~3500 source files (returns 0 diagnostics, marks lint as skipped),
  // but completes with batch=200. If a future bump pushes this
  // back above ~250, large-monorepo scans regress to silent timeout.
  it("stays small enough to keep js-evaluated plugins tractable", () => {
    expect(OXLINT_MAX_FILES_PER_BATCH).toBeLessThanOrEqual(250);
  });
});

describe("batchIncludePaths split behavior", () => {
  it("yields a single batch when total files is under the cap", () => {
    const baseArguments = ["--config", "config.json"];
    const includePaths = Array.from({ length: 50 }, (_, index) => `src/file-${index}.ts`);
    const batches = batchIncludePaths(baseArguments, includePaths);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(includePaths);
  });

  it("partitions a large file list into multiple batches at the cap boundary", () => {
    const baseArguments = ["--config", "config.json"];
    const fileCount = OXLINT_MAX_FILES_PER_BATCH * 3 + 7;
    const includePaths = Array.from({ length: fileCount }, (_, index) => `src/file-${index}.ts`);
    const batches = batchIncludePaths(baseArguments, includePaths);
    expect(batches).toHaveLength(4);
    expect(batches[0]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[1]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[2]).toHaveLength(OXLINT_MAX_FILES_PER_BATCH);
    expect(batches[3]).toHaveLength(7);
  });

  it("preserves all input paths across batches (no drops, no duplicates)", () => {
    const baseArguments = ["--config", "config.json"];
    const includePaths = Array.from({ length: 350 }, (_, index) => `src/file-${index}.ts`);
    const batches = batchIncludePaths(baseArguments, includePaths);
    const flattened = batches.flat();
    expect(flattened).toHaveLength(includePaths.length);
    expect(new Set(flattened).size).toBe(includePaths.length);
  });
});
