import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.ts";

test("lowercases and hyphenates words", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("collapses runs of whitespace", () => {
  assert.equal(slugify("  Multiple   Spaces  "), "multiple-spaces");
});

test("strips non-alphanumeric characters", () => {
  assert.equal(slugify("Café & Crème"), "caf-crme");
});

test("trims and collapses stray hyphens", () => {
  assert.equal(slugify("--already--slugged--"), "already-slugged");
});

test("returns empty string for empty input", () => {
  assert.equal(slugify(""), "");
});
