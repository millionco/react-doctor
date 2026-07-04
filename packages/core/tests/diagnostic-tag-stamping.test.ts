import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { createNodeReadFileLinesSync, mergeAndFilterDiagnostics } from "@react-doctor/core";

const ROOT = "/tmp/tag-stamping";
const readFileLines = createNodeReadFileLinesSync(ROOT);

const stamp = (diagnostic: Diagnostic): Diagnostic | undefined =>
  mergeAndFilterDiagnostics([diagnostic], ROOT, null, readFileLines, {
    respectInlineDisables: false,
    warnings: true,
  })[0];

const base = {
  filePath: "src/App.tsx",
  severity: "warning",
  message: "m",
  help: "",
  line: 1,
  column: 1,
} as const;

describe("per-diagnostic tag stamping", () => {
  it("stamps a registered react-doctor rule with its projected impact tag", () => {
    const stamped = stamp({
      ...base,
      plugin: "react-doctor",
      rule: "no-derived-state",
      category: "Bugs",
    });
    expect(stamped?.tags).toContain("impact:behavior");
    expect(stamped?.tags?.some((tag) => tag.startsWith("confidence:"))).toBe(true);
    expect(stamped?.tags?.some((tag) => tag.startsWith("fix:"))).toBe(true);
  });

  it("stamps a non-registry first-party producer from the fallback map", () => {
    const stamped = stamp({
      ...base,
      plugin: "deslop",
      rule: "unused-export",
      category: "Maintainability",
    });
    expect(stamped?.tags).toEqual(["impact:style", "confidence:heuristic", "fix:mechanical"]);
  });

  it("leaves third-party plugin diagnostics untagged", () => {
    const stamped = stamp({
      ...base,
      plugin: "react-hooks",
      rule: "some-upstream-rule",
      category: "Bugs",
    });
    expect(stamped?.tags).toBeUndefined();
  });
});
