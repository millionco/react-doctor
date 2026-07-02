import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsHoistRegexp } from "./js-hoist-regexp.js";

const expectFail = (code: string): void => {
  const result = runRule(jsHoistRegexp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsHoistRegexp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-hoist-regexp — regressions", () => {
  it("flags a static-pattern `new RegExp(...)` built inside a loop", () => {
    expectFail(`for (const line of lines) { const m = new RegExp("\\\\d+", "gi"); m.test(line); }`);
  });

  it("does not flag `new RegExp(loopVar, ...)` whose pattern depends on the loop", () => {
    expectPass(
      `function h(text, kws){ let o=text; for(const k of kws){ const m=new RegExp(k,"gi"); o=o.replace(m,(x)=>x);} return o; }`,
    );
  });

  // fp-review PR #994: the static check must cover the flags argument too.
  it("does not flag a static pattern with loop-variant flags", () => {
    expectPass(
      `for (const flags of flagVariants) { const re = new RegExp("token", flags); re.test(input); }`,
    );
  });

  it("does not flag a template-literal pattern interpolating the loop variable", () => {
    expectPass(
      `function findUsages(componentNames, content, results, importPath) {
  for (const componentName of componentNames) {
    if (new RegExp(\`<\${componentName}\\\\b\`).test(content)) {
      results.push({ componentName, importPath });
    }
  }
}`,
    );
  });

  it("still flags a static pattern in a for-of loop", () => {
    expectFail(`for (const line of lines) { if (new RegExp("^\\\\s*#").test(line)) count++; }`);
  });

  it("still flags an expression-free template-literal pattern with static flags in a while loop", () => {
    expectFail(
      `while (queue.length > 0) { const item = queue.pop(); new RegExp(\`abc\`, "g").test(item); }`,
    );
  });

  it("does not flag a no-argument `new RegExp()` in a loop", () => {
    expectPass(`for (const x of xs) { const re = new RegExp(); }`);
  });
});
