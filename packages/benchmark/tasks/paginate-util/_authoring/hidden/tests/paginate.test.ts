import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/paginate.ts";

test("returns the first page slice with metadata", () => {
  const result = paginate([1, 2, 3, 4, 5], 1, 2);
  assert.deepEqual(result.items, [1, 2]);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 3);
  assert.equal(result.totalItems, 5);
});

test("returns the final partial page", () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5], 3, 2).items, [5]);
});

test("clamps an out-of-range page to the last page", () => {
  const result = paginate([1, 2, 3, 4, 5], 99, 2);
  assert.deepEqual(result.items, [5]);
  assert.equal(result.page, 3);
});

test("an empty list still has one empty page", () => {
  const result = paginate([], 1, 2);
  assert.deepEqual(result.items, []);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.totalItems, 0);
});
