import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { formatRuleSummary, printDiagnostics } from "../src/cli/utils/render-diagnostics.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  title: "Array index used as a key",
  message: "Reordering the list re-renders the wrong rows.",
  help: "Use a stable id as the key.",
  line: 3,
  column: 1,
  category: "Correctness",
  ...overrides,
});

const ANSI = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI, "");

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

describe("file-context tags in rendered diagnostics", () => {
  it("labels sites in test files so they don't read as production impact", async () => {
    const diagnostics = [
      makeDiagnostic({ filePath: "src/utils/foo.spec.tsx", fileContext: "test" }),
    ];
    const output = await captureOutput(() =>
      Effect.runPromise(printDiagnostics(diagnostics, false, "/nonexistent")),
    );
    expect(output).toContain("src/utils/foo.spec.tsx:3 (test file)");
  });

  it("labels sites in story files", async () => {
    const diagnostics = [
      makeDiagnostic({ filePath: "src/Button.stories.tsx", fileContext: "story" }),
    ];
    const output = await captureOutput(() =>
      Effect.runPromise(printDiagnostics(diagnostics, false, "/nonexistent")),
    );
    expect(output).toContain("src/Button.stories.tsx:3 (story file)");
  });

  it("leaves production sites untagged", async () => {
    const diagnostics = [makeDiagnostic()];
    const output = await captureOutput(() =>
      Effect.runPromise(printDiagnostics(diagnostics, false, "/nonexistent")),
    );
    expect(output).toContain("src/App.tsx:3");
    expect(output).not.toContain("file)");
  });

  it("tags file sites in the per-rule text summary", () => {
    const summary = formatRuleSummary("react-doctor/no-array-index-as-key", [
      makeDiagnostic({ filePath: "src/utils/foo.spec.tsx", fileContext: "test" }),
      makeDiagnostic(),
    ]);
    expect(summary).toContain("src/utils/foo.spec.tsx:3 (test file)");
    expect(summary).toContain("src/App.tsx:3\n");
  });
});
