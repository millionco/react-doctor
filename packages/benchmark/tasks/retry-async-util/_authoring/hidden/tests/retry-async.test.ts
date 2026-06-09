import { test } from "node:test";
import assert from "node:assert/strict";
import { retryAsync } from "../src/retry-async.ts";

test("retries until the operation resolves", async () => {
  let calls = 0;
  const value = await retryAsync(async () => {
    calls++;
    if (calls < 2) throw new Error("transient");
    return "ok";
  }, 3);
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("rejects with the last error after exhausting attempts", async () => {
  let calls = 0;
  await assert.rejects(
    retryAsync(async () => {
      calls++;
      throw new Error(`fail ${calls}`);
    }, 2),
    /fail 2/,
  );
  assert.equal(calls, 2);
});

test("calls the operation only once when it resolves immediately", async () => {
  let calls = 0;
  await retryAsync(async () => {
    calls++;
    return 1;
  }, 5);
  assert.equal(calls, 1);
});
