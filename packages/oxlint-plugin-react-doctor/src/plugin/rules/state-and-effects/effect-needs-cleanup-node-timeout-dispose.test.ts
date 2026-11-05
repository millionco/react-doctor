import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("native Node Timeout disposal", () => {
  it.each([
    ["setInterval", "timer[Symbol.dispose]()"],
    ["setTimeout", "timer[Symbol.dispose]()"],
    ["setInterval", "{ timer[Symbol.dispose](); }"],
    ["setInterval", "{ return timer[Symbol.dispose](); }"],
  ])("accepts a single %s released by %s", (scheduler, cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { ${scheduler} } from "node:timers";
       import { useEffect } from "react";
       const Clock = () => {
         useEffect(() => {
           const timer = ${scheduler}(() => refresh(), 1000);
           return () => ${cleanup};
         }, []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "wrong handle",
      "const other = {};",
      "const timer = setInterval(() => refresh(), 1000); return () => other[Symbol.dispose]();",
    ],
    [
      "shadowed symbol",
      "const Symbol = { dispose: key };",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]();",
    ],
    [
      "replaced global Symbol",
      "globalThis.Symbol = fake;",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]();",
    ],
    [
      "opaque global alias",
      "const holder = { host: globalThis }; holder.host.Symbol = fake;",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]();",
    ],
    [
      "alternate realm",
      "document.defaultView.Symbol = fake;",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]();",
    ],
    [
      "handle mutation",
      "",
      "const timer = setInterval(() => refresh(), 1000); timer[Symbol.dispose] = () => {}; return () => timer[Symbol.dispose]();",
    ],
    [
      "timer passed as this",
      "",
      "const timer = setInterval(function () { this[Symbol.dispose] = () => {}; }, 1000); return () => timer[Symbol.dispose]();",
    ],
    [
      "escaped handle",
      "",
      "const timer = setInterval(() => refresh(), 1000); expose(timer); return () => timer[Symbol.dispose]();",
    ],
    [
      "optional disposal",
      "",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]?.();",
    ],
    [
      "throwing argument",
      "",
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose](throwNow());",
    ],
    [
      "skipped cleanup path",
      "",
      "const timer = setInterval(() => refresh(), 1000); if (enabled) return; return () => timer[Symbol.dispose]();",
    ],
    [
      "mutable builtin exports",
      'import timers from "node:timers"; import { syncBuiltinESMExports as sync } from "node:module"; timers.setInterval = fake; sync();',
      "const timer = setInterval(() => refresh(), 1000); return () => timer[Symbol.dispose]();",
    ],
  ])("does not accept unproven disposal: %s", (_label, preamble, effectBody) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { setInterval } from "node:timers";
       import { useEffect } from "react";
       ${preamble}
       const Clock = () => {
         useEffect(() => { ${effectBody} }, []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["window.setInterval", "setInterval"])(
    "does not accept %s as a proven Node handle",
    (schedule) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
       const Clock = () => {
         useEffect(() => {
           const timer = ${schedule}(() => refresh(), 1000);
           return () => timer[Symbol.dispose]();
         }, []);
         return null;
       };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not assume a manually invoked setup is owned by React", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { setInterval } from "node:timers";
       import { useEffect } from "react";
       const Clock = () => {
         const setup = () => {
           const timer = setInterval(() => refresh(), 1000);
           return () => timer[Symbol.dispose]();
         };
         setup();
         useEffect(setup, []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
