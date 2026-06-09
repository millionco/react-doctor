import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/parse-query.ts";

test("parses simple pairs and ignores a leading ?", () => {
  assert.deepEqual(parseQuery("?a=1&b=two"), { a: "1", b: "two" });
});

test("URI-decodes keys and values", () => {
  assert.deepEqual(parseQuery("name=Ada%20Lovelace"), { name: "Ada Lovelace" });
});

test("maps a bare key to an empty string", () => {
  assert.deepEqual(parseQuery("flag&x=1"), { flag: "", x: "1" });
});

test("keeps the last value for a repeated key", () => {
  assert.deepEqual(parseQuery("k=1&k=2"), { k: "2" });
});

test("returns an empty object for empty input", () => {
  assert.deepEqual(parseQuery(""), {});
  assert.deepEqual(parseQuery("?"), {});
});
