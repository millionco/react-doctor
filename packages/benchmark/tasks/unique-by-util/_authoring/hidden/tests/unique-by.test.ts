import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueBy } from "../src/unique-by.ts";

test("keeps the first item per key, preserving order", () => {
  const result = uniqueBy(
    [
      { id: 1, t: "a" },
      { id: 2, t: "b" },
      { id: 3, t: "a" },
    ],
    (item) => item.t,
  );
  assert.deepEqual(result, [
    { id: 1, t: "a" },
    { id: 2, t: "b" },
  ]);
});

test("dedupes primitives", () => {
  assert.deepEqual(
    uniqueBy([1, 1, 2, 3, 2], (n) => n),
    [1, 2, 3],
  );
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(
    uniqueBy([], (x) => x),
    [],
  );
});
