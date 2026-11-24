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

const withCaptureDeclaration = (
  declaration: string,
  registration: string,
  release: string,
): string =>
  withCapture(registration, release).replace("const timeout", `${declaration} const timeout`);

describe("unconditional cleanup of deferred Document listeners", () => {
  it.each([
    ["direct receiver", source],
    ["equal explicit capture", withCapture(", true", ", true")],
    ["equal explicit non-capture", withCapture(", false", ", false")],
    [
      "local capture flag",
      withCaptureDeclaration("const capture = true;", ", capture", ", capture"),
    ],
    [
      "local non-capture flag",
      withCaptureDeclaration("const capture = false;", ", capture", ", capture"),
    ],
    [
      "local default registration flag",
      withCaptureDeclaration("const capture = false;", ", capture", ""),
    ],
    [
      "local default release flag",
      withCaptureDeclaration("const capture = false;", "", ", capture"),
    ],
    [
      "local and literal capture",
      withCaptureDeclaration("const capture = true;", ", capture", ", true"),
    ],
    [
      "guarded local capture",
      withCaptureDeclaration(
        "const capture = true; let attached = false;",
        ", capture",
        ", capture",
      )
        .replace("document.addEventListener", "attached = true; document.addEventListener")
        .replace("document.removeEventListener", "if (attached) document.removeEventListener"),
    ],
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
    [
      "mismatched local capture",
      withCaptureDeclaration("const capture = true;", ", capture", ", false"),
    ],
    [
      "mutable capture changed during delivery",
      withCaptureDeclaration("let capture = true;", ", capture", ", capture").replace(
        'console.log("resize")',
        "{ capture = false; }",
      ),
    ],
    [
      "mutable options object behind a const",
      withCaptureDeclaration(
        "const options = { capture: true };",
        ", options",
        ", options",
      ).replace('console.log("resize")', "{ options.capture = false; }"),
    ],
    [
      "dynamic capture initializer",
      withCaptureDeclaration("const capture = enabled;", ", capture", ", capture"),
    ],
    [
      "capture declared after cleanup return",
      withCapture(", capture", ", capture").replace(
        "  }, [enabled]",
        "    const capture = true;\n  }, [enabled]",
      ),
    ],
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
