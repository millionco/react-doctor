import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarInitials } from "../src/avatar-initials.ts";

test("takes first and last initials, uppercased", () => {
  assert.equal(avatarInitials("Ada Lovelace"), "AL");
  assert.equal(avatarInitials("grace hopper"), "GH");
});

test("uses a single initial for one word", () => {
  assert.equal(avatarInitials("Cher"), "C");
});

test("ignores extra whitespace and middle words", () => {
  assert.equal(avatarInitials("  Margaret  Heafield  Hamilton "), "MH");
});

test("returns empty string for empty input", () => {
  assert.equal(avatarInitials(""), "");
  assert.equal(avatarInitials("   "), "");
});
