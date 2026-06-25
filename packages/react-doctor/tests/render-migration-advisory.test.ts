import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { MIGRATION_SCALE_RULE_FILE_COUNT } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import {
  buildMigrationScaleAdvisoryLines,
  printDiagnostics,
} from "../src/cli/utils/render-diagnostics.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "react-compiler-no-manual-memoization",
  severity: "error",
  title: "Manual memoization",
  message: "The compiler already memoizes this.",
  help: "Remove the manual useMemo/useCallback.",
  line: 3,
  column: 1,
  category: "Performance",
  ...overrides,
});

const ANSI = new RegExp(String.raw`\[[0-?]*[ -/]*[@-~]`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI, "");

// One rule spread across `fileCount` distinct files (one site each), so its
// blast radius is exactly `fileCount`.
const spreadAcrossFiles = (fileCount: number): Diagnostic[] =>
  Array.from({ length: fileCount }, (_unused, fileIndex) =>
    makeDiagnostic({ filePath: `src/components/widget-${fileIndex}.tsx`, line: fileIndex + 1 }),
  );

const captureOutput = async (run: () => Promise<void>): Promise<string> => {
  const writes: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    writes.push(`${args.join(" ")}\n`);
  });
  try {
    await run();
  } finally {
    logSpy.mockRestore();
  }
  return stripAnsi(writes.join(""));
};

describe("migration-scale advisory", () => {
  it("stays silent below the file threshold", () => {
    const lines = buildMigrationScaleAdvisoryLines(
      spreadAcrossFiles(MIGRATION_SCALE_RULE_FILE_COUNT - 1),
    );
    expect(lines).toEqual([]);
  });

  it("names the rule, its blast radius, the why, and the scope-down step", () => {
    const fileCount = MIGRATION_SCALE_RULE_FILE_COUNT + 5;
    // The guidance prose wraps to the terminal measure, so collapse whitespace
    // before asserting on phrases that may straddle a wrap boundary.
    const text = stripAnsi(
      buildMigrationScaleAdvisoryLines(spreadAcrossFiles(fileCount)).join("\n"),
    )
      .replace(/\s+/g, " ")
      .trim();
    expect(text).toContain("Migration-scale change");
    expect(text).toContain("Manual memoization");
    expect(text).toContain(`×${fileCount} across ${fileCount} files`);
    expect(text).toContain("get the code owner's sign-off");
    expect(text).toContain("npx react-doctor@latest <path>");
  });

  it("counts files, not raw sites, so a rule hammering few files stays silent", () => {
    // Far more sites than the threshold, but all in two files -> small PR, no advisory.
    const sites = Array.from({ length: MIGRATION_SCALE_RULE_FILE_COUNT * 10 }, (_unused, index) =>
      makeDiagnostic({ filePath: index % 2 === 0 ? "src/a.tsx" : "src/b.tsx", line: index + 1 }),
    );
    expect(buildMigrationScaleAdvisoryLines(sites)).toEqual([]);
  });

  it("surfaces the advisory in the rendered report", async () => {
    const output = await captureOutput(() =>
      Effect.runPromise(
        printDiagnostics(
          spreadAcrossFiles(MIGRATION_SCALE_RULE_FILE_COUNT + 2),
          false,
          "/nonexistent",
        ),
      ),
    );
    expect(output).toContain("Migration-scale change");
    expect(output).toContain("sample before you sweep");
  });
});
