import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const source = `
import { useEffect } from "react";

export const ListenerPanel = ({ enabled }) => {
  useEffect(() => {
    if (!enabled) return;
    const handleChange = () => console.log("changed");
    let didAttach = false;
    const timeout = setTimeout(() => {
      didAttach = true;
      document.addEventListener("selectionchange", handleChange);
    }, 10);
    return () => {
      clearTimeout(timeout);
      if (didAttach) {
        document.removeEventListener("selectionchange", handleChange);
      }
    };
  }, [enabled]);
  return null;
};
`;

describe("effect-owned listeners registered by a cancellable timeout", () => {
  it.each([
    ["the same Document", source],
    [
      "the same local Document alias",
      source
        .replace("let didAttach", "const target = document; let didAttach")
        .replaceAll("document.addEventListener", "target.addEventListener")
        .replaceAll("document.removeEventListener", "target.removeEventListener"),
    ],
    [
      "unbraced cleanup guard",
      source
        .replace("if (didAttach) {", "if (didAttach)")
        .replace("handleChange);\n      }\n", "handleChange);\n"),
    ],
  ])("accepts cleanup through %s", (_name, fixture) => {
    const result = runRule(effectNeedsCleanup, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["missing cancellation", source.replace("clearTimeout(timeout);", "")],
    ["a different timeout", source.replace("clearTimeout(timeout)", "clearTimeout(otherTimeout)")],
    [
      "a different realm",
      source.replace("clearTimeout(timeout)", "frame.contentWindow.clearTimeout(timeout)"),
    ],
    [
      "a shadowed cancel function",
      source.replace("const timeout", "const clearTimeout = stop; const timeout"),
    ],
    [
      "a different event",
      source.replace('removeEventListener("selectionchange"', 'removeEventListener("focus"'),
    ],
    [
      "a different handler",
      source.replace(
        'removeEventListener("selectionchange", handleChange)',
        'removeEventListener("selectionchange", otherHandler)',
      ),
    ],
    [
      "capture mismatch",
      source.replace(
        'removeEventListener("selectionchange", handleChange)',
        'removeEventListener("selectionchange", handleChange, true)',
      ),
    ],
    ["a changing body", source.replaceAll("document.", "document.body.")],
    [
      "an unverified body instance",
      source
        .replace("let didAttach", "const target = document.body; let didAttach")
        .replaceAll("document.addEventListener", "target.addEventListener")
        .replaceAll("document.removeEventListener", "target.removeEventListener"),
    ],
    [
      "an event parameter",
      source.replace(
        '() => console.log("changed")',
        "(event) => { event.currentTarget.removeEventListener = replacement; }",
      ),
    ],
    [
      "ambient event exposes its target",
      source.replace(
        '() => console.log("changed")',
        "() => { event.currentTarget.removeEventListener = replacement; }",
      ),
    ],
    [
      "an alternate Document reference",
      source.replace(
        '() => console.log("changed")',
        "() => { node.ownerDocument.removeEventListener = replacement; }",
      ),
    ],
    [
      "an alternate Document binding",
      source.replace(
        '() => console.log("changed")',
        "() => { const { ownerDocument: owner } = node; owner.removeEventListener = replacement; }",
      ),
    ],
    ["inverse guard", source.replace("if (didAttach)", "if (!didAttach)")],
    [
      "another flag write",
      source.replace(
        'addEventListener("selectionchange", handleChange);',
        'addEventListener("selectionchange", handleChange); didAttach = false;',
      ),
    ],
    ["dynamic flag access", source.replace('console.log("changed")', 'eval("didAttach = false")')],
    [
      "conditional native method override",
      source.replace(
        "const timeout",
        "if (enabled) document.removeEventListener = replacement; const timeout",
      ),
    ],
    [
      "conditional prototype alias override",
      source.replace(
        "const timeout",
        "const prototype = EventTarget.prototype; if (enabled) prototype.removeEventListener = replacement; const timeout",
      ),
    ],
    [
      "conditional Document alias override",
      source.replace(
        "const timeout",
        "let target = document; if (enabled) target.removeEventListener = replacement; const timeout",
      ),
    ],
    [
      "a cleanup interruption",
      source.replace("clearTimeout(timeout);", "mightThrow(); clearTimeout(timeout);"),
    ],
    ["a setup interruption", source.replace("return () => {", "mightThrow(); return () => {")],
  ])("retains the warning for %s", (_name, fixture) => {
    const result = runRule(effectNeedsCleanup, fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
