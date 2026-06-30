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

  // Bugbot: a `return` inside a `switch` still exits the loop, so the loop is
  // order-dependent (first-success search) and must NOT be flagged.
  it("stays silent on a loop that returns from inside a switch", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(steps) { for (const step of steps) { const r = await run(step); switch (r.kind) { case "done": return r; default: break; } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // …but a `break` that only exits an inner switch does NOT short-circuit the
  // loop, so independent awaits are still flagged.
  it("still flags independent awaits when a switch only breaks itself", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(items) { for (const item of items) { switch (item.kind) { case "a": break; default: break; } await record(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
