import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCachePropertyAccess } from "./js-cache-property-access.js";

describe("js-performance/js-cache-property-access — regressions", () => {
  it("stays silent when the deep chain is mutated inside the loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(state, results, n) { for (let i = 0; i < n; i++) { state.counter.value = state.counter.value + 1; results.push(state.counter.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a read-only deep chain repeated in the loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(state, results, n) { for (let i = 0; i < n; i++) { results.push(state.counter.value); results.push(state.counter.value); results.push(state.counter.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the chain base is reassigned mid-loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(start) { let node = start; while (node) { process(node.data.value); process(node.data.value); node = node.next; process(node.data.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
