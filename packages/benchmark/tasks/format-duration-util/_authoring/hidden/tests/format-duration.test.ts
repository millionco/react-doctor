import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../src/format-duration.ts";

test("returns 0s for zero and negative input", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(-10), "0s");
});

test("renders seconds only under a minute", () => {
  assert.equal(formatDuration(5_000), "5s");
});

test("renders minutes and seconds", () => {
  assert.equal(formatDuration(65_000), "1m 5s");
});

test("drops trailing zero units", () => {
  assert.equal(formatDuration(3_600_000), "1h");
});

test("keeps a zero unit between two non-zero units", () => {
  assert.equal(formatDuration(3_601_000), "1h 0m 1s");
  assert.equal(formatDuration(3_661_000), "1h 1m 1s");
});
