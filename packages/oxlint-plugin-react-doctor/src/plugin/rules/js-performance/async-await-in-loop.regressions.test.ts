import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncAwaitInLoop } from "./async-await-in-loop.js";

describe("js-performance/async-await-in-loop — regressions", () => {
  it("stays silent on a loop-carried dependency flowing through push + read", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(ids, results) { for (const id of ids) { const prev = results[results.length - 1]; results.push(await fetchNext(id, prev)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags independent awaits in a loop", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(urls) { for (let i = 0; i < urls.length; i++) { await fetch(urls[i]); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
