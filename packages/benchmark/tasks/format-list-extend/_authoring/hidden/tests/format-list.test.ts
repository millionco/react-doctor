import { test } from "node:test";
import assert from "node:assert/strict";
import { formatList } from "../src/format-list.ts";

test("keeps existing default joining behavior", () => {
  assert.equal(formatList([]), "");
  assert.equal(formatList(["a"]), "a");
  assert.equal(formatList(["a", "b"]), "a and b");
  assert.equal(formatList(["a", "b", "c"]), "a, b and c");
});

test("adds an Oxford comma when requested for 3+ items", () => {
  assert.equal(formatList(["a", "b", "c"], { oxford: true }), "a, b, and c");
});

test("honors a custom conjunction", () => {
  assert.equal(formatList(["a", "b", "c"], { conjunction: "or" }), "a, b or c");
  assert.equal(formatList(["a", "b"], { conjunction: "or" }), "a or b");
});
