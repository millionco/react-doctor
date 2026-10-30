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

describe("synchronous disposer named callback ownership", () => {
  const namedDisposer = synchronousDisposer.replace(
    "useEffect(() => {",
    "useEffect(function registerPolling() {",
  );

  it.each([
    ["an unused internal name", namedDisposer],
    [
      "a shadowed callback name",
      namedDisposer.replace(
        "setInterval(() => {},",
        "setInterval(() => { const registerPolling = () => {}; registerPolling(); },",
      ),
    ],
    [
      "a separately named timer callback",
      namedDisposer.replace("setInterval(() => {},", "setInterval(function tick() {},"),
    ],
  ])("accepts %s", (_description, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "direct registration reentry from the timer",
      namedDisposer.replace(
        "setInterval(() => {},",
        "setInterval(() => { if (ready) registerPolling(); },",
      ),
    ],
    [
      "registration escape from the timer",
      namedDisposer.replace("setInterval(() => {},", "setInterval(() => retain(registerPolling),"),
    ],
    [
      "registration alias reentry from the timer",
      namedDisposer.replace(
        "setInterval(() => {},",
        "setInterval(() => { const registerAgain = registerPolling; registerAgain(); },",
      ),
    ],
    [
      "registration retained in a nested callback",
      namedDisposer.replace(
        "setInterval(() => {},",
        "setInterval(() => retain(() => registerPolling()),",
      ),
    ],
  ])("retains the warning for %s", (_description, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("synchronous disposer harmless named callback references", () => {
  const namedDisposer = synchronousDisposer.replace(
    "useEffect(() => {",
    "useEffect(function registerPolling() {",
  );

  it.each([
    ["a literal-false reentry", "if (false) registerPolling();"],
    ["a literal-true alternate", "if (true) {} else registerPolling();"],
    ["an unselected conditional", "false ? registerPolling() : undefined;"],
    ["a short-circuited conjunction", "false && registerPolling();"],
    ["a short-circuited disjunction", "true || registerPolling();"],
    ["an unentered while body", "while (false) registerPolling();"],
    ["an unentered for body", "for (; false;) registerPolling();"],
    ["the callback name", "void registerPolling.name;"],
    ["the callback length", "void registerPolling.length;"],
    ["the callback typeof", "void typeof registerPolling;"],
    ["a static computed metadata key", 'void registerPolling["name"];'],
    [
      "metadata in a computed destructuring key",
      "const source = {}; let value; ({ [registerPolling.name]: value } = source);",
    ],
    [
      "metadata in a destructuring default",
      "const source = {}; let value; ({ value = registerPolling.name } = source);",
    ],
    [
      "a dead metadata override",
      'if (false) registerPolling.name = "ignored"; void registerPolling.name;',
    ],
  ])("accepts %s", (_description, timerBody) => {
    const source = namedDisposer.replace(
      "setInterval(() => {},",
      `setInterval(() => { ${timerBody} },`,
    );
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["metadata assignment", 'registerPolling.name = "poll";'],
    ["metadata update", "registerPolling.length++;"],
    ["metadata deletion", "delete registerPolling.name;"],
    ["an array destructuring write", "[registerPolling.name] = source;"],
    ["an object destructuring write", "({ value: registerPolling.name } = source);"],
    ["an array rest write", "[...registerPolling.name] = source;"],
    ["an object rest write", "({ ...registerPolling.name } = source);"],
    ["a destructuring default target", '[registerPolling.name = "poll"] = source;'],
    ["a for-in target", "for (registerPolling.name in source) {}"],
    ["a for-of target", "for (registerPolling.name of source) {}"],
    ["a called metadata value", "registerPolling.name();"],
    ["an optional metadata call", "registerPolling.name?.();"],
    ["a constructed metadata value", "new registerPolling.name();"],
    ["tagged metadata", "registerPolling.name`poll`;"],
    ["a callback receiver escape", "registerPolling.call(null);"],
    [
      "a callback property override",
      'Object.defineProperty(registerPolling, "name", { get: () => registerPolling() }); void registerPolling.name;',
    ],
    ["a live finalizer reentry", "try { return; } finally { registerPolling(); }"],
    ["an unknown computed reference", "void registerPolling[key];"],
    ["a prototype read", "void registerPolling.prototype;"],
    [
      "a deferred declaration inside a dead branch",
      "if (false) { function retained() { registerPolling(); } } retained();",
    ],
    [
      "a named function metadata initializer",
      "const namedAgain = registerPolling; void namedAgain.name;",
    ],
  ])("retains the warning for %s", (_description, timerBody) => {
    const source = namedDisposer.replace(
      "setInterval(() => {},",
      `setInterval(() => { ${timerBody} },`,
    );
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("synchronous disposer literal representation controls", () => {
  const namedDisposer = synchronousDisposer.replace(
    "useEffect(() => {",
    "useEffect(function registerPolling() {",
  );

  it.each([
    ["a numeric-zero if body", "if (0) registerPolling();"],
    ["a zero-BigInt if body", "if (0n) registerPolling();"],
    ["an unselected BigInt conditional", "0n ? registerPolling() : undefined;"],
    ["a regular-expression alternate", "if (/x/) {} else registerPolling();"],
    ["a regular-expression disjunction", "/x/ || registerPolling();"],
    ["a zero-BigInt while loop", "while (0n) { registerPolling(); break; }"],
    ["a zero-BigInt for loop", "for (; 0n;) { registerPolling(); break; }"],
    ["a zero-BigInt conjunction", "0n && registerPolling();"],
    ["a nonzero-BigInt disjunction", "1n || registerPolling();"],
    ["a hexadecimal zero-BigInt conjunction", "0x0n && registerPolling();"],
  ])("accepts %s", (_description, timerBody) => {
    const source = namedDisposer.replace(
      "setInterval(() => {},",
      `setInterval(() => { ${timerBody} },`,
    );
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["a regular-expression while loop", "while (/x/) { registerPolling(); break; }"],
    ["a regular-expression for loop", "for (; /x/;) { registerPolling(); break; }"],
    ["a regular-expression conjunction", "/x/ && registerPolling();"],
    ["a zero-BigInt disjunction", "0n || registerPolling();"],
    ["a nonzero-BigInt while loop", "while (1n) { registerPolling(); break; }"],
    ["a nonzero-BigInt for loop", "for (; 1n;) { registerPolling(); break; }"],
    ["a nonzero-BigInt conjunction", "1n && registerPolling();"],
    ["a hexadecimal nonzero-BigInt conjunction", "0x1n && registerPolling();"],
  ])("retains the warning for %s", (_description, timerBody) => {
    const source = namedDisposer.replace(
      "setInterval(() => {},",
      `setInterval(() => { ${timerBody} },`,
    );
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("synchronous disposer closed cleanup helpers", () => {
  const callbacks = [
    ["anonymous", synchronousDisposer],
    [
      "dead named reference",
      synchronousDisposer
        .replace("useEffect(() => {", "useEffect(function registerPolling() {")
        .replace("setInterval(() => {},", "setInterval(() => { if (false) registerPolling(); },"),
    ],
    [
      "named metadata read",
      synchronousDisposer
        .replace("useEffect(() => {", "useEffect(function registerPolling() {")
        .replace("setInterval(() => {},", "setInterval(() => { void registerPolling.name; },"),
    ],
  ];
  const acceptedCleanups = [
    ["one helper", "const cleanup = () => release(); return () => cleanup();"],
    [
      "two helpers",
      "const disconnect = () => release(); const cleanup = () => disconnect(); return () => cleanup();",
    ],
    ["expression blocks", "const cleanup = () => { release(); }; return () => { cleanup(); };"],
    [
      "return blocks",
      "const cleanup = () => { return release(); }; return () => { return cleanup(); };",
    ],
  ];
  const unsupportedCleanups = [
    ["uncalled helper", "const cleanup = () => release(); return () => {};"],
    [
      "conditional wrapper",
      "const cleanup = () => release(); return () => { if (enabled) cleanup(); };",
    ],
    [
      "conditional helper",
      "const cleanup = () => { if (enabled) release(); }; return () => cleanup();",
    ],
    [
      "conditional return",
      "const cleanup = () => release(); return () => { if (enabled) return cleanup(); };",
    ],
    [
      "early return",
      "const cleanup = () => release(); return () => { if (enabled) return; cleanup(); };",
    ],
    [
      "throw before cleanup",
      "const cleanup = () => release(); return () => { throw new Error('stop'); cleanup(); };",
    ],
    ["deferred call", "const cleanup = () => release(); return () => queueMicrotask(cleanup);"],
    [
      "async helper",
      "const cleanup = async () => { await ready; release(); }; return () => cleanup();",
    ],
    [
      "mutated helper",
      "let cleanup = () => release(); cleanup = () => {}; return () => cleanup();",
    ],
    [
      "escaped helper",
      "const cleanup = () => release(); publish(cleanup); return () => cleanup();",
    ],
    ["helper declared after return", "return () => cleanup(); const cleanup = () => release();"],
    [
      "unused pure declaration",
      "const unused = () => {}; const cleanup = () => release(); return () => cleanup();",
    ],
    ["extra setup call", "const cleanup = () => release(); mayThrow(); return () => cleanup();"],
    [
      "extra helper statement",
      "const cleanup = () => { release(); publish(); }; return () => cleanup();",
    ],
    ["recursive helper", "const cleanup = () => cleanup(); return () => cleanup();"],
    [
      "mutual recursion",
      "const disconnect = () => cleanup(); const cleanup = () => disconnect(); return () => cleanup();",
    ],
    ["member call", "const cleanup = () => release(); return () => cleanup.call(null);"],
    ["helper argument", "const cleanup = () => release(); return () => cleanup(null);"],
    ["optional helper call", "const cleanup = () => release(); return () => cleanup?.();"],
    [
      "shadowed helper",
      "const cleanup = () => release(); return () => { const cleanup = () => {}; cleanup(); };",
    ],
    [
      "slot overwrite",
      "const cleanup = () => release(); release = () => {}; return () => cleanup();",
    ],
    [
      "direct eval",
      "const cleanup = () => release(); eval('release = () => {}'); return () => cleanup();",
    ],
  ];
  for (const [callbackName, callbackSource] of callbacks) {
    describe(callbackName, () => {
      it.each(acceptedCleanups)("accepts %s", (_name, cleanup) => {
        const result = runRule(
          effectNeedsCleanup,
          callbackSource.replace("return () => release();", cleanup),
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });
      it.each(unsupportedCleanups)("does not certify %s", (_name, cleanup) => {
        const result = runRule(
          effectNeedsCleanup,
          callbackSource.replace("return () => release();", cleanup),
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      });
    });
  }
});
