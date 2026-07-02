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

  it("still flags data.push(await transform(row.data)) — property name is not a value reference", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(rows) { const data = []; for (const row of rows) { data.push(await transform(row.data)); } return data; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags results.push(await api.results(id)) — method name is not a value reference", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(ids) { const results = []; for (const id of ids) { results.push(await api.results(id)); } return results; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an unconditional trailing return — the exit does not depend on the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(items) { for (const item of items) { await save(item); return; } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags independent awaits behind a break that reads no awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(items, signal) { for (const item of items) { if (signal.aborted) break; await save(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a labeled break of the inspected loop guarded by the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(groups) { outer: for (const group of groups) { const r = await probe(group); for (const item of group.items) { if (item.match(r)) break outer; } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a return inside a nested loop guarded by the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(groups) { for (const group of groups) { const r = await probe(group); for (const item of group.items) { if (item.match(r)) return item; } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a first-hit return behind an awaited-value continue guard", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function migrate(stores, key) { for (const store of stores) { const raw = await store.getItem(key); if (!raw) continue; await current.setItem(key, raw); return raw; } return null; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a trailing return behind a continue guard that reads no awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(items, signal) { for (const item of items) { if (signal.aborted) continue; await save(item); return; } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on the canonical result-dependent guard return", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(ids, out) { for (const id of ids) { const user = await fetchUser(id); if (!user) return null; out.push(user); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an async forEach callback even when it returns early", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `function f(items) { items.forEach(async (item) => { const r = await save(item); if (!r.ok) return; }); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when a push only happens inside a nested callback", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(tasks) { const errors = []; for (const task of tasks) { await runTask(task).catch((e) => errors.push(e)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the mutated array is read by the await argument", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(ids) { const acc = []; for (const id of ids) { acc.push(await next(id, acc)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
