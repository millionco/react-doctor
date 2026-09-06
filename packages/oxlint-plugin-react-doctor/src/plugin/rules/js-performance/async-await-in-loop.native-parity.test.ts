import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncAwaitInLoop } from "./async-await-in-loop.js";

describe("async-await-in-loop native parity regressions", () => {
  it.each([
    {
      name: "async-map-conditional-bound-promise-array",
      source:
        "async function load(items, enabled) { const jobs = enabled ? [] : items.map(async item => await fetch(item)); await Promise.all(jobs); }",
      expectedCount: 0,
    },
    {
      name: "async-map-logical-bound-promise-array",
      source:
        "async function load(items, existing) { const jobs = existing || items.map(async item => await fetch(item)); await Promise.all(jobs); }",
      expectedCount: 0,
    },
    {
      name: "async-map-chained-bound-promise-array",
      source:
        "async function load(items) { const jobs = items.map(async item => await fetch(item)).filter(Boolean); await Promise.all(jobs); }",
      expectedCount: 0,
    },
    {
      name: "async-map-conditional-uncombined-control",
      source:
        "async function load(items, enabled) { const jobs = enabled ? [] : items.map(async item => await fetch(item)); return jobs; }",
      expectedCount: 1,
    },
    {
      name: "async-map-nontransparent-call-control",
      source:
        "async function load(items) { await Promise.all(wrap(items.map(async item => await fetch(item)))); }",
      expectedCount: 1,
    },
    {
      name: "async-map-unrelated-function-binding-control",
      source:
        "async function load(items) { const jobs = items.map(async item => await fetch(item)); return jobs; } async function other(jobs) { await Promise.all(jobs); }",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(asyncAwaitInLoop, source, { filename: "src/component.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
