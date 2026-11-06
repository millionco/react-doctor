import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const source = readFileSync(
  new URL(
    "../../../../../fuzz/corpus/regressions/effect-needs-cleanup--render-written-timer-callback-ref.tsx",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("effect-needs-cleanup render-written timer callback refs", () => {
  it.each([
    source,
    source
      .replace("useCallback, useEffect, useRef", "useCallback as memo, useEffect, useRef as ref")
      .replaceAll("useRef(", "ref(")
      .replace("useCallback(", "memo("),
  ])("accepts the same private timer cleanup callback written during render", (fixture) => {
    const result = runRule(effectNeedsCleanup, fixture, { filename: "Clock.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an overwritten callback",
      source.replace("stopRef.current = stop;", "stopRef.current = () => {};"),
    ],
    [
      "an escaped callback ref",
      source.replace("stopRef.current = stop;", "stopRef.current = stop; consume(stopRef);"),
    ],
    [
      "a deferred callback overwrite",
      source.replace(
        "stopRef.current = stop;",
        "stopRef.current = stop; queueMicrotask(() => { stopRef.current = () => {}; });",
      ),
    ],
    ["an optional cleanup call", source.replace("stopRef.current();", "stopRef.current?.();")],
    [
      "a deferred cleanup",
      source.replace("stopRef.current();", "queueMicrotask(() => stopRef.current());"),
    ],
    [
      "a timer handle lost before cleanup",
      source.replace("stopRef.current();", "handleRef.current = null; stopRef.current();"),
    ],
    [
      "a timer handle lost before clearing",
      source.replace(
        "clearInterval(handleRef.current);",
        "handleRef.current = null; clearInterval(handleRef.current);",
      ),
    ],
    [
      "an escaped timer ref",
      source.replace("stopRef.current = stop;", "stopRef.current = stop; consume(handleRef);"),
    ],
    [
      "a second allocation in the same slot",
      source.replace(
        "handleRef.current = setInterval(update, 1000);",
        "handleRef.current = setInterval(update, 1000); handleRef.current = setInterval(update, 1000);",
      ),
    ],
    [
      "a loop that allocates repeatedly",
      source.replace(
        "handleRef.current = setInterval",
        "while (enabled) handleRef.current = setInterval",
      ),
    ],
    [
      "a finally block that replaces cleanup",
      source.replace(
        /return \(\) => \{\s+stopRef\.current\(\);\s+\};/,
        "try { return () => { stopRef.current(); }; } finally { return () => {}; }",
      ),
    ],
    [
      "a throw before the release",
      source
        .replace("clearInterval(handleRef.current);", "fail(); clearInterval(handleRef.current);")
        .replace("export const Clock", "const fail = () => { throw Error(); }; export const Clock"),
    ],
    [
      "a different timer handle",
      source.replace("clearInterval(handleRef.current);", "clearInterval(otherHandle);"),
    ],
    [
      "a patched clear function",
      source.replace(
        "export const Clock",
        "globalThis.clearInterval = () => {}; export const Clock",
      ),
    ],
    [
      "a patched timer reached through a document",
      source.replace(
        "export const Clock",
        "document.defaultView.clearInterval = () => {}; export const Clock",
      ),
    ],
    [
      "a patched timer reached through a legacy accessor",
      source.replace(
        "export const Clock",
        "document.defaultView.__defineGetter__('clearInterval', () => () => {}); export const Clock",
      ),
    ],
    [
      "a patched timer reached through an aliased reflection method",
      source.replace(
        "export const Clock",
        "const key = 'defineProperty'; Object[key](document.defaultView, 'clearInterval', { value: () => {} }); export const Clock",
      ),
    ],
    [
      "a patched React ref hook",
      source
        .replace("import { useCallback", "import React, { useCallback")
        .replace(
          "export const Clock",
          "React.useRef = () => ({ get current() { return () => {}; }, set current(value) {} }); export const Clock",
        ),
    ],
  ])("reports %s", (_name, fixture) => {
    expect(fixture === source).toEqual(false);
    const result = runRule(effectNeedsCleanup, fixture, { filename: "Clock.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
