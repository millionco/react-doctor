import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncAwaitInLoop } from "./async-await-in-loop.js";

describe("js-performance/async-await-in-loop — regressions", () => {
  it("flags an independent visible helper even when it is named query", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; async function load(items) { for (const item of items) { await query(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a visible Promise-returning query helper like its alpha rename", () => {
    for (const helperName of ["query", "loadItem"]) {
      const result = runRule(
        asyncAwaitInLoop,
        `const ${helperName} = (item: number): Promise<number> => Promise.resolve(item * 2); async function load(items: number[]) { for (const item of items) { await ${helperName}(item); } }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it.each([
    "yieldNow",
    "yieldToBrowser",
    "sliceYield",
    "nextFrame",
    "breathe",
    "onYield",
    "onProgress",
    "progress",
    "onStep",
    "step",
    "runStage",
  ])("keeps opaque pacing helper %s sequential", (helperName) => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function build(items) { for (const item of items) { await ${helperName}(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a scheduler check sequential without trusting arbitrary check methods", () => {
    const paced = runRule(
      asyncAwaitInLoop,
      `async function build(scheduler, items) { for (const item of items) { await scheduler.check(item.progress); } }`,
    );
    const independent = runRule(
      asyncAwaitInLoop,
      `async function build(api, items) { for (const item of items) { results.push(await api.check(item)); } }`,
    );
    expect(paced.parseErrors).toEqual([]);
    expect(paced.diagnostics).toEqual([]);
    expect(independent.parseErrors).toEqual([]);
    expect(independent.diagnostics.length).toBeGreaterThan(0);
  });

  it("follows local wrappers to a host-yielding Promise", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
       const sliceYield = () => nextTask();
       async function build(items) { for (const item of items) { consume(item); await sliceYield(); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake an unrelated scheduled Promise for the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const load = async (item) => { void new Promise((resolve) => setTimeout(resolve, 0)); return fetch(item); };
       async function build(items) { for (const item of items) { results.push(await load(item)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps work paced by an explicit scheduler argument sequential", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function build(jobs, scheduler) { for (const job of jobs) { results.push(await job(scheduler)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("skips ordered browser-automation driver loops", () => {
    const browserDriver = runRule(
      asyncAwaitInLoop,
      `import { chromium } from "playwright";
       async function drive(page, steps) { for (const step of steps) { await page.evaluate(step); } }`,
      { filename: "dev/capture.mjs" },
    );
    const production = runRule(
      asyncAwaitInLoop,
      `async function load(api, items) { for (const item of items) { results.push(await api.read(item)); } }`,
    );
    expect(browserDriver.parseErrors).toEqual([]);
    expect(browserDriver.diagnostics).toEqual([]);
    expect(production.parseErrors).toEqual([]);
    expect(production.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(["query", "execute", "wait"])(
    "flags the pure local %s spelling without trusting its name",
    (helperName) => {
      const result = runRule(
        asyncAwaitInLoop,
        `const ${helperName} = async (item) => { await Promise.resolve(); return item * 2; }; async function load(items) { for (const item of items) { await ${helperName}(item); } }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );

  it("follows a const alias to an independent local helper", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const run = query; async function load(items) { for (const item of items) { await run(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an independent statically computed local object helper", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const helpers = { query: async (item) => { await Promise.resolve(); return item * 2; } }; async function load(items) { for (const item of items) { await helpers["query"](item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("follows an object shorthand alias to an independent local helper", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; async function load(items) { for (const item of items) { await helpers.query(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps a dynamically reassigned object shorthand helper sequential", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; helpers[getPropertyName()] = async (item) => { cursor += item; return cursor; }; async function load(items) { for (const item of items) { await helpers.query(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `Object.assign(helpers, { query: async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; } });`,
    `Object.defineProperty(helpers, "query", { value: async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; } });`,
    `const install = (target) => { target.query = async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; }; }; install(helpers);`,
  ])("keeps an escaped and overwritten query helper sequential", (overwrite) => {
    const result = runRule(
      asyncAwaitInLoop,
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; ${overwrite} async function load(items) { for (const item of items) { await helpers.query(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an object shorthand helper mutated through a mutable alias sequential", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; let holder = helpers; holder.query = async (item) => { cursor += item; return cursor; }; async function load(items) { for (const item of items) { await helpers.query(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a mutated non-heuristic object helper sequential", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `let cursor = 0; const run = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { run }; let holder = helpers; holder.run = async (item) => { cursor += item; return cursor; }; async function load(items) { for (const item of items) { await helpers.run(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags object helpers when only an unrelated alias is mutated", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const run = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { run }; const otherHelpers = { run }; let holder = otherHelpers; holder.run = async (item) => item + 1; async function load(items) { for (const item of items) { await helpers.run(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps opaque and visibly stateful query calls intentionally sequential", () => {
    for (const code of [
      `async function load(database, items) { for (const item of items) { await database.query(item); } }`,
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); cursor += item; return cursor; }; async function load(items) { for (const item of items) { await query(item); } }`,
      `const Promise = { resolve: async () => undefined }; const query = async (item) => { await Promise.resolve(); return item * 2; }; async function load(items) { for (const item of items) { await query(item); } }`,
      `const query = async (item) => { await Promise.resolve(); if (item < 0) throw new Error("invalid"); return item * 2; }; async function load(items) { for (const item of items) { await query(item); } }`,
    ]) {
      const result = runRule(asyncAwaitInLoop, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays silent on a loop-carried dependency flowing through push + read", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(ids, results) { for (const id of ids) { const prev = results[results.length - 1]; results.push(await fetchNext(id, prev)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when each awaited result becomes the next member-call receiver", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function descend(root, parts) { let directory = root; for (const part of parts) directory = await directory.getDirectoryHandle(part); return directory; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an awaited shared receiver call bridges ordered state snapshots", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { for (const event of events) { const before = replica.getText(); const result = await replica.apply(event); const after = replica.getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an owner-scoped receiver contributes a result property to owner-observed output", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `class Room { async replay(events) { const operations = []; for (const event of events) { const result = await this.api.processRemoteEvent(event); if (result.operation) operations.push(result.operation); } this.notify(operations); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags generic awaited reads collected before Promise.all", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function restore(payload, products) { const updates = []; for (const product of products) { const original = await payload.findByID(product.id); updates.push(payload.update({ id: product.id, data: original })); } await Promise.all(updates); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a parameter receiver whose result property is passed to a free observer", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { const operations = []; for (const event of events) { const result = await replica.processRemoteEvent(event); if (result.operation) operations.push(result.operation); } notify(operations); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an owner method when the whole awaited result is collected", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `class Analyzer { async analyze(items) { const results = []; for (const item of items) { const result = await this.worker.analyze(item); results.push(result); } this.notify(results); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a direct owner receiver whose result property is collected", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `class Analyzer { async analyze(items) { const results = []; for (const item of items) { const result = await this.analyzeItem(item); results.push(result.value); } this.notify(results); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("follows a stable receiver alias when proving ordered state snapshots", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(events) { const replica = this.api; for (const event of events) { const before = replica.getText(); const result = await replica.apply(event); const after = replica.getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows transparent TypeScript wrappers around a stable receiver", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `interface Replica { apply: (event: unknown) => Promise<unknown>; getText: () => string; } async function replay(replica: Replica, events: unknown[]) { for (const event of events) { const before = (replica as Replica).getText(); const result = await (replica as Replica).apply(event); const after = (replica as Replica).getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a bare awaited method whose name only suggests mutation", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { for (const event of events) { await replica.applyRemoteEvent(event); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags state snapshots around work that does not read the iteration binding", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { for (const event of events) { const before = replica.getText(); await replica.refresh(); const after = replica.getText(); consume(event, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags snapshots taken from different receivers", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(beforeReplica, replica, afterReplica, events) { for (const event of events) { const before = beforeReplica.getText(); const result = await replica.apply(event); const after = afterReplica.getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when only the observation before the await uses the same receiver", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, otherReplica, events) { for (const event of events) { const before = replica.getText(); const result = await replica.apply(event); const after = otherReplica.getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags ordered output unrelated to the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { const operations = []; for (const event of events) { await replica.processRemoteEvent(event); operations.push(event); } notify(operations); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags await-derived output that is not observed after the loop", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { const operations = []; for (const event of events) { const result = await replica.processRemoteEvent(event); operations.push(result.operation); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags output that can be reached without executing the await", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events, enabled) { const operations = []; for (const event of events) { let result = event; if (enabled) result = await replica.processRemoteEvent(event); operations.push(result); } notify(operations); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a receiver created independently inside each iteration", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(events) { for (const event of events) { const replica = createReplica(event); const before = replica.getText(); const result = await replica.apply(event); const after = replica.getText(); consume(result, before, after); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an awaited local helper appends to a passed output array", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { files.push(await read(entry)); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a later assignment carries the awaited value into the ordered output", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { let copy; const file = await read(entry); copy = file; files.push(copy); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an awaited local helper appends through a defaulted output parameter", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files = []) => { files.push(await read(entry)); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an awaited local helper appends to a captured output array", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function load(entries) { const files = []; const collect = async (entry) => { files.push(await read(entry)); }; for (const entry of entries) { await collect(entry); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an awaited helper when its caller-local output has no order-observing escape", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { files.push(await read(entry)); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } consumeAsSet(files); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when the only return of the output is inside a nested callback", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { files.push(await read(entry)); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } consume(files.map(() => { return files; })); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a captured output array with no order-observing escape", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function load(entries) { const files = []; const collect = async (entry) => { files.push(await read(entry)); }; for (const entry of entries) { await collect(entry); } consumeAsSet(files); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an append that reads a shadowing binding instead of the awaited value", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { const file = await read(entry); { const file = entry; files.push(file); } }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a recursive awaited helper appends an await-derived file in traversal order", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { if (entry.isFile) { const file = await read(entry); files.push(withPath(file)); return; } for (const child of entry.children) { await collect(child, files); } }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a helper that pushes before awaiting independent work", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { files.push(entry); await send(entry); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a helper that sets distinct map keys after awaiting", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { const file = await read(entry); files.set(entry.id, file); }; async function load(entries) { const files = new Map(); for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an external append unrelated to the awaited result", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => { await send(entry); files.push(entry); }; async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an awaited local helper that only appends to its own local array", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry) => { const files = []; files.push(await read(entry)); return files; }; async function load(entries) { for (const entry of entries) { await collect(entry); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an awaited local helper that only reads a passed output array", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const collect = async (entry, files) => read(entry, files.length); async function load(entries) { const files = []; for (const entry of entries) { await collect(entry, files); } return files; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  it("stays silent on a batched-concurrency loop awaiting Promise.all per chunk", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(updates) { for (let i = 0; i < updates.length; i += 10) { const batch = updates.slice(i, i + 10); await Promise.all(batch.map((update) => apply(update))); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a loop paced by an inline setTimeout promise", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(items) { for (const item of items) { await send(item); await new Promise((resolve) => setTimeout(resolve, 100)); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a wait that stashes resolve for an external caller", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(queue) { let resolveNext = null; while (true) { const item = queue[0]; if (item) { await handle(item); } await new Promise((resolve) => { resolveNext = resolve; }); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a retry loop that returns from inside try/catch", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function retry(callback, maxRetries) { let lastError; for (let attempt = 0; attempt <= maxRetries; attempt++) { try { return await callback(); } catch (error) { lastError = error; } } throw lastError; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags per-item try/catch that only logs and never exits", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(files) { for (const file of files) { try { await upload(file); } catch (error) { report(error); } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Delta-verify recall regression (bulwarkmail email-composer): a bare
  // `if (cancelled) return;` inside a per-item try/catch is a cancellation
  // check, not a retry-until-success exit — the independent per-attachment
  // fetches must still be flagged.
  it("still flags independent per-item fetches whose try block only exits on a cancellation flag", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function hydrate(inlineAtts, composerClient, updates) {
        let cancelled = false;
        for (const att of inlineAtts) {
          if (!att.cid) continue;
          try {
            const buffer = await composerClient.fetchBlobArrayBuffer(att.blobId);
            if (cancelled) return;
            const blob = new Blob([buffer]);
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            if (cancelled) return;
            updates.set(att.cid, dataUrl);
          } catch (err) { report(err); }
        }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a first-success search whose guarded return carries the awaited value", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function firstMirror(urls) { for (const url of urls) { try { const response = await fetch(url); if (response.ok) return response; } catch (error) { log(error); } } return null; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a guarded bare return whose exit carries an awaited value later", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function pick(ids) { for (const id of ids) { try { const item = await load(id); if (!item) continue; return item; } catch (error) { log(error); } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a stream pump whose while-test reads body-assigned state", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function pipe(reader, writer) { let done = false; while (!done) { const status = await reader.read(); if (!status.done) { await writer.write(status.value); } done = status.done; } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a queue drain whose while-test reads the drained queue", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function drain(queue) { while (queue.length > 0) { const job = queue.shift(); await run(job); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a counter-style while loop over independent items", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(urls) { let i = 0; while (i < urls.length) { await fetch(urls[i]); i++; } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on .map(async).filter(...) collected by Promise.all through a binding", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(rowOrders) { const rowPromises = rowOrders.map(async (row) => { const doc = await createRow(row.id); return doc; }).filter(Boolean); return Promise.all(rowPromises); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on .flatMap(async) assigned then awaited with Promise.all later", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(groups) { const previews = groups.flatMap(async (group) => { const html = await render(group); return html; }); const rendered = await Promise.all(previews); return rendered; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on .map(async) spread into a Promise.race array", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(windows) { return Promise.race([...windows.map(async (win) => { const value = await query(win); return value; })]); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an optional-chained .map(async) wrapped in Promise.all", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(state, sdk) { await Promise.all(state?.order?.line_items.map(async (lineItem) => { await sdk.line_items.delete(lineItem.id); })); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on .map(async) behind a nullish fallback inside Promise.all", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(theme) { const secondary = await Promise.all(theme.secondaryThemePaths?.map(async (path) => (await load(path)).default) ?? []); return secondary; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a bounded worker-pool loop fanned out through Promise.all", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function loadAll(rows, ensureRow) { let cursor = 0; const worker = async () => { while (true) { const idx = cursor++; if (idx >= rows.length) return; await ensureRow(rows[idx].id); } }; await Promise.all(Array.from({ length: 4 }, worker)); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not attribute a nested loop's awaits to the enclosing loop", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(files) { for (const file of files) { let hasMoreItems = true; while (hasMoreItems) { const page = await fetchPage(file); hasMoreItems = page.hasMore; } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an outer loop with its own direct awaits beside a nested loop", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function f(files) { for (const file of files) { for (const chunk of file.chunks) { validate(chunk); } await upload(file); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not use an ordered nested loop to exempt an outer sibling await", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events, batches) { for (const event of events) { await upload(event); for (const batch of batches) { const before = replica.getText(); const result = await replica.apply(event, batch); const after = replica.getText(); consume(result, before, after); } } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not use one ordered shared receiver await to exempt a sibling await", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `async function replay(replica, events) { for (const event of events) { const before = replica.getText(); const result = await replica.apply(event); const after = replica.getText(); consume(result, before, after); await upload(event); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags .map(async) whose promises are never collected", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `function f(items) { items.map(async (item) => { await save(item); }); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on resolved helpers that deliberately yield to the browser", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); async function load(steps) { for (const step of steps) { build(step); await nextFrame(); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags local helpers whose names imply waiting but whose work is independent", () => {
    const result = runRule(
      asyncAwaitInLoop,
      `const nextFrame = async (item) => Promise.resolve(item * 2); async function load(items) { for (const item of items) { await nextFrame(item); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
