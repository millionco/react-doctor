import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkize } from "../src/chunk.ts";

test("splits into chunks with a shorter final chunk", () => {
  assert.deepEqual(chunkize([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("returns a single chunk when size >= length", () => {
  assert.deepEqual(chunkize(["a", "b", "c"], 5), [["a", "b", "c"]]);
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(chunkize([], 3), []);
});

test("returns an empty array for size < 1", () => {
  assert.deepEqual(chunkize([1, 2], 0), []);
});
