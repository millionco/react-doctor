import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const synchronousDisposer = `
import { useEffect } from "react";

export const Polling = ({ ready }) => {
  useEffect(() => {
    let release = () => {};
    void (async () => {
      const timer = setInterval(() => {}, 1000);
      release = () => clearInterval(timer);
      await ready;
    })();
    return () => release();
  }, [ready]);
  return null;
};
`;

describe("effect-needs-cleanup synchronous disposer publication", () => {
  it.each([
    ["a synchronous prefix", synchronousDisposer],
    [
      "a named React import alias",
      synchronousDisposer
        .replaceAll("useEffect", "useAfterRender")
        .replace(
          'import { useAfterRender } from "react";',
          'import { useEffect as useAfterRender } from "react";',
        ),
    ],
    ["a direct invocation", synchronousDisposer.replace("void (async", "(async")],
    [
      "an empty function initializer",
      synchronousDisposer.replace("let release = () => {};", "let release = function () {};"),
    ],
    [
      "parenthesized publication",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);",
        "release = (() => clearInterval(timer));",
      ),
    ],
    [
      "a compatible native timer release",
      synchronousDisposer.replace("clearInterval(timer)", "clearTimeout(timer)"),
    ],
  ])("accepts %s before the first suspension", (_name, code) => {
    const result = runRule(effectNeedsCleanup, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "publication after await",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);\n      await ready;",
        "await ready;\n      release = () => clearInterval(timer);",
      ),
    ],
    [
      "allocation after await",
      synchronousDisposer.replace(
        "const timer = setInterval(() => {}, 1000);",
        "await ready;\n      const timer = setInterval(() => {}, 1000);",
      ),
    ],
    [
      "suspension in an allocation argument",
      synchronousDisposer.replace("1000);", "await ready);"),
    ],
    [
      "a getter before publication",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);",
        "const ignored = source.value;\n      release = () => clearInterval(timer);",
      ),
    ],
    [
      "a setup call before returning cleanup",
      synchronousDisposer.replace(
        "return () => release();",
        "mayThrow();\n    return () => release();",
      ),
    ],
    [
      "the wrong release API",
      synchronousDisposer.replace("clearInterval(timer)", "cancelAnimationFrame(timer)"),
    ],
    [
      "a shadowed release API",
      synchronousDisposer.replace("({ ready })", "({ ready, clearInterval })"),
    ],
    [
      "an opaque handle transformation",
      synchronousDisposer.replace("clearInterval(timer)", "clearInterval(transform(timer))"),
    ],
    [
      "an empty published disposer",
      synchronousDisposer.replace("release = () => clearInterval(timer);", "release = () => {};"),
    ],
    [
      "a conditional publication",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);",
        "if (enabled) release = () => clearInterval(timer);",
      ),
    ],
    [
      "a storage overwrite",
      synchronousDisposer.replace("await ready;", "await ready;\n      release = () => {};"),
    ],
    [
      "storage passed to an unknown owner",
      synchronousDisposer.replace(
        "return () => release();",
        "publish(release);\n    return () => release();",
      ),
    ],
    [
      "an escaped handle",
      synchronousDisposer.replace("await ready;", "publish(timer);\n      await ready;"),
    ],
    [
      "a reassigned handle",
      synchronousDisposer
        .replace("const timer =", "let timer =")
        .replace("await ready;", "await ready;\n      timer = 0;"),
    ],
    [
      "a shadowed cleanup parameter",
      synchronousDisposer.replace("return () => release();", "return (release) => release();"),
    ],
    [
      "a cleanup argument getter",
      synchronousDisposer.replace("return () => release();", "return () => release(source.value);"),
    ],
    [
      "an additional release argument",
      synchronousDisposer.replace("clearInterval(timer)", "clearInterval(timer, mayThrow())"),
    ],
    [
      "reflective storage mutation in the await operand",
      synchronousDisposer.replace("await ready;", 'await eval("release = () => {}");'),
    ],
    [
      "reflective storage mutation in the timer callback",
      synchronousDisposer.replace(
        "setInterval(() => {},",
        'setInterval(() => eval("release = () => {}"),',
      ),
    ],
    [
      "a generator effect callback",
      synchronousDisposer.replace("useEffect(() => {", "useEffect(function* () {"),
    ],
    ["an opaque delay expression", synchronousDisposer.replace("1000);", "source.delay);")],
    [
      "a different published binding",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);",
        "let release = () => clearInterval(timer);",
      ),
    ],
    [
      "two resources in the async owner",
      synchronousDisposer.replace(
        "release = () => clearInterval(timer);",
        "const other = setInterval(() => {}, 2000);\n      release = () => { clearInterval(timer); clearInterval(other); };",
      ),
    ],
    [
      "another invocation in setup",
      synchronousDisposer.replace(
        "return () => release();",
        "startAgain();\n    return () => release();",
      ),
    ],
  ])("retains the warning for %s", (_name, code) => {
    const result = runRule(effectNeedsCleanup, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves abstention for an unknown callback owner", () => {
    const code = synchronousDisposer
      .replace("void (async () => {", "defer(async () => {")
      .replace("    })();", "    });");
    expect(runRule(effectNeedsCleanup, code).diagnostics).toEqual([]);
  });

  it("keeps the post-await guarded storage profile outside this certificate", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
const Polling = ({ ready }) => {
  useEffect(() => {
    let disposed = false;
    let release = () => {};
    void (async () => {
      await ready;
      if (disposed) return;
      const timer = setInterval(() => {}, 1000);
      release = () => clearInterval(timer);
    })();
    return () => { disposed = true; release(); };
  }, [ready]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
