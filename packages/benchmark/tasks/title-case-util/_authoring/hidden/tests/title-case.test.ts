import { test } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/title-case.ts";

test("capitalizes each word", () => {
  assert.equal(titleCase("hello world"), "Hello World");
});

test("collapses whitespace and trims", () => {
  assert.equal(titleCase("  the QUICK  brown  "), "The Quick Brown");
});

test("lowercases the rest of each word", () => {
  assert.equal(titleCase("ALL CAPS"), "All Caps");
});

test("returns empty string for empty input", () => {
  assert.equal(titleCase(""), "");
  assert.equal(titleCase("   "), "");
});
