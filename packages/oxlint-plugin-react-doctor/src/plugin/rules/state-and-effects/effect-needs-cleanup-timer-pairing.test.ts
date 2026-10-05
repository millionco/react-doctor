import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("shared timeout and interval handle cleanup", () => {
  it.each([
    ["setInterval", "clearTimeout"],
    ["setTimeout", "clearInterval"],
  ])("accepts %s released with %s", (allocate, release) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Clock = () => { useEffect(() => {
        const timer = ${allocate}(() => update(), 100);
        return () => ${release}(timer);
      }, []); return null; };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts exhaustive collection cleanup with the other timer API", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Clock = () => { useEffect(() => {
        const timers = [setInterval(update, 100), setInterval(update, 200)];
        return () => timers.forEach(clearTimeout);
      }, []); return null; };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "timers.reduce((count, timer) => { clearTimeout(timer); return count + 1; }, 0)",
    "Array.from(timers, (timer) => { clearTimeout(timer); })",
  ])("preserves collection callback cleanup: %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Clock = () => { useEffect(() => {
        const timers = [setInterval(update, 100), setInterval(update, 200)];
        return () => { ${cleanup}; };
      }, []); return null; };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "return () => clearTimeout(other);",
    "return () => { if (enabled) clearTimeout(timer); };",
    "const clearTimeout = () => {}; return () => clearTimeout(timer);",
  ])("retains reports for incomplete or invalid release: %s", (cleanup) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Clock = () => { useEffect(() => {
        const timer = setInterval(update, 100);
        ${cleanup}
      }, []); return null; };
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
