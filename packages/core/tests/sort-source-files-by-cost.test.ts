import { describe, expect, it } from "vite-plus/test";
import { sortSourceFilesByCost } from "../src/utils/sort-source-files-by-cost.js";
import type { SourceFileEntry } from "@react-doctor/core";

describe("sortSourceFilesByCost", () => {
  it("orders entries descending by sizeBytes", () => {
    const entries: ReadonlyArray<SourceFileEntry> = [
      { path: "a", sizeBytes: 10 },
      { path: "b", sizeBytes: 100 },
      { path: "c", sizeBytes: 50 },
    ];
    expect(sortSourceFilesByCost(entries)).toEqual(["b", "c", "a"]);
  });

  it("preserves input order for entries of equal size (stable sort)", () => {
    const entries: ReadonlyArray<SourceFileEntry> = [
      { path: "a", sizeBytes: 10 },
      { path: "b", sizeBytes: 10 },
    ];
    expect(sortSourceFilesByCost(entries)).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortSourceFilesByCost([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const entries: ReadonlyArray<SourceFileEntry> = [
      { path: "a", sizeBytes: 10 },
      { path: "b", sizeBytes: 100 },
      { path: "c", sizeBytes: 50 },
    ];
    const inputSnapshot = [...entries];
    sortSourceFilesByCost(entries);
    expect(entries).toEqual(inputSnapshot);
  });
});
