import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("undefined fallback in native timeout cleanup", () => {
  const sourceWithCleanup = (effect: string, prelude = "") => `
    import { useEffect } from "react";
    ${prelude}

    function Timer({ onTick, enabled, other }) {
      useEffect(() => {
        ${effect}
      }, [onTick, enabled, other]);
      return null;
    }
  `;

  it.each(["clearTimeout", "window.clearTimeout", 'globalThis["clearTimeout"]'])(
    "recognizes direct cleanup with %s",
    (clearer) => {
      const result = runRule(
        effectNeedsCleanup,
        sourceWithCleanup(`
          const handle = setTimeout(onTick, 100);
          return () => ${clearer}(handle ?? undefined);
        `),
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    "const host = { scheduler: globalThis }; host.scheduler.clearTimeout = () => {};",
    "[globalThis.clearTimeout] = [() => {}];",
  ])("preserves the warning when the global clearer is replaced", (prelude) => {
    const result = runRule(
      effectNeedsCleanup,
      sourceWithCleanup(
        `
        const handle = setTimeout(onTick, 100);
        return () => clearTimeout(handle ?? undefined);
      `,
        prelude,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "return () => clearTimeout(other ?? undefined);",
    "return () => { if (enabled) clearTimeout(handle ?? undefined); };",
    "return async () => { await Promise.resolve(); clearTimeout(handle ?? undefined); };",
    "return () => { if (enabled) throw new Error(); clearTimeout(handle ?? undefined); };",
    "return () => { queueMicrotask(() => clearTimeout(handle ?? undefined)); };",
    "return () => { const clearTimeout = () => {}; clearTimeout(handle ?? undefined); };",
    "return () => { globalThis.clearTimeout = () => {}; clearTimeout(handle ?? undefined); };",
    "if (enabled) return; return () => clearTimeout(handle ?? undefined);",
  ])("preserves the warning for %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      sourceWithCleanup(`const handle = setTimeout(onTick, 100); ${cleanup}`),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
  });
});
