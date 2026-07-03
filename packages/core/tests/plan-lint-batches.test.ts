import { describe, expect, it } from "vite-plus/test";
import { OXLINT_MAX_FILES_PER_BATCH, SPAWN_ARGS_MAX_LENGTH_CHARS } from "../src/constants.js";
import { planLintBatches } from "../src/utils/plan-lint-batches.js";

const BASE_ARGS = ["/usr/bin/node", "oxlint", "-c", "oxlintrc.json", "--format", "json"];

const makeFiles = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `src/file-${String(index).padStart(4, "0")}.ts`);

const uniformSizes = (files: ReadonlyArray<string>, sizeBytes: number): Map<string, number> =>
  new Map(files.map((file) => [file, sizeBytes]));

describe("planLintBatches", () => {
  it("returns no batches for an empty file list", () => {
    expect(planLintBatches({ baseArgs: BASE_ARGS, files: [], sizeByFile: new Map() })).toEqual([]);
  });

  it("keeps a scan under the batch cap in a single batch", () => {
    const files = makeFiles(OXLINT_MAX_FILES_PER_BATCH);
    const batches = planLintBatches({
      baseArgs: BASE_ARGS,
      files,
      sizeByFile: uniformSizes(files, 1_000),
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(files);
  });

  it("balances file counts across the mandatory batch count instead of 100-file chunks plus a remainder", () => {
    const files = makeFiles(617);
    const batches = planLintBatches({
      baseArgs: BASE_ARGS,
      files,
      sizeByFile: uniformSizes(files, 1_000),
    });
    expect(batches).toHaveLength(Math.ceil(files.length / OXLINT_MAX_FILES_PER_BATCH));
    const batchLengths = batches.map((batch) => batch.length);
    expect(Math.max(...batchLengths)).toBeLessThanOrEqual(89);
    expect(Math.min(...batchLengths)).toBeGreaterThanOrEqual(87);
  });

  it("never exceeds the per-batch file-count cliff cap", () => {
    const files = makeFiles(1_234);
    const batches = planLintBatches({
      baseArgs: BASE_ARGS,
      files,
      sizeByFile: uniformSizes(files, 1_000),
    });
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(OXLINT_MAX_FILES_PER_BATCH);
    }
    expect(batches.flat()).toHaveLength(files.length);
  });

  it("spreads the heavy files across batches (LPT) instead of concentrating them", () => {
    const files = makeFiles(400);
    const sizeByFile = new Map(
      files.map((file, index) => [file, index < 4 ? 1_000_000 : 1_000] as const),
    );
    const batches = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile });
    expect(batches).toHaveLength(4);
    for (const batch of batches) {
      const heavyCount = batch.filter((file) => (sizeByFile.get(file) ?? 0) === 1_000_000).length;
      expect(heavyCount).toBe(1);
    }
  });

  it("balances cumulative byte cost, not just file counts", () => {
    const files = makeFiles(200);
    const sizeByFile = new Map(
      files.map((file, index) => [file, index % 2 === 0 ? 50_000 : 100] as const),
    );
    const batches = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile });
    expect(batches).toHaveLength(2);
    const batchByteTotals = batches.map((batch) =>
      batch.reduce((total, file) => total + (sizeByFile.get(file) ?? 0), 0),
    );
    const [firstTotal, secondTotal] = batchByteTotals;
    expect(Math.abs(firstTotal - secondTotal)).toBeLessThanOrEqual(50_000);
  });

  it("preserves every input path exactly once, in arrival order within each batch", () => {
    const files = makeFiles(250);
    const sizeByFile = new Map(files.map((file, index) => [file, (index * 37) % 5_000] as const));
    const batches = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile });
    const flattened = batches.flat();
    expect(flattened).toHaveLength(files.length);
    expect(new Set(flattened).size).toBe(files.length);
    const indexOfFile = new Map(files.map((file, index) => [file, index] as const));
    for (const batch of batches) {
      const indexes = batch.map((file) => indexOfFile.get(file) ?? -1);
      expect([...indexes].sort((left, right) => left - right)).toEqual(indexes);
    }
  });

  it("is deterministic for a fixed input", () => {
    const files = makeFiles(300);
    const sizeByFile = new Map(files.map((file, index) => [file, (index * 101) % 9_000] as const));
    const first = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile });
    const second = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile });
    expect(second).toEqual(first);
  });

  it("spills to extra batches rather than exceed the spawn-args char budget", () => {
    const longSegment = "a".repeat(400);
    const files = Array.from({ length: 200 }, (_, index) => `src/${longSegment}/file-${index}.ts`);
    const batches = planLintBatches({
      baseArgs: BASE_ARGS,
      files,
      sizeByFile: uniformSizes(files, 1_000),
    });
    expect(batches.length).toBeGreaterThan(2);
    const baseArgsLength = BASE_ARGS.reduce((total, argument) => total + argument.length + 1, 0);
    for (const batch of batches) {
      const batchLength = batch.reduce((total, file) => total + file.length + 1, baseArgsLength);
      expect(batchLength).toBeLessThanOrEqual(SPAWN_ARGS_MAX_LENGTH_CHARS);
    }
    expect(batches.flat()).toHaveLength(files.length);
  });

  it("treats files missing from the size map as zero-cost instead of throwing", () => {
    const files = makeFiles(160);
    const batches = planLintBatches({ baseArgs: BASE_ARGS, files, sizeByFile: new Map() });
    expect(batches).toHaveLength(2);
    expect(batches.flat().sort()).toEqual([...files].sort());
  });
});
