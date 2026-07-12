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
    expectFail(`for (const line of lines) { const m = new RegExp("\\\\d+", "i"); m.test(line); }`);
  });

  it("does not flag a global RegExp whose lastIndex resets on every loop pass", () => {
    expectPass(`for (const line of lines) { const m = new RegExp("\\\\d+", "g"); m.test(line); }`);
  });

  it("does not flag global or sticky flag combinations", () => {
    for (const flags of ["g", "y", "gi", "my", "dgy"]) {
      expectPass(`for (const line of lines) { new RegExp("a", "${flags}").test(line); }`);
    }
  });

  it("does not flag stateful static template flags for call or constructor forms", () => {
    expectPass(`for (const line of lines) { RegExp("a", \`g\`).test(line); }`);
    expectPass(`for (const line of lines) { new RegExp(\`a\`, \`y\`).test(line); }`);
  });

  it("still flags stateless call and constructor forms", () => {
    expectFail(`for (const line of lines) { RegExp("a", "i").test(line); }`);
    expectFail(`for (const line of lines) { new RegExp("a", "m").test(line); }`);
    expectFail(`for (const line of lines) { new RegExp("a", "").test(line); }`);
  });

  it("does not recommend moving constructors that throw for invalid static flags", () => {
    expectPass(`for (const line of lines) { new RegExp("a", "gg").test(line); }`);
    expectPass(`for (const line of lines) { new RegExp("a", "q").test(line); }`);
    expectPass(`for (const line of lines) { new RegExp("a", "uv").test(line); }`);
  });

  it("uses inherited RegExp literal flags when constructor flags are omitted", () => {
    expectPass(`for (const line of lines) { new RegExp(/a/g).test(line); }`);
    expectPass(`for (const line of lines) { RegExp(/a/y).test(line); }`);
  });

  it("uses explicit constructor flags instead of RegExp literal flags", () => {
    expectFail(`for (const line of lines) { new RegExp(/a/g, "i").test(line); }`);
    expectFail(`for (const line of lines) { RegExp(/a/y, "").test(line); }`);
    expectPass(`for (const line of lines) { new RegExp(/a/i, "g").test(line); }`);
  });

  it("resolves transparent wrappers around the constructor and its arguments", () => {
    expectPass(
      `for (const line of lines) { (RegExp as typeof RegExp)(("a" as string), ("g" as string)).test(line); }`,
    );
    expectPass(`for (const line of lines) { new RegExp((/a/g as RegExp)).test(line); }`);
    expectFail(
      `for (const line of lines) { new (RegExp as typeof RegExp)(("a" as string), ("i" as string)).test(line); }`,
    );
  });

  it("does not assign global RegExp semantics to shadowed or reassigned bindings", () => {
    expectPass(
      `const CustomRegExp = class {}; let RegExp = CustomRegExp; RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i"); }`,
    );
    expectPass(
      `const scan = (RegExp) => { for (const line of lines) { return RegExp("a", "i"); } };`,
    );
    expectPass(
      `RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("stays quiet on stateful constructors across loop and callback control flow", () => {
    expectPass(`while (queue.length > 0) { new RegExp("a", "g").test(queue.pop()); }`);
    expectPass(`const matches = lines.map((line) => new RegExp("a", "y").test(line));`);
    expectPass(`for (;;) { if (condition) break; RegExp("a", "gy").test(value); }`);
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

  it("still flags an expression-free template-literal pattern with non-stateful flags", () => {
    expectFail(
      `while (queue.length > 0) { const item = queue.pop(); new RegExp(\`abc\`, "m").test(item); }`,
    );
  });

  it("does not flag a no-argument `new RegExp()` in a loop", () => {
    expectPass(`for (const x of xs) { const re = new RegExp(); }`);
  });

  // fn-mining sweep: `RegExp(...)` without `new` constructs a regex per
  // pass exactly like `new RegExp(...)` does.
  it("flags `RegExp(...)` called without `new` inside a for loop", () => {
    expectFail(
      `function count(lines) { let total = 0; for (const line of lines) { if (RegExp("^\\\\d+:").test(line)) total += 1; } return total; }`,
    );
  });

  it("does not flag a non-new `RegExp(loopVar)` whose pattern depends on the loop", () => {
    expectPass(
      `for (const keyword of keywords) { if (RegExp(keyword, "gi").test(text)) hits.push(keyword); }`,
    );
  });

  // fn-mining sweep: iterator callbacks run once per element — regex
  // construction there is per-pass work just like a `for` body.
  it("flags `new RegExp` inside a .map() callback", () => {
    expectFail(`const stripped = lines.map((line) => line.replace(new RegExp("^\\\\d+:"), ""));`);
  });

  it("does not flag `new RegExp` outside any loop or iterator callback", () => {
    expectPass(`const parse = (line) => new RegExp("^\\\\d+:").test(line);`);
  });
});
