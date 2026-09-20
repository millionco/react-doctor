import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const overlaySource = fs.readFileSync(
  new URL(
    "../../../../../fuzz/corpus/regressions/effect-needs-cleanup--replacement-timer-cleanup.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("effect-needs-cleanup replacement timer ownership", () => {
  it.each([
    { name: "event-only branch replacements", source: overlaySource },
    {
      name: "consecutive replacements with separate clears",
      source: overlaySource.replace(
        "scrollResetTimer = setTimeout(() => repositionCursor(null), 150);",
        `scrollResetTimer = setTimeout(() => repositionCursor(null), 150);
            clearTimeout(scrollResetTimer);
            scrollResetTimer = setTimeout(() => repositionCursor(null), 150);`,
      ),
    },
    {
      name: "transparent wrappers around release and assignment",
      source: overlaySource
        .replaceAll("clearTimeout(scrollResetTimer);", "(clearTimeout(scrollResetTimer));")
        .replaceAll(
          "scrollResetTimer = setTimeout(() => repositionCursor(null), 150);",
          "(scrollResetTimer = (setTimeout(() => repositionCursor(null), 150)));",
        ),
    },
    {
      name: "aliased effect imports",
      source: overlaySource
        .replace("{ useEffect }", "{ useEffect as useLifecycle }")
        .replace("useEffect(()", "useLifecycle(()"),
    },
    {
      name: "interval replacements with matching releases",
      source: overlaySource
        .replaceAll("setTimeout", "setInterval")
        .replaceAll("clearTimeout", "clearInterval"),
    },
  ])("accepts $name", ({ source }) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "missing final timer cleanup",
      source: overlaySource.replace("clearTimeout(scrollResetTimer);\n    };", "};"),
    },
    {
      name: "missing replacement clear in the selector branch",
      source: overlaySource.replace("clearTimeout(scrollResetTimer);", ""),
    },
    {
      name: "overwriting before clearing a replacement",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);\n            scrollResetTimer = setTimeout(() => repositionCursor(null), 150);",
        "scrollResetTimer = setTimeout(() => repositionCursor(null), 150);\n            clearTimeout(scrollResetTimer);",
      ),
    },
    {
      name: "reusing one clear for two consecutive allocations",
      source: overlaySource.replace(
        "scrollResetTimer = setTimeout(() => repositionCursor(null), 150);",
        "scrollResetTimer = setTimeout(() => repositionCursor(null), 150);\n            scrollResetTimer = setTimeout(() => repositionCursor(null), 150);",
      ),
    },
    {
      name: "conditional final cleanup",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);\n    };",
        "if (selector) clearTimeout(scrollResetTimer);\n    };",
      ),
    },
    {
      name: "an uncalled nested callback containing the final clear",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);\n    };",
        "const cancel = () => clearTimeout(scrollResetTimer);\n    };",
      ),
    },
    {
      name: "deferred final cleanup",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);\n    };",
        "queueMicrotask(() => clearTimeout(scrollResetTimer));\n    };",
      ),
    },
    {
      name: "a listener left registered after unmount",
      source: overlaySource.replace('window.removeEventListener("resize", reposition);', ""),
    },
    {
      name: "clearing a different handle before replacement",
      source: overlaySource.replace("clearTimeout(scrollResetTimer);", "clearTimeout(otherTimer);"),
    },
    {
      name: "shadowed timer release",
      source: overlaySource.replace(
        "let scrollResetTimer:",
        "const clearTimeout = () => {};\n    let scrollResetTimer:",
      ),
    },
    {
      name: "a nested function containing the replacement clear",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);",
        "const cancel = () => clearTimeout(scrollResetTimer);",
      ),
    },
    {
      name: "replacement clear on only one branch",
      source: overlaySource.replace(
        "clearTimeout(scrollResetTimer);",
        "if (enabled) clearTimeout(scrollResetTimer);",
      ),
    },
    {
      name: "missing cleanup on one effect exit",
      source: overlaySource.replace("return () => {", "if (selector) return;\n    return () => {"),
    },
    {
      name: "a callback escaping to an unknown scheduler",
      source: overlaySource.replace(
        'window.addEventListener("resize", reposition);',
        'window.addEventListener("resize", reposition);\n    scheduleLater(reposition);',
      ),
    },
    {
      name: "a callback that can resume after teardown",
      source: overlaySource
        .replace("const reposition = () => {", "const reposition = async () => {")
        .replace("if (selector) {", "await Promise.resolve();\n      if (selector) {"),
    },
  ])("reports $name", ({ source }) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
