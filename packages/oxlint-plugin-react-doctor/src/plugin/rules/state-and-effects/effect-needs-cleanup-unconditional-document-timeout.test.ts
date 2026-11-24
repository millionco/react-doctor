import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const source = `
import { useEffect } from "react";

const Panel = ({ enabled }) => {
  useEffect(() => {
    if (!enabled) return;
    const onResize = () => console.log("resize");
    const timeout = setTimeout(() => {
      document.addEventListener("resize", onResize);
    }, 20);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("resize", onResize);
    };
  }, [enabled]);
  return null;
};
`;

const withCapture = (registration: string, release: string): string =>
  source
    .replace(
      'addEventListener("resize", onResize)',
      `addEventListener("resize", onResize${registration})`,
    )
    .replace(
      'removeEventListener("resize", onResize)',
      `removeEventListener("resize", onResize${release})`,
    );

describe("unconditional cleanup of deferred Document listeners", () => {
  it.each([
    ["direct receiver", source],
    ["equal explicit capture", withCapture(", true", ", true")],
    ["equal explicit non-capture", withCapture(", false", ", false")],
    ["default registration capture", withCapture("", ", false")],
    ["default removal capture", withCapture(", false", "")],
    [
      "guarded explicit capture",
      withCapture(", true", ", true")
        .replace("const timeout", "let attached = false; const timeout")
        .replace("document.addEventListener", "attached = true; document.addEventListener")
        .replace("document.removeEventListener", "if (attached) document.removeEventListener"),
    ],
    [
      "immutable receiver alias",
      source
        .replace("const onResize", "const target = document; const onResize")
        .replaceAll("document.addEventListener", "target.addEventListener")
        .replaceAll("document.removeEventListener", "target.removeEventListener"),
    ],
    [
      "expression-body timeout",
      source.replace(
        '() => {\n      document.addEventListener("resize", onResize);\n    }',
        '() => document.addEventListener("resize", onResize)',
      ),
    ],
  ])("accepts %s with guaranteed cancellation and release", (_name, fixture) => {
    const result = runRule(effectNeedsCleanup, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["missing cancellation", source.replace("clearTimeout(timeout);", "")],
    ["opposite explicit capture", withCapture(", true", ", false")],
    ["unverified options object", withCapture(", { capture: true }", ", true")],
    ["capture from a parameter", withCapture(", enabled", ", enabled")],
    ["extra argument evaluation", withCapture(", true, mightThrow()", ", true")],
    ["incorrect cancellation", source.replace("clearTimeout(timeout)", "clearTimeout(other)")],
    ["wrong realm", source.replace("clearTimeout(timeout)", "frame.clearTimeout(timeout)")],
    [
      "different target",
      source.replace("document.removeEventListener", "document.body.removeEventListener"),
    ],
    [
      "different event",
      source.replace('removeEventListener("resize"', 'removeEventListener("focus"'),
    ],
    [
      "different listener",
      source.replace(
        'removeEventListener("resize", onResize)',
        'removeEventListener("resize", anotherCallback)',
      ),
    ],
    [
      "different capture flag",
      source.replace(
        'removeEventListener("resize", onResize)',
        'removeEventListener("resize", onResize, true)',
      ),
    ],
    [
      "interrupted cleanup",
      source.replace("clearTimeout(timeout);", "clearTimeout(timeout); mightThrow();"),
    ],
    [
      "unrelated release guard",
      source.replace("document.removeEventListener", "if (enabled) document.removeEventListener"),
    ],
    [
      "extra scheduled work",
      source.replace(
        'addEventListener("resize", onResize);',
        'addEventListener("resize", onResize); unknownWork();',
      ),
    ],
    [
      "event exposes its target",
      source.replace(
        '() => console.log("resize")',
        "(event) => { event.currentTarget.removeEventListener = replacement; }",
      ),
    ],
  ])("retains the warning for %s", (_name, fixture) => {
    const result = runRule(effectNeedsCleanup, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
