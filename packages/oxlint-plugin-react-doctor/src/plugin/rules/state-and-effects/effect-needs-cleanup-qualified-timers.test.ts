import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("qualified native timers", () => {
  it.each([
    "setInterval",
    "globalThis.setInterval",
    'globalThis["setInterval"]',
    "window.setInterval",
    "self.setInterval",
    "global.setInterval",
    "(globalThis as typeof globalThis).setInterval",
    "setTimeout",
    "globalThis.setTimeout",
  ])("reports an effect timer without cleanup: %s", (allocate) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => { ${allocate}(refresh, 1000); }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(
      allocate.includes("Timeout") ? "setTimeout" : "setInterval",
    );
  });

  it.each([
    "setInterval",
    "globalThis.setInterval",
    'globalThis["setInterval"]',
    "window.setInterval",
    "self.setInterval",
  ])("reports a retained handler that discards an interval: %s", (allocate) => {
    const result = runRule(
      effectNeedsCleanup,
      `const Clock = () => <button onClick={() => { ${allocate}(refresh, 1000); }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["globalThis.setInterval", "clearInterval"],
    ["setInterval", "globalThis.clearInterval"],
    ["globalThis.setInterval", "globalThis.clearInterval"],
    ['globalThis["setInterval"]', 'globalThis["clearInterval"]'],
    ["window.setInterval", "window.clearInterval"],
    ["self.setInterval", "self.clearInterval"],
    ["global.setInterval", "global.clearInterval"],
    ["globalThis.setInterval", "globalThis.clearTimeout"],
    ["globalThis.setTimeout", "globalThis.clearInterval"],
  ])("accepts %s released with %s", (allocate, release) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => {
          const timer = ${allocate}(refresh, 1000);
          return () => ${release}(timer);
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["globalThis", "window", "self", "global", "scheduler"])(
    "ignores timer methods on a local receiver: %s",
    (receiver) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
        const Clock = (${receiver}) => {
          useEffect(() => { ${receiver}.setInterval(refresh, 1000); }, []);
          return <button onClick={() => { ${receiver}.setInterval(refresh, 1000); }} />;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    "return () => globalThis.clearInterval(otherTimer);",
    "return () => { if (enabled) globalThis.clearInterval(timer); };",
    "const globalThis = scheduler; return () => globalThis.clearInterval(timer);",
    "return () => scheduler.clearInterval(timer);",
    'const method = "clearInterval"; return () => globalThis[method](timer);',
  ])("rejects incomplete or unproven cleanup: %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => {
          const timer = window.setInterval(refresh, 1000);
          ${cleanup}
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not attribute an uncalled local callback to its effect", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => { const start = () => globalThis.setInterval(refresh, 1000); }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["setInterval", "globalThis.setInterval"])(
    "tracks resources owned by a native timer callback: %s",
    (allocate) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
        const Clock = () => {
          useEffect(() => {
            const timer = ${allocate}(() => { ${allocate}(refresh, 1000); }, 1000);
            return () => globalThis.clearInterval(timer);
          }, []);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    "const scheduler = globalThis;",
    "const scheduler = window;",
    "const browser = globalThis; const scheduler = browser;",
    "const { window: scheduler } = globalThis;",
  ])("recognizes an existing proven global receiver alias: %s", (alias) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      ${alias}
      const Clock = () => {
        useEffect(() => { scheduler.setInterval(refresh, 1000); }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const scheduler = globalThis; return () => scheduler.clearInterval(timer);",
    "return () => (globalThis as typeof globalThis).clearInterval(timer);",
  ])("accepts proven qualified cleanup through wrappers and aliases: %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => {
          const timer = globalThis.setInterval(refresh, 1000);
          ${cleanup}
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "timers.forEach(globalThis.clearInterval)",
    "timers.forEach((timer) => globalThis.clearTimeout(timer))",
  ])("accepts qualified exhaustive collection cleanup: %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
      const Clock = () => {
        useEffect(() => {
          const timers = [globalThis.setInterval(refresh, 1000), window.setInterval(refresh, 1000)];
          return () => { ${cleanup}; };
        }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["clearInterval", "globalThis.clearInterval", "self.clearTimeout"])(
    "finds retained handle cleanup in another handler: %s",
    (release) => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useRef } from "react";
        const Clock = () => {
          const timer = useRef(null);
          const start = () => { timer.current = globalThis.setInterval(refresh, 1000); };
          const stop = () => ${release}(timer.current);
          return <><button onClick={start} /><button onClick={stop} /></>;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );
  it.each([
    ["globalThis.setInterval = () => 0;", "globalThis"],
    ["Object.assign(globalThis, {setInterval: () => 0});", "globalThis"],
    ["Object.defineProperty(globalThis, 'setInterval', {value: () => 0});", "globalThis"],
    ["const method = 'setInterval'; globalThis[method] = () => 0;", "globalThis"],
    ["const scheduler = globalThis; scheduler.setInterval = () => 0;", "scheduler"],
    ["const scheduler = window; scheduler.setInterval = () => 0;", "globalThis"],
    ["delete globalThis.setInterval;", "globalThis"],
    ["globalThis.setInterval++;", "globalThis"],
  ])("does not claim an overridden qualified allocator is native: %s", (setup, receiver) => {
    const result = runRule(
      effectNeedsCleanup,
      `import {useEffect} from "react";
      ${setup}
      const Clock = () => { useEffect(() => { ${receiver}.setInterval(refresh, 1000); }, []); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "globalThis.clearInterval = () => {};",
    "Object.assign(globalThis, {clearInterval: () => {}});",
    "Object.defineProperty(globalThis, 'clearInterval', {value: () => {}});",
    "const method = 'clearInterval'; globalThis[method] = () => {};",
    "const scheduler = globalThis; scheduler.clearInterval = () => {};",
    "delete globalThis.clearInterval;",
    "globalThis.clearInterval++;",
  ])("does not trust an overridden qualified cleanup: %s", (setup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import {useEffect} from "react";
      ${setup}
      const Clock = () => { useEffect(() => {
        const timer = globalThis.setInterval(refresh, 1000);
        return () => globalThis.clearInterval(timer);
      }, []); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const scheduler = globalThis; scheduler.unrelated = () => 0;",
    "Object.assign(globalThis, {unrelated: () => 0});",
    "const Object = {assign: () => {}}; Object.assign(globalThis, {setInterval: () => 0});",
    "function custom(globalThis) { globalThis.setInterval = () => 0; }",
  ])("preserves native allocation despite unrelated or shadowed writes: %s", (setup) => {
    const result = runRule(
      effectNeedsCleanup,
      `import {useEffect} from "react";
      ${setup}
      const Clock = () => { useEffect(() => { globalThis.setInterval(refresh, 1000); }, []); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not prove a reassigned namespace alias", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import {useEffect} from "react";
      let scheduler = globalThis; scheduler = customScheduler;
      const Clock = () => { useEffect(() => { scheduler.setInterval(refresh, 1000); }, []); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
