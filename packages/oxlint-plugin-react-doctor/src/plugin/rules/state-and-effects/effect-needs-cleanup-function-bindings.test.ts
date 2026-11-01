import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup function bindings", () => {
  it.each([
    ["discarded returned timer", "function start() { return setInterval(tick, 1000); } start();"],
    [
      "wrong returned timer cleanup",
      "function start() { return setInterval(tick, 1000); } const timer = start(); return () => clearInterval(other);",
    ],
    [
      "two timer allocations",
      "function start() { return setInterval(tick, 1000); } start(); const timer = start(); return () => clearInterval(timer);",
    ],
    [
      "conditional outer cleanup",
      "let timer; function start() { timer = setInterval(tick, 1000); } start(); return () => { if (ready) clearInterval(timer); };",
    ],
    [
      "async returned timer",
      "async function start() { return setInterval(tick, 1000); } const timer = start(); return () => clearInterval(timer);",
    ],
    ["direct call", "function start() { setInterval(tick, 1000); } start();"],
    ["hoisted call", "start(); function start() { setInterval(tick, 1000); }"],
    [
      "transitive call",
      "function start() { attach(); } function attach() { setInterval(tick, 1000); } start();",
    ],
    [
      "recursive call",
      "function start() { setInterval(tick, 1000); if (retry) start(); } start();",
    ],
    [
      "discarded disposer",
      "function start() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); } start();",
    ],
    [
      "second discarded disposer",
      "function start() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); } start(); return start();",
    ],
    [
      "wrong disposer",
      "function start() { const timer = setInterval(tick, 1000); return () => clearInterval(other); } return start();",
    ],
    [
      "conditional disposer",
      "function start() { const timer = setInterval(tick, 1000); if (ready) return () => clearInterval(timer); } return start();",
    ],
    [
      "async disposer",
      "async function start() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); } return start();",
    ],
    [
      "conditional clear",
      "function start() { const timer = setInterval(tick, 1000); if (ready) clearInterval(timer); } start();",
    ],
    [
      "wrong handle",
      "function start() { const timer = setInterval(tick, 1000); clearInterval(other); } start();",
    ],
    [
      "deferred clear",
      "function start() { const timer = setInterval(tick, 1000); queueMicrotask(() => clearInterval(timer)); } start();",
    ],
    [
      "async clear",
      "async function start() { const timer = setInterval(tick, 1000); await pending; clearInterval(timer); } start();",
    ],
    ["arrow helper", "const start = () => { setInterval(tick, 1000); }; start();"],
    [
      "opaque setup continuation",
      "const start = () => { const timer = setInterval(tick, 1000); opaque(); return () => clearInterval(timer); }; return start();",
    ],
    [
      "throwing setup getter",
      "const start = () => { const timer = setInterval(tick, 1000); state.throwingGetter; return () => clearInterval(timer); }; return start();",
    ],
    [
      "setup temporal dead zone",
      "const start = () => { const timer = setInterval(tick, 1000); pending; const pending = 1; return () => clearInterval(timer); }; return start();",
    ],
    [
      "opaque cleanup prefix",
      "const start = () => { const timer = setInterval(tick, 1000); return () => { opaque(); clearInterval(timer); }; }; return start();",
    ],
    [
      "overridden factory cleanup",
      "const start = () => { const timer = setInterval(tick, 1000); try { return () => clearInterval(timer); } finally { return () => {}; } }; return start();",
    ],
    [
      "overridden outer cleanup",
      "const start = () => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }; try { return start(); } finally { return () => {}; }",
    ],
  ])("reports a leaked timer through a %s", (_label, body) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Clock = () => {
  useEffect(() => { ${body} }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("setInterval");
  });

  it.each([
    [
      "outer stored timer cleanup",
      "let timer; function start() { timer = setInterval(tick, 1000); } start(); return () => clearInterval(timer);",
    ],
    [
      "hoisted returned disposer",
      "return start(); function start() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }",
    ],
    [
      "returned local timer cleanup",
      "function start() { const timer = setInterval(tick, 1000); return timer; } const timer = start(); return () => clearInterval(timer);",
    ],
    [
      "returned timer cleanup",
      "function start() { return setInterval(tick, 1000); } const timer = start(); return () => clearInterval(timer);",
    ],
    ["uncalled generator body", "function* start() { setInterval(tick, 1000); yield 1; } start();"],
    [
      "returned disposer",
      "function start() { const timer = setInterval(tick, 1000); return () => clearInterval(timer); } return start();",
    ],
    [
      "factory-prefix cleanup binding",
      "const start = () => { const cleanup = () => clearInterval(timer); const timer = setInterval(tick, 1000); return cleanup; }; return start();",
    ],
    [
      "returned block disposer",
      "const start = () => { const timer = setInterval(tick, 1000); return () => { clearInterval(timer); }; }; return start();",
    ],
    [
      "returned release expression",
      "const start = () => { const timer = setInterval(tick, 1000); return () => { return clearInterval(timer); }; }; return start();",
    ],
    [
      "cleared arrow helper",
      "const start = () => { const timer = setInterval(tick, 1000); clearInterval(timer); }; start();",
    ],
    ["uncalled helper", "function start() { setInterval(tick, 1000); }"],
    [
      "reassigned helper",
      "function start() { setInterval(tick, 1000); } start = () => {}; start();",
    ],
    [
      "shadowed helper",
      "function start() { setInterval(tick, 1000); } { const start = () => {}; start(); }",
    ],
    [
      "parameter shadow",
      "function start() { setInterval(tick, 1000); } ((start) => start())(() => {});",
    ],
    [
      "cleaned helper",
      "function start() { const timer = setInterval(tick, 1000); clearInterval(timer); } start();",
    ],
  ])("does not report a %s", (_label, body) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Clock = () => {
  useEffect(() => { ${body} }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not call an unreferenced block-scoped declaration", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Clock = () => {
  useEffect(() => {
    function start() {}
    { function start() { setInterval(tick, 1000); } }
    start();
  }, []);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("returned listener factory cleanup bindings", () => {
  it.each([
    ["const cleanup = () => document.removeEventListener('change', handler);", "", 0],
    ["", "const cleanup = () => document.removeEventListener('change', handler);", 1],
  ])("requires cleanup initialization before acquisition: %s %s", (before, after, count) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      function Screen() { useEffect(() => {
        ${before}
        const setup = () => { document.addEventListener('change', handler); return cleanup; };
        return setup();
        ${after}
      }, []); return null; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});

it("preserves helper-local handler and event declarations before registration", () => {
  const result = runRule(
    effectNeedsCleanup,
    `import { useEffect } from "react";
    function Screen() { useEffect(() => {
      const setup = () => {
        const handler = () => {};
        const event = 'resize';
        window.addEventListener(event, handler);
        return () => window.removeEventListener(event, handler);
      };
      return setup();
    }, []); return null; }`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("does not trust a factory that replaces the release provider", () => {
  const result = runRule(
    effectNeedsCleanup,
    `import { useEffect } from "react";
    function Screen() { useEffect(() => {
      const setup = () => {
        window.removeEventListener = () => {};
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
      };
      return setup();
    }, []); return null; }`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
});

it("does not trust an outer factory callback that replaces the release provider", () => {
  const result = runRule(
    effectNeedsCleanup,
    `import { useEffect } from "react";
    function Screen() { useEffect(() => {
      const setup = () => {
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
      };
      window.removeEventListener = () => {};
      return setup();
    }, []); return null; }`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
});
